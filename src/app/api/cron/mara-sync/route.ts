/**
 * Endpoint pra disparar Mara sync via cron.
 *
 * Proteção: header `Authorization: Bearer ${CRON_SECRET}`.
 * Tempo: ~3min (6 chunks ZIP + 3 cancelamentos) — não cabe em Vercel Hobby (10s).
 * Solução: rodar via GitHub Actions (que tem timeout 6h) chamando o endpoint num
 * worker dedicado, OU localmente via `npm run mara:sync`.
 *
 * Vercel Pro tem maxDuration 60s — também não cabe. Em produção, hospedar um
 * worker no Railway/Fly que roda o script direto.
 */

import { NextResponse } from 'next/server';
import { extractAll } from '@/lib/vendetti/mara/extract';
import { loadAll } from '@/lib/vendetti/mara/load';
import { getSecret } from '@/lib/secrets';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5min — funciona localmente, em prod precisa worker

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
  console.log('[cron/mara-sync] start');

  try {
    const data = await extractAll();
    const r = await loadAll(data);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[cron/mara-sync] done in ${elapsed}s`);

    return NextResponse.json({
      ok: true,
      elapsedSec: Number(elapsed),
      result: {
        slots: data.slots.length,
        skus: data.skus.length,
        transactions: data.transactions.length,
        cancellations: data.cancellations.length,
        capacityPct: data.snapshot.capacityFilledPct,
        loadedSkus: r.skusUpserted,
        loadedSlots: r.slotsUpserted,
        loadedTransactions: r.transactionsCreated,
        loadedCancellations: r.cancellationsCreated,
        daysAggregated: r.transactionsAggregatedDays,
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[cron/mara-sync] FAILED:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Pra teste local rápido sem mexer em mara:sync
export async function GET(req: Request) {
  return POST(req);
}
