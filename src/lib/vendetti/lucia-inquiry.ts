/**
 * Lúcia · handler de Inquiries não-SAC.
 *
 * Quando classifier detecta LEAD_LOCACAO / ESTACIONAMENTO / GERAL, criamos
 * uma Inquiry, mandamos UMA mensagem cordial pro cliente e escalamos pro
 * Luís com o resumo. Não insistimos, não conversamos. Cap de 4 msgs igual SAC.
 */

import { prisma } from '../db';
import type { Prisma } from '@prisma/client';
import { sendText } from '../zapi/send';
import { getSecret } from '../secrets';
import type { Classification, InquiryCategory } from './lucia-classify';

const MAX_LUCIA_MSGS = 4;
const SIGN = 'Lúcia · Bluemall';

const TEMPLATES: Record<InquiryCategory, (subject?: string) => string> = {
  SAC_VENDING: () => '', // não usado aqui (Complaint trata SAC)

  LEAD_LOCACAO: () =>
    `Olá! Aqui é a Lúcia, atendimento Bluemall.

Vi seu interesse em locação no shopping. Vou repassar para o Luís Neto, responsável pela área comercial, e ele entrará em contato em breve com as opções disponíveis e condições.

Para agilizar, se puder me adiantar: tipo de negócio, metragem desejada e prazo previsto para abertura, eu encaminho já organizado.

${SIGN}`,

  ESTACIONAMENTO: () =>
    `Olá! Aqui é a Lúcia, atendimento Bluemall.

Recebi sua mensagem sobre o estacionamento. Vou repassar para o Luís Neto, responsável, e ele retornará em breve.

${SIGN}`,

  GERAL: () =>
    `Olá! Aqui é a Lúcia, atendimento Bluemall.

Recebi sua mensagem. Vou repassar para o Luís Neto, responsável, para que ele te dê a resposta adequada.

${SIGN}`,

  SPAM: () => '',
};

type ConversationEntry = {
  from: 'customer' | 'lucia' | 'luis';
  at: string;
  text?: string;
  imageUrl?: string;
  audioUrl?: string;
};

function append(prev: unknown, entry: ConversationEntry): ConversationEntry[] {
  const arr = Array.isArray(prev) ? (prev as ConversationEntry[]) : [];
  return [...arr, entry];
}

export async function handleInquiry({
  phone,
  classification,
  text,
  imageUrl,
  audioUrl,
}: {
  phone: string;
  classification: Classification;
  text: string;
  imageUrl?: string;
  audioUrl?: string;
}): Promise<{ inquiryId: string; status: string; replyText?: string }> {
  // SPAM → não cria registro, ignora
  if (classification.category === 'SPAM') {
    return { inquiryId: '', status: 'IGNORED_SPAM' };
  }

  // Procura inquiry aberta pra esse phone+categoria (continuação de conversa)
  const open = await prisma.inquiry.findFirst({
    where: {
      customerPhone: phone,
      category: classification.category,
      status: { in: ['NEW', 'ACKNOWLEDGED', 'ESCALATED', 'IN_PROGRESS'] },
    },
    orderBy: { receivedAt: 'desc' },
  });

  // Continuação de conversa: só atualiza conversa, eventualmente notifica Luís
  if (open) {
    const updatedConv = append(open.conversation, {
      from: 'customer',
      at: new Date().toISOString(),
      text,
      imageUrl,
      audioUrl,
    });
    await prisma.inquiry.update({
      where: { id: open.id },
      data: {
        conversation: updatedConv as unknown as object,
        lastClientMessageAt: new Date(),
      },
    });
    // Ping Luís de nova mensagem
    await pingLuisNewMsg(open.id, text, !!imageUrl);
    return { inquiryId: open.id, status: open.status };
  }

  // Nova inquiry
  const template = TEMPLATES[classification.category];
  const greet = template(classification.subject);

  const created = await prisma.inquiry.create({
    data: {
      customerPhone: phone,
      source: 'zapi',
      category: classification.category,
      subject: classification.subject?.slice(0, 80) ?? null,
      originalMessage: text.slice(0, 2000),
      status: 'NEW',
      luciaMessageCount: 0,
      lastClientMessageAt: new Date(),
      leadStage: classification.category === 'LEAD_LOCACAO' ? 'PRE_QUALIFICACAO' : null,
      leadDetails: ((classification.leadDetails ?? null) as unknown) as Prisma.InputJsonValue,
      conversation: append(null, {
        from: 'customer',
        at: new Date().toISOString(),
        text,
        imageUrl,
        audioUrl,
      }) as unknown as object,
    },
  });

  // Manda greet
  if (greet) {
    await sendText(phone, greet);
    await prisma.inquiry.update({
      where: { id: created.id },
      data: {
        luciaMessageCount: { increment: 1 },
        status: 'ACKNOWLEDGED',
        conversation: append(created.conversation, {
          from: 'lucia',
          at: new Date().toISOString(),
          text: greet,
        }) as unknown as object,
      },
    });
  }

  // Escala pro Luís
  await escalateToLuis(created.id);
  await prisma.inquiry.update({
    where: { id: created.id },
    data: { status: 'ESCALATED' },
  });

  return { inquiryId: created.id, status: 'ESCALATED', replyText: greet };
}

