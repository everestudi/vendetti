# Vendetti · Arquitetura multi-agente — pesquisa + proposta

Documento consolidado da pesquisa feita em mai/2026 sobre frameworks e plataformas
de orquestração multi-agente, com proposta arquitetural pro próximo refactor do
Vendetti.

**Contexto**: hoje o Vendetti tem 1 LLM real (Opus 4.7 no `/chat`) com 22 tools
nomeadas por prefixo (`mara_*`, `bruno_*`, etc). Os "6 agentes" são teatro de UI.
Queremos uma empresa virtual de verdade: agentes paralelos, mailbox visível,
schedules, memória de longo prazo, e um agente "co-founder" que ajuda a evoluir
o próprio produto Vendetti.

---

## 1. Paperclip (paperclipai/paperclip) — diagnóstico

Repo MIT, TypeScript, monorepo pnpm. **2502 commits totais, 1049 nos últimos
60 dias, 426 test files**. Substância real, não vibe inflado.

### Arquitetura

- **Não é framework, é control plane**: Express server + UI React + Postgres
  (Drizzle) orquestrando adapters externos (Claude Code CLI, Codex CLI, Cursor,
  HTTP, process). O servidor não inferencia LLM — invoca CLI e guarda resultado.
- **Modelo mental**: `companies → goals → projects → issues → issue_comments`.
  Agentes vivem em árvore via `agents.reports_to`. Toda mutação cai em `activity_log`.
- **Loop principal** (`server/src/index.ts:719-740`): um `setInterval` chama
  `heartbeat.tickTimers()` + `routines.tickScheduledTriggers()` +
  `reapOrphanedRuns()` + `promoteDueScheduledRetries()`. Sem queue externa — tudo
  via Postgres.

### Patterns que valem ouro pro Vendetti

| # | Pattern | Arquivo de referência | Por que importa |
|---|---|---|---|
| 1 | **Wakeup coalescing** | `packages/db/src/schema/agent_wakeup_requests.ts` | Fila por agente com `status`, `idempotencyKey`, `coalescedCount`. Múltiplos wakes enquanto agente roda viram um só. Resolve concorrência sem Redis/BullMQ. |
| 2 | **4 fontes de wake** | `docs/agents-runtime.md` | `timer | assignment | on_demand | automation`. Modelo simples e suficiente — cobre cron, mailbox-delivered, /chat, e mara_sync. |
| 3 | **Mailbox = comments em issues** | `packages/db/src/schema/issue_comments.ts` | Não há sistema de chat separado. `authorAgentId` / `authorUserId` / `authorType` no mesmo registro. Humano e agente na mesma timeline. UI "empresa conversando" sai natural. |
| 4 | **Atomic checkout** | `services/issues-checkout-wakeup.ts` | Transição `pending → in_progress` atômica via DB. Single-assignee. Evita 2 agentes pegando o mesmo ticket. |
| 5 | **Cron parser inline** | `server/src/services/cron.ts` (373 linhas, zero deps) | MIT — copia direto pro Vendetti. |
| 6 | **Routines versionadas** | `packages/db/src/schema/routines.ts` | `concurrencyPolicy: "coalesce_if_active"`, `catchUpPolicy: "skip_missed"`, `latestRevisionId`. Quando o agente meta evoluir prompts dos outros, audit grátis. |
| 7 | **Budget hard-stop per-agent** | `server/src/services/budgets.ts` | Quando `observedAmount >= amount`, retorna `"hard_stop"` e pausa o agente. Vital — Opus 4.7 não é barato. |
| 8 | **Adapter contract minimalista** | `packages/adapter-utils/src/types.ts:349-432` | `execute(ctx) → {usage, costUsd, sessionParams, ...}`. Padroniza retorno de cada agente, dá budget tracking de graça. |

### Por que NÃO migrar pra Paperclip

