/**
 * Centraliza triggers automáticos pós-evento → wakeup pro agente certo.
 *
 * Implementado a partir da SPEC #2 da Gabi (mailbox: cmpdx81gq000).
 *
 * Padrão de uso:
 *   import { fireDomainEvent } from '@/lib/agents/triggers';
 *   await fireDomainEvent({ kind: 'mara_sync_done', runId: 'xyz' });
 *
 * Em vez de espalhar enqueueWakeup pelo codebase, todo evento de domínio
 * passa por aqui — fica fácil ver "o que acorda quem" e adicionar dedupe
 * + handoffDepth control sem caçar tools.ts/run.ts/etc.
 *
 * Edge cases (da SPEC):
 * - Loop Zelda audita decision que cria decision → ignore se origin=zelda
 * - Storm de wakeups (21 slots críticos) → dedupe por (target, kind, payload-hash) janela 5min
 * - Handoff infinito Augusto↔Mara → handoffDepth no payload (max 3)
 */

import { enqueueWakeup } from './runtime';
import { prisma } from '../db';

/** Eventos de domínio que disparam wakeups. */
export type DomainEvent =
  | { kind: 'mara_sync_done'; runId: string; capacityPct?: number; criticalCount?: number }
  | { kind: 'decision_created'; decisionId: string; createdByAgentSlug: string; decisionKind: string; level: string }
  | { kind: 'stock_critical'; slotPosition: string; skuCode?: string | null; skuName?: string | null }
  | { kind: 'sale_unmatched'; transactionId: string; slotPosition: string }
  | { kind: 'restock_approved'; decisionId: string; slots: string[] }
  | { kind: 'restock_executed'; reposicaoId: string; totalUnits: number }
  | { kind: 'infra_stale'; workerName: string; ageHours: number }
  | { kind: 'margin_below_threshold'; skuCode: string; marginPct: number };

/** Roteamento — qual agente acorda pra cada evento. */
const TRIGGER_ROUTES: Record<DomainEvent['kind'], { agentSlug: string; reason: (e: DomainEvent) => string }> = {
  mara_sync_done: {
    agentSlug: 'mara',
    reason: (e) => `sync ${(e as Extract<DomainEvent, { kind: 'mara_sync_done' }>).runId} terminou — gerar análise diff`,
  },
  decision_created: {
    agentSlug: 'zelda',
    reason: (e) => {
      const ev = e as Extract<DomainEvent, { kind: 'decision_created' }>;
      return `auditar decision ${ev.decisionId} (${ev.decisionKind} ${ev.level}) criada por ${ev.createdByAgentSlug}`;
    },
  },
  stock_critical: {
    agentSlug: 'bruno',
    reason: (e) => {
      const ev = e as Extract<DomainEvent, { kind: 'stock_critical' }>;
      return `slot ${ev.slotPosition} (${ev.skuName ?? '?'}) crítico — cotar reposição`;
    },
  },
  sale_unmatched: {
    agentSlug: 'rita',
    reason: (e) => {
      const ev = e as Extract<DomainEvent, { kind: 'sale_unmatched' }>;
      return `venda ${ev.transactionId} sem match no slot ${ev.slotPosition}`;
    },
  },
  restock_approved: {
    agentSlug: 'rita',
    reason: (e) => {
      const ev = e as Extract<DomainEvent, { kind: 'restock_approved' }>;
      return `agendar Weverton pros slots ${ev.slots.join(',')}`;
    },
  },
  restock_executed: {
    agentSlug: 'lucia',
    reason: (e) => {
      const ev = e as Extract<DomainEvent, { kind: 'restock_executed' }>;
      return `restock ${ev.reposicaoId} (${ev.totalUnits} un) executado — atualizar P&L`;
    },
  },
  infra_stale: {
    agentSlug: 'zelda',
    reason: (e) => {
      const ev = e as Extract<DomainEvent, { kind: 'infra_stale' }>;
      return `worker ${ev.workerName} stale ${ev.ageHours}h — investigar`;
    },
  },
  margin_below_threshold: {
    agentSlug: 'bruno',
    reason: (e) => {
      const ev = e as Extract<DomainEvent, { kind: 'margin_below_threshold' }>;
      return `SKU ${ev.skuCode} margem ${ev.marginPct}% < 35% — buscar alternativa`;
    },
  },
};

