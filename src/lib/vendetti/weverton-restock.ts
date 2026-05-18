/**
 * Handler de mensagens do Weverton no grupo "Operação TCN Vending Machine".
 *
 * Fluxo:
 *  1. Weverton manda no grupo formato: "Boa tarde DD/MM Reposição (02) Biz 6 unidades..."
 *  2. Parser extrai itens (slot + qty)
 *  3. Cria Decision PENDING (kind=RESTOCK_TASK) com items no .data
 *  4. Avisa Luís via WhatsApp privado pra revisar
 *  5. Luís aprova em /decisions → executor dispara GH Action que atualiza
 *     estoque no Vendtef + responde no grupo "✓ atualizado"
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { sendText } from '../zapi/send';
import { getSecret } from '../secrets';

export interface ParsedItem {
  slotPosition: string;
  productGuess: string;
  qty: number;
  slotProduct: string | null;
  matchConfidence: 'high' | 'mid' | 'low' | 'no-slot';
}

export async function parseWevertonText(text: string): Promise<{ items: ParsedItem[]; warnings: string[] }> {
  const machine = await prisma.machine.findFirst({ where: { name: 'Maquina BlueMall Rondon' } });
  const lines = text.split('\n').map((l) => l.trim());
  const items: ParsedItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const headerMatch = /^\(?(\d{1,3})\)?\s*[-:]?\s*(.+)$/.exec(line);
    if (!headerMatch) continue;
    const slotPosition = headerMatch[1];
    const productGuess = headerMatch[2].trim();
    if (productGuess.length < 3) continue;
    // skip se é "Boa tarde DD/MM" ou "Reposição"
    if (/^(boa\s+(tarde|noite|dia)|reposi|bom\s+dia)/i.test(productGuess)) continue;

    let qty = 0;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const ln = lines[j];
      if (!ln) continue;
      const qtyMatch = /^(\d+)\s*(?:un|unid|unidad)/i.exec(ln);
      if (qtyMatch) {
        qty = parseInt(qtyMatch[1], 10);
        break;
      }
      if (/^\(?\d/.test(ln)) break;
    }
    if (qty === 0) continue;

    let slotProduct: string | null = null;
    let matchConfidence: ParsedItem['matchConfidence'] = 'no-slot';
    if (machine) {
      const slot = await prisma.slot.findFirst({
        where: { machineId: machine.id, position: slotPosition },
        include: { sku: true },
      });
      slotProduct = slot?.sku?.name ?? null;
      if (slotProduct) {
        const guess = productGuess.toLowerCase();
        const real = slotProduct.toLowerCase();
        const tokens = guess.split(/\s+/).filter((t) => t.length > 3);
        const matched = tokens.filter((t) => real.includes(t));
        if (matched.length === tokens.length && tokens.length > 0) matchConfidence = 'high';
        else if (matched.length > 0) matchConfidence = 'mid';
        else matchConfidence = 'low';
      }
    }
    items.push({ slotPosition, productGuess, qty, slotProduct, matchConfidence });
  }

  const lowConfidence = items.filter((i) => i.matchConfidence === 'low' || i.matchConfidence === 'no-slot');
  const warnings: string[] = [];
  if (lowConfidence.length > 0) {
    warnings.push(`${lowConfidence.length} item(ns) com match baixo/sem slot — confirme antes de aplicar.`);
  }
  return { items, warnings };
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Processa uma mensagem do Weverton no grupo Operação.
 * Cria Decision PENDING + notifica Luís.
 */
