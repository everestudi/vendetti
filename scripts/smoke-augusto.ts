/**
 * Smoke test do /chat real: cria msg do Luís → dispara wakeup → roda Augusto inline.
 * Uso: `npx tsx scripts/smoke-augusto.ts`
 */

import { prisma } from '../src/lib/db';
import { runAgent } from '../src/lib/agents/runtime';

async function main() {
  const augusto = await prisma.agent.findUnique({ where: { slug: 'augusto' } });
  if (!augusto) {
    console.error('Augusto não está no DB. Rode `npm run seed:agents` primeiro.');
    process.exit(1);
  }

  console.log(`🎩 Augusto encontrado: ${augusto.name} (${augusto.model})`);
  console.log(`   budget: $${augusto.budgetUsdMonth} · spent: $${augusto.spentUsdMonth}`);
  console.log(`   humanInLoop: ${augusto.humanInLoop} · paused: ${augusto.paused}`);

  // Cria msg do Luís
  const msg = await prisma.agentMessage.create({
    data: {
      fromAgentId: null,
      toAgentId: augusto.id,
      threadId: 'luis-augusto',
      kind: 'QUESTION',
      body: 'Oi Augusto! Esse é o primeiro teste do novo runtime. Me dá um "olá" curto + 1 frase do que você consegue fazer agora.',
      status: 'DELIVERED',
    },
  });
  console.log(`\n📩 Msg criada (id=${msg.id.slice(0, 12)}) na thread luis-augusto`);

  // Roda Augusto inline
  console.log(`\n⏳ Rodando Augusto via runAgent... (Opus 4.7, pode levar 10-30s)`);
  const t0 = Date.now();
  try {
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
    console.log(`  msgs novas: ${result.newMessages.length}`);
    console.log(`  recalls novos: ${result.newRecalls.length}`);
    if (result.nextAgentSlug) console.log(`  handoff → ${result.nextAgentSlug}`);

    console.log(`\n📝 OUTPUT do Augusto:\n${'─'.repeat(60)}\n${result.outputMd}\n${'─'.repeat(60)}`);

    if (result.thinkingMd) {
      console.log(`\n🧠 THINKING (chain-of-thought):\n${'─'.repeat(60)}\n${result.thinkingMd}\n${'─'.repeat(60)}`);
    }

    // Verifica que AgentMessage de resposta foi criada
    const responseMsgs = await prisma.agentMessage.findMany({
      where: { threadId: 'luis-augusto', fromAgentId: augusto.id },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    console.log(`\n💬 Mensagens do Augusto na thread: ${responseMsgs.length}`);
    for (const r of responseMsgs.slice(0, 1)) {
      console.log(`   [${r.kind}] ${r.body.slice(0, 200)}${r.body.length > 200 ? '...' : ''}`);
    }
  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`\n✗ runAgent falhou em ${elapsed}s:`, err instanceof Error ? err.message : err);
    throw err;
  }
}

main()
  .catch(() => process.exit(1))
  .finally(() => prisma.$disconnect());
