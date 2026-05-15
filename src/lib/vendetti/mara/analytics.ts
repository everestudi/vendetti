/**
 * Mara · métricas derivadas (consultas no DB local — milisegundos).
 */

import { prisma } from '../../db';

const MACHINE_NAME = 'Maquina BlueMall Rondon';

export interface SlotAnalytics {
  selecao: string;
  produto: string;
  price: number;
  marginEst: number;
  marginPct: number;
  capacity: number;
}

export interface MarginBuckets {
  high: SlotAnalytics[]; // ≥ 50%
  mid: SlotAnalytics[]; // 30-50%
  low: SlotAnalytics[]; // < 30%
}

async function getMachineId() {
  const m = await prisma.machine.findUnique({ where: { name: MACHINE_NAME } });
  return m?.id ?? null;
}

export async function getLatestSnapshot() {
  const id = await getMachineId();
  if (!id) return null;
  return prisma.inventorySnapshot.findFirst({
    where: { machineId: id },
    orderBy: { capturedAt: 'desc' },
  });
}

export async function getMarginBuckets(): Promise<MarginBuckets> {
  const id = await getMachineId();
  if (!id) return { high: [], mid: [], low: [] };

  const slots = await prisma.slot.findMany({
    where: { machineId: id, price: { not: null } },
    include: { sku: true },
  });

  const buckets: MarginBuckets = { high: [], mid: [], low: [] };
  for (const s of slots) {
    const price = Number(s.price ?? 0);
    const margin = Number(s.marginEst ?? 0);
    if (price === 0) continue;
    const marginPct = (margin / price) * 100;
    const entry: SlotAnalytics = {
      selecao: s.position,
      produto: s.sku?.name ?? '(sem SKU)',
      price,
      marginEst: margin,
      marginPct,
      capacity: s.capacity,
    };
    if (marginPct >= 50) buckets.high.push(entry);
    else if (marginPct >= 30) buckets.mid.push(entry);
    else buckets.low.push(entry);
  }
  for (const k of ['high', 'mid', 'low'] as const) {
    buckets[k].sort((a, b) => b.marginPct - a.marginPct);
  }
  return buckets;
}

export async function getLowMarginSlots(thresholdPct = 30): Promise<SlotAnalytics[]> {
  const buckets = await getMarginBuckets();
  return buckets.low.filter((s) => s.marginPct < thresholdPct);
}

export async function getSlotCount(): Promise<number> {
  const id = await getMachineId();
  if (!id) return 0;
  return prisma.slot.count({ where: { machineId: id } });
}

export async function getSkuCount(): Promise<number> {
  return prisma.sku.count();
}

export interface CancellationStats {
  total: number;
  byCategory: { category: string; count: number }[];
  topProducts: { product: string; count: number }[];
  last7DaysCount: number;
}

export async function getCancellationStats(daysWindow = 30): Promise<CancellationStats> {
  const since = new Date();
  since.setDate(since.getDate() - daysWindow);

  const all = await prisma.transaction.findMany({
    where: { status: 'FAILED', occurredAt: { gte: since } },
    include: { sku: true },
  });

  const byCat = new Map<string, number>();
  const byProd = new Map<string, number>();
  let last7 = 0;
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  for (const t of all) {
    const cat = t.failureCategory ?? 'OTHER';
    byCat.set(cat, (byCat.get(cat) ?? 0) + 1);
    const prod = t.sku?.name ?? '(indefinido)';
    byProd.set(prod, (byProd.get(prod) ?? 0) + 1);
    if (t.occurredAt >= sevenDaysAgo) last7++;
  }

  return {
    total: all.length,
    byCategory: Array.from(byCat.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    topProducts: Array.from(byProd.entries())
      .map(([product, count]) => ({ product, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    last7DaysCount: last7,
  };
}

export interface DailyPoint {
  day: number;
  thisMonth: number | null;
  lastMonth: number | null;
}

/**
 * Pega faturamento por dia do mês atual e do mês anterior, com dias do mês como eixo X.
 * Retorna array com 31 pontos (dia 1 a 31) — null nos dias sem dado.
 */
export async function getMonthlyRevenueComparison(now: Date = new Date()): Promise<{
  points: DailyPoint[];
  totals: { thisMonth: number; lastMonth: number; thisMonthDays: number; lastMonthDays: number };
  monthLabels: { thisMonth: string; lastMonth: string };
}> {
  const id = await getMachineId();
  if (!id) {
    return {
      points: [],
      totals: { thisMonth: 0, lastMonth: 0, thisMonthDays: 0, lastMonthDays: 0 },
      monthLabels: { thisMonth: '', lastMonth: '' },
    };
  }

  const thisMonth = { y: now.getFullYear(), m: now.getMonth() }; // 0-indexed
  const lastMonthDate = new Date(thisMonth.y, thisMonth.m - 1, 1);
  const lastMonth = { y: lastMonthDate.getFullYear(), m: lastMonthDate.getMonth() };

  const startThis = new Date(Date.UTC(thisMonth.y, thisMonth.m, 1));
  const endThis = new Date(Date.UTC(thisMonth.y, thisMonth.m + 1, 0));
  const startLast = new Date(Date.UTC(lastMonth.y, lastMonth.m, 1));
  const endLast = new Date(Date.UTC(lastMonth.y, lastMonth.m + 1, 0));

  const [thisRows, lastRows] = await Promise.all([
    prisma.dailyRevenue.findMany({
      where: { machineId: id, date: { gte: startThis, lte: endThis } },
      orderBy: { date: 'asc' },
    }),
    prisma.dailyRevenue.findMany({
      where: { machineId: id, date: { gte: startLast, lte: endLast } },
      orderBy: { date: 'asc' },
    }),
  ]);

  const thisMap = new Map(thisRows.map((r) => [r.date.getUTCDate(), Number(r.totalRevenue)]));
  const lastMap = new Map(lastRows.map((r) => [r.date.getUTCDate(), Number(r.totalRevenue)]));

  const points: DailyPoint[] = [];
  for (let d = 1; d <= 31; d++) {
    points.push({
      day: d,
      thisMonth: thisMap.get(d) ?? null,
      lastMonth: lastMap.get(d) ?? null,
    });
  }

  const monthLabels = {
    thisMonth: new Date(thisMonth.y, thisMonth.m, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' }),
    lastMonth: new Date(lastMonth.y, lastMonth.m, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' }),
  };

  return {
    points,
    totals: {
      thisMonth: thisRows.reduce((acc, r) => acc + Number(r.totalRevenue), 0),
      lastMonth: lastRows.reduce((acc, r) => acc + Number(r.totalRevenue), 0),
      thisMonthDays: thisRows.length,
      lastMonthDays: lastRows.length,
    },
    monthLabels,
  };
}
