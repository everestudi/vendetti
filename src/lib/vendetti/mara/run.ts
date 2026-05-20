/**
 * Mara · entry point. Roda extract → load + imprime sumário analítico.
 *
 * Uso: `npm run mara:sync`
 */

import { extractAll } from './extract';
import { loadAll } from './load';
import { getLatestSnapshot, getMarginBuckets } from './analytics';
import { runWithWorkerLog } from '../../infra/health';
import { backfillProductImages } from '../../products/fetch-images';
import { enqueueWakeup } from '../../agents/runtime';
import { prisma } from '../../db';

async function main() {
  console.log('🧮 Mara — sync iniciado');
  const t0 = Date.now();

  const result = await runWithWorkerLog('mara_sync', async () => {
    console.log('\n[1/3] extract — abrindo browser e visitando Vendtef...');
    const data = await extractAll();
    console.log(`  ✓ ${data.slots.length} slots · ${data.skus.length} SKUs · ${data.transactions.length} transações · ${data.cancellations.length} cancelamentos · snapshot ${data.snapshot.capacityFilledPct}%`);

    console.log('\n[2/3] load — UPSERT no Postgres...');
    const r = await loadAll(data);
    console.log(`  ✓ ${r.skusUpserted} SKUs · ${r.slotsUpserted} slots · ${r.transactionsCreated} trx OK · ${r.cancellationsCreated} trx FAILED · ${r.transactionsAggregatedDays} dias agregados · snapshot ${r.snapshotId.slice(0, 12)}…`);
    return {
      slots: data.slots.length,
      skus: data.skus.length,
      transactions: data.transactions.length,
      cancellations: data.cancellations.length,
      capacityPct: data.snapshot.capacityFilledPct,
      loadResult: r,
    };
  });

  console.log('\n[3/3] analytics — sumário do estado atual...');
  void result;
  const snap = await getLatestSnapshot();
  if (snap) {
    console.log(`  estoque: ${snap.slotsOk}🟢 / ${snap.slotsAlert}🟡 / ${snap.slotsCritical}🔴 · capacity ${snap.capacityFilledPct}%`);
  }
  const buckets = await getMarginBuckets();
  console.log(`  margem: ${buckets.high.length} alta (≥50%) · ${buckets.mid.length} média (30-50%) · ${buckets.low.length} baixa (<30%)`);

  if (buckets.low.length > 0) {
    console.log('\n⚠️ slots de baixa margem:');
    for (const s of buckets.low) {
      console.log(`  · sel ${s.selecao.padStart(3, ' ')}  ${s.produto.slice(0, 40).padEnd(40, ' ')} ${s.marginPct.toFixed(1)}%  R$ ${s.price.toFixed(2)}`);
    }
  }

  // [4/4] backfill imagens pros SKUs novos (sem imageUrl). Princípio:
  // "sempre atualizado" — não obriga Luís/Augusto a disparar manualmente.
  // Throttle interno garante que rodada não explode quota se vier SKU novo.
  console.log('\n[4/4] imagens — backfill SKUs sem imagem...');
  try {
    const img = await backfillProductImages({ max: 50 });
    if (img.total === 0) {
      console.log('  ✓ todos os SKUs ativos já têm imagem');
    } else {
      console.log(`  ✓ ${img.matched}/${img.total} novas imagens (${img.failed} falharam)`);
    }
  } catch (e) {
    console.warn('  ⚠️ backfill imagens falhou (não-fatal):', e instanceof Error ? e.message : e);
  }

  // [5/5] dispara wakeup pro agente Mara analisar o diff — se ela existir no DB.
  // Princípio: dado fresh → análise fresh. Augusto consome findings via mailbox.
  // O wakeup vai pra fila e é processado pelo próximo /api/tick (≤15min) OU
  // disparado manual via gh workflow run agents-tick.yml.
  console.log('\n[5/5] agente Mara — disparando wakeup pós-sync...');
  try {
    const mara = await prisma.agent.findUnique({ where: { slug: 'mara' } });
    if (!mara) {
      console.log('  (agente mara não está no DB — rode `npm run seed:agents` se quiser)');
    } else if (mara.paused || !mara.active) {
      console.log(`  (agente mara está ${mara.paused ? 'pausado' : 'inativo'} — pulando)`);
    } else {
      const r = await enqueueWakeup({
        agentSlug: 'mara',
        trigger: 'AUTOMATION',
        triggerRef: `mara_sync@${new Date().toISOString()}`,
        // Idempotency por hora — várias maras_sync no mesmo dia geram só 1 wakeup
        // (Mara analisa "estado atual" não o histórico de cada sync individual)
        idempotencyKey: `mara_sync:${new Date().toISOString().slice(0, 13)}`,
        payload: {
          source: 'mara_sync',
          snapshotCapacityPct: snap?.capacityFilledPct ?? null,
          slotsCritical: snap?.slotsCritical ?? 0,
          lowMarginCount: buckets.low.length,
        },
      });
      console.log(`  ✓ wakeup enfileirado (${r.coalesced ? 'coalesced' : 'novo'}, id=${r.wakeupId.slice(0, 8)})`);
    }
  } catch (e) {
    console.warn('  ⚠️ enqueueWakeup falhou (não-fatal):', e instanceof Error ? e.message : e);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✓ Mara terminou em ${elapsed}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
