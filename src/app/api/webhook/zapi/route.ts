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
import { handleNfeFromWhatsapp } from '@/lib/vendetti/nfe-from-whatsapp';
import { classifyInbound } from '@/lib/zapi/allowlist';
import { getSecret } from '@/lib/secrets';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Circuit breaker em memória: mesma phone só pode disparar processamento 1x a cada 3s.
// Defesa-em-profundidade caso o filtro `type !== 'ReceivedCallback'` falhe e a Z-API
// mande envio próprio de volta. Reset por cold start é aceitável (ainda corta surto).
const lastSeen = new Map<string, number>();
const COOLDOWN_MS = 3000;

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
  // Auth opcional: header OU query string (?secret=...) — Z-API não suporta header customizado
  const expected = await getSecret('ZAPI_WEBHOOK_SECRET');
  if (expected) {
    const url = new URL(req.url);
    const fromHeader = req.headers.get('x-vendetti-secret');
    const fromQuery = url.searchParams.get('secret');
    const provided = fromHeader ?? fromQuery;
    if (provided !== expected) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const body = (await req.json().catch(() => ({}))) as ZapiPayload;

  // Z-API manda tipos diferentes pro mesmo webhook URL:
  //   - ReceivedCallback   → mensagem inbound do cliente (único que processamos)
  //   - MessageStatusCallback / DeliveryCallback / SendMessageCallback → eventos de envio
  // Se aceitarmos os 2, entramos em loop: cada sendText vira nova "msg" pro webhook.
  if (body.type && body.type !== 'ReceivedCallback') {
    return NextResponse.json({ ok: true, ignored: `type:${body.type}` });
  }
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

  const now = Date.now();
  const last = lastSeen.get(body.phone) ?? 0;
  if (now - last < COOLDOWN_MS) {
    return NextResponse.json({ ok: true, ignored: 'cooldown' });
  }
  lastSeen.set(body.phone, now);

  const text = body.text?.message ?? body.image?.caption ?? '';
  const imageUrl = body.image?.imageUrl;

  // Admin (Luís) + mídia → roteia pra parser de NF-e (Rita).
  // Sem mídia ainda não temos chat livre de admin → cai pra silence.
  const klass = await classifyInbound(body.phone, text);
  if (klass.tier === 'admin') {
    if (imageUrl) {
      const r = await handleNfeFromWhatsapp(body.phone, imageUrl);
      return NextResponse.json({ route: 'admin-nfe', ...r });
    }
    return NextResponse.json({ ok: true, route: 'admin-text', ignored: 'admin chat livre não implementado' });
  }

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
