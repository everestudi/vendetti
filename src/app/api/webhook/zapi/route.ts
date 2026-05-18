/**
 * Webhook Z-API · recebe mensagens inbound.
 *
 * Z-API envia POST com `{ phone, fromMe, type, text:{message}, image:{imageUrl},
 * audio:{audioUrl}, ... }`. Validação por shared secret no header
 * `X-Vendetti-Secret` ou query `?secret=...`.
 *
 * Roteamento:
 *   - fromMe=true / type≠ReceivedCallback → ignora
 *   - admin (Luís) com imagem → NF-e (Bruno)
 *   - admin (Luís) com texto → comandos SAC (Lúcia admin)
 *   - SAC → Lúcia
 *   - silence → loga e ignora
 */

import { NextResponse } from 'next/server';
import { processLuciaInbound } from '@/lib/vendetti/lucia';
import { handleAdminCommand } from '@/lib/vendetti/lucia-admin';
import { handleNfeFromWhatsapp } from '@/lib/vendetti/nfe-from-whatsapp';
import { transcribeAudio } from '@/lib/zapi/audio-transcribe';
import { classifyInbound } from '@/lib/zapi/allowlist';
import { sendText } from '@/lib/zapi/send';
import { getSecret } from '@/lib/secrets';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Circuit breaker em memória: mesma phone só pode disparar processamento 1x a cada 3s.
const lastSeen = new Map<string, number>();
const COOLDOWN_MS = 3000;

interface ZapiTextMessage { message?: string }
interface ZapiImageMessage { imageUrl?: string; caption?: string }
interface ZapiAudioMessage { audioUrl?: string; mimeType?: string }
interface ZapiPayload {
  phone?: string;
  fromMe?: boolean;
  isGroup?: boolean;
  type?: string;
  text?: ZapiTextMessage;
  image?: ZapiImageMessage;
  audio?: ZapiAudioMessage;
  messageId?: string;
}

export async function POST(req: Request) {
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

  if (body.type && body.type !== 'ReceivedCallback') {
    return NextResponse.json({ ok: true, ignored: `type:${body.type}` });
  }
  if (body.fromMe === true) {
    return NextResponse.json({ ok: true, ignored: 'fromMe' });
  }
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
  const audioUrl = body.audio?.audioUrl;

  // Transcreve áudio se houver (best-effort, falha silenciosa se OPENAI_API_KEY ausente)
  let audioTranscript: string | undefined;
  if (audioUrl) {
    const t = await transcribeAudio(audioUrl);
    if (t) audioTranscript = t;
  }
  const effectiveText = text || audioTranscript || '';

  const klass = await classifyInbound(body.phone, effectiveText);

  // === ADMIN (Luís) ===
  if (klass.tier === 'admin') {
    if (imageUrl) {
      // Imagem do Luís = NF-e (fluxo Bruno)
      const r = await handleNfeFromWhatsapp(body.phone, imageUrl);
      return NextResponse.json({ route: 'admin-nfe', ...r });
    }
    if (effectiveText) {
      const cmd = await handleAdminCommand(effectiveText);
      if (cmd.handled) {
        if (cmd.reply) await sendText(body.phone, cmd.reply);
        return NextResponse.json({ ok: true, route: 'admin-cmd', reply: cmd.reply });
      }
      // Texto não-reconhecido — só loga
      return NextResponse.json({
        ok: true,
        route: 'admin-text',
        ignored: 'comando não reconhecido (use /listar, /assumir, /dispensar, /aprovar)',
      });
    }
    return NextResponse.json({ ok: true, route: 'admin-empty' });
  }

  // === SAC (cliente) ===
  const result = await processLuciaInbound({
    phone: body.phone,
    text,
    imageUrl,
    audioUrl,
    audioTranscript,
    messageId: body.messageId,
  });

  return NextResponse.json({ ok: true, ...result });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'zapi-webhook' });
}