async function escalateToLuis(inquiryId: string) {
  const luisPhone = await getSecret('LUIS_PHONE');
  if (!luisPhone) return;
  const i = await prisma.inquiry.findUnique({ where: { id: inquiryId } });
  if (!i) return;

  // Histórico desse cliente (outras inquiries)
  const history = await prisma.inquiry.count({
    where: { customerPhone: i.customerPhone, id: { not: i.id } },
  });
  const histSac = await prisma.complaint.count({
    where: { customerPhone: i.customerPhone },
  });

  const emoji =
    i.category === 'LEAD_LOCACAO'
      ? '🏢'
      : i.category === 'ESTACIONAMENTO'
        ? '🚗'
        : '📩';

  const lines: string[] = [
    `${emoji} ${i.category} · #${i.id.slice(-6)}`,
    ``,
    `Cliente: ${i.customerPhone}`,
  ];
  if (i.subject) lines.push(`Assunto: ${i.subject}`);
  if (i.leadDetails && typeof i.leadDetails === 'object') {
    const det = i.leadDetails as Record<string, unknown>;
    for (const [k, v] of Object.entries(det)) {
      if (v) lines.push(`${k}: ${String(v)}`);
    }
  }
  lines.push('');
  lines.push(`Mensagem: "${i.originalMessage.slice(0, 240)}"`);
  lines.push('');
  if (history + histSac > 0) {
    lines.push(`Histórico desse cliente: ${history} inquiry(ies) + ${histSac} SAC(s)`);
    lines.push('');
  }
  lines.push(`Comandos (responda esse zap):`);
  lines.push(`/responder ${i.id.slice(-6)} "texto" — envia ao cliente`);
  lines.push(`/assumir ${i.id.slice(-6)} — Lúcia muta, você fala direto`);
  lines.push(`/dispensar ${i.id.slice(-6)} [motivo] — encerra`);
  if (i.category === 'LEAD_LOCACAO') {
    lines.push(`/qualificar ${i.id.slice(-6)} | /negociar | /converter | /perder`);
  }

  await sendText(luisPhone, lines.join('\n')).catch((e) =>
    console.warn('[lucia-inquiry] escalate:', e),
  );
}

async function pingLuisNewMsg(inquiryId: string, text: string, hasImage: boolean) {
  const luisPhone = await getSecret('LUIS_PHONE');
  if (!luisPhone) return;
  const i = await prisma.inquiry.findUnique({ where: { id: inquiryId } });
  if (!i) return;
  const preview = text ? `"${text.slice(0, 100)}"` : hasImage ? '(imagem)' : '(vazio)';
  await sendText(
    luisPhone,
    `💬 Nova msg de ${i.customerPhone} (${i.category} #${i.id.slice(-6)}): ${preview}`,
  ).catch(() => undefined);
}

/**
 * Envia uma resposta digitada pelo Luís ao cliente (action /responder).
 */
export async function sendLuisResponse(inquiryId: string, text: string): Promise<boolean> {
  const i = await prisma.inquiry.findUnique({ where: { id: inquiryId } });
  if (!i || !i.customerPhone) return false;
  await sendText(i.customerPhone, text);
  await prisma.inquiry.update({
    where: { id: inquiryId },
    data: {
      status: 'IN_PROGRESS',
      conversation: append(i.conversation, {
        from: 'luis',
        at: new Date().toISOString(),
        text,
      }) as unknown as object,
    },
  });
  return true;
}

export async function markInquiryAssumed(id: string) {
  const i = await prisma.inquiry.findUnique({ where: { id } });
  if (!i || !i.customerPhone) return;
  await prisma.inquiry.update({
    where: { id },
    data: { status: 'ASSUMED_BY_LUIS' },
  });
  if (i.luciaMessageCount < MAX_LUCIA_MSGS) {
    const msg = `Vou passar para o Luís Neto, ele entrará em contato em instantes.\n\n${SIGN}`;
    await sendText(i.customerPhone, msg);
    await prisma.inquiry.update({
      where: { id },
      data: {
        luciaMessageCount: { increment: 1 },
        conversation: append(i.conversation, {
          from: 'lucia',
          at: new Date().toISOString(),
          text: msg,
        }) as unknown as object,
      },
    });
  }
}

export async function markInquiryDismissed(id: string, razao?: string) {
  await prisma.inquiry.update({
    where: { id },
    data: { status: 'DISMISSED', resolution: razao ?? 'Encerrada pelo Luís', resolvedAt: new Date() },
  });
}

export async function markInquiryResolved(id: string, resolution?: string) {
  await prisma.inquiry.update({
    where: { id },
    data: { status: 'RESOLVED', resolution: resolution ?? null, resolvedAt: new Date() },
  });
}

export async function setLeadStage(
  id: string,
  stage: 'PRE_QUALIFICACAO' | 'QUALIFICADO' | 'EM_NEGOCIACAO' | 'PROPOSTA_ENVIADA' | 'CONVERTIDO' | 'PERDIDO',
) {
  await prisma.inquiry.update({
    where: { id },
    data: {
      leadStage: stage,
      status: stage === 'CONVERTIDO' || stage === 'PERDIDO' ? 'RESOLVED' : 'IN_PROGRESS',
      resolvedAt: stage === 'CONVERTIDO' || stage === 'PERDIDO' ? new Date() : undefined,
    },
  });
}
