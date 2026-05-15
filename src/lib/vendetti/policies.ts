/**
 * Matriz de autonomia do Vendetti (DEC-002).
 *
 * Camada de oversight: toda ação proposta passa por `evaluatePolicy()` antes de executar.
 * Retorna o nível 🟢🟡🔴 e a razão. O agent loop respeita isso obrigatoriamente.
 */

import { z } from 'zod';

export const AutonomyLevel = z.enum(['GREEN', 'YELLOW', 'RED']);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

export const MIN_MARGIN_PCT = 35; // regra dura — Project Vend learning

// Limites editáveis pelo dashboard (mais tarde lemos do DB).
export const LIMITS = {
  // Mudança de preço
  priceChange: {
    autoBandPct: 15, // ±15% do preço atual = autônomo
    minMargin: MIN_MARGIN_PCT,
  },
  // Compra de reposição (Atacadão)
  restock: {
    autoMaxBRL: 500, // 🟢 até R$ 500 / semana
    approvalMaxBRL: 2000, // 🟡 até R$ 2000
    // acima de 2000 → 🔴
    weeklyCapBRL: 3000, // hard cap por semana, mesmo aprovado
  },
  // Reembolso
  refund: {
    autoMaxBRL: 30,
    approvalMaxBRL: 100,
  },
  // Slot reorg — sempre 🟢 (reversível)
  slotReorg: { level: 'GREEN' as AutonomyLevel },
  // Add/remove SKU
  sku: { level: 'YELLOW' as AutonomyLevel },
};

// ---------------------------------------------------------------
// Avaliação por tipo de ação
// ---------------------------------------------------------------

interface PolicyResult {
  level: AutonomyLevel;
  reason: string;
  blocked?: boolean; // se true, nem com aprovação humana pode rodar
}

export function evalPriceChange(input: {
  currentPrice: number;
  newPrice: number;
  cost: number;
}): PolicyResult {
  const { currentPrice, newPrice, cost } = input;
  const marginPct = ((newPrice - cost) / newPrice) * 100;

  if (marginPct < MIN_MARGIN_PCT) {
    return {
      level: 'RED',
      reason: `Margem ${marginPct.toFixed(1)}% < mínima ${MIN_MARGIN_PCT}%. Bloqueado.`,
      blocked: true,
    };
  }

  const deltaPct = Math.abs((newPrice - currentPrice) / currentPrice) * 100;
  if (deltaPct <= LIMITS.priceChange.autoBandPct) {
    return { level: 'GREEN', reason: `Δ${deltaPct.toFixed(1)}% dentro da banda autônoma ±${LIMITS.priceChange.autoBandPct}%.` };
  }
  return { level: 'YELLOW', reason: `Δ${deltaPct.toFixed(1)}% fora da banda — pedindo aprovação.` };
}

export function evalRestock(input: { totalBRL: number; weeklySpentBRL: number }): PolicyResult {
  const { totalBRL, weeklySpentBRL } = input;
  if (weeklySpentBRL + totalBRL > LIMITS.restock.weeklyCapBRL) {
    return {
      level: 'RED',
      reason: `Cap semanal R$${LIMITS.restock.weeklyCapBRL} estouraria.`,
      blocked: true,
    };
  }
  if (totalBRL <= LIMITS.restock.autoMaxBRL) {
    return { level: 'GREEN', reason: `Pedido R$${totalBRL.toFixed(2)} ≤ R$${LIMITS.restock.autoMaxBRL}.` };
  }
  if (totalBRL <= LIMITS.restock.approvalMaxBRL) {
    return { level: 'YELLOW', reason: `R$${totalBRL.toFixed(2)} — aprovação 1-clique.` };
  }
  return { level: 'RED', reason: `R$${totalBRL.toFixed(2)} — conversa obrigatória.` };
}

export function evalRefund(amountBRL: number): PolicyResult {
  if (amountBRL <= LIMITS.refund.autoMaxBRL) return { level: 'GREEN', reason: `R$${amountBRL} ≤ ${LIMITS.refund.autoMaxBRL}` };
  if (amountBRL <= LIMITS.refund.approvalMaxBRL) return { level: 'YELLOW', reason: 'Aprovação 1-clique' };
  return { level: 'RED', reason: 'Conversa obrigatória' };
}

export function evalSlotReorg(): PolicyResult {
  return { level: 'GREEN', reason: 'Reorganização de slot é reversível.' };
}

export function evalSkuChange(): PolicyResult {
  return { level: 'YELLOW', reason: 'Add/remove SKU é estrutural — aprovação 1-clique.' };
}

export function evalInventorySync(): PolicyResult {
  // Vendetti alimentando Vendtef após Weverton repor — 🟢
  return { level: 'GREEN', reason: 'Sincronização passiva (espelha mundo real).' };
}
