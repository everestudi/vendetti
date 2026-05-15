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
import { getMarginBuckets, getLatestSnapshot, getSlotCount, getSkuCount } from './mara/analytics';

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

export const VENDETTI_TOOLS = {
  mara_summary,
  mara_margin_buckets,
  mara_slot_detail,
  list_recent_decisions,
  decision_create,
} as const;
