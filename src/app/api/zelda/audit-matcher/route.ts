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
import { getSecret } from '@/lib/secrets';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Aceita 2 formas de auth:
 *  - Cookie de sessão válida (UI /equipe/zelda) — pra Luís clicar botão manual
 *  - Header x-service-key === CRON_SECRET — pra scraper Bruno chamar do GH Actions
 */
async function isAuthorized(req: Request): Promise<boolean> {
  const serviceKey = req.headers.get('x-service-key');
  if (serviceKey) {
    const expected = await getSecret('CRON_SECRET');
    if (expected && serviceKey === expected) return true;
  }
  const c = await cookies();
  const raw = c.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookie(raw);
  if (session) return true;
  return false;
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
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
