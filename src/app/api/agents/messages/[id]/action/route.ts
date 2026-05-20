/**
 * POST /api/agents/messages/[id]/action — Luís aprova/rejeita/comenta uma
 * mensagem PROPOSAL/REQUEST/QUESTION direcionada a ele.
 *
 * Efeitos:
 *   - approve: marca msg como ACTIONED, cria msg de resposta "Aprovado.", e
 *     dispara wakeup pro agente original com payload { approvedMsgId, action }.
 *   - reject: marca como DISMISSED, cria msg com motivo (body), wakeup com
 *     payload { rejectedMsgId, action, reason }.
 *   - comment: cria msg de resposta com body livre, mantém status original,
 *     wakeup pro agente.
 *
 * Auth: sessão NextAuth (cookies). Endpoint protegido pelo middleware.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { enqueueWakeup } from '@/lib/agents/runtime';

export const runtime = 'nodejs';

interface PostBody {
  action: 'approve' | 'reject' | 'comment';
  /** Texto livre — obrigatório pra comment, opcional pra approve/reject. */
  body?: string;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const json = (await req.json().catch(() => ({}))) as PostBody;

  if (!json.action || !['approve', 'reject', 'comment'].includes(json.action)) {
    return NextResponse.json({ error: 'action inválida (approve|reject|comment)' }, { status: 400 });
  }
  if (json.action === 'comment' && !json.body?.trim()) {
    return NextResponse.json({ error: 'comment requer body' }, { status: 400 });
  }

  const original = await prisma.agentMessage.findUnique({
    where: { id },
    include: { fromAgent: { select: { id: true, slug: true, name: true } } },
  });
  if (!original) {
    return NextResponse.json({ error: 'mensagem não encontrada' }, { status: 404 });
  }

  if (!original.fromAgentId || !original.fromAgent) {
    return NextResponse.json(
      { error: 'mensagem não veio de agente — sem destino pra wakeup' },
      { status: 400 },
    );
  }

  // Body da msg de resposta do Luís
  const responseBody =
    json.action === 'approve'
      ? json.body?.trim() || '✅ Aprovado. Pode prosseguir.'
      : json.action === 'reject'
        ? `❌ Rejeitado.${json.body?.trim() ? ` Motivo: ${json.body.trim()}` : ''}`
        : json.body!.trim();

  const newStatus = json.action === 'approve' ? 'ACTIONED' : json.action === 'reject' ? 'DISMISSED' : original.status;

  const result = await prisma.$transaction(async (tx) => {
    // 1) Marca a original
    await tx.agentMessage.update({
      where: { id: original.id },
      data: { status: newStatus, readAt: new Date() },
    });

    // 2) Cria resposta do Luís (fromAgentId=null = humano)
    const reply = await tx.agentMessage.create({
      data: {
        fromAgentId: null,
        toAgentId: original.fromAgentId,
        threadId: original.threadId,
        kind: json.action === 'comment' ? 'NOTE' : json.action === 'approve' ? 'NOTE' : 'NOTE',
        body: responseBody,
        refs: {
          inResponseTo: original.id,
          action: json.action,
        },
        status: 'DELIVERED',
      },
    });

    return { reply };
  });

  // 3) Dispara wakeup pro agente fora da transaction (enqueueWakeup busca agente)
  try {
    await enqueueWakeup({
      agentSlug: original.fromAgent.slug,
      trigger: 'MAILBOX',
      triggerRef: result.reply.id,
      idempotencyKey: `human-action:${original.id}:${json.action}`,
      payload: {
        messageId: result.reply.id,
        threadId: original.threadId,
        humanAction: json.action,
        originalMessageId: original.id,
      },
    });
  } catch (e) {
    console.warn('[messages/action] enqueueWakeup falhou (não-fatal):', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({
    ok: true,
    action: json.action,
    originalMessageId: original.id,
    newStatus,
    replyMessageId: result.reply.id,
    notifiedAgent: original.fromAgent.slug,
  });
}
