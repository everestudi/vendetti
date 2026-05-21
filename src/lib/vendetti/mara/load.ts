/**
 * Mara · UPSERT no Postgres a partir do que o extract trouxe.
 */

import type { Prisma } from '@prisma/client';
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
  transactionsCreated: number;
  cancellationsCreated: number;
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

    // Respeita manualOverrideAt — se Luís ajustou skuId manualmente
    // (ex: aprovou Decision inventory com swap), NÃO sobrescreve skuId.
    // Continua sincronizando capacity/price/margin/alertas — só o produto-do-slot
    // fica travado até Luís ajustar no Vendtef e liberar.
    const existing = await prisma.slot.findUnique({
      where: { machineId_position: { machineId: machine.id, position: slot.selecao } },
      select: { manualOverrideAt: true },
    });
    const respectOverride = existing?.manualOverrideAt != null;

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
        // skuId só atualiza se NÃO houver override manual
        ...(respectOverride ? {} : { skuId: sku?.id ?? undefined }),
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

  // 7. Transactions INDIVIDUAIS (OK) — batch insert por vendpagoId.
  // Otimização: pre-carrega SKU map por nome + vendpagoIds existentes, depois
  // monta lote de novos e usa createMany skipDuplicates.
  const allSkus = await prisma.sku.findMany({ select: { id: true, name: true } });
  const skuByName = new Map(allSkus.map((s) => [s.name, s.id]));

  // IDs já existentes pra evitar conflito + acelerar (sem N+1 upsert)
  const existingTrx = new Set(
    (
      await prisma.transaction.findMany({
        select: { vendpagoId: true },
        where: { vendpagoId: { not: null } },
      })
    ).map((t) => t.vendpagoId!),
  );

  const toCreate: Prisma.TransactionCreateManyInput[] = [];
  for (const t of data.transactions) {
    const [d, m, y] = t.dateBR.split('/').map(Number);
    const [hh, mm, ss] = t.timeBR.split(':').map(Number);
    if (!d || !m || !y) continue;
    const occurredAt = new Date(Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0));

    const vendpagoId = t.nsu || `${t.dateBR}-${t.timeBR}-${t.slot}-${t.product}`;
    if (existingTrx.has(vendpagoId)) continue;
    existingTrx.add(vendpagoId); // proteger contra dup dentro do batch

    toCreate.push({
      vendpagoId,
      occurredAt,
      skuId: t.product ? skuByName.get(t.product) ?? null : null,
      slotPosition: t.slot || null,
      qty: 1,
      grossAmount: brlToNumber(t.totalBR),
      paymentType: t.paymentType,
      status: 'OK',
    });
  }

  let trxCreated = 0;
  if (toCreate.length > 0) {
    // createMany em lotes de 500 pra não sobrecarregar conexão
    for (let i = 0; i < toCreate.length; i += 500) {
      const slice = toCreate.slice(i, i + 500);
      const r = await prisma.transaction.createMany({ data: slice, skipDuplicates: true });
      trxCreated += r.count;
    }
  }

  // 8. Cancelamentos como Transactions com status=FAILED + failureReason/Category
  function categorize(desc: string): string {
    const d = desc.toLowerCase();
    if (d.includes('usuário cancelou') || d.includes('usuario cancelou')) return 'USER_CANCEL';
    if (d.includes('não autorizada') || d.includes('nao autorizada')) return 'CARD_DENIED';
    if (d.includes('operacao cancelada') || d.includes('operação cancelada')) return 'OP_CANCELLED';
    if (d.includes('não foi selecionado') || d.includes('nao foi selecionado')) return 'NO_SELECTION';
    if (d.includes('conexão com a máquina') || d.includes('conexao com a maquina')) return 'CONNECTION_LOST';
    return 'OTHER';
  }
  // Cancellations: usa SKU map já carregado e mesma técnica de batch
  const toCreateCancel: Prisma.TransactionCreateManyInput[] = [];
  for (const c of data.cancellations) {
    const [d, m, y] = c.dateBR.split('/').map(Number);
    const [hh, mm, ss] = (c.timeBR || '00:00:00').split(':').map(Number);
    if (!d || !m || !y) continue;
    const occurredAt = new Date(Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0));

    const vendpagoId = c.nsu || `cancel-${c.dateBR}-${c.timeBR}-${c.product}`;
    if (existingTrx.has(vendpagoId)) continue;
    existingTrx.add(vendpagoId);

    toCreateCancel.push({
      vendpagoId,
      occurredAt,
      skuId: c.product && c.product !== 'Indefinido' ? skuByName.get(c.product) ?? null : null,
      slotPosition: c.slot || null,
      qty: 0,
      grossAmount: brlToNumber(c.totalBR),
      paymentType: c.paymentType,
      status: 'FAILED',
      failureReason: c.description,
      failureCategory: categorize(c.description),
    });
  }
  let canceledCreated = 0;
  if (toCreateCancel.length > 0) {
    for (let i = 0; i < toCreateCancel.length; i += 500) {
      const r = await prisma.transaction.createMany({
        data: toCreateCancel.slice(i, i + 500),
        skipDuplicates: true,
      });
      canceledCreated += r.count;
    }
  }

  // Trigger sale_unmatched: detecta vendas recém-criadas SEM skuId (slot
  // teve venda mas a Mara não conseguiu matchar produto → P&L distorcido).
  // Dispara wakeup pra Rita verificar com Weverton OU acionar match_correction.
  // Janela: últimas 24h pra não disparar pelas históricas antigas.
  if (trxCreated > 0) {
    try {
      const { fireDomainEvent } = await import('../../agents/triggers');
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const unmatched = await prisma.transaction.findMany({
        where: {
          status: 'OK',
          skuId: null,
          occurredAt: { gte: since },
        },
        select: { id: true, slotPosition: true },
        take: 50, // sanity cap
      });
      for (const tx of unmatched) {
        await fireDomainEvent({
          kind: 'sale_unmatched',
          transactionId: tx.id,
          slotPosition: tx.slotPosition ?? 'unknown',
        });
      }
      if (unmatched.length > 0) {
        console.log(`[mara/load] ${unmatched.length} sale_unmatched triggers disparados`);
      }
    } catch (e) {
      console.warn('[mara/load] fireDomainEvent sale_unmatched falhou:', e instanceof Error ? e.message : e);
    }
  }

  return {
    machineId: machine.id,
    skusUpserted: skusCount,
    slotsUpserted: slotsCount,
    snapshotId: snapshot.id,
    dailyRevenueUpserted: dailyCount,
    transactionsAggregatedDays: aggregatedDays,
    transactionsCreated: trxCreated,
    cancellationsCreated: canceledCreated,
  };
}
