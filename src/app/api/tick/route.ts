/**
 * /api/tick — processa wakeups pendentes dos agentes.
 *
 * Chamado por:
 *   - GH Actions cron a cada 5min (.github/workflows/agents-tick.yml)
 *   - /chat quando Luís manda msg (push imediato local)
 *   - Webhooks internos (ex: mara-sync no fim do scrape)
 *
 * Proteção: header `Authorization: Bearer ${CRON_SECRET}` (mesmo padrão de mara-sync).
 *
 * Tempo: limitado a 5min via maxDuration. Cada run de agente leva ~5-30s, então
 * cabem ~5-10 runs por tick. Wakeups que não couberem ficam QUEUED pro próximo tick.
 */

import { NextResponse } from 'next/server';
import { tickAgents } from '@/lib/agents/runtime';
import { getSecret } from '@/lib/secrets';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5min

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

  // Parse opcional do body — { maxRuns?: number }
  let maxRuns = 5;
  try {
    const body = (await req.json()) as { maxRuns?: number } | null;
    if (body?.maxRuns && body.maxRuns > 0 && body.maxRuns <= 20) {
      maxRuns = body.maxRuns;
    }
  } catch {
    // sem body, usa default
  }

  const t0 = Date.now();
  console.log(`[tick] start (maxRuns=${maxRuns})`);

  try {
    const out = await tickAgents(maxRuns);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[tick] done in ${elapsed}s · ${out.processed} runs`);

    return NextResponse.json({
      ok: true,
      elapsedSec: Number(elapsed),
      ...out,
    });
  } catch (err) {
    console.error('[tick] failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** GET retorna stats curtos pra healthcheck — sem auth. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'tick',
    method: 'POST',
    auth: 'Bearer CRON_SECRET',
  });
}
