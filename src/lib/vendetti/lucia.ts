/**
 * Lúcia · SAC scripted, agora minimalista e direta.
 *
 * Filosofia:
 *  - Single-shot greeting: pede print + slot juntos numa mensagem.
 *  - Máximo 4 mensagens por reclamação. Depois disso, fica muda — Luís intervém.
 *  - Não insiste. Cliente não respondeu? Cron marca ABANDONED após 2h.
 *  - Após escalar pro Luís: cliente recebe 1 ack final ("vou passar pro Luís") e
 *    a Lúcia silencia. Luís fala direto do próprio zap.
 *  - Tom: formal, sem emoji, assina "Lúcia · Bluemall".
 */

import { prisma } from '../db';
import { sendText } from '../zapi/send';
import { classifyInbound } from '../zapi/allowlist';
import { getSecret } from '../secrets';

const MAX_LUCIA_MSGS = 4;

const BUSINESS_HOUR_START = 8; // 08:00 BRT
const BUSINESS_HOUR_END = 22; // 22:00 BRT

function isBusinessHours(now: Date = new Date()): boolean {
  // Vercel gru1 e dev local rodam em BRT — confio no Date.now() local.
  const h = now.getHours();
  return h >= BUSINESS_HOUR_START && h < BUSINESS_HOUR_END;
}

const SIGN = 'Lúcia · Bluemall';

const TEMPLATES = {
  greetBusinessHours: () =>
    `Olá! Aqui é a Lúcia, atendimento Bluemall.

Recebi sua mensagem sobre um problema com a máquina. Para agilizar o atendimento, por favor envie:

1. Print/foto do pagamento (PIX ou cartão)
2. Número do slot que você apertou na máquina (ex: 32, 45)

Após receber, vou verificar no sistema e informar o Luís Neto, responsável.

${SIGN}`,

  greetOutOfHours: () =>
    `Olá! Aqui é a Lúcia, atendimento Bluemall.

Recebi sua mensagem. Como estamos fora do horário de atendimento (8h às 22h), vou repassar para o Luís Neto, responsável, e ele retornará durante o horário comercial.

Para agilizar, você pode já enviar:

1. Print/foto do pagamento (PIX ou cartão)
2. Número do slot que você apertou na máquina (ex: 32, 45)

${SIGN}`,

  ackEscalated: () =>
    `Recebi as informações. Vou verificar no sistema e repassar para o Luís Neto, responsável. Ele entrará em contato em breve para tratar do reembolso.

${SIGN}`,

  postEscalationAck: () =>
    `Obrigada. Já repassei para o Luís Neto e ele entrará em contato pessoalmente.

${SIGN}`,

  handoffToLuis: () =>
    `Vou passar para o Luís Neto, ele entrará em contato em instantes.

${SIGN}`,

  ackPartialInfo: () =>
    `Recebido. Preciso ainda do print/foto do pagamento e do número do slot para repassar para o Luís Neto.

${SIGN}`,

  ackAudio: () =>
    `Recebi sua mensagem de áudio mas não consegui interpretar. Por favor, digite o problema em texto para eu repassar mais rápido para o Luís Neto.

${SIGN}`,
} as const;

export interface InboundPayload {
  phone: string;
  text?: string;
  imageUrl?: string;
  audioUrl?: string;
  audioTranscript?: string;
  messageId?: string;
}

export interface ProcessResult {
  classified: 'admin' | 'sac' | 'silence';
  complaintId?: string;
  status?: string;
  replyText?: string;
  silenced?: boolean;
  reason?: string;
}

type ConversationEntry = {
  from: 'customer' | 'lucia' | 'luis';
  at: string;
  text?: string;
  imageUrl?: string;
  audioUrl?: string;
};

function appendConversation(prev: unknown, entry: ConversationEntry): ConversationEntry[] {
  const arr = Array.isArray(prev) ? (prev as ConversationEntry[]) : [];
  return [...arr, entry];
}

