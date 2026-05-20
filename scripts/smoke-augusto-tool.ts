/**
 * Smoke test forte: pede pro Augusto consultar mara_summary e devolver status.
 * Valida tool calling end-to-end + agentic loop.
 */

import { prisma } from '../src/lib/db';
import { runAgent } from '../src/lib/agents/runtime';

async function main() {
  const msg = await prisma.agentMessage.create({
    data: {
      fromAgentId: null,
      toAgentId: (await prisma.agent.findUnique({ where: { slug: 'augusto' } }))!.id,
      threadId: 'luis-augusto',
      kind: 'QUESTION',
      body: 'Augusto, me dá um status curto da operação: chama mara_summary, infra_health, e me diz em 3 linhas o que vê (sem inventar contexto). Não precisa mandar mensagem pra ninguém — só me responde aqui.',
      status: 'DELIVERED',
    },
  });
  console.log(`📩 Msg criada (id=${msg.id.slice(0, 12)})`);

  const t0 = Date.now();
  const { runId, result } = await runAgent({
    agentSlug: 'augusto',
    trigger: 'ON_DEMAND',
    triggerRef: msg.id,
    payload: { messageId: msg.id, threadId: 'luis-augusto', userText: msg.body },
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n✓ Run completa em ${elapsed}s (runId=${runId.slice(0, 12)})`);
  console.log(`  tokens: ${result.tokensIn} in / ${result.tokensOut} out`);
  console.log(`  custo: $${result.costUsd.toFixed(4)}`);
  console.log(`  tool calls: ${result.toolCalls.length}`);
  for (const tc of result.toolCalls) {
    console.log(`    🔧 ${tc.name} (${tc.ms}ms)${tc.error ? ' ✗ ERRO: ' + tc.error : ' ✓'}`);
  }

  console.log(`\n📝 OUTPUT:\n${'─'.repeat(60)}\n${result.outputMd}\n${'─'.repeat(60)}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
