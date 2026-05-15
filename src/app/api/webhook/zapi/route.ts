/**
 * Webhook Z-API · recebe mensagens inbound.
 *
 * Z-API envia POST com `{ phone, fromMe, type, text:{message}, image:{imageUrl}, ... }`.
 * Validação por shared secret no header `X-Vendetti-Secret` (configura no Z-API
 * webhook URL → adiciona o header).
 *
 * Roteamento:
 *   - fromMe=true → ignora (foi o Vendetti mesmo)
 *   - admin (Luís) → TODO: rotear pro agent loop (próxima rodada)
 *   - SAC → processa Lúcia
 *   - silence → loga e ignora
 */

import { NextResponse } from 'next/server';
import { processLuciaInbound } from '@/lib/vendetti/lucia';
import { getSecret } from '@/lib/secrets';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface ZapiTextMessage { message?: string }
interface ZapiImageMessage { imageUrl?: string; caption?: string }
interface ZapiPayload {
  phone?: string;
  fromMe?: boolean;
  isGroup?: boolean;
  type?: string;
  text?: ZapiTextMessage;
  image?: ZapiImageMessage;
  messageId?: string;
}

export async function POST(req: Request) {
  // Auth opcional via header
  const expected = await getSecret('ZAPI_WEBHOOK_SECRET');
  if (expected) {
    const got = req.headers.get('x-vendetti-secret');
    if (got !== expected) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const body = (await req.json().catch(() => ({}))) as ZapiPayload;

  // fromMe → silencia (eco da própria msg que mandamos)
  if (body.fromMe === true) {
    return NextResponse.json({ ok: true, ignored: 'fromMe' });
  }
  // grupos: ignoramos por agora (futuro: Weverton confirmar abastecimento no grupo)
  if (body.isGroup === true) {
    return NextResponse.json({ ok: true, ignored: 'group' });
  }
  if (!body.phone) {
    return NextResponse.json({ ok: false, error: 'phone ausente' }, { status: 400 });
  }

  const text = body.text?.message ?? body.image?.caption ?? '';
  const imageUrl = body.image?.imageUrl;

  const result = await processLuciaInbound({
    phone: body.phone,
    text,
    imageUrl,
    messageId: body.messageId,
  });

  return NextResponse.json({ ok: true, ...result });
}

// GET pra healthcheck
export async function GET() {
  return NextResponse.json({ ok: true, service: 'zapi-webhook' });
}
