/**
 * Smoke test forte: pede pro Augusto consultar mara_summary e devolver status.
 * Valida tool calling end-to-end + agentic loop.
 */

import { prisma } from '../src/lib/db';
import { runAgent } from '../src/lib/agents/runtime';

async function main() {
  const claudeCode = await prisma.agent.findUnique({ where: { slug: 'claude-code' } });
  if (!claudeCode) {
    console.error('claude-code não está no DB');
    process.exit(1);
  }
  const augusto = await prisma.agent.findUnique({ where: { slug: 'augusto' } });
  if (!augusto) {
    console.error('augusto não está no DB');
    process.exit(1);
  }

  const msg = await prisma.agentMessage.create({
    data: {
      fromAgentId: claudeCode.id,
      toAgentId: augusto.id,
      threadId: 'claude-code-tests',
      kind: 'QUESTION',
      body: '[SMOKE TEST claude-code] Status curto: chama mara_summary + infra_health, me diz em 3 linhas o que vê. Sem inventar contexto.',
      status: 'DELIVERED',
    },
  });
  console.log(`📩 Msg criada (id=${msg.id.slice(0, 12)}) sender: 🤖 claude-code`);

  const t0 = Date.now();
  const { runId, result } = await runAgent({
    agentSlug: 'augusto',
    trigger: 'MAILBOX',
    triggerRef: msg.id,
    payload: { messageId: msg.id, threadId: 'claude-code-tests', source: 'claude-code-smoke' },
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
