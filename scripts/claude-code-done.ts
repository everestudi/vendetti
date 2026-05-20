/**
 * Marca msg do inbox do claude-code como ACTIONED + opcionalmente responde
 * ao remetente (Gabi/Augusto) com um update.
 *
 * Uso: `npm run cc:done -- <msgIdPrefix> [reply text]`
 *      `npm run cc:done -- cmpdfh6 "Implementado em commit abc123"`
 */

import { prisma } from '../src/lib/db';

async function main() {
  const args = process.argv.slice(2);
  const msgPrefix = args[0];
  const replyText = args.slice(1).join(' ');

  if (!msgPrefix) {
    console.error('uso: npm run cc:done -- <msgIdPrefix> [reply text]');
    process.exit(1);
  }

  const claudeCode = await prisma.agent.findUnique({ where: { slug: 'claude-code' } });
  if (!claudeCode) {
    console.error('claude-code não está no DB');
    process.exit(1);
  }

  // Procura msg pelo prefix
  const msg = await prisma.agentMessage.findFirst({
    where: {
      toAgentId: claudeCode.id,
      id: { startsWith: msgPrefix },
    },
    include: { fromAgent: { select: { slug: true, name: true } } },
  });
  if (!msg) {
    console.error(`Msg não encontrada com prefix "${msgPrefix}"`);
    process.exit(1);
  }

  // Marca como ACTIONED
  await prisma.agentMessage.update({
    where: { id: msg.id },
    data: { status: 'ACTIONED', readAt: new Date() },
  });
  console.log(`✓ Msg ${msg.id.slice(0, 12)} marcada ACTIONED`);

  // Se passou reply, cria msg de resposta do claude-code pro remetente
  if (replyText && msg.fromAgent) {
    const reply = await prisma.agentMessage.create({
      data: {
        fromAgentId: claudeCode.id,
        toAgentId: msg.fromAgent ? (await prisma.agent.findUnique({ where: { slug: msg.fromAgent.slug } }))!.id : null,
        threadId: msg.threadId,
        kind: 'NOTE',
        body: replyText,
        refs: { inResponseTo: msg.id },
        status: 'DELIVERED',
      },
    });
    console.log(`✓ Reply criada (${reply.id.slice(0, 12)}) → ${msg.fromAgent.name}`);

    // Enfileira wakeup pro remetente
    if (msg.fromAgent.slug !== 'claude-code') {
      const { enqueueWakeup } = await import('../src/lib/agents/runtime');
      try {
        await enqueueWakeup({
          agentSlug: msg.fromAgent.slug,
          trigger: 'MAILBOX',
          triggerRef: reply.id,
          idempotencyKey: `cc-done:${msg.id}`,
          payload: { messageId: reply.id, threadId: msg.threadId },
        });
        console.log(`✓ Wakeup enfileirado pro ${msg.fromAgent.slug}`);
      } catch (e) {
        console.warn('enqueueWakeup falhou:', e instanceof Error ? e.message : e);
      }
    }
  } else if (replyText) {
    console.log('(reply text fornecido mas msg não tem fromAgent — só marquei ACTIONED)');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