/** Loop protection: evita recursão Zelda audita decision que ela mesma criou. */
function isRecursive(event: DomainEvent): boolean {
  if (event.kind === 'decision_created' && event.createdByAgentSlug === 'zelda') {
    return true;
  }
  return false;
}

/**
 * Dispara wakeup pro agente apropriado.
 * - Skipa se agent não existe / pausado / inativo
 * - Skipa eventos recursivos (Zelda → Zelda)
 * - Idempotência via key estável por evento (mesmo evento 2x = 1 wakeup só)
 */
export async function fireDomainEvent(event: DomainEvent): Promise<{ fired: boolean; reason?: string }> {
  if (isRecursive(event)) {
    return { fired: false, reason: 'recursive event (loop prevention)' };
  }

  const route = TRIGGER_ROUTES[event.kind];
  if (!route) {
    return { fired: false, reason: `no route for ${event.kind}` };
  }

  // Idempotency key: hash compacto do evento — mesma payload 2x não dispara 2x
  const idempotencyKey = buildIdempotencyKey(event);

  try {
    const result = await enqueueWakeup({
      agentSlug: route.agentSlug,
      trigger: 'AUTOMATION',
      triggerRef: extractRef(event),
      idempotencyKey,
      payload: {
        domainEvent: event,
        reason: route.reason(event),
      },
    });
    return { fired: true, reason: result.coalesced ? 'coalesced (já enfileirado)' : 'new wakeup' };
  } catch (e) {
    // Tolerante: agente pode estar inativo/pausado
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[triggers] fireDomainEvent ${event.kind}: ${msg}`);
    return { fired: false, reason: msg };
  }
}

function buildIdempotencyKey(event: DomainEvent): string {
  switch (event.kind) {
    case 'mara_sync_done':
      // 1 wakeup por hora (mesmo sync_done várias vezes na mesma hora = 1)
      return `mara_sync_done:${new Date().toISOString().slice(0, 13)}`;
    case 'decision_created':
      return `decision_created:${event.decisionId}`;
    case 'stock_critical':
      // 1 wakeup por slot por dia (não estoura 21 wakeups se 21 slots crítico no mesmo dia)
      return `stock_critical:${event.slotPosition}:${new Date().toISOString().slice(0, 10)}`;
    case 'sale_unmatched':
      return `sale_unmatched:${event.transactionId}`;
    case 'restock_approved':
      return `restock_approved:${event.decisionId}`;
    case 'restock_executed':
      return `restock_executed:${event.reposicaoId}`;
    case 'infra_stale':
      return `infra_stale:${event.workerName}:${new Date().toISOString().slice(0, 10)}`;
    case 'margin_below_threshold':
      return `margin:${event.skuCode}:${new Date().toISOString().slice(0, 10)}`;
  }
}

function extractRef(event: DomainEvent): string {
  switch (event.kind) {
    case 'mara_sync_done': return `sync:${event.runId}`;
    case 'decision_created': return `decision:${event.decisionId}`;
    case 'stock_critical': return `slot:${event.slotPosition}`;
    case 'sale_unmatched': return `tx:${event.transactionId}`;
    case 'restock_approved': return `decision:${event.decisionId}`;
    case 'restock_executed': return `restock:${event.reposicaoId}`;
    case 'infra_stale': return `worker:${event.workerName}`;
    case 'margin_below_threshold': return `sku:${event.skuCode}`;
  }
}

/**
 * Helper pra detectar e disparar stock_critical em batch após mara_sync.
 * Lê snapshot mais recente, identifica slots críticos NOVOS (não disparados
 * hoje), dispara fireDomainEvent pra cada.
 */
export async function fireStockCriticalEvents(): Promise<{ fired: number; skipped: number }> {
  const slots = await prisma.slot.findMany({
    include: { sku: true },
    where: {
      // currentQty < qtdeCritico (slot tá crítico fisicamente)
      // Sem filtro temporal — idempotency cuida do dedup diário
    },
  });

  const criticos = slots.filter((s) => {
    const qty = s.currentQty ?? 0;
    const limit = s.qtdeCritico ?? 1;
    return qty <= limit;
  });

  let fired = 0;
  let skipped = 0;
  for (const slot of criticos) {
    const r = await fireDomainEvent({
      kind: 'stock_critical',
      slotPosition: slot.position,
      skuCode: slot.sku?.code,
      skuName: slot.sku?.name,
    });
    if (r.fired && r.reason === 'new wakeup') fired++;
    else skipped++;
  }

  return { fired, skipped };
}
