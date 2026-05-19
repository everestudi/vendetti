/**
 * POST /api/zelda/audit-matcher · pede pra Zelda analisar as correções
 * de match recentes e propor melhorias. Persiste findings como Ideas
 * (status=NEW) que aparecem em /equipe/zelda.
 *
 * Manual (Luís clica botão em /equipe/zelda) ou agendado (cron diário
 * via repository_dispatch event_type='zelda-audit').
 */

import { NextResponse } from 'next/server';
import { auditMatchCorrections } from '@/lib/vendetti/zelda';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const incremental = url.searchParams.get('incremental') === '1';
  const result = await auditMatchCorrections({
    limit: 30,
    incrementalOnly: incremental,
    notifyLuis: true,
  });
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return POST(req);
}
