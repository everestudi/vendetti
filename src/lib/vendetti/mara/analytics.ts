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
