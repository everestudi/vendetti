/**
 * Mara · UPSERT no Postgres a partir do que o extract trouxe.
 */

import { prisma } from '../../db';
import type { ExtractResult } from './extract';

const MACHINE_NAME = 'Maquina BlueMall Rondon';
const MACHINE_MODEL = 'TCN Pro 6G';
const MACHINE_LOCATION = 'Blue Mall Rondon — Av. Nicomedes Alves dos Santos, 830, Uberlândia/MG';

export interface LoadResult {
  machineId: string;
  skusUpserted: number;
  slotsUpserted: number;
  snapshotId: string;
}

export function brlToNumber(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/R\$\s*/i, '').replace(/\./g, '').replace(',', '.').trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export async function loadAll(data: ExtractResult): Promise<LoadResult> {
  // 1. Machine (upsert por nome)
  const machine = await prisma.machine.upsert({
    where: { name: MACHINE_NAME },
    create: { name: MACHINE_NAME, model: MACHINE_MODEL, location: MACHINE_LOCATION },
    update: { model: MACHINE_MODEL, location: MACHINE_LOCATION },
  });

  // 2. SKUs (em paralelo, pequenos batches)
  let skusCount = 0;
  for (const s of data.skus) {
    await prisma.sku.upsert({
      where: { code: s.code },
      create: {
        code: s.code,
        name: s.name,
        category: s.category || 'sem-categoria',
        supplier: 'OUTRO',
        cost: 0,
        price: 0,
        active: s.active,
      },
      update: { name: s.name, category: s.category || 'sem-categoria', active: s.active },
    });
    skusCount++;
  }

  // 3. Slots (precisa lookup SKU por code)
  let slotsCount = 0;
  for (const slot of data.slots) {
    const sku = await prisma.sku.findUnique({ where: { code: slot.produtoCode } });
    const price = brlToNumber(slot.precoBR);
    const margin = brlToNumber(slot.lucroEstimadoBR);

    await prisma.slot.upsert({
      where: { machineId_position: { machineId: machine.id, position: slot.selecao } },
      create: {
        machineId: machine.id,
        position: slot.selecao,
        skuId: sku?.id,
        capacity: slot.capacidade,
        currentQty: 0,
        price,
        marginEst: margin,
        qtdeAlerta: slot.qtdeAlerta,
        qtdeCritico: slot.qtdeCritico,
      },
      update: {
        skuId: sku?.id ?? undefined,
        capacity: slot.capacidade,
        price,
        marginEst: margin,
        qtdeAlerta: slot.qtdeAlerta,
        qtdeCritico: slot.qtdeCritico,
      },
    });
    slotsCount++;
  }

  // 4. InventorySnapshot (sempre novo — é histórico)
  const total = data.snapshot.ok + data.snapshot.alert + data.snapshot.critical;
  const snapshot = await prisma.inventorySnapshot.create({
    data: {
      machineId: machine.id,
      slotsTotal: total,
      slotsOk: data.snapshot.ok,
      slotsAlert: data.snapshot.alert,
      slotsCritical: data.snapshot.critical,
      capacityFilledPct: data.snapshot.capacityFilledPct,
    },
  });

  return { machineId: machine.id, skusUpserted: skusCount, slotsUpserted: slotsCount, snapshotId: snapshot.id };
}
