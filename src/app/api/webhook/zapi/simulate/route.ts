/**
 * Endpoint de simulação — pra testar Lúcia localmente sem Z-API real.
 *
 * POST { phone, text?, imageUrl? } → processa como se fosse webhook inbound.
 */

import { NextResponse } from 'next/server';
import { processLuciaInbound } from '@/lib/vendetti/lucia';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    phone?: string;
    text?: string;
    imageUrl?: string;
  };
  if (!body.phone) {
    return NextResponse.json({ ok: false, error: 'phone ausente' }, { status: 400 });
  }
  const r = await processLuciaInbound({
    phone: body.phone,
    text: body.text,
    imageUrl: body.imageUrl,
  });
  return NextResponse.json({ ok: true, ...r });
}
