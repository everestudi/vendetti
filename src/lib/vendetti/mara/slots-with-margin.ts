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
  return rows.map((r) => {
    const price = r.price ? Number(r.price) : null;
    const marginEst = r.marginEst ? Number(r.marginEst) : null;
    const marginPct = price && marginEst ? Number(((marginEst / price) * 100).toFixed(1)) : null;
    const everest = r.sku?.everestStock;
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
    };
  });
}
