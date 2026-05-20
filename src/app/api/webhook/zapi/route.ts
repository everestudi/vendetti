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
import { handleInquiry } from '@/lib/vendetti/lucia-inquiry';
import { classifyInquiry, classifyByKeywords } from '@/lib/vendetti/lucia-classify';
import { handleNfeFromWhatsapp } from '@/lib/vendetti/nfe-from-whatsapp';
import { handleWevertonGroupMessage } from '@/lib/vendetti/weverton-restock';
import { transcribeAudio } from '@/lib/zapi/audio-transcribe';
import { classifyInbound } from '@/lib/zapi/allowlist';
import { sendText } from '@/lib/zapi/send';
import { getSecret } from '@/lib/secrets';
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';

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
  /// Em msg de grupo: telefone real do remetente (Weverton, Luís, etc)
  participantPhone?: string;
  fromMe?: boolean;
  isGroup?: boolean;
  type?: string;
  text?: ZapiTextMessage;
  image?: ZapiImageMessage;
  audio?: ZapiAudioMessage;
  messageId?: string;
}

function normalize(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Grava o hit no WorkerRun pra ficar visível em /webhooks.
 * status=OK; route+meta contam a história completa. Não bloqueia o response.
 */
async function logHit(payload: ZapiPayload | null, route: string, result: unknown): Promise<void> {
  try {
    await prisma.workerRun.create({
      data: {
        name: 'webhook_zapi',
        status: 'OK',
        finishedAt: new Date(),
        meta: {
          route,
          phone: payload?.phone ?? null,
          participantPhone: payload?.participantPhone ?? null,
          isGroup: payload?.isGroup === true,
          fromMe: payload?.fromMe === true,
          type: payload?.type ?? null,
          text: (payload?.text?.message ?? payload?.image?.caption ?? '').slice(0, 500),
          hasImage: Boolean(payload?.image?.imageUrl),
          hasAudio: Boolean(payload?.audio?.audioUrl),
          payloadKeys: payload ? Object.keys(payload) : [],
          result,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    console.warn('[webhook log]', e instanceof Error ? e.message : e);
  }
}

export async function POST(req: Request) {
  const expected = await getSecret('ZAPI_WEBHOOK_SECRET');
  if (expected) {
    const url = new URL(req.url);
    const fromHeader = req.headers.get('x-vendetti-secret');
    const fromQuery = url.searchParams.get('secret');
    const provided = fromHeader ?? fromQuery;
    if (provided !== expected) {
      await logHit(null, 'rejected:unauthorized', { status: 401 });
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const body = (await req.json().catch(() => ({}))) as ZapiPayload;

  if (body.type && body.type !== 'ReceivedCallback') {
    const result = { ok: true, ignored: `type:${body.type}` };
    await logHit(body, `ignored:type:${body.type}`, result);
    return NextResponse.json(result);
  }
  if (body.fromMe === true) {
    const result = { ok: true, ignored: 'fromMe' };
    await logHit(body, 'ignored:fromMe', result);
    return NextResponse.json(result);
  }
  if (!body.phone) {
    const result = { ok: false, error: 'phone ausente' };
    await logHit(body, 'rejected:no-phone', result);
    return NextResponse.json(result, { status: 400 });
  }

  // === MENSAGEM DE GRUPO ===
  if (body.isGroup === true) {
    const opGroupId = await getSecret('OPERACAO_GROUP_ID');
    const wevertonPhone = await getSecret('WEVERTON_PHONE');
    const luisPhone = await getSecret('LUIS_PHONE');
    const isOpGroup = opGroupId && body.phone && normalize(body.phone) === normalize(opGroupId);
    // Aceita Weverton (oficial) OU Luís (pra testar/simular). O handler interno
    // filtra por padrão de texto — só processa se parece reposição.
    const fromKnownOperator =
      body.participantPhone &&
      ((wevertonPhone && normalize(body.participantPhone) === normalize(wevertonPhone)) ||
        (luisPhone && normalize(body.participantPhone) === normalize(luisPhone)));

    if (isOpGroup && fromKnownOperator) {
      const text = body.text?.message ?? body.image?.caption ?? '';
      if (text.trim()) {
        const r = await handleWevertonGroupMessage(text, body.messageId);
        const result = { route: 'weverton-restock', ...r };
        await logHit(body, 'weverton-restock', result);
        return NextResponse.json(result);
      }
    }
    const result = {
      ok: true,
      ignored: 'group',
      detail: isOpGroup ? 'op group but not from Weverton/Luís' : 'other group',
      diag: {
        isOpGroup: Boolean(isOpGroup),
        fromKnownOperator: Boolean(fromKnownOperator),
        // mostra parcial pra diagnostico sem vazar
        body_phone_tail: body.phone?.slice(-8) ?? null,
        op_id_tail: opGroupId?.slice(-8) ?? null,
        participant_tail: body.participantPhone?.slice(-8) ?? null,
        luis_tail: luisPhone?.slice(-8) ?? null,
        weverton_tail: wevertonPhone?.slice(-8) ?? null,
      },
    };
    await logHit(body, `ignored:group:${isOpGroup ? 'wrong-operator' : 'other-group'}`, result);
    return NextResponse.json(result);
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
      // 1) Tenta comandos antigos primeiro (/listar, /assumir, /dispensar, /aprovar)
      const cmd = await handleAdminCommand(effectiveText);
      if (cmd.handled) {
        if (cmd.reply) await sendText(body.phone, cmd.reply);
        return NextResponse.json({ ok: true, route: 'admin-cmd', reply: cmd.reply });
      }

      // 2) Texto livre do Luís → roteia pro Augusto via mailbox + wakeup
      try {
        const augusto = await prisma.agent.findUnique({ where: { slug: 'augusto' } });
        if (!augusto) {
          await sendText(body.phone, '⚠️ Augusto não tá ativo. Seed os agentes em /empresa.');
          return NextResponse.json({ ok: true, route: 'admin-text', error: 'augusto-not-seeded' });
        }
        if (augusto.paused) {
          await sendText(body.phone, '⏸ Empresa pausada. Retoma em /empresa pra eu responder.');
          return NextResponse.json({ ok: true, route: 'admin-text', error: 'augusto-paused' });
        }

        // Cria msg do Luís → Augusto na thread luis-augusto
        const msg = await prisma.agentMessage.create({
          data: {
            fromAgentId: null, // Luís humano
            toAgentId: augusto.id,
            threadId: 'luis-augusto',
            kind: 'NOTE',
            body: effectiveText,
            refs: { channel: 'whatsapp', zapiMessageId: body.messageId },
            status: 'DELIVERED',
          },
        });

        // Enfileira wakeup
        const { enqueueWakeup } = await import('@/lib/agents/runtime');
        await enqueueWakeup({
          agentSlug: 'augusto',
          trigger: 'MAILBOX',
          triggerRef: msg.id,
          idempotencyKey: `whatsapp:${msg.id}`,
          payload: { messageId: msg.id, threadId: 'luis-augusto', channel: 'whatsapp' },
        });

        // Fire-and-forget: dispara /api/tick pra processar imediato (não bloqueia o webhook)
        const cronSecret = await getSecret('CRON_SECRET');
        if (cronSecret) {
          const tickUrl = `${new URL(req.url).origin}/api/tick`;
          fetch(tickUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${cronSecret}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ maxRuns: 1 }),
          }).catch((e) => console.warn('[admin-text tick fire-and-forget]', e));
        }

        // Não responde nada via Z-API agora — Augusto vai responder quando processar
        // (via augusto_notify_luis tool).
        return NextResponse.json({
          ok: true,
          route: 'admin-text-to-augusto',
          messageId: msg.id,
          note: 'Mensagem encaminhada ao Augusto. Resposta dele virá via Z-API (augusto_notify_luis) ou só na UI /empresa.',
        });
      } catch (e) {
        console.error('[admin-text → augusto]', e);
        return NextResponse.json({
          ok: false,
          route: 'admin-text',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return NextResponse.json({ ok: true, route: 'admin-empty' });
  }

  // === Cliente (não-admin) ===
  // Classifica via LLM (Haiku 4.5) — fallback keywords se falhar
  const classification =
    (await classifyInquiry(body.phone, effectiveText)) ?? classifyByKeywords(effectiveText);

  // SAC_VENDING continua na state machine atual (Complaint)
  if (classification.category === 'SAC_VENDING') {
    const result = await processLuciaInbound({
      phone: body.phone,
      text,
      imageUrl,
      audioUrl,
      audioTranscript,
      messageId: body.messageId,
    });
    return NextResponse.json({ ok: true, category: 'SAC_VENDING', ...result });
  }

  // SPAM → silencia
  if (classification.category === 'SPAM') {
    return NextResponse.json({ ok: true, category: 'SPAM', ignored: 'classified-spam' });
  }

  // Demais categorias (LEAD_LOCACAO, ESTACIONAMENTO, GERAL) → Inquiry
  const result = await handleInquiry({
    phone: body.phone,
    classification,
    text: effectiveText,
    imageUrl,
    audioUrl,
  });
  return NextResponse.json({ ok: true, category: classification.category, ...result });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'zapi-webhook' });
}
