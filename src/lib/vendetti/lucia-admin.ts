/**
 * Lúcia · interpretador de comandos do Luís (admin) via WhatsApp.
 *
 * Comandos aceitos:
 *   /assumir [#id]       — Luís toma a conversa (Lúcia muta)
 *   /dispensar [#id] [razão] — recusa cordial
 *   /aprovar [#id] [valor] — marca REFUNDED (Luís faz o estorno manual no PagBank)
 *   /listar              — lista reclamações abertas
 *
 * Também aceita texto livre informal. Heurísticas mínimas — se em dúvida, pede
 * confirmação.
 *
 * #id é opcional. Se omitido, aplica na última ESCALATED.
 */

import { prisma } from '../db';
import { markAssumedByLuis, markDismissed, markRefunded } from './lucia';

const CMD_RE = {
  assumir: /(?:^|\s)\/?assum(?:ir|o|i)(?:\s|$)|^(?:eu\s)?(?:assumo|deixa\s+comigo|deixa\s+eu|vou\s+falar|tô\s+falando)\b/i,
  dispensar: /(?:^|\s)\/?(?:dispens(?:ar|a|o)|recus(?:ar|a|o)|neg(?:ar|a|o))(?:\s|$)/i,
  aprovar: /(?:^|\s)\/?(?:aprov(?:ar|ado|o|e)|reembols(?:ar|a|o|e)|estorna|confirm(?:ar|o|ado))\b/i,
  listar: /(?:^|\s)\/?(?:list(?:ar)?|abertas|pendentes|reclam(?:a|ações))(?:\s|$)/i,
  id: /#([a-z0-9]{4,12})/i,
  valor: /R?\$?\s*(\d+[.,]?\d{0,2})/i,
};

export interface AdminCommandResult {
  handled: boolean;
  reply: string;
}

async function findTargetComplaint(idHint: string | null) {
  if (idHint) {
    // Tenta achar por id partial (últimos 6 chars normalmente)
    const all = await prisma.complaint.findMany({
      where: {
        OR: [
          { id: idHint },
          { id: { endsWith: idHint } },
          { id: { startsWith: idHint } },
        ],
      },
      orderBy: { receivedAt: 'desc' },
      take: 1,
    });
    if (all[0]) return all[0];
  }
  // Última ESCALATED
  return prisma.complaint.findFirst({
    where: { status: 'ESCALATED' },
    orderBy: { escalatedAt: 'desc' },
  });
}

export async function handleAdminCommand(text: string): Promise<AdminCommandResult> {
  const idMatch = CMD_RE.id.exec(text);
  const idHint = idMatch?.[1] ?? null;

  // === /listar ===
  if (CMD_RE.listar.test(text)) {
    const open = await prisma.complaint.findMany({
      where: {
        status: { in: ['AWAITING_INFO', 'ESCALATED'] },
      },
      orderBy: { receivedAt: 'desc' },
      take: 10,
    });
    if (open.length === 0) {
      return { handled: true, reply: 'Sem reclamações abertas no momento.' };
    }
    const lines = open.map(
      (c) =>
        `#${c.id.slice(-6)} · ${c.customerPhone ?? '?'} · ${c.status} · slot ${
          c.slotPosition ?? '?'
        } · ${new Date(c.receivedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
    );
    return {
      handled: true,
      reply: `Abertas (${open.length}):\n${lines.join('\n')}`,
    };
  }

  // === /assumir ===
  if (CMD_RE.assumir.test(text)) {
    const target = await findTargetComplaint(idHint);
    if (!target) return { handled: true, reply: 'Sem reclamação escalada pra assumir.' };
    await markAssumedByLuis(target.id);
    return {
      handled: true,
      reply: `✓ Assumido. Lúcia muta. Cliente: ${target.customerPhone}. Fale direto.`,
    };
  }

  // === /dispensar ===
  if (CMD_RE.dispensar.test(text)) {
    const target = await findTargetComplaint(idHint);
    if (!target) return { handled: true, reply: 'Sem reclamação aberta pra dispensar.' };
    const razao = text
      .replace(CMD_RE.dispensar, '')
      .replace(CMD_RE.id, '')
      .replace(/^\/+/, '')
      .trim()
      .slice(0, 200);
    await markDismissed(target.id, razao || undefined);
    return {
      handled: true,
      reply: `✓ Dispensada. Cliente ${target.customerPhone} comunicado.`,
    };
  }

  // === /aprovar ===
  if (CMD_RE.aprovar.test(text)) {
    const target = await findTargetComplaint(idHint);
    if (!target) return { handled: true, reply: 'Sem reclamação aberta pra aprovar.' };
    const valor = CMD_RE.valor.exec(text);
    const amount = valor ? parseFloat(valor[1].replace(',', '.')) : undefined;
    await markRefunded(target.id, amount);
    return {
      handled: true,
      reply: `✓ Marcada REFUNDED ${amount ? `· R$ ${amount.toFixed(2)}` : ''}. Faça o estorno no PagBank e mande o print pro cliente direto.`,
    };
  }

  return { handled: false, reply: '' };
}
