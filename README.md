# Vendetti

> Agente CEO autônomo (Claude Opus 4.7) que opera a vending machine TCN Pro 6G no Blue Mall Rondon.
> Inspirado no [Project Vend Phase 2](https://www.anthropic.com/research/project-vend-2) da Anthropic.
>
> _Nome formal completo: **Augusto Vendetti** — usado apenas em assinaturas finais de email._

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│  OBSIDIAN VAULT  (decision log, memória de longo prazo) │
│  Projects/Vendetti CEO/                                  │
└────────────────────────────┬────────────────────────────┘
                             │ leitura/escrita
                             │
┌─────────────────────────────────────────────────────────┐
│  AUGUSTO (Claude Agent SDK + Opus 4.7)                  │
│                                                          │
│  Tools registradas:                                     │
│   • vendtef.*          ← scraping ERP                   │
│   • vendpago.*         ← relatório pagamentos           │
│   • atacadao.*         ← preço fornecedor               │
│   • obsidian.*         ← R/W vault                      │
│   • email.send         ← Resend                         │
│   • whatsapp.send      ← Z-API → Weverton               │
│   • decision_log.*     ← Postgres                       │
│                                                          │
│  Camadas:                                               │
│   1. Especializada (faz a tarefa)                       │
│   2. Oversight (valida contra policies.ts)              │
│   3. Escalação humana (3 níveis: 🟢🟡🔴)                │
└────────────────────────────┬────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐
│ Email diário   │  │ Dashboard       │  │ WhatsApp p/     │
│ Resend → Luís  │  │ /chat /aprov.   │  │ Weverton (Z-API)│
└────────────────┘  └─────────────────┘  └─────────────────┘
```

## Stack

- **Frontend + API**: Next.js 15 (App Router) + TypeScript + Tailwind
- **Agente**: Claude Agent SDK (TypeScript) + Opus 4.7
- **DB**: Postgres (Neon) + Prisma
- **Auth**: NextAuth v5
- **Scraping**: Playwright (Vendtef sem API)
- **Email**: Resend
- **WhatsApp**: Z-API
- **Hospedagem**: Vercel (app) + Railway (worker Playwright 24/7)
- **Domínio**: `vendetti.everest.udi.br`

## Setup local

```bash
# 1. Instalar dependências
npm install
npx playwright install chromium

# 2. Configurar env
cp .env.example .env.local
# preenche com credenciais reais

# 3. Banco de dados
npm run db:push

# 4. Dev server
npm run dev
```

### Após mudanças no schema do Prisma

```bash
npm run db:push          # aplica schema
npm run db:generate      # regenera client
# RESTART obrigatório do dev server (Turbopack cacheia o client em memória):
# Ctrl+C → rm -rf .next → npm run dev
```

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Next dev server |
| `npm run scrape:login` | Smoke test: loga no Vendtef e captura screenshot |
| `npm run scrape:sales` | Baixa relatório de vendas |
| `npm run scrape:inventory` | Lê inventário atual |
| `npm run agent:tick` | Executa um tick manual do Vendetti |
| `npm run db:studio` | UI do Prisma |

## Faseamento (4 sprints)

Ver [`Projects/Vendetti CEO/02 - Backlog imediato.md`](file:///Users/luisneto/Documents/Obsidian%20Vault/Projects/Vendetti%20CEO/02%20-%20Backlog%20imediato.md) no Obsidian Vault.

## Decision log

Decisões arquiteturais e operacionais são versionadas em append-only no vault: [`Projects/Vendetti CEO/01 - Decisões.md`](file:///Users/luisneto/Documents/Obsidian%20Vault/Projects/Vendetti%20CEO/01%20-%20Decis%C3%B5es.md).

## Project Vend learnings aplicados

O Claudius (Anthropic) deu prejuízo na Phase 1 por 5 motivos. Como o Vendetti mitiga cada um:

| Phase 1 falhou em | Mitigação no Vendetti |
|---|---|
| Vendia abaixo do custo | `policies.ts` impõe **margem mínima 35%** — Vendetti não pode aprovar preço que viole |
| Dava desconto pra qualquer um | Vending física, cliente não conversa com IA → vetor de prompt injection ~zero |
| Hallucinou contas Venmo, contatos | Tools rígidas — não há "ferramenta de transferência genérica"; só ações dentro do ERP |
| Esqueceu lições anteriores | Decision log append-only + Obsidian + Postgres → contexto persistente |
| Crise de identidade | System prompt explícito: "você é um agente digital, não um humano" |