async function sendLuciaText(phone: string, text: string, complaintId: string) {
  await sendText(phone, text);
  const c = await prisma.complaint.findUnique({
    where: { id: complaintId },
    select: { conversation: true },
  });
  await prisma.complaint.update({
    where: { id: complaintId },
    data: {
      luciaMessageCount: { increment: 1 },
      conversation: appendConversation(c?.conversation, {
        from: 'lucia',
        at: new Date().toISOString(),
        text,
      }) as unknown as object,
    },
  });
}

async function appendCustomerToConv(complaintId: string, p: InboundPayload) {
  const c = await prisma.complaint.findUnique({
    where: { id: complaintId },
    select: { conversation: true },
  });
  await prisma.complaint.update({
    where: { id: complaintId },
    data: {
      lastClientMessageAt: new Date(),
      conversation: appendConversation(c?.conversation, {
        from: 'customer',
        at: new Date().toISOString(),
        text: p.text ?? p.audioTranscript,
        imageUrl: p.imageUrl,
        audioUrl: p.audioUrl,
      }) as unknown as object,
    },
  });
}

/**
 * Cruza com Transaction no Vendpago.
 * Retorna info pra anexar no escalation message.
 */
async function matchTransaction(slot: string | null): Promise<{ matched: boolean; info: string }> {
  if (!slot) return { matched: false, info: '(sem slot pra cruzar com Transaction)' };

  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const txns = await prisma.transaction.findMany({
    where: { slotPosition: slot, occurredAt: { gte: since } },
    orderBy: { occurredAt: 'desc' },
    include: { sku: true },
    take: 3,
  });

  if (txns.length === 0) {
    return { matched: false, info: `✗ Sem venda registrada no slot ${slot} nas últimas 24h.` };
  }

  const t = txns[0];
  const dt = t.occurredAt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return {
    matched: true,
    info: `✓ Venda slot ${t.slotPosition} · ${dt} · ${t.sku?.name ?? '?'} · R$ ${Number(t.grossAmount).toFixed(2)} · ${t.paymentType ?? '?'} · ${t.status}`,
  };
}

async function escalateToLuis(complaintId: string) {
  const luisPhone = await getSecret('LUIS_PHONE');
  if (!luisPhone) return;

  const c = await prisma.complaint.findUnique({ where: { id: complaintId } });
  if (!c) return;

  const { info: txnInfo, matched } = await matchTransaction(c.slotPosition);
  await prisma.complaint
    .update({ where: { id: complaintId }, data: { transactionMatched: matched } })
    .catch(() => undefined);

  const history = await prisma.complaint.count({
    where: { customerPhone: c.customerPhone ?? undefined, id: { not: c.id } },
  });

  let slotInfo = '';
  if (c.slotPosition) {
    const slot = await prisma.slot.findFirst({
      where: { position: c.slotPosition },
      include: { sku: true },
    });
    if (slot?.sku) {
      slotInfo = `\nProduto no slot: ${slot.sku.name} · R$ ${Number(slot.price ?? 0).toFixed(2)}`;
    }
  }

  const base = process.env.APP_URL ?? 'https://vendetti.everest.udi.br';

  const msg = [
    `🆘 SAC #${c.id.slice(-6)}`,
    ``,
    `Cliente: ${c.customerPhone ?? '?'}`,
    c.slotPosition ? `Slot reportado: ${c.slotPosition}${slotInfo}` : '(cliente não informou slot)',
    c.proofUrl ? `Print: ${c.proofUrl}` : '(sem print)',
    ``,
    `Mensagem original: "${(c.customerNote ?? '').slice(0, 200)}"`,
    ``,
    txnInfo,
    ``,
    `Histórico desse cliente: ${history === 0 ? '1ª reclamação' : `${history} reclamação(ões) anterior(es)`}`,
    ``,
    `Comandos (responda esse zap):`,
    `/assumir — Lúcia muta, você fala direto`,
    `/dispensar [razão] — recusa cordial`,
    `/aprovar — marca REFUNDED (você faz o estorno no PagBank)`,
    ``,
    `Painel: ${base}/sac`,
  ].join('\n');

  await sendText(luisPhone, msg).catch((e) => console.warn('[lucia] escalation msg:', e));
}

/**
 * Notifica o Luís de nova mensagem do cliente quando já estamos em estado ESCALATED
 * (sem nova escalação completa, só ping curto).
 */
