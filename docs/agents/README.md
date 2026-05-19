# Agentes Vendetti

Todo agente é uma instância de Claude (Opus 4.7 ou Haiku 4.5) com prompt específico,
ferramentas próprias e domínio de atuação. Cada um tem seu README aqui.

## Time

| ID | Persona | Modelo | Domínio principal | README |
|---|---|---|---|---|
| `vendetti` | Augusto Vendetti, CEO | Opus 4.7 | Chat com Luís, decisões cross-domain | vendetti.md *(TODO)* |
| `mara` | Mara Costa, Análise | Opus 4.7 | Scrape Vendtef/Vendpago, analytics, slots-with-margin | mara.md *(TODO)* |
| `bruno` | Bruno Almeida, Compras | Opus 4.7 + Vision | NF-e parse, sync Vendtef (entrada estoque) | bruno.md *(TODO)* |
| `lucia` | Lúcia Pereira, Atendimento | Haiku 4.5 (classifier) + Opus (response) | SAC + Inquiries (locação, estacionamento, geral) | lucia.md *(TODO)* |
| `rita` | Rita Aparecida Borges, Operações | Opus 4.7 + Haiku 4.5 (LLM review) | Estado físico+sistema da máquina, processa Weverton | [rita.md](./rita.md) |
| `zelda` | Zelda, Oversight | Haiku 4.5 | Auditoria autônoma, gera findings com prompts pra Augusto | zelda.md *(TODO)* |

## Atores externos (NÃO são agentes)

| Quem | O que faz | Como entra no sistema |
|---|---|---|
| **Luís Neto** | Dono/operador humano | Chat com Augusto, aprova /decisions, recebe WhatsApp da Zelda |
| **Weverton** | Zelador Bluemall (faz reposição física) | Manda msg no grupo Op WhatsApp → Rita processa |
| **Cliente da máquina** | Compra produtos | Reclama via WhatsApp → Lúcia atende |
| **Fornecedor** | Atacadão / Vittal | NF-e via foto/PDF → Bruno processa |

## Template pra novos READMEs

```markdown
# <ID> · <Persona>

## O que faço
1 parágrafo claro. Onde meu domínio começa e termina.

## Modelo + tools
- Modelo: Opus 4.7 / Haiku 4.5
- Tools: lista das functions disponíveis (se tem chat) OU "sem chat, roda triggered"

## Triggers (quem me chama)
- Onde nasce uma execução minha (UI, webhook, cron, outro agente)

## Outputs (o que eu produzo)
- Decisions, Events, Mensagens WhatsApp, mudanças no DB

## Domínio (regras do mundo que eu conheço)
- 3-5 fatos importantes sobre como meu domínio funciona
- Ex: "Sempre cadastra produto novo com max=100/alerta=2/crítico=1"

## Estado atual / TODO
- ✅ O que tá funcionando
- 🚧 O que tá pela metade
- ❌ Limitações conhecidas
```

## Princípio organizador

- **Cada agente tem 1 diretório em `src/domains/<id>/`** (futuro — hoje tá tudo em `src/lib/vendetti/`)
- **Cada agente tem 1 README aqui** descrevendo o que faz
- **Atores externos não viram domínio** — eles são triggers de domínios existentes
- Ex: Weverton é trigger da Rita (operações), não um agente