- Paperclip = **Express + Postgres long-running process**. Vendetti = **Next.js 16
  App Router + Neon serverless** (Vercel). Adoptar Paperclip inteiro = abandonar
  Vercel, hostear Node 24/7, refatorar tudo pro shape `company → issue → comment`.
- Paperclip presupõe **CLIs externos como adapters**. Vendetti já tem `ai-sdk` +
  Anthropic SDK in-process. Adapter pra envelopar SDK = overengineering.
- A UI Paperclip é board genérica de tickets. Vendetti tem identidade visual
  própria — perde isso.

### Veredicto Paperclip

**Rouba 8 patterns acima, não migra.** O loop `setInterval` deles não cabe em
serverless — pra Vendetti continua GH Actions cron disparando `/api/tick`. Mas
a estrutura **interna** do tick (claim wakeup atômico → execute → grava resultado
→ publica live event) é exatamente o que precisamos.

---

## 2. Frameworks similares — comparativo

| Framework | Comunicação | Schedule | Memória | Linguagem | Stars | Prod-ready |
|---|---|---|---|---|---|---|
| **CrewAI** | Delegação role-based (manager→worker), seq ou hierárquico | Não nativo | LanceDB + tree, semantic+recency | Python | 51.7k | ❌ Médio — hierarchical mode quebra silenciosamente |
| **AutoGen** | Actor model, msgs assíncronas | Não nativo | Sem persistência first-class | Python | 58.2k | ❌ Microsoft em **maintenance mode** em 2026 |
| **LangGraph** | Graph (nodes/edges) + handoffs + shared state | Não nativo | **Checkpointing built-in (PG/SQLite) + time-travel** | Python + **TS paridade** | 32.4k | ✅ Alto — Replit, Uber, LinkedIn, GitLab |
| **Mastra** | Supervisor + subagents-as-tools + workflows | **Cron nativo via Inngest** | Memory module + threads/resources | **TypeScript** | 24k | ✅ Crescente — YC W25, 300k npm/sem, jan/2026 GA |
| **Letta** | Shared memory blocks entre agentes + tool messaging | Sleeptime agents + scheduling | **Hierárquica 3-tier: Core / Recall / Archival** | Python (HTTP) | 22.8k | Médio — stateful-first, infra própria |

### Highlights por framework

- **CrewAI ❌**: Towards Data Science e fórum oficial documentam que hierarchical
  process executa tudo sequencial mesmo quando deveria delegar seletivo. Memória
  cresce linear (>2GB com 10 agents/50 tasks). Telemetria envia prompts por padrão.
  Bom protótipo, ruim 24/7.
- **AutoGen ❌**: actor model bonito (v0.4 reescreveu sobre msgs async), mas
  Microsoft em maintenance mode início 2026, energia foi pro novo Agent Framework
  (fusão com Semantic Kernel). AutoGen Studio "not production-ready".
- **LangGraph ✅ patterns**: o mais sólido prod da lista. Checkpointing first-class
  + time-travel debugging + interrupts pra human-in-loop + TS SDK com paridade
  real. Curva mais íngreme — você desenha grafo explícito, ganha previsibilidade.
- **Mastra ✅ stack match**: único TS nativo. YC W25, time do Gatsby, $13M. Cron
  schedule nativo via Inngest. Suspend/resume em workflows. Studio playground.
  Modelo claro: **agents** (tarefas abertas) vs **workflows** (fluxos determinísticos).
  Issue #12682 mostra cron landou recentemente. Stack match com Vendetti é perfeito.
- **Letta ✅ conceito**: herdeiro do paper MemGPT. **Memória hierárquica como SO**:
  - **Core** (RAM, in-context): identidade do agente, KPIs atuais, regras invioláveis
  - **Recall** (disk, searchable): histórico
  - **Archival** (cold storage via tool call): dumps, logs operacionais
  - Memory blocks **compartilhados entre agentes** (multi-agent shared state real)

---

## 3. Proposta de arquitetura pro Vendetti