async function pingLuisNewMsg(complaintId: string, text: string | undefined, hasImage: boolean) {
  const luisPhone = await getSecret('LUIS_PHONE');
  if (!luisPhone) return;
  const c = await prisma.complaint.findUnique({ where: { id: complaintId } });
  if (!c) return;
  const preview = text ? `"${text.slice(0, 100)}"` : hasImage ? '(imagem)' : '(vazio)';
  await sendText(
    luisPhone,
    `💬 Nova msg de ${c.customerPhone} (SAC #${c.id.slice(-6)}): ${preview}`,
  ).catch(() => undefined);
}

export async function processLuciaInbound(p: InboundPayload): Promise<ProcessResult> {
  const text = p.text ?? p.audioTranscript ?? '';
  const klass = await classifyInbound(p.phone, text);

  if (klass.tier === 'admin') return { classified: 'admin' };

  // Procura complaint aberta pra esse phone
  const open = await prisma.complaint.findFirst({
    where: {
      customerPhone: p.phone,
      status: { in: ['RECEIVED', 'AWAITING_PROOF', 'AWAITING_SLOT', 'AWAITING_INFO', 'ESCALATED'] },
    },
    orderBy: { receivedAt: 'desc' },
  });

  // Sem complaint aberta + silence → ignora
  if (!open && klass.tier === 'silence') {
    return { classified: 'silence', silenced: true };
  }

  // === ROTA 1: nova reclamação ===
  if (!open && klass.tier === 'sac') {
    const inHours = isBusinessHours();

    const c = await prisma.complaint.create({
      data: {
        customerPhone: p.phone,
        source: 'zapi',
        customerNote: text.slice(0, 1000),
        status: 'AWAITING_INFO',
        proofUrl: p.imageUrl ?? null,
        lastClientMessageAt: new Date(),
        conversation: appendConversation(null, {
          from: 'customer',
          at: new Date().toISOString(),
          text,
          imageUrl: p.imageUrl,
          audioUrl: p.audioUrl,
        }) as unknown as object,
      },
    });

    // Se cliente já mandou áudio sem transcript, avisa pra digitar
    if (p.audioUrl && !p.audioTranscript) {
      await sendLuciaText(p.phone, TEMPLATES.ackAudio(), c.id);
      return { classified: 'sac', complaintId: c.id, status: 'AWAITING_INFO', replyText: TEMPLATES.ackAudio() };
    }

    const greeting = inHours ? TEMPLATES.greetBusinessHours() : TEMPLATES.greetOutOfHours();
    await sendLuciaText(p.phone, greeting, c.id);

    // Fora do horário: escala imediatamente
    if (!inHours) {
      await prisma.complaint.update({
        where: { id: c.id },
        data: { status: 'ESCALATED', escalatedAt: new Date() },
      });
      await escalateToLuis(c.id);
      return { classified: 'sac', complaintId: c.id, status: 'ESCALATED', replyText: greeting };
    }

    return { classified: 'sac', complaintId: c.id, status: 'AWAITING_INFO', replyText: greeting };
  }

  // === ROTA 2: complaint aberta ===
  if (!open) return { classified: 'silence', silenced: true, reason: 'no-open-complaint' };

  await appendCustomerToConv(open.id, p);

  // Captura novos dados do cliente
  const slotMatch = /\b(\d{1,3})\b/.exec(text);
  const slotFromText = slotMatch?.[1] ?? null;
  const hasNewProof = !!p.imageUrl && !open.proofUrl;
  const hasNewSlot = !!slotFromText && !open.slotPosition;

  // Aplica updates parciais
  const updateData: { proofUrl?: string; slotPosition?: string } = {};
  if (hasNewProof) updateData.proofUrl = p.imageUrl;
  if (hasNewSlot) updateData.slotPosition = slotFromText!;
  if (Object.keys(updateData).length > 0) {
    await prisma.complaint.update({ where: { id: open.id }, data: updateData });
  }

  const reloaded = await prisma.complaint.findUnique({ where: { id: open.id } });
  if (!reloaded) return { classified: 'sac', complaintId: open.id, silenced: true };

  const hasProof = !!reloaded.proofUrl;
  const hasSlot = !!reloaded.slotPosition;
  const isAwaiting = ['AWAITING_INFO', 'AWAITING_PROOF', 'AWAITING_SLOT', 'RECEIVED'].includes(
    reloaded.status,
  );

  // === CASO A: ainda awaiting, info ficou suficiente (qualquer um dos dois basta) ===
  if (isAwaiting && (hasProof || hasSlot)) {
    await prisma.complaint.update({
      where: { id: open.id },
      data: { status: 'ESCALATED', escalatedAt: new Date() },
    });

    if (reloaded.luciaMessageCount < MAX_LUCIA_MSGS) {
      await sendLuciaText(p.phone, TEMPLATES.ackEscalated(), open.id);
    }
    await escalateToLuis(open.id);

    return {
      classified: 'sac',
      complaintId: open.id,
      status: 'ESCALATED',
      replyText: TEMPLATES.ackEscalated(),
    };
  }

  // === CASO B: ainda awaiting, cliente respondeu sem info útil ===
  if (isAwaiting) {
    if (reloaded.luciaMessageCount < MAX_LUCIA_MSGS - 1) {
      await sendLuciaText(p.phone, TEMPLATES.ackPartialInfo(), open.id);
      return {
        classified: 'sac',
        complaintId: open.id,
        status: reloaded.status,
        replyText: TEMPLATES.ackPartialInfo(),
      };
    }
    return {
      classified: 'sac',
      complaintId: open.id,
      status: reloaded.status,
      silenced: true,
      reason: 'msg-cap',
    };
  }

  // === CASO C: já ESCALATED, cliente continua mandando msg ===
  if (reloaded.status === 'ESCALATED') {
    if (reloaded.luciaMessageCount < MAX_LUCIA_MSGS) {
      await sendLuciaText(p.phone, TEMPLATES.postEscalationAck(), open.id);
    }
    await pingLuisNewMsg(open.id, text, !!p.imageUrl);
    return { classified: 'sac', complaintId: open.id, status: 'ESCALATED' };
  }

  return { classified: 'sac', complaintId: open.id, silenced: true };
}

