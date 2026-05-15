/**
 * GET /api/bruno-nfe/prefill/[id] · devolve doc cacheado pra UI prefiller após
 * parse via WhatsApp (handleNfeFromWhatsapp).
 */

import { NextResponse } from 'next/server';
import { getPrefilled } from '@/lib/vendetti/nfe-from-whatsapp';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const doc = getPrefilled(id);
  if (!doc) return NextResponse.json({ ok: false, error: 'expirado ou inexistente' }, { status: 404 });
  return NextResponse.json({ ok: true, parsed: doc });
}