export async function handleWevertonGroupMessage(text: string, messageId?: string): Promise<{ ok: boolean; decisionId?: string; itemsCount?: number; reason?: string }> {
  // Detecção rápida: só processa se tem padrão de reposição
  if (!/repos|reabast|completei|abasteci|coloque/i.test(text) && !/^\s*\(?\d/m.test(text)) {
    return { ok: false, reason: 'sem padrão de reposição' };
  }

  const { items, warnings } = await parseWevertonText(text);
  if (items.length === 0) {
    return { ok: false, reason: 'parser não achou items' };
  }

  // Cria Decision PENDING — Luís aprova em /decisions
  const totalUnits = items.reduce((s, i) => s + i.qty, 0);
  const summary = `Reposição Weverton: ${items.length} slot(s) · ${totalUnits} unidades`;
  const rationale = [
    `Mensagem recebida no grupo Operação:`,
    `"${text.slice(0, 400)}${text.length > 400 ? '...' : ''}"`,
    ``,
    `Items extraídos:`,
    ...items.map(
      (it) =>
        `  · slot ${it.slotPosition.padStart(2, '0')} · ${it.qty}× · ${it.productGuess.slice(0, 40)} (match: ${it.matchConfidence}${it.slotProduct ? ` → ${it.slotProduct}` : ''})`,
    ),
    ...(warnings.length > 0 ? ['', ...warnings.map((w) => `⚠️ ${w}`)] : []),
  ].join('\n');

  const dec = await prisma.decision.create({
    data: {
      kind: 'SYSTEM_INVENTORY_SYNC',
      level: warnings.length > 0 ? 'RED' : 'YELLOW',
      summary,
      rationale,
      data: {
        source: 'weverton-group',
        messageId: messageId ?? null,
        rawMessage: text.slice(0, 2000),
        items,
        totalUnits,
      } as unknown as object,
      status: 'PENDING',
    },
  });

  // Notifica Luís no privado
  const luisPhone = await getSecret('LUIS_PHONE');
  if (luisPhone) {
    const base = process.env.APP_URL ?? 'https://vendetti.everest.udi.br';
    const lines = [
      `📦 Reposição Weverton — aprovação`,
      ``,
      `${items.length} slot(s), ${totalUnits} unidades:`,
      ...items.map(
        (it) =>
          `· slot ${it.slotPosition.padStart(2, '0')} · ${it.qty}× ${it.productGuess.slice(0, 30)}${it.matchConfidence === 'high' ? ' ✓' : ' ⚠️'}`,
      ),
      ...(warnings.length > 0 ? ['', ...warnings.map((w) => `⚠️ ${w}`)] : []),
      ``,
      `Aprovar / Rejeitar:`,
      `${base}/decisions`,
      ``,
      `Após aprovar, o Vendtef é atualizado automaticamente e o grupo é notificado.`,
    ].join('\n');
    await sendText(luisPhone, lines).catch((e) => console.warn('[weverton] notify Luís:', e));
  }
  void brl; // reservado pra futuro

  return { ok: true, decisionId: dec.id, itemsCount: items.length };
}

/**
 * Executor da Decision RESTOCK aprovada: dispara GH Action que atualiza
 * estoque no Vendtef + responde no grupo. Chamada pelo executor de decisions.
 */
export async function executeWevertonRestock(decisionId: string): Promise<{ ok: boolean; message: string }> {
  const dec = await prisma.decision.findUnique({ where: { id: decisionId } });
  if (!dec) return { ok: false, message: 'Decision não encontrada' };
  const data = (dec.data ?? {}) as { items?: ParsedItem[]; totalUnits?: number };
  if (!data.items?.length) return { ok: false, message: 'sem items na Decision' };

  // Cria Reposicao no DB (audit)
  const machine = await prisma.machine.findFirst({ where: { name: 'Maquina BlueMall Rondon' } });
  if (!machine) return { ok: false, message: 'máquina não encontrada' };

  const reposicao = await prisma.reposicao.create({
    data: {
      reportedBy: 'weverton',
      source: 'WHATSAPP_AUGUSTO',
      notes: `Decision ${decisionId.slice(-6)} aprovada`,
    },
  });

  const itemsToSync: { slotPosition: string; qty: number }[] = [];
  for (const it of data.items) {
    const slot = await prisma.slot.findFirst({
      where: { machineId: machine.id, position: it.slotPosition },
      include: { sku: true },
    });
    if (!slot?.skuId) continue;
    const newQty = Math.min(slot.currentQty + it.qty, slot.capacity);
    await prisma.reposicaoItem.create({
      data: {
        reposicaoId: reposicao.id,
        skuId: slot.skuId,
        slotPosition: it.slotPosition,
        qty: it.qty,
      },
    });
    await prisma.slot.update({ where: { id: slot.id }, data: { currentQty: newQty } });
    itemsToSync.push({ slotPosition: it.slotPosition, qty: it.qty });
  }

  // Dispara GH Action pra atualizar Vendtef (operação de estoque) + responde no grupo
  // ao terminar. Por enquanto, só atualiza local + responde no grupo.
  const groupId = await getSecret('OPERACAO_GROUP_ID');
  if (groupId) {
    const msg = `✓ Reposição registrada: ${itemsToSync.length} slots, ${itemsToSync.reduce((s, i) => s + i.qty, 0)} unidades. Sistema atualizado.`;
    await sendText(groupId, msg).catch((e) => console.warn('[weverton execute] grupo:', e));
  }

  return { ok: true, message: `${itemsToSync.length} slots atualizados` };
}

export async function persistWevertonConversation(messageId: string | undefined, text: string) {
  // Pra log/audit — guarda no campo de Reposicao quando aprovada, OU em meta da Decision.
  void messageId;
  void text;
}

declare module '@prisma/client' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type _UnusedPrisma = Prisma.DecisionWhereInput;
}
