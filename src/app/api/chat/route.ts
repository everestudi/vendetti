/**
 * POST /api/chat — manda mensagem pro Augusto via mailbox + dispara wakeup imediato.
 *
 * Antes: usava @ai-sdk/react streamText direto (Augusto era 1 LLM única sem
 * histórico estruturado).
 *
 * Agora: cria AgentMessage(luis→augusto), enfileira AgentWakeupRequest com
 * idempotencyKey, e chama runAgent('augusto') INLINE (sem esperar cron).
 * Retorna { messageId, runId, status } pro client. O frontend faz polling de
 * /api/chat/history pra ver a resposta quando AgentRun completar.
 *
 * Thread fixa: 'luis-augusto' (uma conversa contínua). Augusto carrega Recall
 * relevante pelo body da msg pra ter contexto histórico.
 *
 * Diferença visual pro Luís: perde streaming token-by-token mas ganha:
 *   - Thinking visível na timeline (chain-of-thought)
 *   - Tool-calls renderizados estruturados
 *   - Mensagens visíveis em /empresa pros outros agentes
 *   - Memory recall ativo
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { runAgent, enqueueWakeup } from '@/lib/agents/runtime';
import { AgentRuntimeError } from '@/lib/agents/types';

export const runtime = 'nodejs';
export const maxDuration = 90; // Opus 4.7 pode levar 30-60s

const THREAD_LUIS_AUGUSTO = 'luis-augusto';

interface PostBody {
  body?: string;
  /** Compat com @ai-sdk/react useChat — extrai o último user message. */
  messages?: Array<{ role: string; parts?: Array<{ type: string; text?: string }> }>;
}

export async function POST(req: Request) {
  const json = (await req.json().catch(() => ({}))) as PostBody;

  // Aceita 2 formatos:
  //   { body: "texto" }                     — novo formato direto
  //   { messages: [...] } com último user   — compat útil mas vamos migrar
  let userText: string | null = null;
  if (json.body) {
    userText = json.body.trim();
  } else if (json.messages?.length) {
    const last = json.messages[json.messages.length - 1];
    if (last.role === 'user' && Array.isArray(last.parts)) {
      userText = last.parts.find((p) => p.type === 'text')?.text?.trim() ?? null;
    }
  }

  if (!userText) {
    return NextResponse.json({ error: 'mensagem vazia' }, { status: 400 });
  }

  // Verifica Augusto existe (seed precisa ter rodado)
  const augusto = await prisma.agent.findUnique({ where: { slug: 'augusto' } });
  if (!augusto) {
    return NextResponse.json(
      { error: 'Augusto ainda não foi seedado. Rode `npm run seed:agents`.' },
      { status: 500 },
    );
  }
  if (augusto.paused) {
    return NextResponse.json(
      { error: `Augusto está pausado: ${augusto.pausedReason ?? 'sem motivo'}. Retome em /empresa.` },
      { status: 423 }, // Locked
    );
  }

  // 1) Cria AgentMessage no mailbox: humano (null) → Augusto
  const msg = await prisma.agentMessage.create({
    data: {
      fromAgentId: null,
      toAgentId: augusto.id,
      threadId: THREAD_LUIS_AUGUSTO,
      kind: 'QUESTION',
      body: userText,
      status: 'DELIVERED',
    },
  });

  // 2) Enfileira wakeup com idempotencyKey = msgId
  await enqueueWakeup({
    agentSlug: 'augusto',
    trigger: 'ON_DEMAND',
    triggerRef: msg.id,
    idempotencyKey: `chat:${msg.id}`,
    payload: { messageId: msg.id, threadId: THREAD_LUIS_AUGUSTO },
  });

  // 3) Roda Augusto INLINE (não espera cron — usuário tá na tela esperando)
  try {
    const { runId, result } = await runAgent({
      agentSlug: 'augusto',
      trigger: 'ON_DEMAND',
      triggerRef: msg.id,
      payload: { messageId: msg.id, threadId: THREAD_LUIS_AUGUSTO, userText },
    });

    // Marca wakeup como processado (limpa fila)
    await prisma.agentWakeupRequest.updateMany({
      where: { idempotencyKey: `chat:${msg.id}`, status: 'QUEUED' },
      data: { status: 'COMPLETED', completedAt: new Date(), processedByRunId: runId },
    });

    return NextResponse.json({
      ok: true,
      messageId: msg.id,
      runId,
      status: 'completed',
      costUsd: result.costUsd,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });
  } catch (err) {
    const isBudget = err instanceof AgentRuntimeError && err.code === 'BUDGET_STOPPED';
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[chat] runAgent failed:', err);
    return NextResponse.json(
      {
        ok: false,
        messageId: msg.id,
        status: isBudget ? 'budget_stopped' : 'failed',
        error: errorMsg,
      },
      { status: isBudget ? 402 : 500 },
    );
  }
}
