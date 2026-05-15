/**
 * Vendetti · tools registradas no agent loop.
 *
 * Padrão: read-only primeiro (consulta DB rápido), depois write.
 * Tools de escrita SEMPRE registram em `Decision` antes de executar
 * (mesmo em 🟢, pra auditoria).
 */

import { tool } from 'ai';
import { z } from 'zod';
import { prisma } from '../db';
import { getCancellationStats, getMarginBuckets, getLatestSnapshot, getSkuCount, getSlotCount } from './mara/analytics';
import { evalPriceChange } from './policies';

// ============================================================
// Read-only — Mara (DB)
// ============================================================

export const mara_summary = tool({
  description:
    'Retorna o sumário operacional atual: snapshot mais recente do estoque (slots OK/alerta/críticos + % capacidade), contagem de SKUs e slots. Use no início de qualquer raciocínio pra entender o estado da máquina.',
  inputSchema: z.object({}),
  execute: async () => {
    const [snap, slots, skus] = await Promise.all([
      getLatestSnapshot(),
      getSlotCount(),
      getSkuCount(),
    ]);
    return {
      snapshot: snap
        ? {
            capturedAt: snap.capturedAt.toISOString(),
            slotsTotal: snap.slotsTotal,
            slotsOk: snap.slotsOk,
            slotsAlert: snap.slotsAlert,
            slotsCritical: snap.slotsCritical,
            capacityFilledPct: Number(snap.capacityFilledPct ?? 0),
          }
        : null,
      slotsInCatalog: slots,
      skusInCatalog: skus,
    };
  },
});

export const mara_margin_buckets = tool({
  description:
    'Lista todos os slots agrupados por faixa de margem: alta (≥50%), média (30-50%), baixa (<30%). Cada slot vem com seleção, produto, preço, lucro estimado e margem percentual. Use pra identificar slots a otimizar.',
  inputSchema: z.object({}),
  execute: async () => {
    const b = await getMarginBuckets();
    return {
      high: b.high.map((s) => ({ ...s, marginPct: Number(s.marginPct.toFixed(1)) })),
      mid: b.mid.map((s) => ({ ...s, marginPct: Number(s.marginPct.toFixed(1)) })),
      low: b.low.map((s) => ({ ...s, marginPct: Number(s.marginPct.toFixed(1)) })),
    };
  },
});

export const mara_slot_detail = tool({
  description:
    'Retorna detalhe de um slot específico pela seleção (ex: "13" pra Topway). Inclui SKU vinculado, preço, lucro estimado, capacidade, qtde alerta/crítica.',
  inputSchema: z.object({
    selecao: z.string().describe('Número da seleção, ex: "13" ou "33"'),
  }),
  execute: async ({ selecao }) => {
    const slot = await prisma.slot.findFirst({
      where: { position: selecao },
      include: { sku: true, machine: true },
    });
    if (!slot) return { error: `Slot "${selecao}" não encontrado` };
    return {
      selecao: slot.position,
      product: slot.sku?.name ?? null,
      productCode: slot.sku?.code ?? null,
      capacity: slot.capacity,
      price: slot.price ? Number(slot.price) : null,
      marginEst: slot.marginEst ? Number(slot.marginEst) : null,
      qtdeAlerta: slot.qtdeAlerta,
      qtdeCritico: slot.qtdeCritico,
      machine: slot.machine.name,
      updatedAt: slot.updatedAt.toISOString(),
    };
  },
});

export const list_recent_decisions = tool({
  description:
    'Lista as últimas N decisões registradas no decision log, com kind, level, summary, status e timestamp. Use pra checar histórico ou status de ações pendentes.',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).default(10),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'AWAITING_PHYSICAL', 'EXECUTED', 'FAILED']).optional(),
  }),
  execute: async ({ limit, status }) => {
    const rows = await prisma.decision.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        kind: true,
        level: true,
        status: true,
        summary: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
  },
});

// ============================================================
// Write — Decision log (sempre disponível, é o ledger)
// ============================================================

export const decision_create = tool({
  description:
    'CRIA um registro no decision log. SEMPRE chame antes de qualquer ação concreta (mesmo em 🟢). O registro fica como rastro do que você pensou e por quê.',
  inputSchema: z.object({
    kind: z
      .enum([
        'PRICE_CHANGE',
        'RESTOCK_ORDER',
        'RESTOCK_TASK',
        'SLOT_REORG',
        'SKU_ADD',
        'SKU_REMOVE',
        'REFUND',
        'COMPLAINT_RESPONSE',
        'SYSTEM_INVENTORY_SYNC',
        'OTHER',
      ])
      .describe('Tipo da decisão'),
    level: z.enum(['GREEN', 'YELLOW', 'RED']).describe('Nível de autonomia avaliado pela policy'),
    summary: z.string().max(200).describe('Resumo de 1 linha do que será feito'),
    rationale: z.string().max(2000).describe('Por que essa decisão — números, comparações, hipóteses'),
    data: z.record(z.string(), z.unknown()).describe('Dados estruturados (slot, preço novo/antigo, etc) em JSON'),
  }),
  execute: async ({ kind, level, summary, rationale, data }) => {
    const d = await prisma.decision.create({
      data: {
        kind,
        level,
        summary,
        rationale,
        data: data as object,
        status: level === 'GREEN' ? 'APPROVED' : 'PENDING',
      },
      select: { id: true, status: true, createdAt: true },
    });
    return {
      decisionId: d.id,
      status: d.status,
      createdAt: d.createdAt.toISOString(),
      note:
        level === 'GREEN'
          ? 'Auto-aprovada (🟢). Pode executar.'
          : 'Aguardando aprovação humana. NÃO execute ainda.',
    };
  },
});