Não adoptar nenhum em bloco. Construir runtime próprio que rouba seletivo:

### Stack final

- **Base**: Next.js 16 App Router + Prisma + Postgres (Neon) — já temos
- **Cron**: GitHub Actions chamando `/api/tick` (Vercel-friendly, já temos pra mara_sync)
- **Comunicação**: tabela `AgentMessage` no Prisma (mailbox)
- **Wakeup**: tabela `AgentWakeupRequest` com coalescing (rouba do Paperclip)
- **Memória**: 3-tier inspirada em Letta (Core in-prompt, Recall via Postgres+pgvector, Archival cold)
- **Checkpoint**: tabela `AgentRun` com state JSON + cost tracking
- **Handoffs explícitos**: agente retorna `{ next: 'bruno', payload: ... }` (rouba do LangGraph)
- **Budget guard**: hard-stop per-agent (rouba do Paperclip)

### Schema Prisma novo (esboço)

```prisma
model Agent {
  id          String   @id @default(cuid())
  slug        String   @unique  // 'augusto', 'mara', 'bruno', 'rita', 'zelda', 'lucia', 'gabi'
  name        String
  emoji       String
  promptCore  String   @db.Text  // memória Core (in-prompt)
  promptRev   Int      @default(1)
  model       String   // 'claude-opus-4-7', 'claude-sonnet-4-5', 'claude-haiku-4-5'
  toolsAllowed String[] // subset de tools que esse agente pode chamar
  budgetUsdMonth Decimal @default(50)
  active      Boolean  @default(true)
  reportsTo   String?  // hierarquia: Mara/Bruno/Rita/Zelda/Lucia → Augusto
  runs        AgentRun[]
  messagesFrom AgentMessage[] @relation("from")
  messagesTo   AgentMessage[] @relation("to")
}

model AgentRun {
  id          String   @id @default(cuid())
  agentId     String
  agent       Agent    @relation(fields: [agentId], references: [id])
  trigger     String   // 'cron' | 'mailbox' | 'on_demand' | 'automation'
  status      String   // 'running' | 'completed' | 'failed' | 'budget_stopped'
  thinkingMd  String?  @db.Text  // chain-of-thought visível na UI
  outputMd    String?  @db.Text
  toolCalls   Json?    // log estruturado
  costUsd     Decimal  @default(0)
  tokensIn    Int      @default(0)
  tokensOut   Int      @default(0)
  startedAt   DateTime @default(now())
  finishedAt  DateTime?
  errorMsg    String?
}

model AgentMessage {
  id          String   @id @default(cuid())
  fromAgentId String?  // null = humano (Luís)
  fromAgent   Agent?   @relation("from", fields: [fromAgentId], references: [id])
  toAgentId   String?  // null = broadcast (todos veem)
  toAgent     Agent?   @relation("to", fields: [toAgentId], references: [id])
  threadId    String?  // pra agrupar conversa
  body        String   @db.Text
  attachments Json?    // links/files
  status      String   @default("delivered")  // 'delivered' | 'read' | 'actioned'
  triggeredRunId String? // se gerou wakeup, qual run resolveu
  createdAt   DateTime @default(now())
  readAt      DateTime?
}

model AgentWakeupRequest {
  id          String   @id @default(cuid())
  agentId     String
  source      String   // 'cron' | 'mailbox:msgId' | 'on_demand:userId' | 'automation:ruleId'
  status      String   @default("queued")  // 'queued' | 'claimed' | 'completed' | 'failed' | 'coalesced'
  idempotencyKey String? @unique
  coalescedCount Int   @default(0)
  payload     Json?
  createdAt   DateTime @default(now())
  claimedAt   DateTime?
  completedAt DateTime?
}

model AgentMemoryRecall {
  id          String   @id @default(cuid())
  agentId     String
  kind        String   // 'decision' | 'insight' | 'mistake' | 'conversation'
  summary     String   // ~200 chars pra semantic search
  embedding   Unsupported("vector(1536)")?
  body        String   @db.Text
  refs        Json?    // links pra Decision/Idea/Transaction etc
  createdAt   DateTime @default(now())
  lastUsedAt  DateTime?
}
```

