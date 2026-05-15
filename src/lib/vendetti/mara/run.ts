/**
 * Mara · entry point. Roda extract → load + imprime sumário analítico.
 *
 * Uso: `npm run mara:sync`
 */

import { extractAll } from './extract';
import { loadAll } from './load';
import { getLatestSnapshot, getMarginBuckets } from './analytics';

async function main() {
  console.log('🧮 Mara — sync iniciado');
  const t0 = Date.now();

  console.log('\n[1/3] extract — abrindo browser e visitando Vendtef...');
  const data = await extractAll();
  console.log(`  ✓ ${data.slots.length} slots · ${data.skus.length} SKUs · ${data.transactions.length} transações · ${data.cancellations.length} cancelamentos · snapshot ${data.snapshot.capacityFilledPct}%`);

  console.log('\n[2/3] load — UPSERT no Postgres...');
  const r = await loadAll(data);
  console.log(`  ✓ ${r.skusUpserted} SKUs · ${r.slotsUpserted} slots · ${r.transactionsCreated} trx OK · ${r.cancellationsCreated} trx FAILED · ${r.transactionsAggregatedDays} dias agregados · snapshot ${r.snapshotId.slice(0, 12)}…`);

  console.log('\n[3/3] analytics — sumário do estado atual...');
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

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✓ Mara terminou em ${elapsed}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
