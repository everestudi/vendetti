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
import {
  evalPriceChange,
  evalRestock,
  evalRefund,
  evalSlotReorg,
  evalSkuChange,
  evalInventorySync,
  LIMITS,
  MIN_MARGIN_PCT,
} from './policies';
import { searchAtacadao } from '../../scrapers/atacadao/search';
import { sendToOperacaoGroup, sendText } from '../zapi/send';
import { getFreshness, getInfraHealth } from '../infra/health';
import { dispatchWorkflow } from '../infra/gh-dispatch';
import { backfillProductImages, refetchImageForSkuByName } from '../products/fetch-images';

// ============================================================
// Read-only — Mara (DB)
// ============================================================

export const mara_summary = tool({
  description:
    'Retorna o sumário operacional atual: snapshot mais recente do estoque (slots OK/alerta/críticos + % capacidade), contagem de SKUs e slots. Use no início de qualquer raciocínio pra entender o estado da máquina. RETORNA dataFreshness: SE isStale=true, OS DADOS ESTÃO VELHOS — avise o Luís e considere acionar infra_trigger_backfill.',
  inputSchema: z.object({}),
  execute: async () => {
    const [snap, slots, skus, freshness] = await Promise.all([
      getLatestSnapshot(),
      getSlotCount(),
      getSkuCount(),
      getFreshness('snapshot'),
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
      dataFreshness: {
        lastUpdate: freshness.lastUpdate?.toISOString() ?? null,
        ageHours: freshness.ageHours,
        isStale: freshness.isStale,
      },
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

    // Trigger automático Zelda — via fireDomainEvent (centralizado em
    // src/lib/agents/triggers.ts). Loop prevention: se Zelda mesmo criar
    // Decision, não auto-dispara (isRecursive em triggers.ts trata).
    //
    // TODO: passar createdByAgentSlug real (precisa contexto da run atual).
    // Por ora hardcoded 'unknown' — recursion check só funciona quando
    // sabemos quem criou. Aceito por enquanto.
    try {
      const { fireDomainEvent } = await import('../agents/triggers');
      await fireDomainEvent({
        kind: 'decision_created',
        decisionId: d.id,
        createdByAgentSlug: 'unknown',
        decisionKind: kind,
        level,
      });
    } catch (e) {
      console.warn('[decision_create] fireDomainEvent falhou (não-fatal):', e instanceof Error ? e.message : e);
    }

    return {
      decisionId: d.id,
      status: d.status,
      createdAt: d.createdAt.toISOString(),
      note:
        level === 'GREEN'
          ? 'Auto-aprovada (🟢). Pode executar. Zelda foi notificada pra auditar.'
          : 'Aguardando aprovação humana. NÃO execute ainda. Zelda foi notificada pra revisar policies.',
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
    'Lista N transações mais recentes (filtra por status OK / FAILED / REFUNDED / COMPLAINT se fornecido). Inclui produto, slot, valor, hora, motivo de falha se houver. Use pra investigar período específico ou ver as últimas vendas. RETORNA dataFreshness — SE isStale, comunique ao Luís.',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).default(20),
    status: z.enum(['OK', 'FAILED', 'REFUNDED', 'COMPLAINT']).optional(),
  }),
  execute: async ({ limit, status }) => {
    const [rows, freshness] = await Promise.all([
      prisma.transaction.findMany({
        where: status ? { status } : undefined,
        orderBy: { occurredAt: 'desc' },
        take: limit,
        include: { sku: true },
      }),
      getFreshness('transactions'),
    ]);
    return {
      transactions: rows.map((r) => ({
        occurredAt: r.occurredAt.toISOString(),
        product: r.sku?.name ?? null,
        slotPosition: r.slotPosition,
        amount: Number(r.grossAmount),
        paymentType: r.paymentType,
        status: r.status,
        failureReason: r.failureReason,
        failureCategory: r.failureCategory,
      })),
      dataFreshness: {
        lastUpdate: freshness.lastUpdate?.toISOString() ?? null,
        ageHours: freshness.ageHours,
        isStale: freshness.isStale,
      },
    };
  },
});

export const infra_health = tool({
  description:
    'CRÍTICO: retorna saúde de todos os pipelines de dados + workers. Sempre cheque no início de uma conversa pra detectar staleness. Se isStale=true, comunique imediatamente ao Luís com os motivos e considere infra_trigger_backfill.',
  inputSchema: z.object({}),
  execute: async () => {
    const h = await getInfraHealth();
    return {
      isStale: h.isStale,
      reasons: h.reasons,
      pipelines: h.pipelines.map((p) => ({
        ...p,
        lastUpdate: p.lastUpdate?.toISOString() ?? null,
      })),
      workers: h.workers.map((w) => ({
        ...w,
        lastRun: w.lastRun?.toISOString() ?? null,
      })),
      capturedAt: h.capturedAt.toISOString(),
    };
  },
});

export const mara_force_sync = tool({
  description:
    'Força a Mara a rodar AGORA (dispara GH Action mara-sync). Use quando infra_health mostrar pipeline snapshot/transactions stale > 24h. Roda em ~3-5min e atualiza Postgres com extract + load do Vendtef. Não cria Decision — é ação direta. Retorna ok=true se o dispatch foi aceito (a execução continua em background; verifique infra_health depois pra confirmar).',
  inputSchema: z.object({
    reason: z
      .string()
      .describe('Por que disparou — vai no log pra audit (ex: "snapshot stale há 72h, ingest parado")'),
  }),
  execute: async ({ reason }) => {
    const r = await dispatchWorkflow('mara-sync', { reason, triggeredBy: 'vendetti-agent' });
    if (!r.ok) {
      return { ok: false, error: r.error };
    }
    return {
      ok: true,
      message: 'Mara sync disparada. Roda em ~3-5min via GH Action. Aguarde e chame infra_health pra verificar atualização.',
      reason,
    };
  },
});

export const infra_trigger_backfill = tool({
  description:
    'Cria uma Decision PENDING pedindo backfill de dados de uma janela específica. Use quando precisar re-importar período passado (raro — para sync imediato use mara_force_sync).',
  inputSchema: z.object({
    worker: z.enum(['mara_sync', 'vendtef_entrada', 'sac_cleanup']).describe('Worker a re-executar'),
    fromDate: z.string().optional().describe('Data início janela (ISO, ex: 2026-05-14T00:00:00Z). Omite pra "desde último OK".'),
    toDate: z.string().optional().describe('Data fim janela (ISO). Omite pra "agora".'),
    reason: z.string().describe('Por que precisa backfill — diagnóstico curto que vai no rationale.'),
  }),
  execute: async ({ worker, fromDate, toDate, reason }) => {
    const dec = await prisma.decision.create({
      data: {
        kind: 'SYSTEM_INVENTORY_SYNC',
        level: 'YELLOW',
        summary: `Backfill ${worker}: ${fromDate ?? 'último OK'} → ${toDate ?? 'agora'}`,
        rationale: reason,
        data: { worker, fromDate, toDate, reason } as unknown as object,
        status: 'PENDING',
      },
    });
    return {
      ok: true,
      decisionId: dec.id,
      message: `Decision ${dec.id.slice(-6)} criada. Luís aprova em /decisions.`,
    };
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

// ============================================================
// Zelda — Auditora (Oversight)
// ============================================================

export const zelda_check_proposal = tool({
  description:
    'Pergunta para a Zelda (Auditora) se uma proposta passa nas policies ANTES de criar Decision. SEMPRE chame antes de vendetti_propose_slot_change ou qualquer write tool. Retorna level (🟢🟡🔴) + reason. Se blocked=true, NÃO prossiga — ajuste a proposta ou descarte.',
  inputSchema: z.object({
    kind: z.enum(['PRICE_CHANGE', 'RESTOCK', 'REFUND', 'SLOT_REORG', 'SKU_CHANGE', 'INVENTORY_SYNC']),
    data: z
      .object({
        currentPrice: z.number().optional().describe('Preço atual do slot (pra PRICE_CHANGE)'),
        newPrice: z.number().optional().describe('Preço novo proposto (pra PRICE_CHANGE)'),
        cost: z.number().optional().describe('Custo do produto (pra calcular margem)'),
        totalBRL: z.number().optional().describe('Valor total da compra (pra RESTOCK)'),
        weeklySpentBRL: z.number().optional().describe('Gasto semanal acumulado (pra RESTOCK)'),
        refundAmount: z.number().optional().describe('Valor do reembolso (pra REFUND)'),
      })
      .default({}),
  }),
  execute: async ({ kind, data }) => {
    let result: { level: 'GREEN' | 'YELLOW' | 'RED'; reason: string; blocked?: boolean };
    if (kind === 'PRICE_CHANGE') {
      if (data.currentPrice === undefined || data.newPrice === undefined || data.cost === undefined) {
        return { from: 'Zelda', error: 'PRICE_CHANGE requer currentPrice + newPrice + cost' };
      }
      result = evalPriceChange({ currentPrice: data.currentPrice, newPrice: data.newPrice, cost: data.cost });
    } else if (kind === 'RESTOCK') {
      if (data.totalBRL === undefined) return { from: 'Zelda', error: 'RESTOCK requer totalBRL' };
      result = evalRestock({ totalBRL: data.totalBRL, weeklySpentBRL: data.weeklySpentBRL ?? 0 });
    } else if (kind === 'REFUND') {
      if (data.refundAmount === undefined) return { from: 'Zelda', error: 'REFUND requer refundAmount' };
      result = evalRefund(data.refundAmount);
    } else if (kind === 'SLOT_REORG') {
      result = evalSlotReorg();
    } else if (kind === 'SKU_CHANGE') {
      result = evalSkuChange();
    } else {
      result = evalInventorySync();
    }
    const msg =
      result.blocked
        ? `🔴 BLOQUEADO. ${result.reason}`
        : result.level === 'GREEN'
          ? `🟢 OK. ${result.reason} Pode propor como auto-aprovada.`
          : result.level === 'YELLOW'
            ? `🟡 Pode prosseguir, mas vai pra fila de aprovação humana. ${result.reason}`
            : `🔴 Conversa obrigatória. ${result.reason}`;
    return { from: 'Zelda · Auditora', ...result, recomendacao: msg };
  },
});

export const zelda_policy_limits = tool({
  description:
    'Mostra os limites duros configurados nas policies (margem mínima, bandas de preço, teto de compra semanal, etc). Use quando o Vendetti ou Luís perguntar "qual o limite pra X?".',
  inputSchema: z.object({}),
  execute: async () => ({
    from: 'Zelda · Auditora',
    margemMinima: `${MIN_MARGIN_PCT}%`,
    priceChangeBandaAutonomaPct: LIMITS.priceChange.autoBandPct,
    restockAutoMaxBRL: LIMITS.restock.autoMaxBRL,
    restockAprovacaoMaxBRL: LIMITS.restock.approvalMaxBRL,
    restockCapSemanalBRL: LIMITS.restock.weeklyCapBRL,
    refundAutoMaxBRL: LIMITS.refund.autoMaxBRL,
    refundAprovacaoMaxBRL: LIMITS.refund.approvalMaxBRL,
  }),
});

export const zelda_audit_recent = tool({
  description:
    'Zelda audita o decision log recente: distribuição por status/level, pendentes antigas, taxa de falhas. Use pra detectar padrões problemáticos.',
  inputSchema: z.object({
    limitHistory: z.number().int().min(10).max(200).default(50),
  }),
  execute: async ({ limitHistory }) => {
    const recent = await prisma.decision.findMany({
      orderBy: { createdAt: 'desc' },
      take: limitHistory,
    });

    const byStatus = new Map<string, number>();
    const byLevel = new Map<string, number>();
    let oldestPendingDays = 0;
    for (const d of recent) {
      byStatus.set(d.status, (byStatus.get(d.status) ?? 0) + 1);
      byLevel.set(d.level, (byLevel.get(d.level) ?? 0) + 1);
      if (d.status === 'PENDING') {
        const days = (Date.now() - d.createdAt.getTime()) / 86_400_000;
        if (days > oldestPendingDays) oldestPendingDays = days;
      }
    }

    const insights: string[] = [];
    if (oldestPendingDays > 3) insights.push(`Decisão pendente há ${oldestPendingDays.toFixed(1)} dias — escalar pro Luís decidir`);
    if ((byStatus.get('FAILED') ?? 0) >= 3) insights.push(`${byStatus.get('FAILED')} FAILED no histórico — investigar scraper`);
    if ((byLevel.get('RED') ?? 0) > 0) insights.push(`${byLevel.get('RED')} decisões em level RED — bloqueios sendo gerados`);
    if (recent.length === 0) insights.push('Sem decisões registradas ainda — Vendetti pouco ativo.');

    return {
      from: 'Zelda · Auditora',
      analisado: recent.length,
      porStatus: Object.fromEntries(byStatus),
      porLevel: Object.fromEntries(byLevel),
      oldestPendingDays: Number(oldestPendingDays.toFixed(1)),
      insights: insights.length > 0 ? insights : ['Nada de anormal no histórico recente.'],
    };
  },
});

// ============================================================
// Bruno — Comprador (Atacadão)
// ============================================================

export const bruno_search_atacadao = tool({
  description:
    'Bruno pesquisa um produto no Atacadão online (atacadao.com.br) e retorna até N resultados com nome, marca, preço, tamanho e link. Use quando precisar comparar custo de fornecedor com preço de venda atual, ou pra cotar antes de propor compra. Fuzzy search — busque por palavra-chave do produto, não código.',
  inputSchema: z.object({
    query: z.string().min(2).describe('Termo de busca, ex: "Red Bull 250ml", "água crystal", "kit kat"'),
    limit: z.number().int().min(1).max(15).default(8),
  }),
  execute: async ({ query, limit }) => {
    try {
      const products = await searchAtacadao(query, limit);
      return {
        from: 'Bruno · Comprador',
        query,
        count: products.length,
        results: products.map((p) => ({
          name: p.name,
          brand: p.brand,
          size: p.size,
          price: p.price,
          link: p.link,
        })),
      };
    } catch (err) {
      return {
        from: 'Bruno · Comprador',
        error: (err as Error).message,
      };
    }
  },
});

export const bruno_compare_with_slot = tool({
  description:
    'Compara o custo no Atacadão com o preço atual de um slot. Útil pra detectar oportunidades: "produto X tá custando R$ Y no Atacadão, mas no slot Z eu compro por mais (custo cadastrado)". Retorna sugestão de ação.',
  inputSchema: z.object({
    selecao: z.string().describe('Número da seleção no Vendtef, ex: "13"'),
    query: z.string().optional().describe('Termo de busca; se vazio, usa o nome do SKU do slot'),
  }),
  execute: async ({ selecao, query }) => {
    const slot = await prisma.slot.findFirst({ where: { position: selecao }, include: { sku: true } });
    if (!slot || !slot.sku) return { from: 'Bruno', error: `slot ${selecao} sem SKU` };
    const term = query ?? slot.sku.name;
    const results = await searchAtacadao(term, 5);
    if (results.length === 0) return { from: 'Bruno', error: 'sem resultados no Atacadão pra esse termo' };

    const currentPrice = Number(slot.price ?? 0);
    const currentMargin = Number(slot.marginEst ?? 0);
    const currentCost = currentPrice - currentMargin;
    const cheapest = results.reduce<{ name: string; price: number } | null>((min, p) => {
      if (p.price === null) return min;
      if (!min || p.price < min.price) return { name: p.name, price: p.price };
      return min;
    }, null);

    return {
      from: 'Bruno · Comprador',
      slot: selecao,
      product: slot.sku.name,
      currentPrice,
      currentCostEstimated: currentCost,
      atacadaoSearch: results.slice(0, 3).map((p) => ({ name: p.name, brand: p.brand, price: p.price, size: p.size })),
      cheapestAtacadao: cheapest,
      hint:
        cheapest && currentCost > cheapest.price
          ? `Atacadão pode ter mais barato — custo cadastrado R$ ${currentCost.toFixed(2)} vs R$ ${cheapest.price.toFixed(2)} no Atacadão (${cheapest.name})`
          : cheapest
            ? `Custo cadastrado (R$ ${currentCost.toFixed(2)}) tá próximo do Atacadão (R$ ${cheapest.price.toFixed(2)})`
            : 'sem comparativo de preço disponível',
    };
  },
});

// ============================================================
// Rita — Operações: comunicação + escrita no DB (espelha o que o Luís fazia manual)
// ============================================================

export const rita_log_restock = tool({
  description:
    'Registra abastecimento físico que o Weverton fez. Cria registro `Reposicao` no DB e ATUALIZA `Slot.currentQty` somando a quantidade. Use quando o Weverton avisar "abasteci X unidades do produto Y no slot Z" — pode receber via WhatsApp ou Luís encaminhar. Substitui o trabalho manual do Luís de "alimentar o sistema".',
  inputSchema: z.object({
    items: z
      .array(
        z.object({
          slotPosition: z.string().describe('Número da seleção, ex: "13"'),
          qty: z.number().int().min(1),
          note: z.string().optional(),
        }),
      )
      .min(1),
    reportedBy: z.string().default('weverton'),
    sourceNote: z.string().optional().describe('Origem (ex: "Whatsapp", "manual", etc)'),
  }),
  execute: async ({ items, reportedBy, sourceNote }) => {
    const machine = await prisma.machine.findFirst({ where: { name: 'Maquina BlueMall Rondon' } });
    if (!machine) return { from: 'Rita', error: 'máquina não encontrada' };

    const created: { slot: string; product: string | null; qty: number; newCurrentQty: number }[] = [];
    const errors: string[] = [];

    const reposicao = await prisma.reposicao.create({
      data: {
        reportedBy,
        source: 'WHATSAPP_AUGUSTO',
        notes: sourceNote ?? null,
      },
    });

    for (const it of items) {
      const slot = await prisma.slot.findFirst({
        where: { machineId: machine.id, position: it.slotPosition },
        include: { sku: true },
      });
      if (!slot) {
        errors.push(`slot ${it.slotPosition} não encontrado`);
        continue;
      }
      if (!slot.skuId) {
        errors.push(`slot ${it.slotPosition} sem SKU vinculado`);
        continue;
      }
      const newQty = Math.min(slot.currentQty + it.qty, slot.capacity);

      await prisma.reposicaoItem.create({
        data: {
          reposicaoId: reposicao.id,
          skuId: slot.skuId,
          slotPosition: it.slotPosition,
          qty: it.qty,
        },
      });
      await prisma.slot.update({
        where: { id: slot.id },
        data: { currentQty: newQty },
      });
      created.push({
        slot: it.slotPosition,
        product: slot.sku?.name ?? null,
        qty: it.qty,
        newCurrentQty: newQty,
      });
    }

    return {
      from: 'Rita · Operações',
      reposicaoId: reposicao.id,
      registered: created,
      errors: errors.length > 0 ? errors : undefined,
      note: 'Slot.currentQty atualizado no DB. Quando Mara fizer sync com Vendtef, vai detectar divergência se Vendtef estiver desatualizado.',
    };
  },
});

export const rita_parse_weverton_message = tool({
  description:
    'Parsea mensagem de reposição do Weverton no formato dele:\n  "Boa tarde DD/MM/AAAA\\nReposição\\n\\n(02) Biz xtra Black\\n6 unidades\\n\\n(35) Água normal\\n5 unidades"\n\nRetorna lista estruturada {slotPosition, productGuess, qty} + match heurístico com SKU do slot. NÃO registra — só extrai pra revisão. Depois use rita_log_restock pra gravar.',
  inputSchema: z.object({
    text: z.string().min(10).describe('Mensagem bruta colada do WhatsApp do Weverton'),
  }),
  execute: async ({ text }) => {
    const lines = text.split('\n').map((l) => l.trim());
    const items: {
      slotPosition: string;
      productGuess: string;
      qty: number;
      slotProduct: string | null;
      matchConfidence: 'high' | 'mid' | 'low' | 'no-slot';
    }[] = [];

    const machine = await prisma.machine.findFirst({ where: { name: 'Maquina BlueMall Rondon' } });
    if (!machine) return { from: 'Rita', error: 'máquina não encontrada' };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      // Match "(02) Nome" / "02) Nome" / "02 - Nome" / "02: Nome"
      const headerMatch = /^\(?(\d{1,3})\)?\s*[-:]?\s*(.+)$/.exec(line);
      if (!headerMatch) continue;
      const slotPosition = headerMatch[1];
      const productGuess = headerMatch[2].trim();
      if (productGuess.length < 3) continue;

      // procura "N unidades" nas próximas linhas (skip vazias)
      let qty = 0;
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const ln = lines[j];
        if (!ln) continue;
        const qtyMatch = /^(\d+)\s*(?:un|unid|unidad)/i.exec(ln);
        if (qtyMatch) {
          qty = parseInt(qtyMatch[1], 10);
          break;
        }
        // se chegou em outra linha que parece header de produto, para
        if (/^\(?\d/.test(ln)) break;
      }
      if (qty === 0) continue;

      // Match com SKU do slot
      const slot = await prisma.slot.findFirst({
        where: { machineId: machine.id, position: slotPosition },
        include: { sku: true },
      });
      const slotProduct = slot?.sku?.name ?? null;
      let matchConfidence: 'high' | 'mid' | 'low' | 'no-slot' = 'no-slot';
      if (slotProduct) {
        const guess = productGuess.toLowerCase();
        const real = slotProduct.toLowerCase();
        const tokens = guess.split(/\s+/).filter((t) => t.length > 3);
        const matched = tokens.filter((t) => real.includes(t));
        if (matched.length === tokens.length && tokens.length > 0) matchConfidence = 'high';
        else if (matched.length > 0) matchConfidence = 'mid';
        else matchConfidence = 'low';
      }

      items.push({ slotPosition, productGuess, qty, slotProduct, matchConfidence });
    }

    const totalUnits = items.reduce((s, i) => s + i.qty, 0);
    const lowConfidence = items.filter((i) => i.matchConfidence === 'low' || i.matchConfidence === 'no-slot');

    return {
      from: 'Rita · Operações',
      parsed: items.length,
      totalUnits,
      items,
      warnings:
        lowConfidence.length > 0
          ? `⚠️ ${lowConfidence.length} slot(s) com baixa confiança no match — confirme antes de registrar.`
          : null,
      next: 'Se tudo bate, chame rita_log_restock com items=[{slotPosition, qty}, ...].',
    };
  },
});

export const rita_register_purchase = tool({
  description:
    'Registra COMPRA de produtos (entrada de estoque central/Everest). Cria/atualiza SKUs no DB. Use quando Bruno fechar uma compra no Atacadão/Vittal, ou quando Luís encaminhar uma NF-e. Cada item tem produto, qty, custo unitário. Atualiza Sku.cost e marginPct.',
  inputSchema: z.object({
    items: z
      .array(
        z.object({
          productName: z.string().min(2),
          productCode: z.string().optional().describe('Código do fornecedor, ex: GTIN. Se vazio, gera um interno.'),
          qty: z.number().int().min(1),
          unitCost: z.number().positive(),
          supplier: z.enum(['ATACADAO', 'VITTAL', 'OUTRO']).default('OUTRO'),
        }),
      )
      .min(1),
    invoiceRef: z.string().optional().describe('Nº NF-e ou identificação da compra'),
    totalAmount: z.number().optional(),
  }),
  execute: async ({ items, invoiceRef, totalAmount }) => {
    const processed: { product: string; action: 'CREATED' | 'UPDATED'; cost: number; qty: number }[] = [];

    for (const it of items) {
      const code = it.productCode || `RITA-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const existing = await prisma.sku.findUnique({ where: { code } });

      if (existing) {
        // Atualiza custo (média ponderada simples por ora)
        const newCost = Number(existing.cost) === 0 ? it.unitCost : (Number(existing.cost) + it.unitCost) / 2;
        await prisma.sku.update({
          where: { code },
          data: { cost: newCost, supplier: it.supplier },
        });
        processed.push({ product: it.productName, action: 'UPDATED', cost: newCost, qty: it.qty });

        // Trigger margin_below_threshold (SPEC #2): se novo custo derruba margem
        // abaixo de 35% em algum slot que vende esse SKU, acorda Bruno.
        try {
          const price = Number(existing.price);
          if (price > 0) {
            const newMarginPct = ((price - newCost) / price) * 100;
            if (newMarginPct < 35) {
              const { fireDomainEvent } = await import('../agents/triggers');
              await fireDomainEvent({
                kind: 'margin_below_threshold',
                skuCode: code,
                marginPct: Number(newMarginPct.toFixed(1)),
              });
            }
          }
        } catch (e) {
          console.warn('[rita_register_purchase] margin trigger falhou:', e instanceof Error ? e.message : e);
        }
      } else {
        await prisma.sku.create({
          data: {
            code,
            name: it.productName,
            category: 'a-classificar',
            supplier: it.supplier,
            cost: it.unitCost,
            price: 0,
          },
        });
        processed.push({ product: it.productName, action: 'CREATED', cost: it.unitCost, qty: it.qty });
      }
    }

    return {
      from: 'Rita · Operações',
      invoiceRef: invoiceRef ?? null,
      totalAmount: totalAmount ?? items.reduce((s, i) => s + i.unitCost * i.qty, 0),
      processed,
      note: 'SKUs atualizados/criados no DB. Pra refletir no Vendtef, usar `/produtos/importarProdutos` (CSV import) — TODO mapear UI.',
    };
  },
});

// ============================================================
// Rita — Operações (comunicação Weverton + listas)
// ============================================================

export const rita_propose_restock = tool({
  description:
    'Rita analisa slots críticos da máquina e gera uma pick list pro Weverton repor. Retorna a lista formatada + total de itens. Use quando snapshot indicar muitos slots críticos. NÃO envia ainda — só prepara; pra enviar use rita_send_grupo_operacao.',
  inputSchema: z.object({}),
  execute: async () => {
    const machine = await prisma.machine.findFirst({ where: { name: 'Maquina BlueMall Rondon' } });
    if (!machine) return { from: 'Rita', error: 'máquina não encontrada' };

    const slots = await prisma.slot.findMany({
      where: { machineId: machine.id },
      include: { sku: true },
      orderBy: { position: 'asc' },
    });

    // Pra cada slot: heurística "precisa repor?" baseada em qtdeCritico
    // (não temos currentQty real ainda — usamos vendas dos últimos 7d como proxy de giro)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const items: { selecao: string; product: string; capacity: number; suggestedQty: number; weekSales: number }[] = [];

    for (const s of slots) {
      if (!s.sku) continue;
      const sales = await prisma.transaction.count({
        where: { skuId: s.sku.id, status: 'OK', occurredAt: { gte: sevenDaysAgo } },
      });
      // Sugestão: completar até capacidade, considerando giro semanal
      // Se vendeu N na semana, precisa repor pelo menos N + margem (assume estoque baixo)
      const suggested = Math.min(s.capacity, Math.max(Math.ceil(sales * 1.5), Math.ceil(s.capacity * 0.6)));
      if (suggested > 0) {
        items.push({
          selecao: s.position,
          product: s.sku.name,
          capacity: s.capacity,
          suggestedQty: suggested,
          weekSales: sales,
        });
      }
    }

    // Ordena por giro decrescente (prioridade)
    items.sort((a, b) => b.weekSales - a.weekSales);
    const top = items.slice(0, 20);

    // Formata mensagem
    const lines = top.map(
      (i) => `· Slot ${i.selecao.padStart(2, ' ')}: ${i.suggestedQty}x ${i.product} (cap ${i.capacity}, vendeu ${i.weekSales} essa semana)`,
    );
    const message = `🤖 Pick list (sugerida pela Rita):\n${lines.join('\n')}\n\nTotal: ${top.length} slots. Weverton, confere a lista e abastece quando der. 🙏`;

    return {
      from: 'Rita · Operações',
      itemsCount: top.length,
      totalUnits: top.reduce((acc, i) => acc + i.suggestedQty, 0),
      items: top,
      messagePreview: message,
      next: 'Pra enviar pro grupo: chame `rita_send_grupo_operacao(message=messagePreview)`. Pra ajustar antes, edite a mensagem.',
    };
  },
});

export const rita_send_grupo_operacao = tool({
  description:
    'Envia mensagem pro grupo "Operação TCN Vending Machine" via Z-API. Use pra lista de reposição, alertas pro Weverton, ou confirmar mudanças que precisam ação física. Luís acompanha o grupo.',
  inputSchema: z.object({
    message: z.string().min(5).describe('Texto da mensagem (com quebras de linha se preciso)'),
  }),
  execute: async ({ message }) => {
    const r = await sendToOperacaoGroup(message);
    if (!r.ok) return { from: 'Rita', error: r.error };
    return {
      from: 'Rita · Operações',
      ok: true,
      messageId: r.messageId,
      preview: message.slice(0, 200),
    };
  },
});

export const rita_send_luis = tool({
  description:
    'Manda mensagem direta pro WhatsApp do Luís (LUIS_PHONE). Use pra alertas urgentes que NÃO devem ir pro grupo, ou pra "ping" se ele tá vendo o dashboard. Mantenha curto.',
  inputSchema: z.object({
    message: z.string().min(5).max(500),
  }),
  execute: async ({ message }) => {
    const luis = await prisma.secret.findUnique({ where: { key: 'LUIS_PHONE' } });
    if (!luis) return { from: 'Rita', error: 'LUIS_PHONE não configurado' };
    // Decifra (não posso usar getSecret aqui pra evitar dependency cycle)
    const { decrypt } = await import('../crypto');
    const phone = decrypt(luis.value);
    const r = await sendText(phone, message);
    if (!r.ok) return { from: 'Rita', error: r.error };
    return { from: 'Rita · Operações', ok: true, messageId: r.messageId };
  },
});

// ============================================================
// Imagens de produto — Atacadão + Claude web search
// ============================================================

export const refresh_product_images = tool({
  description:
    'Roda backfill de imagens APENAS pros SKUs ativos que ainda não têm imageUrl. Usa Atacadão → Claude web search → match parcial Atacadão. Demora ~30s-1min pra ~30 SKUs. Use proativamente quando notar produto sem imagem na vending, ou após Mara importar SKU novo. Read+Write — não cria Decision (operação inócua de UX).',
  inputSchema: z.object({
    max: z.number().int().min(1).max(200).default(100).describe('Máximo de SKUs a processar nessa rodada'),
  }),
  execute: async ({ max }) => {
    const r = await backfillProductImages({ max });
    return {
      ok: r.ok,
      total: r.total,
      matched: r.matched,
      skipped: r.skipped,
      failed: r.failed,
      summary: `${r.matched}/${r.total} SKUs ganharam imagem (${r.failed} falharam, ${r.skipped} skipped)`,
      failedSkus: r.details.filter((d) => !d.matched && !d.skipped).map((d) => d.skuName),
    };
  },
});

export const refetch_product_image = tool({
  description:
    'Re-busca a imagem de UM SKU específico pelo nome — força nova busca mesmo se já tinha imagem. Use quando Luís reportar "imagem errada" (ex: água sem gás pegou imagem da com gás) ou quando você detectar match suspeito. Match fuzzy: aceita nome aproximado (ex: "água crystal sem gás" acha "Água Crystal Sem Gás 500ml"). Read+Write — não cria Decision.',
  inputSchema: z.object({
    skuName: z.string().min(2).describe('Nome do produto a re-buscar (fuzzy match, ex: "red bull 250", "água sem gás")'),
  }),
  execute: async ({ skuName }) => {
    const r = await refetchImageForSkuByName(skuName);
    if (!r.ok) {
      return {
        ok: false,
        error: r.error,
        skuFound: r.skuFound,
        hint: r.skuFound
          ? `SKU encontrado mas Atacadão/Claude não acharam imagem confiável — talvez produto raro. Reporta pro Luís.`
          : `Não achei SKU "${skuName}" no catálogo — verifique o nome ou rode mara_force_sync se for produto novo.`,
      };
    }
    return {
      ok: true,
      sku: r.skuFound,
      newImage: r.matched,
      summary: `✓ ${r.skuFound?.name} → ${r.matched?.source} (${r.matched?.score}% match)`,
    };
  },
});

// ============================================================
// Augusto · canal único humano (WhatsApp + thread)
// ============================================================

export const augusto_notify_luis = tool({
  description:
    'AUGUSTO ONLY: notifica o Luís via WhatsApp (Z-API outbound) + cria msg na thread luis-augusto. Use quando precisar de resposta rápida do Luís OU quando tiver briefing que ele precise ver fora do /chat. Body curto (1-3 frases), telegráfico. Se for pergunta que espera sim/não/aguarde, marca needsReply=true.',
  inputSchema: z.object({
    body: z
      .string()
      .min(5)
      .max(800)
      .describe(
        'Texto da notificação. Curto, direto. Termina com pergunta clara se precisar resposta (ex: "Aprova? sim/não/aguarde").',
      ),
    urgency: z
      .enum(['normal', 'urgent'])
      .default('normal')
      .describe('urgent = adiciona 🚨 no início; normal = adiciona 🎩 (sua assinatura).'),
    needsReply: z.boolean().default(false).describe('true = msg vira kind=QUESTION na UI, esperando resposta.'),
  }),
  execute: async ({ body, urgency, needsReply }) => {
    const luisPhone = await getSecret('LUIS_PHONE');
    if (!luisPhone) {
      return { error: 'LUIS_PHONE não configurado em /settings — não consigo notificar.' };
    }
    const augusto = await prisma.agent.findUnique({ where: { slug: 'augusto' } });
    if (!augusto) {
      return { error: 'agente augusto não está no DB' };
    }

    // Prefix por urgency
    const prefix = urgency === 'urgent' ? '🚨 *URGENTE*' : '🎩 *Augusto*';
    const fullBody = `${prefix}\n\n${body}`;

    // 1) Envia via Z-API
    const { sendText } = await import('../zapi/send');
    const sendResult = await sendText(luisPhone, fullBody);

    // 2) Cria AgentMessage na thread luis-augusto (UI consegue ver)
    const msg = await prisma.agentMessage.create({
      data: {
        fromAgentId: augusto.id,
        toAgentId: null, // pro humano (Luís)
        threadId: 'luis-augusto',
        kind: needsReply ? 'QUESTION' : 'NOTE',
        body,
        refs: {
          channel: 'whatsapp',
          urgency,
          needsReply,
          zapiMessageId: sendResult.ok ? sendResult.messageId : null,
          zapiError: sendResult.ok ? null : sendResult.error,
        },
        status: 'DELIVERED',
      },
    });

    return {
      ok: sendResult.ok,
      from: 'Augusto · canal WhatsApp',
      messageId: msg.id,
      zapiMessageId: sendResult.ok ? sendResult.messageId : null,
      zapiError: sendResult.ok ? null : sendResult.error,
      note: needsReply
        ? 'Notificação WhatsApp enviada. Aguarde resposta do Luís (vai chegar via webhook).'
        : 'Notificação WhatsApp enviada (informativa, sem pedir resposta).',
    };
  },
});

// ============================================================
// Zelda · token watchdog (audita custos dos agentes)
// ============================================================

export const zelda_token_audit = tool({
  description:
    'Auditoria de tokens/custo dos agentes da empresa Vendetti. Retorna: gasto/budget per-agente, velocidade de queima (vai estourar?), cost per outcome (cost / mensagens geradas), top tools usadas. Use semanalmente OU quando um agente tiver gasto > 50% do budget.',
  inputSchema: z.object({
    days: z.number().int().min(1).max(60).default(7).describe('Janela de dias pra calcular cost/run'),
  }),
  execute: async ({ days }) => {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const agents = await prisma.agent.findMany({
      where: { active: true },
      select: {
        slug: true,
        name: true,
        emoji: true,
        model: true,
        budgetUsdMonth: true,
        spentUsdMonth: true,
        humanInLoop: true,
        paused: true,
      },
      orderBy: { slug: 'asc' },
    });

    const out = await Promise.all(
      agents.map(async (a) => {
        const [runs, msgs] = await Promise.all([
          prisma.agentRun.findMany({
            where: { agentId: (await prisma.agent.findUnique({ where: { slug: a.slug } }))!.id, startedAt: { gte: since } },
            select: { costUsd: true, tokensIn: true, tokensOut: true, toolCalls: true, status: true },
          }),
          prisma.agentMessage.count({
            where: { fromAgent: { slug: a.slug }, createdAt: { gte: since } },
          }),
        ]);

        const totalCost = runs.reduce((s, r) => s + Number(r.costUsd), 0);
        const totalTokensIn = runs.reduce((s, r) => s + r.tokensIn, 0);
        const totalTokensOut = runs.reduce((s, r) => s + r.tokensOut, 0);
        const costPerRun = runs.length > 0 ? totalCost / runs.length : 0;
        const costPerOutcome = msgs > 0 ? Number(a.spentUsdMonth) / msgs : null;

        // Velocidade de queima — se manter ritmo, vai estourar?
        const dayOfMonth = new Date().getDate();
        const projected = dayOfMonth > 0 ? (Number(a.spentUsdMonth) / dayOfMonth) * 30 : 0;
        const willOverflow = projected > Number(a.budgetUsdMonth) * 1.05; // >5% acima

        // Top tools (mais usadas)
        const toolUsage = new Map<string, number>();
        for (const r of runs) {
          const tcs = (r.toolCalls as Array<{ name?: string }> | null) ?? [];
          for (const tc of tcs) {
            if (tc.name) toolUsage.set(tc.name, (toolUsage.get(tc.name) ?? 0) + 1);
          }
        }
        const topTools = Array.from(toolUsage.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, count]) => ({ name, count }));

        const failedRuns = runs.filter((r) => r.status === 'FAILED').length;

        return {
          agent: { slug: a.slug, name: a.name, emoji: a.emoji, model: a.model, paused: a.paused },
          budget: Number(a.budgetUsdMonth),
          spentMonth: Number(a.spentUsdMonth),
          projectedMonth: Math.round(projected * 100) / 100,
          willOverflow,
          runsInWindow: runs.length,
          failedRuns,
          msgsInWindow: msgs,
          tokensInWindow: totalTokensIn + totalTokensOut,
          costInWindow: Math.round(totalCost * 10000) / 10000,
          costPerRun: Math.round(costPerRun * 10000) / 10000,
          costPerOutcome: costPerOutcome ? Math.round(costPerOutcome * 10000) / 10000 : null,
          topTools,
        };
      }),
    );

    const totalBudget = out.reduce((s, a) => s + a.budget, 0);
    const totalSpent = out.reduce((s, a) => s + a.spentMonth, 0);
    const overflowing = out.filter((a) => a.willOverflow).map((a) => a.agent.slug);
    const idle = out.filter((a) => a.runsInWindow === 0).map((a) => a.agent.slug);

    return {
      from: 'Zelda · Watchdog',
      windowDays: days,
      totalBudgetMonth: totalBudget,
      totalSpentMonth: totalSpent,
      utilizationPct: Math.round((totalSpent / totalBudget) * 100),
      overflowingAgents: overflowing,
      idleAgents: idle,
      perAgent: out,
    };
  },
});

// ============================================================
// Gabi · co-founder (escopo é o PRODUTO Vendetti, não a vending)
// ============================================================

export const gabi_read_repo_file = tool({
  description:
    'Lê um arquivo do repositório Vendetti (Gabi only — escopo dela é o produto). Path relativo ao root do repo (ex: "src/lib/agents/runtime.ts"). Limita a 50KB pra não estourar context.',
  inputSchema: z.object({
    path: z.string().describe('Path relativo ao root, ex: "src/lib/agents/runtime.ts"'),
  }),
  execute: async ({ path }) => {
    // Segurança: bloqueia paths escapando o repo
    if (path.includes('..') || path.startsWith('/') || path.startsWith('~')) {
      return { error: 'path inválido — use caminho relativo ao root do repo' };
    }
    try {
      const fs = await import('fs/promises');
      const pathLib = await import('path');
      const fullPath = pathLib.resolve(process.cwd(), path);
      // Confirma que tá dentro do cwd
      if (!fullPath.startsWith(process.cwd())) {
        return { error: 'path fora do repo' };
      }
      const stat = await fs.stat(fullPath);
      if (stat.size > 50_000) {
        return { error: `arquivo grande (${stat.size} bytes) — limite 50KB. Use grep ou faça leitura paginada.` };
      }
      const content = await fs.readFile(fullPath, 'utf-8');
      return {
        ok: true,
        path,
        size: stat.size,
        content,
      };
    } catch (e) {
      return { error: `falha ao ler "${path}": ${e instanceof Error ? e.message : String(e)}` };
    }
  },
});

export const gabi_recent_runs = tool({
  description:
    'Gabi only: lista runs recentes dos outros agentes pra detectar padrões (gargalo, bug, ideia repetida). Retorna: agent, trigger, status, cost, tools usadas, output (truncado). Use pra mapear o que o time tá fazendo antes de propor mudança.',
  inputSchema: z.object({
    slug: z.string().optional().describe('Filtra por agente (ex: "augusto"). Vazio = todos.'),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  execute: async ({ slug, limit }) => {
    const where = slug ? { agent: { slug } } : {};
    const runs = await prisma.agentRun.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: { agent: { select: { slug: true, name: true, emoji: true } } },
    });
    return {
      from: 'Gabi · Co-founder',
      count: runs.length,
      runs: runs.map((r) => ({
        runId: r.id.slice(0, 12),
        agent: `${r.agent.emoji} ${r.agent.name}`,
        trigger: r.trigger,
        status: r.status,
        costUsd: Number(r.costUsd),
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        startedAt: r.startedAt.toISOString(),
        durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
        toolsCalled: ((r.toolCalls as Array<{ name?: string }> | null) ?? []).map((tc) => tc.name).filter(Boolean),
        outputPreview: r.outputMd?.slice(0, 200) ?? null,
        nextAgentSlug: r.nextAgentSlug,
        error: r.errorMsg,
      })),
    };
  },
});

export const gabi_create_github_issue = tool({
  description:
    'Gabi only: cria uma issue no repo everestudi/vendetti via GH API. Use pra propor feature/bug com detalhamento técnico. NÃO usa pra coisas triviais — só quando tiver investigado e ter recomendação clara. Issue fica como rascunho pro Luís revisar e priorizar.',
  inputSchema: z.object({
    title: z.string().min(5).max(120),
    body: z
      .string()
      .min(20)
      .describe(
        'Body em markdown. Estrutura sugerida: ## Motivação · ## O que mudaria · ## Esboço de impl · ## Esforço estimado (h) · ## Refs (arquivos/runs)',
      ),
    labels: z.array(z.string()).optional().describe('Labels GitHub (ex: ["enhancement", "from-gabi"])'),
  }),
  execute: async ({ title, body, labels }) => {
    const token = await getSecret('GITHUB_PAT');
    if (!token) {
      return {
        error: 'GITHUB_PAT ausente no DB. Configure em /settings pra Gabi poder abrir issue.',
      };
    }
    const fullLabels = ['from-gabi', ...(labels ?? [])];
    try {
      const r = await fetch('https://api.github.com/repos/everestudi/vendetti/issues', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ title, body, labels: fullLabels }),
      });
      const json = (await r.json()) as { html_url?: string; number?: number; message?: string };
      if (!r.ok) {
        return { error: `GitHub API ${r.status}: ${json.message ?? 'unknown'}` };
      }
      return {
        ok: true,
        from: 'Gabi · Co-founder',
        issueNumber: json.number,
        url: json.html_url,
        note: 'Issue aberta. Luís revisa em /issues do repo. Labels: from-gabi + custom.',
      };
    } catch (e) {
      return { error: `falha ao chamar GH API: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
});

// Helper local pra Gabi/runtime acessar getSecret sem import circular feio
async function getSecret(key: string): Promise<string | null> {
  const { getSecret: gs } = await import('../secrets');
  return gs(key);
}

export const VENDETTI_TOOLS = {
  mara_summary,
  mara_margin_buckets,
  mara_slot_detail,
  mara_cancellations,
  transactions_recent,
  list_recent_decisions,
  zelda_check_proposal,
  zelda_policy_limits,
  zelda_audit_recent,
  bruno_search_atacadao,
  bruno_compare_with_slot,
  rita_parse_weverton_message,
  rita_log_restock,
  rita_register_purchase,
  rita_propose_restock,
  rita_send_grupo_operacao,
  rita_send_luis,
  decision_create,
  vendetti_propose_slot_change,
  infra_health,
  mara_force_sync,
  infra_trigger_backfill,
  refresh_product_images,
  refetch_product_image,
  zelda_token_audit,
  gabi_read_repo_file,
  gabi_recent_runs,
  gabi_create_github_issue,
  augusto_notify_luis,
} as const;
