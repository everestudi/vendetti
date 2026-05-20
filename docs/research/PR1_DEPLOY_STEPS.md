# PR 1 — Deploy steps · Runtime de agentes Vendetti

Implementação inicial do refactor "empresa de verdade". Você precisa rodar 3
comandos pra colocar isso ao vivo. Nada destrutivo — só ADD de tabelas novas e
ADD de endpoint novo. Zero impacto no que tá em produção hoje.

## O que foi adicionado

### Schema Prisma (5 tabelas novas)
- `Agent` — definição de cada agente (slug, promptCore, model, toolsAllowed, budget)
- `AgentRun` — cada execução de agente com thinking + output + cost
- `AgentMessage` — mailbox unificado (humano + agentes na mesma timeline)
- `AgentWakeupRequest` — fila com coalescing (rouba do Paperclip)
- `AgentMemoryRecall` — memória searchable (keyword search v1; semantic em PR 3)

### Código novo
- `src/lib/agents/types.ts` — contratos (AgentRunContext, AgentRunResult, etc)
- `src/lib/agents/seed.ts` — config dos 7 agentes + SHARED_RULES
- `src/lib/agents/runtime.ts` — core: claim wakeup → load context → call LLM → parse → persist
- `src/app/api/tick/route.ts` — endpoint POST chamado pelo cron GH Actions
- `src/app/empresa/page.tsx` — UI live feed da empresa conversando
- `src/components/EmpresaFeed.tsx` — componente client do feed
- `scripts/seed-agents.ts` — popular DB com os 7 agentes (idempotente)
- `scripts/tick-once.ts` — rodar um tick local pra testar
- `.github/workflows/agents-tick.yml` — cron a cada 15min (free) ou 5min (pro)

### Package.json
- `npm run seed:agents` — popula os 7 agentes
- `npm run agents:tick` — roda 1 tick local

## Passo a passo do deploy

### 1. Aplicar migration no Neon
```bash
# .env.local já tem DATABASE_URL apontando pro Neon prod
npm run db:push
```

Isso vai criar as 5 tabelas novas + enums. **Não toca em nenhuma tabela existente.**
Resposta esperada:
```
Your database is now in sync with your Prisma schema.
```

### 2. Popular os 7 agentes
```bash
npm run seed:agents
```

Saída esperada:
```
🌱 Seeding 7 agentes...
  🎩 Augusto Vendetti     ✓ criado
  📊 Mara                 ✓ criado
  🧾 Bruno                ✓ criado
  🔍 Zelda                ✓ criado
  🔧 Rita                 ✓ criado
  💬 Lúcia                ✓ criado
  🛠️ Gabi                 ✓ criado
✓ 7 agentes ativos no DB
```

### 3. Testar localmente
Abra `http://localhost:3000/empresa` (rode `npm run dev` se não estiver).

Você vai ver a sidebar com os 7 agentes + feed vazio ("A empresa ainda não conversou").

Pra acordar a empresa:
```bash
# Dispara wakeup pro Augusto via API direto
curl -X POST http://localhost:3000/api/tick \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"maxRuns": 1}'
```

Como ainda não tem wakeups na fila (mailbox vazio), o tick não vai fazer nada.
Pra testar, **dispare um wakeup manualmente** via Prisma Studio ou via /chat
quando você falar com Augusto.

### 4. GitHub Actions secrets
Pro cron rodar em prod, configure no repo `everestudi/vendetti`:

- `APP_URL` = `https://vendetti.everest.udi.br` (ou seu deploy Vercel)
- `CRON_SECRET` = mesmo valor do .env.local

```bash
gh secret set APP_URL --repo everestudi/vendetti --body "https://vendetti.everest.udi.br"
gh secret set CRON_SECRET --repo everestudi/vendetti --body "<valor>"
```

(Você já tem CRON_SECRET configurado pro mara-sync — reaproveita.)

### 5. Deploy Vercel
Push pra main. Vercel detecta mudança em `prisma/schema.prisma`, mas o
`db push` já rodou no passo 1, então só o build novo do app.

```bash
git add -A
git commit -m "feat(agents): runtime de empresa virtual — schema + tick loop + UI /empresa"
git push origin main
```

## Como testar end-to-end

1. Abra `/empresa` → vê 7 agentes na sidebar, feed vazio
2. Vá em `/chat` (Augusto chat antigo) e mande "ok, me dá um status da operação"
3. O `/chat` antigo ainda funciona — não foi migrado pro novo runtime nesse PR
4. PR 2: vamos migrar Augusto pro novo runtime, conectar `/chat` ao mailbox,
   e criar o botão "falar com X" em `/empresa`

## O que NÃO foi feito ainda (próximos PRs)

| PR | Escopo | Estimativa |
|---|---|---|
| 2 | Migrar Augusto pro novo runtime + UI "falar com X" + thinking visível | ~6h |
| 3 | Memória semantic search (embeddings Voyage-3) + budget reset mensal | ~6h |
| 4 | Gabi co-founder: tools de repo (file_read, gh_create_issue) + UI de propostas | ~8h |
| 5 | Tools "agent_send_message" e "agent_list_inbox" como tool-calls do Anthropic SDK (hoje o parser de markdown faz isso) | ~4h |
| 6 | Briefing matinal Augusto → WhatsApp Rita (cron 8h) | ~3h |

## Decisões que ficaram travadas

Implementação assumiu defaults reversíveis:

1. **Embedding**: nenhum por enquanto (keyword search no body) — PR 3 adiciona
2. **Mailbox**: público (todos veem) — campo `visibility` será adicionado se você quiser private msgs
3. **Tick**: 15min cron (free GH Actions) + push imediato via API quando você mandar msg do /chat
4. **Gabi**: começa sem permissão de PR — só propõe via mailbox
5. **Archival**: Postgres TOAST por enquanto — S3 quando memory passar de 1GB

Todas reversíveis sem migration destrutiva.

## Riscos & rollback

**Risco baixo.** Schema novo só adiciona, não modifica tabela existente.
Rollback completo:

```bash
# Drop tabelas novas (em prisma studio ou SQL direto)
DROP TABLE "AgentMemoryRecall", "AgentMessage", "AgentRun", "AgentWakeupRequest", "Agent" CASCADE;
DROP TYPE "AgentTrigger", "AgentRunStatus", "AgentMessageKind", "AgentMessageStatus", "AgentWakeupStatus", "AgentMemoryKind";
```

Endpoint `/api/tick` só processa wakeups da fila — fila vazia = no-op. Pode
deployar sem o cron ativo e testar manualmente primeiro.
