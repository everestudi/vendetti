/**
 * GET /api/chat/history — devolve mensagens da thread luis-augusto (mailbox).
 *
 * Antes: lia ChatMessage table (chat antigo).
 * Agora: lê AgentMessage filtrado por threadId='luis-augusto' + runs anexados
 * (pra renderizar thinking e tool calls inline).
 *
 * Formato compatível com a UI antiga (role + parts) pra ChatVendetti renderizar
 * sem mudanças estruturais.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const THREAD = 'luis-augusto';

interface UIMessagePart {
  type: string;
  text?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}

interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: UIMessagePart[];
  createdAt: string;
  /** Metadados do AgentRun se a msg veio de um agente (Augusto). */
  meta?: {
    runId?: string;
    agentSlug?: string;
    costUsd?: number;
    thinkingMd?: string | null;
    toolCalls?: unknown;
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);

  // Mensagens da thread + agent associado + run que gerou
  const rows = await prisma.agentMessage.findMany({
    where: { threadId: THREAD },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: {
      fromAgent: { select: { slug: true, name: true, emoji: true } },
      toAgent: { select: { slug: true, name: true, emoji: true } },
      triggeredByRun: {
        select: { id: true, thinkingMd: true, toolCalls: true, costUsd: true },
      },
    },
  });

  const messages: UIMessage[] = rows.map((m) => {
    // Convenção: fromAgentId=null ⇒ Luís (user); senão ⇒ agente (assistant)
    const isUser = m.fromAgentId === null;
    const parts: UIMessagePart[] = [{ type: 'text', text: m.body }];

    // Anexa tool calls como "parts" tool-* pra UI renderizar igual ao chat antigo
    if (m.triggeredByRun && Array.isArray(m.triggeredByRun.toolCalls)) {
      for (const tc of m.triggeredByRun.toolCalls as Array<{
        name?: string;
        input?: unknown;
        output?: unknown;
        error?: string;
      }>) {
        if (!tc.name) continue;
        parts.push({
          type: `tool-${tc.name}`,
          toolName: tc.name,
          state: tc.error ? 'output-error' : 'output-available',
          input: tc.input,
          output: tc.error ? { error: tc.error } : tc.output,
        });
      }
    }

    return {
      id: m.id,
      role: isUser ? 'user' : 'assistant',
      parts,
      createdAt: m.createdAt.toISOString(),
      meta: !isUser
        ? {
            runId: m.triggeredByRun?.id,
            agentSlug: m.fromAgent?.slug,
            costUsd: m.triggeredByRun ? Number(m.triggeredByRun.costUsd) : undefined,
            thinkingMd: m.triggeredByRun?.thinkingMd ?? null,
            toolCalls: m.triggeredByRun?.toolCalls ?? null,
          }
        : undefined,
    };
  });

  // === "Está digitando…" — detecta runs ATIVOS do Augusto ===
  // RUNNING ou CLAIMED nos últimos 2min. UI mostra indicador WhatsApp-like.
  const recentRun = await prisma.agentRun.findFirst({
    where: {
      agent: { slug: 'augusto' },
      status: { in: ['RUNNING'] },
      startedAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
    },
    orderBy: { startedAt: 'desc' },
    select: { id: true, startedAt: true, trigger: true },
  });
  const isTyping = Boolean(recentRun);

  return NextResponse.json({
    ok: true,
    messages,
    isTyping,
    typingSince: recentRun?.startedAt.toISOString() ?? null,
  });
}

export async function DELETE(req: Request) {
  // Reset da thread — apaga mensagens. Memória Recall fica preservada (insights/decisões)
  // pra Augusto não esquecer aprendizados.
  const url = new URL(req.url);
  if (url.searchParams.get('confirm') !== '1') {
    return NextResponse.json({ error: 'add ?confirm=1' }, { status: 400 });
  }
  const r = await prisma.agentMessage.deleteMany({ where: { threadId: THREAD } });
  return NextResponse.json({ ok: true, deleted: r.count });
}