### Tick loop (em `/api/tick` chamado por GH Actions cron a cada 5min)

```
1. claim N wakeups oldest-first (DB transação atômica)
2. pra cada wakeup:
   a. carrega Agent + última AgentMemoryRecall relevante (semantic search pelo
      payload)
   b. monta system prompt = promptCore + recall + msg que disparou
   c. chama Anthropic com tools = toolsAllowed
   d. parse output → procura handoffs / mensagens novas / decisions
   e. grava AgentRun (cost, thinking, output)
   f. cria AgentMessage pros handoffs
   g. cria AgentMemoryRecall se output tiver insights/decisões
3. budget check: se agent.spentMonth >= budget → marca AgentRun status=budget_stopped
```

### Os 7 agentes

| Agente | Modelo | Quando roda | Tools (subset) | Responsabilidade |
|---|---|---|---|---|
| **Augusto** (CEO) | Opus 4.7 | Cron 8h + mailbox + /chat | TODAS read-only + mara_force_sync + rita_send_luis | Briefing matinal, recebe inputs dos outros, decide, fala com Luís |
| **Mara** (analista) | Sonnet 4.5 | Após mara_sync (cron) | mara_*, transactions_*, infra_health | Roda análise depois de cada scrape, escreve findings em mailbox pro Augusto |
| **Bruno** (comprador) | Sonnet 4.5 | Cron 2x/semana + on_demand | bruno_*, mara_margin_buckets, mara_slot_detail | Monitora preços Atacadão vs custo, propõe recompras |
| **Zelda** (auditora) | Opus 4.7 | Após cada Decision criada | list_recent_decisions, zelda_* | Revisa decisões, flag suspeitas, escala pro Luís |
| **Rita** (ops) | Haiku 4.5 | Mailbox-driven | rita_* | Executa pick-lists, manda Z-API outbound pro Weverton |
| **Lúcia** (SAC) | Sonnet 4.5 | Z-API inbound trigger | lucia_*, decision_create | Classifica msg recebida, responde scripted ou escala |
| **Gabi** (co-founder) | Opus 4.7 | Cron diário + /chat | gh CLI, git, file_read, propose_pr | **Lê o repo Vendetti**, identifica problemas/oportunidades no PRÓPRIO produto, propõe PRs ou ideias no mailbox |

### UI nova: `/empresa` (página que substitui `/equipe`)

- Lista de agentes ativos com status ao vivo (idle, running, blocked-by-budget)
- Feed de mensagens em tempo real (polling de AgentMessage) — você "vê a empresa
  conversando"
- Click num agente → side panel com últimas N runs + thinking de cada uma
- Botão "falar com X" → cria AgentMessage de você pra ele → dispara wakeup
- Budget bar no header (custo mês corrente vs limite global)

---

## 4. Gabi · o agente co-founder (detalhamento)

O conceito mais inovador da proposta. Gabi é um agente cujo **escopo é o próprio
repo Vendetti**, não a vending machine. Tools:

- `repo_read(path)` — lê arquivos do `/Users/luisneto/Desktop/Vending CEO/`
- `repo_grep(pattern)` — busca por padrão
- `gh_list_issues()`, `gh_create_issue(title, body)`, `gh_view_pr(n)`
- `git_log_recent(n=20)`
- `propose_feature(title, motivation, impl_sketch)` — escreve em mailbox pro Luís
- `read_other_agents_runs()` — vê o que os outros 6 produziram pra inferir gaps

Gabi roda cron diário (manhã, antes do Augusto). Faz 1 ciclo:
1. Lê últimas 20 runs dos outros agentes
2. Lê ROADMAP.md
3. Procura padrões: agentes que falham muito (bug?), tools que ninguém usa
   (morta?), pendências antigas (gargalo?), insights repetidos (vira feature?)
