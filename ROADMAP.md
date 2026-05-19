# Vendetti · Roadmap

Estado e prioridades. Vivo — atualiza quando faz sense.

---

## Onde estamos hoje (2026-05)

**Funcionando end-to-end:**

- ✅ Bruno: upload NF-e → parse vision → matcher F1+noise → confirmação UI → scraper Vendtef (cadastro produto + configurar Estoque Everest + entrada de estoque)
- ✅ Rita (flow Weverton): mensagem grupo WhatsApp → parser multi-linha → LLM review (Haiku, detecta slot-swap/alias/variantes) → Decision PENDING → editor inline em /decisions → aprovar+executar → scraper Vendtef (cadastro se novo + configurar máquina + swap slot + abastecimento)
- ✅ Lúcia: SAC + Inquiries (locação, estacionamento, geral) com classificador Haiku + state machine + escalation pro Luís
- ✅ Mara: scrape diário Vendtef/Vendpago + analytics + slots-com-margem
- ✅ Zelda: audit autônomo de match corrections, gera findings com prompt-pronto-pra-Augusto, WhatsApp pro Luís quando há finding
- ✅ Augusto (Vendetti CEO): chat, tools (mara_summary, transactions_recent, mara_force_sync, infra_health, etc), decisions
- ✅ Observability: /webhooks, AgentTerminal por agente, ScraperLiveStatus em /bruno, /equipe/zelda

**Atores externos** (não são agentes IA, mas disparam flows):

- Weverton (zelador Bluemall): manda mensagens no grupo Op
- Cliente final da máquina: SAC inbound

---

## Próximas prioridades

### P0 · Organização do código (não-funcional mas urgente)

- [ ] Reorganizar `src/lib/vendetti/` (god module) em `src/domains/{agente}/`
- [ ] Mover `weverton-restock.ts` pra `src/domains/rita/` (é flow da Rita, não do Weverton)
- [ ] Extrair `match` (similarity + noise + discriminators) pra `src/shared/match/` (hoje duplicado em 3 arquivos)
- [ ] Componente único `<DecisionCard>` (substitui duplicação /vendetti e /decisions)
- [ ] Tipos discriminados pra `Decision.data` (sumir os `as never`)
- [ ] READMEs por agente IA (Vendetti, Mara, Bruno, Lúcia, Rita, Zelda)

### P1 · Robustez do flow Rita (Weverton)

- [ ] Executor de slot_swap_with em produção (já implementado, falta validar com Decision atual)
- [ ] Scraper retry com backoff se Vendtef instável
- [ ] Detecção de "Weverton mandou item duplicado" (mesmo slot 2x na msg) — atualmente parser pega a 1ª e ignora
- [ ] Validar entrada Everest antes de tentar abastecer (se 0, scraper avisa em vez de falhar silencioso)

### P2 · Auto-melhoria (Zelda)

- [ ] Cron diário de Zelda audit (safety net se trigger inline falhar)
- [ ] Zelda audita scraper failures (atualmente só audita match_correction)
- [ ] Zelda audita decisions rejected (Luís rejeita = algo errado no que Augusto/sistema propôs)
- [ ] Zelda audita complaint patterns (slot reclamado 3x = pattern)
- [ ] Auto-aplicar findings de severity=sugestão e baixa-risco (adicionar NOISE token)

### P3 · Observability central

- [ ] /timeline ou /agents-log: timeline única com TODOS os eventos de TODOS os agentes (já temos AgentTerminal por agente, falta visão unificada)
- [ ] Conversas inter-agentes capturadas (quando Augusto chama tool X, registra. Quando Lúcia escala, registra)
- [ ] Métricas: quantos slots/dia, % auto-resolvidos vs precisaram Luís, MTBF do scraper

### P4 · Flows novos

- [ ] Cliente reporta falha pelo QR code da máquina (já tem /sac, falta QR direto)
- [ ] Bruno proativo: avisa Luís quando precisa comprar (estoque crítico + histórico de vendas)
- [ ] Rita autoremap: detecta slot vazio há >Xh + venda zerada = trocar produto
- [ ] Zelda gera resumo semanal pra Luís (WhatsApp domingo de manhã)

### P5 · Outras máquinas / multi-tenant

- Hoje hardcoded "Maquina BlueMall Rondon". Eventualmente quero mais máquinas
- Quando rolar, precisará: tabela MachineSettings, secrets por máquina, scraper parametrizado, UI filtros por máquina

---

## Princípios de organização (lembrete)

1. **Domínio > Tipo técnico**: agrupar por agente, não por "tudo que é parser num lugar"
2. **Surface fina, domínio gordo**: páginas Next só montam UI + chamam server actions. Toda regra de negócio em `src/domains/<agente>/`
3. **Boy Scout rule**: toda vez que mexer num arquivo, melhora 1 coisa pequena
4. **DRY pragmático**: extrai quando duplicar 2x, não antes
5. **Tipos > comentários**: se você precisa comentar o que um campo significa, prefira tipo nominal/union

---

## DECISIONS rápidas (memória)

- **2026-05-19**: LLM review pós F1 matcher (Haiku, vê mapa COMPLETO de slots) — F1 só compara 2 nomes. LLM detecta slot-swap.
- **2026-05-18**: Vendtef "Produtos Configurados" é modal Bootstrap (não nav nem aba) — scraper precisa scope ao modal pelo título.
- **2026-05-18**: Matcher unificado em 3 arquivos: noise filter + discriminators + F1 score. Era Jaccard antes (penalizava nomes longos NF-e).
- **2026-05-18**: Zelda auto-trigger via `after()` Next 16 pós-confirm + via HTTP no fim do scraper. Notifica Luís em qualquer finding.
- **2026-05-18**: GH Actions roda Playwright (Vercel Hobby não tem). Vercel dispara via `repository_dispatch`.
- **2026-05-15**: Lúcia max 4 mensagens antes de escalar, single-shot greeting, tom formal. SAC + Inquiry (não-SAC) state machines separadas.
