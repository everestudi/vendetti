/**
 * /api/agents/panic — botão vermelho de emergência.
 *
 * POST { reason: string } — pausa todos os agentes ativos:
 *   - Agent.paused = true
 *   - AgentWakeupRequest QUEUED → FAILED (com errorMsg "panic")
 *   - AgentRun RUNNING continuam até terminar naturalmente (não dá pra matar
 *     uma call Anthropic já em voo, mas próximos wakeups não rodam)
 *
 * GET — retorna status atual (quantos pausados, qual última razão).
 *
 * DELETE — resume (despausa todos). Use só depois que tiver investigado.
 *
 * Auth: sessão NextAuth (cookies). Não precisa CRON_SECRET — é ação humana.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

/** Pausa todos os agentes. Resposta imediata (não espera runs terminarem). */
export async function POST(req: Request) {
  let reason = 'manual panic button';
  try {
    const body = (await req.json()) as { reason?: string } | null;
    if (body?.reason) reason = body.reason.slice(0, 200);
  } catch {
    // sem body, usa default
  }

  const now = new Date();
  const [pausedAgents, droppedWakeups] = await prisma.$transaction([
    prisma.agent.updateMany({
      where: { active: true, paused: false },
      data: { paused: true, pausedReason: reason, pausedAt: now },
    }),
    prisma.agentWakeupRequest.updateMany({
      where: { status: 'QUEUED' },
      data: { status: 'FAILED', completedAt: now },
    }),
  ]);

  console.warn(`[PANIC] ${pausedAgents.count} agentes pausados, ${droppedWakeups.count} wakeups dropados · reason: ${reason}`);

  return NextResponse.json({
    ok: true,
    pausedCount: pausedAgents.count,
    droppedWakeupsCount: droppedWakeups.count,
    reason,
    pausedAt: now.toISOString(),
  });
}

/** Status atual da pausa. */
export async function GET() {
  const [paused, total, queuedAfterPause] = await Promise.all([
    prisma.agent.findMany({
      where: { paused: true },
      select: { slug: true, name: true, emoji: true, pausedReason: true, pausedAt: true },
      orderBy: { pausedAt: 'desc' },
    }),
    prisma.agent.count({ where: { active: true } }),
    prisma.agentWakeupRequest.count({ where: { status: 'QUEUED' } }),
  ]);

  return NextResponse.json({
    pausedCount: paused.length,
    totalActive: total,
    isPanic: paused.length === total && total > 0,
    pausedAgents: paused.map((a) => ({
      ...a,
      pausedAt: a.pausedAt?.toISOString(),
    })),
    queuedWakeups: queuedAfterPause,
  });
}

/** Resume — despausa todos. */
export async function DELETE() {
  const result = await prisma.agent.updateMany({
    where: { paused: true },
    data: { paused: false, pausedReason: null, pausedAt: null },
  });

  console.log(`[PANIC RESUME] ${result.count} agentes despausados`);

  return NextResponse.json({
    ok: true,
    resumedCount: result.count,
  });
}
