/**
 * Lúcia · interpretador de comandos do Luís (admin) via WhatsApp.
 *
 * Funciona pra Complaint (SAC vending) E pra Inquiry (locação/estacionamento/geral).
 * Se o comando tem #id, busca em ambas tabelas e age na que achar.
 *
 * Comandos:
 *   /listar              — lista abertas (Complaint + Inquiry)
 *   /assumir [#id]       — Lúcia muta, Luís fala direto
 *   /dispensar [#id] [razão]
 *   /aprovar [#id] [valor] — só Complaint: marca REFUNDED
 *   /responder #id "texto" — envia mensagem ao cliente via Lúcia
 *   /qualificar #id      — Lead muda pra QUALIFICADO
 *   /negociar #id        — Lead muda pra EM_NEGOCIACAO
 *   /proposta #id        — Lead muda pra PROPOSTA_ENVIADA
 *   /converter #id       — Lead muda pra CONVERTIDO (resolved)
 *   /perder #id          — Lead muda pra PERDIDO (resolved)
 */

import { prisma } from '../db';
import { markAssumedByLuis, markDismissed, markRefunded } from './lucia';
import {
  markInquiryAssumed,
  markInquiryDismissed,
  markInquiryResolved,
  sendLuisResponse,
  setLeadStage,
} from './lucia-inquiry';

const CMD = {
  listar: /(?:^|\s)\/?(?:list(?:ar)?|abertas|pendentes)\b/i,
  assumir: /(?:^|\s)\/?assum(?:ir|o|i)\b|^(?:assumo|deixa\s+comigo|deixa\s+eu)\b/i,
  dispensar: /(?:^|\s)\/?(?:dispens(?:ar|a|o)|recus(?:ar|a|o)|encerra(?:r|do)?)\b/i,
  aprovar: /(?:^|\s)\/?(?:aprov(?:ar|ado|o|e)|reembols(?:ar|a|o|e)|estorna|confirm(?:ar|o|ado))\b/i,
  responder: /(?:^|\s)\/?(?:respond(?:er|e)|envia(?:r)?)\b/i,
  qualificar: /(?:^|\s)\/?qualific(?:ar|ado|o)\b/i,
  negociar: /(?:^|\s)\/?negoci(?:ar|ando|o)\b/i,
  proposta: /(?:^|\s)\/?proposta\b/i,
  converter: /(?:^|\s)\/?convert(?:er|ido|i)\b/i,
  perder: /(?:^|\s)\/?perd(?:er|ido|i)\b/i,
  id: /#([a-z0-9]{4,12})/i,
  valor: /R?\$?\s*(\d+[.,]?\d{0,2})/i,
  quoted: /"([^"]+)"|"([^"]+)"|'([^']+)'/,
};

export interface AdminCommandResult {
  handled: boolean;
  reply: string;
}

async function findTarget(idHint: string | null) {
  if (idHint) {
    // Tenta em ambas as tabelas
    const comp = await prisma.complaint.findFirst({
      where: {
        OR: [{ id: idHint }, { id: { endsWith: idHint } }, { id: { startsWith: idHint } }],
      },
      orderBy: { receivedAt: 'desc' },
    });
    if (comp) return { type: 'complaint' as const, record: comp };

    const inq = await prisma.inquiry.findFirst({
      where: {
        OR: [{ id: idHint }, { id: { endsWith: idHint } }, { id: { startsWith: idHint } }],
      },
      orderBy: { receivedAt: 'desc' },
    });
    if (inq) return { type: 'inquiry' as const, record: inq };
    return null;
  }
  // Sem id: pega a Complaint ESCALATED mais recente; senão Inquiry ESCALATED mais recente
  const comp = await prisma.complaint.findFirst({
    where: { status: 'ESCALATED' },
    orderBy: { escalatedAt: 'desc' },
  });
  if (comp) return { type: 'complaint' as const, record: comp };
  const inq = await prisma.inquiry.findFirst({
    where: { status: { in: ['ESCALATED', 'IN_PROGRESS'] } },
    orderBy: { receivedAt: 'desc' },
  });
  if (inq) return { type: 'inquiry' as const, record: inq };
  return null;
}

