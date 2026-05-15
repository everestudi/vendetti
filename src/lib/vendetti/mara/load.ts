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
  dailyRevenueUpserted: number;
  transactionsAggregatedDays: number;
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

  // 5. DailyRevenue (UPSERT por data — re-sync atualiza valores)
  let dailyCount = 0;
  for (const r of data.dailyRevenue) {
    const [d, m, y] = r.dateBR.split('/').map(Number);
    if (!d || !m || !y) continue;
    const date = new Date(Date.UTC(y, m - 1, d));
    await prisma.dailyRevenue.upsert({
      where: { machineId_date: { machineId: machine.id, date } },
      create: {
        machineId: machine.id,
        date,
        qtdTotal: r.qtdTotal,
        qtdTef: r.qtdTef,
        qtdPix: r.qtdPix,
        qtdCash: r.qtdCash,
        qtdPrivate: r.qtdPrivate,
        totalTef: brlToNumber(r.totalTefBR),
        totalPix: brlToNumber(r.totalPixBR),
        totalCash: brlToNumber(r.totalCashBR),
        totalPrivate: brlToNumber(r.totalPrivateBR),
        totalRevenue: brlToNumber(r.totalBR),
        totalCost: brlToNumber(r.costBR),
      },
      update: {
        qtdTotal: r.qtdTotal,
        qtdTef: r.qtdTef,
        qtdPix: r.qtdPix,
        qtdCash: r.qtdCash,
        qtdPrivate: r.qtdPrivate,
        totalTef: brlToNumber(r.totalTefBR),
        totalPix: brlToNumber(r.totalPixBR),
        totalCash: brlToNumber(r.totalCashBR),
        totalPrivate: brlToNumber(r.totalPrivateBR),
        totalRevenue: brlToNumber(r.totalBR),
        totalCost: brlToNumber(r.costBR),
      },
    });
    dailyCount++;
  }

  // 6. Transactions agregadas por dia — substitui o ETL antigo (que pegava só mês corrente)
  //    Agrega por (date, paymentType) e UPSERT em DailyRevenue.
  interface Agg {
    qtdTotal: number;
    qtdTef: number;
    qtdPix: number;
    qtdCash: number;
    qtdPrivate: number;
    totalTef: number;
    totalPix: number;
    totalCash: number;
    totalPrivate: number;
    totalRevenue: number;
  }
  const map = new Map<string, { date: Date; agg: Agg }>();
  for (const t of data.transactions) {
    const [d, m, y] = t.dateBR.split('/').map(Number);
    if (!d || !m || !y) continue;
    const key = `${y}-${m}-${d}`;
    if (!map.has(key)) {
      map.set(key, {
        date: new Date(Date.UTC(y, m - 1, d)),
        agg: { qtdTotal: 0, qtdTef: 0, qtdPix: 0, qtdCash: 0, qtdPrivate: 0, totalTef: 0, totalPix: 0, totalCash: 0, totalPrivate: 0, totalRevenue: 0 },
      });
    }
    const a = map.get(key)!.agg;
    const value = brlToNumber(t.totalBR);
    a.qtdTotal += 1;
    a.totalRevenue += value;
    const pay = (t.paymentType ?? '').toUpperCase();
    if (pay.includes('PIX')) {
      a.qtdPix += 1;
      a.totalPix += value;
    } else if (pay.includes('PRIVATE')) {
      a.qtdPrivate += 1;
      a.totalPrivate += value;
    } else if (pay === 'CASH' || pay.includes('DINHEIRO')) {
      a.qtdCash += 1;
      a.totalCash += value;
    } else {
      // TEF, CRÉDITO, DÉBITO etc — tudo cartão
      a.qtdTef += 1;
      a.totalTef += value;
    }
  }

  let aggregatedDays = 0;
  for (const [, { date, agg }] of map) {
    await prisma.dailyRevenue.upsert({
      where: { machineId_date: { machineId: machine.id, date } },
      create: {
        machineId: machine.id,
        date,
        qtdTotal: agg.qtdTotal,
        qtdTef: agg.qtdTef,
        qtdPix: agg.qtdPix,
        qtdCash: agg.qtdCash,
        qtdPrivate: agg.qtdPrivate,
        totalTef: agg.totalTef,
        totalPix: agg.totalPix,
        totalCash: agg.totalCash,
        totalPrivate: agg.totalPrivate,
        totalRevenue: agg.totalRevenue,
        totalCost: 0,
      },
      update: {
        qtdTotal: agg.qtdTotal,
        qtdTef: agg.qtdTef,
        qtdPix: agg.qtdPix,
        qtdCash: agg.qtdCash,
        qtdPrivate: agg.qtdPrivate,
        totalTef: agg.totalTef,
        totalPix: agg.totalPix,
        totalCash: agg.totalCash,
        totalPrivate: agg.totalPrivate,
        totalRevenue: agg.totalRevenue,
      },
    });
    aggregatedDays++;
  }

  return {
    machineId: machine.id,
    skusUpserted: skusCount,
    slotsUpserted: slotsCount,
    snapshotId: snapshot.id,
    dailyRevenueUpserted: dailyCount,
    transactionsAggregatedDays: aggregatedDays,
  };
}
