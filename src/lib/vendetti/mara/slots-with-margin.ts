/**
 * Helper · busca todos os slots da máquina BlueMall com SKU + margem calculada.
 * Reutilizado pela home (cartoon) e pelo /dashboard.
 */

import { prisma } from '../../db';
import type { SlotData } from '@/components/VendingMachineLive';

const MACHINE_NAME = 'Maquina BlueMall Rondon';

export async function getSlotsWithMargin(): Promise<SlotData[]> {
  const machine = await prisma.machine.findUnique({ where: { name: MACHINE_NAME } });
  if (!machine) return [];
  const rows = await prisma.slot.findMany({
    where: { machineId: machine.id },
    include: { sku: { include: { everestStock: true } } },
  });

  // Vendas dos slots no mês atual (qty + revenue) — pra mini chart no painel
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const skuIds = rows.map((r) => r.skuId).filter((id): id is string => id !== null);
  const salesAgg = skuIds.length > 0
    ? await prisma.transaction.groupBy({
        by: ['skuId'],
        where: { skuId: { in: skuIds }, status: 'OK', occurredAt: { gte: startMonth } },
        _sum: { grossAmount: true, qty: true },
        _count: true,
      }).catch(() => [] as Array<{ skuId: string | null; _sum: { grossAmount: unknown; qty: number | null }; _count: number }>)
    : [];
  const salesMap = new Map<string, { qty: number; revenue: number; count: number }>();
  for (const s of salesAgg) {
    if (!s.skuId) continue;
    salesMap.set(s.skuId, {
      qty: s._sum.qty ?? 0,
      revenue: Number(s._sum.grossAmount ?? 0),
      count: s._count,
    });
  }

  return rows.map((r) => {
    const price = r.price ? Number(r.price) : null;
    const marginEst = r.marginEst ? Number(r.marginEst) : null;
    const marginPct = price && marginEst ? Number(((marginEst / price) * 100).toFixed(1)) : null;
    const everest = r.sku?.everestStock;
    const sales = r.skuId ? salesMap.get(r.skuId) : null;
    return {
      selecao: r.position,
      productName: r.sku?.name ?? null,
      productCode: r.sku?.code ?? null,
      price,
      marginEst,
      marginPct,
      capacity: r.capacity,
      currentQty: r.currentQty,
      qtdeAlerta: r.qtdeAlerta,
      qtdeCritico: r.qtdeCritico,
      everestQty: everest?.qty ?? null,
      everestStatus: everest?.status ?? null,
      everestUpdatedAt: everest?.updatedAt ?? null,
      salesMonthQty: sales?.qty ?? 0,
      salesMonthRevenue: sales?.revenue ?? 0,
      salesMonthCount: sales?.count ?? 0,
    };
  });
}
