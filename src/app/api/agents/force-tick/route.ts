/**
 * POST /api/agents/force-tick — Luís clica "Processar agora" no /empresa.
 *
 * Roda tickAgents() com cap razoável. Auth via sessão NextAuth (não CRON_SECRET)
 * porque é ação humana via UI, não cron externo.
 */

import { NextResponse } from 'next/server';
import { tickAgents } from '@/lib/agents/runtime';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  try {
    const out = await tickAgents(8);
    return NextResponse.json({
      ok: true,
      processed: out.processed,
      results: out.results,
    });
  } catch (err) {
    console.error('[force-tick]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
