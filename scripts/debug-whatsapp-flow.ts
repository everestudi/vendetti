/** Debug do fluxo WhatsApp inbound → Augusto. */
import { prisma } from '../src/lib/db';

async function main() {
  // 1) Última msg na thread luis-augusto vinda do WhatsApp
  const msgs = await prisma.agentMessage.findMany({
    where: { threadId: 'luis-augusto' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: {
      fromAgent: { select: { slug: true, name: true } },
      toAgent: { select: { slug: true, name: true } },
    },
  });

  console.log('=== Últimas 5 msgs da thread luis-augusto ===');
  for (const m of msgs) {
    const from = m.fromAgent?.slug ?? 'luis-humano';
    const to = m.toAgent?.slug ?? 'broadcast/luis';
    const refs = m.refs ? JSON.stringify(m.refs) : '';
    console.log(`\n${m.createdAt.toISOString()} · ${from} → ${to} · ${m.kind} · ${m.status}`);
    console.log(`  body: ${m.body.slice(0, 120)}`);
    if (refs) console.log(`  refs: ${refs}`);
  }

  // 2) Wakeups recentes pro Augusto
  const augusto = await prisma.agent.findUnique({ where: { slug: 'augusto' } });
  if (!augusto) {
    console.log('\n[augusto não está no DB]');
    return;
  }

  console.log('\n\n=== Wakeups recentes do Augusto ===');
  const wakeups = await prisma.agentWakeupRequest.findMany({
    where: { agentId: augusto.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  for (const w of wakeups) {
    console.log(
      `${w.createdAt.toISOString()} · ${w.trigger} · ${w.status} · ref=${w.triggerRef?.slice(0, 12) ?? '∅'}`,
    );
    if (w.completedAt) console.log(`  completed: ${w.completedAt.toISOString()}`);
  }

  // 3) Runs recentes do Augusto
  console.log('\n=== Runs recentes do Augusto ===');
  const runs = await prisma.agentRun.findMany({
    where: { agentId: augusto.id },
    orderBy: { startedAt: 'desc' },
    take: 5,
  });
  for (const r of runs) {
    console.log(
      `${r.startedAt.toISOString()} · ${r.trigger} · ${r.status} · cost=$${Number(r.costUsd).toFixed(4)}`,
    );
    if (r.errorMsg) console.log(`  ERROR: ${r.errorMsg}`);
    const tcs = Array.isArray(r.toolCalls) ? (r.toolCalls as Array<{ name?: string }>) : [];
    if (tcs.length > 0) {
      console.log(`  tools: ${tcs.map((t) => t.name).join(', ')}`);
    }
    if (r.outputMd) {
      console.log(`  output: ${r.outputMd.slice(0, 200)}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
