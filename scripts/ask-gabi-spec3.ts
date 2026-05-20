/**
 * Pede SPEC #3 da Gabi: inbox sem expiração + recall sem embedding/index.
 * Mesmo padrão assertivo da SPEC #2 (que funcionou) — limite estrito.
 */

import { prisma } from '../src/lib/db';
import { runAgent } from '../src/lib/agents/runtime';

const REQUEST = `🛑 GABI, SPEC #3 — FORMATO IGUAL QUE FUNCIONOU NA #2.

⛔ PROIBIDO:
- gabi_read_repo_file (você JÁ leu runtime.ts, schema.prisma, seed.ts, tool-bridge.ts)
- gabi_recent_runs (você JÁ viu)
- Análise prosa antes da tool call

✅ APENAS: UMA chamada de agent_send_message({to:"claude-code", kind:"REQUEST", body:SPEC})

🎯 SPEC #3: inbox sem expiração + recall sem embedding/index

Você articulou nas runs anteriores:

> 6. Inbox loading sempre 8 mensagens (loadInbox limit=8), todas DELIVERED.
>    Não há limite por tempo — se houver 50 msgs antigas DELIVERED nunca lidas,
>    Augusto carrega as 8 mais recentes a cada run. Mas: ele marca todas como
>    READ. Inbox cresce com mensagens trash-quality.
>
> 7. No keyword recall: loadRecalls faz LIKE em summary+body. Sem index trigram.
>    Com volume vai virar table scan.

Foco em fix BARATO + correto, NÃO em embedding semântico (deferido pra
quando recall table tiver >1000 entries).

Formato OBRIGATÓRIO do body:

# SPEC #3: Inbox + Recall scaling fixes

## Contexto (2 linhas)

## Mudanças
1. **loadInbox** (src/lib/agents/runtime.ts:[linha]): [snippet com fix]
2. **loadRecalls** (src/lib/agents/runtime.ts:[linha]): [snippet com fix + migration index trigram]

## Migrations Prisma (se precisar)
[SQL exato]

## Edge cases
- ...

## Esforço: ~Xh

NADA além de UMA agent_send_message com isso. Vai.`;

async function main() {
  const cc = await prisma.agent.findUnique({ where: { slug: 'claude-code' } });
  const gabi = await prisma.agent.findUnique({ where: { slug: 'gabi' } });
  if (!cc || !gabi) throw new Error('agentes faltando');

  const msg = await prisma.agentMessage.create({
    data: {
      fromAgentId: cc.id,
      toAgentId: gabi.id,
      threadId: 'claude-code-gabi',
      kind: 'REQUEST',
      body: REQUEST,
      status: 'DELIVERED',
    },
  });
  console.log('Msg enviada, rodando Gabi...');

  const t0 = Date.now();
  const { runId, result } = await runAgent({
    agentSlug: 'gabi',
    trigger: 'MAILBOX',
    triggerRef: msg.id,
    payload: { messageId: msg.id, threadId: 'claude-code-gabi', focusedRequest: 'spec-3' },
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n✓ Run ${runId.slice(0, 8)} em ${elapsed}s · $${result.costUsd.toFixed(4)}`);
  console.log(`tokens: ${result.tokensIn} in / ${result.tokensOut} out`);
  console.log(`tools: ${result.toolCalls.map((t) => t.name).join(', ') || '(nenhuma)'}`);
  console.log(`msgs novas: ${result.newMessages.length}`);
  for (const m of result.newMessages) {
    console.log(`  → ${m.toSlug ?? 'broadcast'} · ${m.kind} · ${m.body.length} chars`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