export async function handleAdminCommand(text: string): Promise<AdminCommandResult> {
  const idMatch = CMD.id.exec(text);
  const idHint = idMatch?.[1] ?? null;

  // === /listar ===
  if (CMD.listar.test(text)) {
    const [comps, inqs] = await Promise.all([
      prisma.complaint.findMany({
        where: { status: { in: ['AWAITING_INFO', 'ESCALATED'] } },
        orderBy: { receivedAt: 'desc' },
        take: 8,
      }),
      prisma.inquiry.findMany({
        where: { status: { in: ['NEW', 'ACKNOWLEDGED', 'ESCALATED', 'IN_PROGRESS'] } },
        orderBy: { receivedAt: 'desc' },
        take: 8,
      }),
    ]);
    if (comps.length + inqs.length === 0) {
      return { handled: true, reply: 'Sem atendimentos abertos.' };
    }
    const lines: string[] = [];
    if (comps.length > 0) {
      lines.push(`SAC (${comps.length}):`);
      for (const c of comps) {
        lines.push(
          `#${c.id.slice(-6)} · ${c.customerPhone} · ${c.status} · slot ${c.slotPosition ?? '?'}`,
        );
      }
    }
    if (inqs.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push(`Inquiries (${inqs.length}):`);
      for (const i of inqs) {
        lines.push(
          `#${i.id.slice(-6)} · ${i.customerPhone} · ${i.category}${i.leadStage ? ' ' + i.leadStage : ''}`,
        );
      }
    }
    return { handled: true, reply: lines.join('\n') };
  }

  // === /responder #id "texto" ===
  if (CMD.responder.test(text)) {
    const qm = CMD.quoted.exec(text);
    const msg = qm ? (qm[1] ?? qm[2] ?? qm[3]) : '';
    if (!msg) {
      return {
        handled: true,
        reply: 'Faltou o texto entre aspas. Ex: /responder #abc123 "texto da resposta"',
      };
    }
    const target = await findTarget(idHint);
    if (!target) return { handled: true, reply: 'Nenhuma conversa aberta pra responder.' };
    if (target.type === 'complaint') {
      // Pra Complaint, melhor assumir+ depois manda manual. Aqui só avisa.
      return {
        handled: true,
        reply: '/responder ainda só funciona pra Inquiries. Pra SAC, use /assumir e fale direto.',
      };
    }
    const ok = await sendLuisResponse(target.record.id, msg);
    return {
      handled: true,
      reply: ok
        ? `✓ Mensagem enviada ao ${target.record.customerPhone}.`
        : 'Falhou ao enviar — verifica os logs.',
    };
  }

  // === /assumir ===
  if (CMD.assumir.test(text)) {
    const target = await findTarget(idHint);
    if (!target) return { handled: true, reply: 'Sem conversa pra assumir.' };
    if (target.type === 'complaint') {
      await markAssumedByLuis(target.record.id);
    } else {
      await markInquiryAssumed(target.record.id);
    }
    return {
      handled: true,
      reply: `✓ Assumido. Lúcia muta. Cliente: ${target.record.customerPhone}.`,
    };
  }

  // === /dispensar ===
  if (CMD.dispensar.test(text)) {
    const target = await findTarget(idHint);
    if (!target) return { handled: true, reply: 'Sem conversa aberta pra dispensar.' };
    const razao = text
      .replace(CMD.dispensar, '')
      .replace(CMD.id, '')
      .replace(/^\/+/, '')
      .trim()
      .slice(0, 200);
    if (target.type === 'complaint') {
      await markDismissed(target.record.id, razao || undefined);
    } else {
      await markInquiryDismissed(target.record.id, razao || undefined);
    }
    return { handled: true, reply: `✓ Encerrada. Cliente ${target.record.customerPhone} comunicado.` };
  }

  // === /aprovar (só Complaint) ===
  if (CMD.aprovar.test(text)) {
    const target = await findTarget(idHint);
    if (!target) return { handled: true, reply: 'Sem conversa aberta.' };
    if (target.type !== 'complaint') {
      return { handled: true, reply: '/aprovar só vale pra SAC vending. Use /converter pra leads.' };
    }
    const valor = CMD.valor.exec(text);
    const amount = valor ? parseFloat(valor[1].replace(',', '.')) : undefined;
    await markRefunded(target.record.id, amount);
    return {
      handled: true,
      reply: `✓ REFUNDED ${amount ? `· R$ ${amount.toFixed(2)}` : ''}. Faça o estorno no PagBank.`,
    };
  }

  // === Lead stage commands ===
  const leadStageMap: Array<[RegExp, 'QUALIFICADO' | 'EM_NEGOCIACAO' | 'PROPOSTA_ENVIADA' | 'CONVERTIDO' | 'PERDIDO']> = [
    [CMD.qualificar, 'QUALIFICADO'],
    [CMD.negociar, 'EM_NEGOCIACAO'],
    [CMD.proposta, 'PROPOSTA_ENVIADA'],
    [CMD.converter, 'CONVERTIDO'],
    [CMD.perder, 'PERDIDO'],
  ];
  for (const [re, stage] of leadStageMap) {
    if (re.test(text)) {
      const target = await findTarget(idHint);
      if (!target || target.type !== 'inquiry') {
        return { handled: true, reply: 'Comando de lead — informe #id de uma Inquiry.' };
      }
      await setLeadStage(target.record.id, stage);
      // Se converter, marca também resolved
      if (stage === 'CONVERTIDO' || stage === 'PERDIDO') {
        await markInquiryResolved(target.record.id, `Lead ${stage}`);
      }
      return { handled: true, reply: `✓ Lead #${target.record.id.slice(-6)} → ${stage}` };
    }
  }

  return { handled: false, reply: '' };
}
