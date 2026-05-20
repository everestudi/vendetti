/**
 * Inbox do claude-code — mostra msgs DELIVERED endereçadas a slug=claude-code.
 *
 * Use quando Luís me chamar no terminal pra implementar/discutir algo:
 *   `npm run cc:inbox`        (lista resumida)
 *   `npm run cc:inbox -- --full` (renderiza body completo)
 *
 * Quando implementar uma spec, depois marca a msg como ACTIONED:
 *   `npm run cc:done -- <msgId>`
 */

import { prisma } from '../src/lib/db';

const FULL = process.argv.includes('--full');

async function main() {
  const claudeCode = await prisma.agent.findUnique({ where: { slug: 'claude-code' } });
  if (!claudeCode) {
    console.error('claude-code não está no DB — rode `npm run seed:agents`');
    process.exit(1);
  }

  // Msgs DELIVERED pra mim
  const inbox = await prisma.agentMessage.findMany({
    where: {
      toAgentId: claudeCode.id,
      status: 'DELIVERED',
    },
    orderBy: { createdAt: 'asc' },
    include: {
      fromAgent: { select: { slug: true, name: true, emoji: true } },
      triggeredByRun: { select: { id: true, costUsd: true } },
    },
  });

  if (inbox.length === 0) {
    console.log('📭 Inbox vazia (sem msgs DELIVERED pra claude-code)');
    return;
  }

  console.log(`📬 ${inbox.length} msg${inbox.length > 1 ? 's' : ''} no inbox do claude-code:\n`);

  for (const m of inbox) {
    const from = m.fromAgent ? `${m.fromAgent.emoji} ${m.fromAgent.name}` : '👤 Luís';
    const cost = m.triggeredByRun ? ` · gerou run $${Number(m.triggeredByRun.costUsd).toFixed(4)}` : '';
    console.log(`─ ${m.id.slice(0, 12)} · ${from} · ${m.kind}${cost}`);
    console.log(`  thread: ${m.threadId ?? '(sem thread)'} · ${m.createdAt.toISOString()}`);
    if (FULL) {
      console.log(`\n${m.body}\n`);
      if (m.refs) console.log(`refs: ${JSON.stringify(m.refs, null, 2)}\n`);
    } else {
      const preview = m.body.slice(0, 200);
      console.log(`  ${preview}${m.body.length > 200 ? '…' : ''}`);
    }
    console.log('');
  }

  if (!FULL) {
    console.log('(use --full pra ver corpo completo)');
  }
  console.log(`\npra fechar uma msg após implementar: npm run cc:done -- <msgId>`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
