/**
 * Marca wakeups duplicados antigos como COALESCED e processa só o mais recente.
 * Útil quando o webhook acumulou wakeups por causa do bug fire-and-forget.
 */

import { prisma } from '../src/lib/db';
import { runAgent } from '../src/lib/agents/runtime';

async function main() {
  const augusto = await prisma.agent.findUnique({ where: { slug: 'augusto' } });
  if (!augusto) {
    console.error('augusto não está no DB');
    process.exit(1);
  }

  // Pega wakeups QUEUED do Augusto
  const queued = await prisma.agentWakeupRequest.findMany({
    where: { agentId: augusto.id, status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
  });

  if (queued.length === 0) {
    console.log('✓ Sem wakeups pendentes pro Augusto');
    return;
  }

  console.log(`Encontrei ${queued.length} wakeups QUEUED. Vou marcar os ${queued.length - 1} mais antigos como COALESCED e processar só o último.`);

  // Coalesce todos exceto o último
  const toCoalesce = queued.slice(0, -1);
  const lastWakeup = queued[queued.length - 1];

  if (toCoalesce.length > 0) {
    await prisma.agentWakeupRequest.updateMany({
      where: { id: { in: toCoalesce.map((w) => w.id) } },
      data: {
        status: 'COALESCED',
        completedAt: new Date(),
        coalescedCount: queued.length - 1,
      },
    });
    console.log(`✓ ${toCoalesce.length} wakeups marcados COALESCED`);
  }

  // Processa o último
  console.log(`\n⏳ Processando wakeup ${lastWakeup.id.slice(0, 12)} (triggerRef=${lastWakeup.triggerRef?.slice(0, 12)})...`);

  const payload = (lastWakeup.payload as Record<string, unknown> | null) ?? undefined;
  const t0 = Date.now();
  try {
    const { runId, result } = await runAgent({
      agentSlug: 'augusto',
      trigger: lastWakeup.trigger,
      triggerRef: lastWakeup.triggerRef ?? undefined,
      payload,
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    // Marca wakeup como completado
    await prisma.agentWakeupRequest.update({
      where: { id: lastWakeup.id },
      data: { status: 'COMPLETED', completedAt: new Date(), processedByRunId: runId },
    });

    console.log(`\n✓ Run ${runId.slice(0, 12)} completa em ${elapsed}s`);
    console.log(`  custo: $${result.costUsd.toFixed(4)}`);
    console.log(`  tokens: ${result.tokensIn} in / ${result.tokensOut} out`);
    console.log(`  tool calls: ${result.toolCalls.length}`);
    for (const tc of result.toolCalls) {
      console.log(`    🔧 ${tc.name}${tc.error ? ' ✗ ' + tc.error : ' ✓'}`);
    }
    console.log(`\n📝 OUTPUT:\n${'─'.repeat(60)}\n${result.outputMd}\n${'─'.repeat(60)}`);
  } catch (e) {
    await prisma.agentWakeupRequest.update({
      where: { id: lastWakeup.id },
      data: { status: 'FAILED', completedAt: new Date() },
    });
    console.error('runAgent failed:', e);
    throw e;
  }
}

main()
  .catch(() => process.exit(1))
  .finally(() => prisma.$disconnect());
