import Link from 'next/link';
import { getLatestSnapshot, getMarginBuckets, getSlotCount, getSkuCount, type SlotAnalytics } from '@/lib/vendetti/mara/analytics';
import { getSlotsWithMargin } from '@/lib/vendetti/mara/slots-with-margin';
import { getProductMeta } from '@/lib/products/icons';
import { TEAM, avatarUrl } from '@/lib/agents/team';

export const dynamic = 'force-dynamic';

const mara = TEAM.find((a) => a.id === 'mara')!;

export default async function MaraDashboard({ searchParams }: { searchParams: Promise<{ slot?: string }> }) {
  const { slot: focusSlot } = await searchParams;
  const [snap, buckets, slotCount, skuCount, slots] = await Promise.all([
    getLatestSnapshot(),
    getMarginBuckets(),
    getSlotCount(),
    getSkuCount(),
    getSlotsWithMargin(),
  ]);

  const focus = focusSlot ? slots.find((s) => s.selecao === focusSlot) : null;
  const lastSync = snap?.capturedAt ? new Date(snap.capturedAt).toLocaleString('pt-BR') : '—';
  const capacity = snap?.capacityFilledPct ? Number(snap.capacityFilledPct) : 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      {/* Header com a persona Mara */}
      <header className="mb-8 flex items-start gap-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl(mara, 128)}
          alt="Mara"
          width={96}
          height={96}
          className="rounded-full ring-4 ring-gold/40"
        />
        <div className="flex-1">
          <div className="text-xs font-semibold uppercase tracking-widest text-gold-900">{mara.origin}</div>
          <h1 className="text-3xl font-bold text-navy">Dashboard da Mara</h1>
          <p className="mt-1 italic text-navy/65">"{mara.tagline}"</p>
          <p className="mt-2 text-xs text-navy/45">
            Último sync: <strong>{lastSync}</strong> · <code className="rounded bg-navy-50 px-1.5 py-0.5">npm run mara:sync</code> pra atualizar.
          </p>
        </div>
      </header>

      {/* DRILL-DOWN se ?slot=X */}
      {focus && <FocusSlot slot={focus} />}

      {/* KPIs */}
      <section className="grid gap-3 sm:grid-cols-4">
        <Kpi label="SKUs no catálogo" value={skuCount.toString()} />
        <Kpi label="Slots na máquina" value={slotCount.toString()} />
        <Kpi label="Capacidade" value={`${capacity.toFixed(1)}%`} tone={capacity < 40 ? 'red' : capacity < 70 ? 'amber' : 'emerald'} />
        <Kpi label="Snapshots" value="1" />
      </section>

      {/* Estoque */}
      {snap && (
        <section className="mt-8 rounded-lg border border-navy/10 bg-white p-5">
          <h2 className="text-lg font-semibold text-navy">Estado dos slots</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <StatusBar label="Ideal" count={snap.slotsOk} total={snap.slotsTotal} color="emerald" />
            <StatusBar label="Alerta" count={snap.slotsAlert} total={snap.slotsTotal} color="amber" />
            <StatusBar label="Crítico" count={snap.slotsCritical} total={snap.slotsTotal} color="rose" />
          </div>
        </section>
      )}

      {/* Distribuição */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-navy">Distribuição de margem</h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <Bucket title="🟢 Alta (≥50%)" items={buckets.high} accent="emerald" />
          <Bucket title="🟡 Média (30-50%)" items={buckets.mid} accent="amber" />
          <Bucket title="🔴 Baixa (<30%)" items={buckets.low} accent="rose" />
        </div>
      </section>

      {/* Tabela completa */}
      <section className="mt-10">
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-navy">Todos os {slots.length} slots</h2>
          <Link href="/" className="text-xs text-navy/50 hover:text-navy">← ver na máquina</Link>
        </header>
        <SlotsTable slots={slots} />
      </section>

      {/* Alertas */}
      {buckets.low.length > 0 && (
        <section className="mt-8 rounded-lg border border-rose-200 bg-rose-50 p-5">
          <h2 className="text-base font-semibold text-rose-900">⚠️ Atenção em {buckets.low.length} slots</h2>
          <p className="mt-1 text-sm text-rose-800">
            Margem &lt; 30%. Mentos Kiss já foi marcado como phase-out intencional. Os outros precisam decisão.
          </p>
        </section>
      )}
    </main>
  );
}

