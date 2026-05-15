/**
 * Lúcia · SAC scripted state machine.
 *
 * Fluxo:
 *   1. Inbound chega → classifyInbound
 *      - admin (Luís)     → roteia pro agent loop normal (NÃO aqui)
 *      - sac reconhecido  → segue abaixo
 *      - silence          → loga e ignora
 *   2. Verifica se já tem Complaint aberta pra esse phone (RECEIVED/AWAITING_PROOF/AWAITING_SLOT)
 *   3. State machine:
 *      RECEIVED → AWAITING_PROOF (manda "manda o print")
 *      AWAITING_PROOF → se chegou imagem: salva proofUrl, AWAITING_SLOT, manda "qual slot"
 *      AWAITING_SLOT → extrai número, ESCALATED, manda ack + email pro Luís
 */

import { prisma } from '../db';
import { sendText } from '../zapi/send';
import { classifyInbound } from '../zapi/allowlist';
import { getSecret } from '../secrets';

const TEMPLATES = {
  greet:
    'Oi! Aqui é a Lúcia, atendimento da máquina automática do Bluemall Rondon. Vi que você teve um problema. Pra eu te ajudar, me manda por favor o print/foto do pagamento (PIX, cartão).',
  askSlot:
    'Recebi o comprovante, obrigada! Pra eu identificar exatamente o que aconteceu: qual número você apertou no painel da máquina antes de pagar? (ex: 32, 45)',
  ackEscalated:
    'Anotei tudo. Vou repassar pro responsável aqui (Luís) decidir o reembolso e ele te retorna o quanto antes. Obrigada pela paciência! 🙏',
  ack_unclear:
    'Desculpa, não consegui entender o número do slot na sua mensagem. Pode mandar de novo só o número, por favor?',
} as const;

export interface InboundPayload {
  phone: string;
  text?: string;
  imageUrl?: string;
  messageId?: string;
}

export interface ProcessResult {
  classified: 'admin' | 'sac' | 'silence';
  complaintId?: string;
  status?: string;
  replyText?: string;
  silenced?: boolean;
  emailEscalated?: boolean;
}

function appendConversation(prev: unknown, entry: { from: string; at: string; text?: string; imageUrl?: string }) {
  const arr = Array.isArray(prev) ? (prev as unknown[]) : [];
  return [...arr, entry];
}

export async function processLuciaInbound(p: InboundPayload): Promise<ProcessResult> {
  const text = p.text ?? '';
  const klass = await classifyInbound(p.phone, text);

  // Admin (Luís) — não é fluxo SAC; chamador deve rotear pro agent loop separado
  if (klass.tier === 'admin') {
    return { classified: 'admin' };
  }

  // Procura Complaint aberta pra esse phone
  const open = await prisma.complaint.findFirst({
    where: {
      customerPhone: p.phone,
      status: { in: ['RECEIVED', 'AWAITING_PROOF', 'AWAITING_SLOT'] },
    },
    orderBy: { receivedAt: 'desc' },
  });

  // Sem complaint aberta + classificação não-SAC → silencia
  if (!open && klass.tier === 'silence') {
    return { classified: 'silence', silenced: true };
  }

  // === STATE MACHINE ===

  // Caso 1: nova reclamação (SAC válido) sem complaint aberta
  if (!open && klass.tier === 'sac') {
    const c = await prisma.complaint.create({
      data: {
        customerPhone: p.phone,
        source: 'zapi',
        customerNote: text.slice(0, 1000),
        status: 'AWAITING_PROOF',
        conversation: appendConversation(null, { from: 'customer', at: new Date().toISOString(), text }),
      },
    });
    await sendText(p.phone, TEMPLATES.greet);
    await updateConversation(c.id, { from: 'lucia', at: new Date().toISOString(), text: TEMPLATES.greet });
    return { classified: 'sac', complaintId: c.id, status: 'AWAITING_PROOF', replyText: TEMPLATES.greet };
  }

  // Caso 2: já tem complaint aberta — avança state
  if (open) {
    await updateConversation(open.id, { from: 'customer', at: new Date().toISOString(), text, imageUrl: p.imageUrl });

    if (open.status === 'AWAITING_PROOF') {
      // Espera imagem (print) ou link de imagem
      if (p.imageUrl) {
        const updated = await prisma.complaint.update({
          where: { id: open.id },
          data: { proofUrl: p.imageUrl, status: 'AWAITING_SLOT' },
        });
        await sendText(p.phone, TEMPLATES.askSlot);
        await updateConversation(updated.id, { from: 'lucia', at: new Date().toISOString(), text: TEMPLATES.askSlot });
        return { classified: 'sac', complaintId: updated.id, status: 'AWAITING_SLOT', replyText: TEMPLATES.askSlot };
      }
      // Sem imagem ainda — repete pedido suavemente
      const reminder = 'Aguardando o print do pagamento. Pode mandar a foto, por favor?';
      await sendText(p.phone, reminder);
      return { classified: 'sac', complaintId: open.id, status: open.status, replyText: reminder };
    }

    if (open.status === 'AWAITING_SLOT') {
      // Extrai número do texto
      const slotMatch = /\b(\d{1,3})\b/.exec(text);
      if (!slotMatch) {
        await sendText(p.phone, TEMPLATES.ack_unclear);
        return { classified: 'sac', complaintId: open.id, status: open.status, replyText: TEMPLATES.ack_unclear };
      }
      const slot = slotMatch[1];
      const updated = await prisma.complaint.update({
        where: { id: open.id },
        data: { slotPosition: slot, status: 'ESCALATED', escalatedAt: new Date() },
      });
      await sendText(p.phone, TEMPLATES.ackEscalated);
      await updateConversation(updated.id, { from: 'lucia', at: new Date().toISOString(), text: TEMPLATES.ackEscalated });

      // Notifica Luís
      const luisPhone = await getSecret('LUIS_PHONE');
      if (luisPhone) {
        const slotInfo = await getSlotInfo(slot);
        const summary = `🆘 Reclamação SAC nova\n\nCliente: ${p.phone}\nSlot: ${slot}${slotInfo ? ` (${slotInfo})` : ''}\nMensagem inicial: "${open.customerNote.slice(0, 100)}..."\nPrint: ${open.proofUrl ?? 'não enviado'}\n\nAbre /sac pra decidir o reembolso.`;
        await sendText(luisPhone, summary).catch((e) => console.warn('[lucia] notify Luís falhou:', e));
      }

      return {
        classified: 'sac',
        complaintId: updated.id,
        status: 'ESCALATED',
        replyText: TEMPLATES.ackEscalated,
        emailEscalated: true,
      };
    }
  }

  return { classified: klass.tier, silenced: true };
}

async function updateConversation(id: string, entry: { from: string; at: string; text?: string; imageUrl?: string }) {
  const c = await prisma.complaint.findUnique({ where: { id } });
  if (!c) return;
  const conv = appendConversation(c.conversation, entry);
  await prisma.complaint.update({ where: { id }, data: { conversation: conv } });
}

async function getSlotInfo(position: string): Promise<string | null> {
  const slot = await prisma.slot.findFirst({ where: { position }, include: { sku: true } });
  if (!slot) return null;
  return `${slot.sku?.name ?? '?'} · R$ ${Number(slot.price ?? 0).toFixed(2)}`;
}