/**
 * Marca cliente como assumido pelo Luís. Lúcia avisa o cliente uma última vez
 * (handoff) e silencia.
 */
export async function markAssumedByLuis(complaintId: string): Promise<void> {
  const c = await prisma.complaint.findUnique({ where: { id: complaintId } });
  if (!c || !c.customerPhone) return;
  await prisma.complaint.update({
    where: { id: complaintId },
    data: { status: 'ASSUMED_BY_LUIS' },
  });
  if (c.luciaMessageCount < MAX_LUCIA_MSGS) {
    await sendLuciaText(c.customerPhone, TEMPLATES.handoffToLuis(), complaintId);
  }
}

/**
 * Dispensa a reclamação com motivo opcional. Lúcia comunica o cliente.
 */
export async function markDismissed(complaintId: string, razao?: string): Promise<void> {
  const c = await prisma.complaint.findUnique({ where: { id: complaintId } });
  if (!c) return;
  await prisma.complaint.update({
    where: { id: complaintId },
    data: { status: 'DISMISSED', resolution: razao ?? 'Dispensada pelo Luís' },
  });
  if (c.customerPhone && c.luciaMessageCount < MAX_LUCIA_MSGS) {
    const msg = razao
      ? `Verifiquei sua solicitação. ${razao}\n\nQualquer dúvida, estou à disposição.\n\n${SIGN}`
      : `Verifiquei sua solicitação e não foi possível prosseguir com o reembolso neste momento. Qualquer dúvida, estou à disposição.\n\n${SIGN}`;
    await sendLuciaText(c.customerPhone, msg, complaintId);
  }
}

/**
 * Marca como REFUNDED — Luís confirmou. Não envia mensagem ao cliente
 * (o Luís já está em contato direto).
 */
export async function markRefunded(complaintId: string, amount?: number): Promise<void> {
  await prisma.complaint.update({
    where: { id: complaintId },
    data: {
      status: 'REFUNDED',
      resolvedAt: new Date(),
      refundAmount: amount ?? null,
    },
  });
}

export { TEMPLATES, MAX_LUCIA_MSGS, isBusinessHours };