4. Propõe 1-3 features novas OU 1-2 bugs pra arrumar
5. Manda no mailbox pro Augusto + pro Luís

Gabi é o que torna a empresa **auto-evolutiva**.

---

## 5. Plano de implementação incremental

Quebrado em 4 PRs de tamanho controlado:

### PR 1 · Schema + tick básico (~6h)
- Migration Prisma com 5 tabelas novas
- Endpoint `/api/tick` que claim+execute wakeups
- Seed dos 7 agentes com promptCore inicial
- 1 agente funcional (Mara) só pra validar loop end-to-end
- Cron GH Actions a cada 5min

### PR 2 · Mailbox + UI `/empresa` (~8h)
- UI react com feed live (polling 5s)
- Click → side panel com runs+thinking
- Botão "falar com X"
- Augusto migrado pro novo runtime (depreca AUGUSTO_SYSTEM_PROMPT atual)

### PR 3 · Memória 3-tier + budget (~6h)
- AgentMemoryRecall + embedding via Anthropic (text-embedding-3)
- Semantic search no início de cada run
- Hard-stop quando budget vence
- Promote/demote tool calls (agente decide o que vira recall)

### PR 4 · Gabi co-founder (~8h)
- Tools de repo (file_read, gh, git)
- Prompt inicial focado em auto-evolução do produto
- UI especial pra propostas de Gabi (você aprova/rejeita)
- Audit log das mudanças que Gabi pediu

**Total estimado**: ~28h de trabalho focado. PR 1+2 entregam o "ver a empresa
pensando" que você pediu. PR 4 entrega o "agente que me ajuda a construir".

---

## 6. Patterns roubados, fontes citadas

| Pattern | De onde | Aplicação no Vendetti |
|---|---|---|
| Wakeup coalescing | Paperclip `agent_wakeup_requests` | Tabela `AgentWakeupRequest` |
| Mailbox = comments unified | Paperclip `issue_comments` | Tabela `AgentMessage` |
| Cron parser inline | Paperclip `services/cron.ts` (MIT) | Copia, se precisar |
| Budget hard-stop | Paperclip `services/budgets.ts` | Field `budgetUsdMonth` + check inicial |
| Adapter `execute(ctx)→{cost, usage}` | Paperclip `adapter-utils/types.ts` | Shape do retorno de run |
| Atomic checkout | Paperclip `issues-checkout-wakeup.ts` | Transaction no claim |
| Checkpointing + time-travel | LangGraph | AgentRun.thinkingMd visível na UI |
| Handoffs explícitos | LangGraph | Output `{ next: 'bruno', payload }` |
| Memória 3-tier | Letta/MemGPT | Core (promptCore) + Recall (table) + Archival (cold S3) |
| Workflows + cron schedule | Mastra | Cron GH Actions + tick endpoint |
| Agents-as-tools | Mastra | Augusto pode chamar `delegate_to(agent_slug, msg)` |

---

## 7. Decisões em aberto pro Luís

1. **Embedding model**: usar `voyage-3` (Anthropic recomendado) ou OpenAI
   `text-embedding-3-small`? Voyage é melhor mas adiciona dependência.
2. **Mailbox público**: toda mensagem fica visível pra todos os agentes ou só
   pros endereçados? Voto: visível (transparência > segredo nessa escala).
3. **Frequência do tick**: a cada 5min (resposta lenta, custo baixo) ou 1min
   (responsivo, custo 5x maior)? Voto: 5min default + push imediato quando você
   mandar mensagem do `/chat`.
4. **Gabi com permissão de criar PR**? Ou só de escrever issue/proposta?
   Voto: começa com proposta (não-destrutivo), evolui pra PR depois.
5. **Memória archival em S3 ou Postgres TOAST**? Voto: Postgres por simplicidade
   inicial, S3 quando passar de 1GB.
