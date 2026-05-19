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

export async function POST() {
  const result = await auditMatchCorrections(30);
  return NextResponse.json(result);
}

export async function GET() {
  // Permite testar via browser também (mesmo behavior)
  return POST();
}