function FocusSlot({ slot }: { slot: import('@/components/VendingMachineLive').SlotData }) {
  const meta = getProductMeta(slot.productName);
  return (
    <section className="mb-8 rounded-2xl border-2 border-gold bg-gold-50 p-6">
      <div className="flex items-start gap-5">
        <div className={`flex h-24 w-24 shrink-0 items-center justify-center rounded-xl ${meta.bgClass} text-6xl shadow-sm`}>
          {meta.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-mono text-navy/40">SELEÇÃO {slot.selecao} · {slot.productCode}</div>
          <h2 className="text-2xl font-bold text-navy">{slot.productName ?? '(slot vazio)'}</h2>
          <div className="mt-1 text-xs uppercase tracking-wide text-navy/55">{meta.category}</div>

          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
            <Metric label="Preço" value={slot.price !== null ? `R$ ${slot.price.toFixed(2)}` : '—'} />
            <Metric label="Lucro/un" value={slot.marginEst !== null ? `R$ ${slot.marginEst.toFixed(2)}` : '—'} />
            <Metric label="Margem" value={slot.marginPct !== null ? `${slot.marginPct.toFixed(0)}%` : '—'} />
            <Metric label="Capacidade" value={`${slot.capacity}`} />
            <Metric label="Alerta" value={slot.qtdeAlerta?.toString() ?? '—'} />
            <Metric label="Crítico" value={slot.qtdeCritico?.toString() ?? '—'} />
          </div>

          <Link href="/mara" className="mt-3 inline-block text-xs text-navy/60 hover:text-navy">× fechar focus</Link>
        </div>
      </div>
    </section>
  );
}

function SlotsTable({ slots }: { slots: import('@/components/VendingMachineLive').SlotData[] }) {
  const sorted = [...slots].sort((a, b) => Number(a.selecao) - Number(b.selecao));
  return (
    <div className="overflow-x-auto rounded-lg border border-navy/10 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-navy/10 bg-navy-50/50 text-xs uppercase tracking-wide text-navy/55">
          <tr>
            <th className="px-3 py-2 text-left">Sel</th>
            <th className="px-3 py-2 text-left">Produto</th>
            <th className="px-3 py-2 text-right">Preço</th>
            <th className="px-3 py-2 text-right">Lucro/un</th>
            <th className="px-3 py-2 text-right">Margem</th>
            <th className="px-3 py-2 text-right">Cap.</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => {
            const meta = getProductMeta(s.productName);
            const marginCls =
              s.marginPct === null
                ? 'text-navy/40'
                : s.marginPct >= 50
                  ? 'text-emerald-700'
                  : s.marginPct >= 30
                    ? 'text-amber-700'
                    : 'text-rose-700 font-bold';
            return (
              <tr key={s.selecao} className="border-b border-navy/5 hover:bg-navy-50/30">
                <td className="px-3 py-2 font-mono text-xs text-navy/60">{s.selecao}</td>
                <td className="px-3 py-2"><span className="mr-1">{meta.emoji}</span>{s.productName ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.price !== null ? `R$ ${s.price.toFixed(2)}` : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.marginEst !== null ? `R$ ${s.marginEst.toFixed(2)}` : '—'}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${marginCls}`}>{s.marginPct !== null ? `${s.marginPct.toFixed(0)}%` : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.capacity}</td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/mara?slot=${s.selecao}`} className="text-xs text-navy/50 hover:text-navy">detalhe →</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'amber' | 'emerald' }) {
  const toneCls = { red: 'text-rose-700', amber: 'text-amber-700', emerald: 'text-emerald-700' } as const;
  return (
    <div className="rounded-lg border border-navy/10 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-navy/45">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone ? toneCls[tone] : 'text-navy'}`}>{value}</div>
    </div>
  );
}

function StatusBar({ label, count, total, color }: { label: string; count: number; total: number; color: 'emerald' | 'amber' | 'rose' }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const bg = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500' }[color];
  const text = { emerald: 'text-emerald-700', amber: 'text-amber-700', rose: 'text-rose-700' }[color];
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className={`text-sm font-medium ${text}`}>{label}</span>
        <span className={`text-lg font-bold ${text}`}>{count}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-navy-50">
        <div className={`h-full ${bg}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-0.5 text-xs text-navy/50">{pct.toFixed(0)}% dos {total} slots</div>
    </div>
  );
}

function Bucket({ title, items, accent }: { title: string; items: SlotAnalytics[]; accent: 'emerald' | 'amber' | 'rose' }) {
  const border = { emerald: 'border-emerald-200', amber: 'border-amber-200', rose: 'border-rose-200' }[accent];
  const bg = { emerald: 'bg-emerald-50/40', amber: 'bg-amber-50/40', rose: 'bg-rose-50/40' }[accent];
  return (
    <article className={`rounded-lg border ${border} ${bg} p-4`}>
      <h3 className="mb-2 text-sm font-semibold text-navy">
        {title} <span className="font-normal text-navy/50">· {items.length}</span>
      </h3>
      <ul className="space-y-1 text-xs">
        {items.slice(0, 12).map((s) => (
          <li key={s.selecao} className="flex items-baseline justify-between gap-2 border-b border-navy/5 pb-1 last:border-b-0">
            <Link href={`/mara?slot=${s.selecao}`} className="truncate hover:underline">
              <span className="font-mono text-navy/40">{s.selecao.padStart(2, '0')}</span>{' '}
              <span className="text-navy/80">{s.produto}</span>
            </Link>
            <span className="shrink-0 font-mono font-semibold text-navy">{s.marginPct.toFixed(0)}%</span>
          </li>
        ))}
        {items.length > 12 && <li className="text-navy/40 italic">+{items.length - 12}...</li>}
      </ul>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-navy/10 bg-white p-2">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-navy/40">{label}</div>
      <div className="mt-0.5 text-base font-bold text-navy">{value}</div>
    </div>
  );
}