// ============================================================
// Registry
// ============================================================

// ============================================================
// Read-only — Cancelamentos
// ============================================================

export const mara_cancellations = tool({
  description:
    'Sumário de cancelamentos (transações com status=FAILED) nos últimos N dias. Retorna total, breakdown por categoria (USER_CANCEL, CARD_DENIED, OP_CANCELLED, NO_SELECTION, CONNECTION_LOST, OTHER), top 5 produtos com mais cancelamentos, e contagem dos últimos 7 dias. Use pra identificar problemas de UX ou pagamento.',
  inputSchema: z.object({
    daysWindow: z.number().int().min(1).max(180).default(30),
  }),
  execute: async ({ daysWindow }) => {
    return getCancellationStats(daysWindow);
  },
});

export const transactions_recent = tool({
  description:
    'Lista N transações mais recentes (filtra por status OK / FAILED / REFUNDED / COMPLAINT se fornecido). Inclui produto, slot, valor, hora, motivo de falha se houver. Use pra investigar período específico ou ver as últimas vendas.',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).default(20),
    status: z.enum(['OK', 'FAILED', 'REFUNDED', 'COMPLAINT']).optional(),
  }),
  execute: async ({ limit, status }) => {
    const rows = await prisma.transaction.findMany({
      where: status ? { status } : undefined,
      orderBy: { occurredAt: 'desc' },
      take: limit,
      include: { sku: true },
    });
    return rows.map((r) => ({
      occurredAt: r.occurredAt.toISOString(),
      product: r.sku?.name ?? null,
      slotPosition: r.slotPosition,
      amount: Number(r.grossAmount),
      paymentType: r.paymentType,
      status: r.status,
      failureReason: r.failureReason,
      failureCategory: r.failureCategory,
    }));
  },
});

// ============================================================
// Write — Slot change (cria Decision, NÃO executa scraper inline)
// ============================================================

export const vendetti_propose_slot_change = tool({
  description:
    'Propõe mudança de capacidade ou preço em um slot. Sempre passa pela policy (margem ≥35%). Cria Decision com status PENDING (🟡🔴) ou APPROVED (🟢). NÃO executa o scraper — Rita executa em ação separada (npm run slot:update -- --selecao X --commit OU via worker quando disponível). Pra preço, lembre da regra das 2 pernas (sistema + físico via Weverton no grupo).',
  inputSchema: z.object({
    selecao: z.string().describe('Número da seleção, ex: "13"'),
    capacity: z.number().int().min(1).max(50).optional(),
    price: z.number().positive().optional(),
    rationale: z.string().min(10).describe('Por que essa mudança — quantos dias de dados, padrão observado, hipótese'),
  }),
  execute: async ({ selecao, capacity, price, rationale }) => {
    const slot = await prisma.slot.findFirst({ where: { position: selecao }, include: { sku: true } });
    if (!slot) return { error: `slot ${selecao} não encontrado no banco — rode mara:sync` };

    const currentPrice = slot.price ? Number(slot.price) : 0;
    const currentMargin = slot.marginEst ? Number(slot.marginEst) : 0;
    const cost = currentPrice - currentMargin;

    let level: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
    let policyReason = '';
    let blocked = false;
    if (price !== undefined) {
      const policy = evalPriceChange({ currentPrice, newPrice: price, cost });
      level = policy.level;
      policyReason = policy.reason;
      blocked = policy.blocked ?? false;
    }

    if (blocked) {
      return { error: `🔴 BLOQUEADO: ${policyReason}` };
    }

    const summary = [
      `Slot ${selecao}`,
      slot.sku?.name ?? '(sem SKU)',
      capacity !== undefined ? `capacidade → ${capacity}` : null,
      price !== undefined ? `preço → R$ ${price.toFixed(2)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const status: 'APPROVED' | 'PENDING' = level === 'GREEN' ? 'APPROVED' : 'PENDING';

    const decision = await prisma.decision.create({
      data: {
        kind: price !== undefined ? 'PRICE_CHANGE' : 'SLOT_REORG',
        level,
        summary,
        rationale,
        data: {
          selecao,
          changes: { capacity: capacity ?? null, price: price ?? null },
          before: { capacity: slot.capacity, price: currentPrice, marginEst: currentMargin },
          policyReason,
        },
        status,
      },
      select: { id: true, status: true, level: true },
    });

    const next = price !== undefined
      ? `Próximo passo: (1) Rita roda \`npm run slot:update -- --selecao ${selecao} --price ${price}${capacity !== undefined ? ` --capacity ${capacity}` : ''} --commit\` (sistema). (2) Rita avisa no grupo "Operação TCN" pro Weverton ajustar preço físico. (3) Decision vira AWAITING_PHYSICAL até Weverton confirmar. Só depois EXECUTED.`
      : `Próximo passo: rodar \`npm run slot:update -- --selecao ${selecao} --capacity ${capacity} --commit\` (Rita executa no Vendtef).`;

    return {
      decisionId: decision.id,
      status: decision.status,
      level: decision.level,
      summary,
      policyReason,
      next,
    };
  },
});

export const VENDETTI_TOOLS = {
  mara_summary,
  mara_margin_buckets,
  mara_slot_detail,
  mara_cancellations,
  transactions_recent,
  list_recent_decisions,
  decision_create,
  vendetti_propose_slot_change,
} as const;
