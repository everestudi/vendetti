/**
 * POST /api/agents/briefing — dispara Augusto pra fazer briefing matinal.
 *
 * Chamado por GH Actions cron 8h BRT (11h UTC) via workflow augusto-briefing.yml.
 *
 * Augusto recebe payload { mode: 'morning_briefing' } e o prompt orienta ele a:
 *  1. Chamar mara_summary, infra_health, list_recent_decisions, transactions_recent
 *  2. Chamar zelda_token_audit pra olhar gasto da empresa
 *  3. Mandar WhatsApp via augusto_notify_luis (needsReply=false) com:
 *     - Estado da máquina ontem (vendas, slots críticos novos)
 *     - Pendências do Luís (PROPOSALs, Decisions)
 *     - 1-3 ações sugeridas pro dia
 *
 * Auth: CRON_SECRET no header Authorization (mesmo padrão de /api/tick).
 */

import { NextResponse } from 'next/server';
import { runAgent } from '@/lib/agents/runtime';
import { AgentRuntimeError } from '@/lib/agents/types';
import { getSecret } from '@/lib/secrets';

export const runtime = 'nodejs';
// Briefing matinal pode levar 30-60s com várias tools. Aceita até 90s.
export const maxDuration = 90;

export async function POST(req: Request) {
  // Auth
  const authHeader = req.headers.get('authorization') ?? '';
  const expected = (await getSecret('CRON_SECRET')) ?? process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();
  console.log('[briefing] disparando Augusto matinal');

  try {
    const { runId, result } = await runAgent({
      agentSlug: 'augusto',
      trigger: 'CRON',
      triggerRef: `morning-briefing-${new Date().toISOString().slice(0, 10)}`,
      payload: {
        mode: 'morning_briefing',
        hint: 'Briefing matinal automatizado. Use mara_summary + infra_health + transactions_recent + list_recent_decisions + zelda_token_audit. Manda resumo via augusto_notify_luis (urgency=normal, needsReply=false). 1-3 ações sugeridas pro dia. Sem perguntar nada — só relatar.',
      },
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[briefing] done in ${elapsed}s · $${result.costUsd.toFixed(4)}`);

    return NextResponse.json({
      ok: true,
      runId,
      elapsedSec: Number(elapsed),
      costUsd: Number(result.costUsd.toFixed(6)),
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      toolCalls: result.toolCalls.length,
      tools: result.toolCalls.map((t) => t.name),
    });
  } catch (err: unknown) {
    console.error('[briefing] failed:', err);
    const isBudget = err instanceof AgentRuntimeError && err.code === 'BUDGET_STOPPED';
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: message,
        status: isBudget ? 'budget_stopped' : 'failed',
      },
      { status: isBudget ? 402 : 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'briefing', method: 'POST', auth: 'Bearer CRON_SECRET' });
}
