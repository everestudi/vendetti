/**
 * HomeDashboard · KPIs operacionais + faturamento mês-a-mês + status de sync
 * + pendências por agente. Cabeçalho da home pro Luís ver o estado geral
 * num piscar de olhos.
 */

import Link from 'next/link';
import { MonthlyRevenuePoint, AgentPending, SyncStatus } from '@/lib/dashboard';
import { forceMaraSync } from '@/app/actions';

interface Props {
  revenueSeries: MonthlyRevenuePoint[];
  syncStatus: SyncStatus;
  pending: AgentPending[];
}

const brl = (n: number) =>
  Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });

const LEVEL_CLS: Record<AgentPending['level'], { card: string; badge: string; emoji: string }> = {
  ok: {
    card: 'border-emerald-200 bg-emerald-50/40',
    badge: 'bg-emerald-100 text-emerald-800',
    emoji: '✓',
  },
  warn: {
    card: 'border-amber-300 bg-amber-50/60',
    badge: 'bg-amber-100 text-amber-800',
    emoji: '⚠️',
  },
  critical: {
    card: 'border-rose-300 bg-rose-50/60',
    badge: 'bg-rose-100 text-rose-800',
    emoji: '🔴',
  },
};

export function HomeDashboard({ revenueSeries, syncStatus, pending }: Props) {
  const currentMonth = revenueSeries[revenueSeries.length - 1];
  const previousMonth = revenueSeries[revenueSeries.length - 2];
  const monthRevenue = currentMonth?.revenue ?? 0;
  const monthTxCount = currentMonth?.txCount ?? 0;
  const previousRevenue = previousMonth?.revenue ?? 0;
  const deltaPct =
    previousRevenue > 0 ? Math.round(((monthRevenue - previousRevenue) / previousRevenue) * 100) : null;
  const totalRevenue6m = revenueSeries.slice(-6).reduce((s, p) => s + p.revenue, 0);

  const ageStr = syncStatus.ageHours == null
    ? '—'
    : syncStatus.ageHours < 1
      ? 'há minutos'
      : syncStatus.ageHours < 24
        ? `há ${Math.round(syncStatus.ageHours)}h`
        : `há ${Math.round(syncStatus.ageHours / 24)}d`;

  const totalPending = pending.reduce((s, p) => s + p.count, 0);
  const criticalCount = pending.filter((p) => p.level === 'critical').length;

  return (
    <section className="mb-10 rounded-2xl border-2 border-navy/15 bg-white p-6 shadow-sm">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold text-navy">📊 Dashboard operacional</h2>
        <span className="text-xs text-navy/55">Estado da operação · atualizado em tempo real</span>
      </header>

      {/* KPI cards (4 colunas em desktop, 2 em mobile) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label={`Faturamento ${currentMonth?.label ?? ''}`}
          value={brl(monthRevenue)}
          sub={
            deltaPct == null
              ? `${monthTxCount} vendas`
              : `${monthTxCount} vendas · ${deltaPct >= 0 ? '+' : ''}${deltaPct}% vs ${previousMonth?.label}`
          }
          tone={deltaPct == null ? 'neutral' : deltaPct >= 0 ? 'positive' : 'negative'}
        />
        <Kpi
          label="6 meses"
          value={brl(totalRevenue6m)}
          sub={`média ${brl(totalRevenue6m / Math.min(6, revenueSeries.length))}/mês`}
          tone="neutral"
        />
        <Kpi
          label="Última sincronização"
          value={ageStr}
          sub={
            syncStatus.lastSnapshotAt
              ? syncStatus.lastSnapshotAt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
              : 'sem dados'
          }
          tone={syncStatus.isStale ? 'negative' : 'positive'}
        />
        <Kpi
          label="Pendências totais"
          value={String(totalPending)}
          sub={criticalCount > 0 ? `${criticalCount} crítica(s)` : 'sem urgência'}
          tone={criticalCount > 0 ? 'negative' : totalPending > 0 ? 'warn' : 'positive'}
        />
      </div>

      {/* Faturamento mês-a-mês (barras simples CSS) */}
      <div className="mt-6 rounded-lg border border-navy/10 bg-navy-50/30 p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-navy">Faturamento últimos {revenueSeries.length} meses</h3>
          <form action={forceMaraSync}>
            <button
              type="submit"
              className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-900"
              title="Dispara mara-sync no GH Actions · ~3-5min"
            >
              🔄 Sincronizar agora
            </button>
          </form>
        </div>
        <RevenueBars points={revenueSeries} />
        {syncStatus.isStale && (
          <p className="mt-2 text-[11px] text-rose-700">
            ⚠️ Dados podem estar desatualizados (última atualização {ageStr}). Clique "Sincronizar agora" pra
            disparar a Mara.
          </p>
        )}
      </div>

      {/* Pendências por departamento */}
      <div className="mt-6">
        <h3 className="mb-3 text-sm font-semibold text-navy">Pendências por departamento</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {pending.map((p) => (
            <Link
              key={p.agentId}
              href={p.href}
              className={`flex flex-col rounded-lg border-2 p-3 transition hover:shadow-md ${LEVEL_CLS[p.level].card}`}
            >
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-navy/65">
                  {p.emoji} {p.label}
                </span>
                {p.count > 0 && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${LEVEL_CLS[p.level].badge}`}>
                    {p.count}
                  </span>
                )}
              </div>
              <ul className="mt-1 space-y-0.5 text-[11px] text-navy/75">
                {p.summaryLines.slice(0, 4).map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
              <span className="mt-2 text-[10px] text-navy/40 group-hover:text-navy">abrir →</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

interface KpiProps {
  label: string;
  value: string;
  sub?: string;
  tone: 'positive' | 'negative' | 'neutral' | 'warn';
}
function Kpi({ label, value, sub, tone }: KpiProps) {
  const cls =
    tone === 'positive'
      ? 'border-emerald-200 bg-emerald-50/40 text-emerald-900'
      : tone === 'negative'
        ? 'border-rose-200 bg-rose-50/40 text-rose-900'
        : tone === 'warn'
          ? 'border-amber-200 bg-amber-50/40 text-amber-900'
          : 'border-navy/15 bg-white text-navy';
  return (
    <div className={`rounded-lg border-2 p-3 ${cls}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-xl font-bold leading-tight">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] opacity-70">{sub}</div>}
    </div>
  );
}

function RevenueBars({ points }: { points: MonthlyRevenuePoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.revenue));
  return (
    <div className="flex h-32 items-end gap-1 sm:gap-2">
      {points.map((p) => {
        const heightPct = (p.revenue / max) * 100;
        const isCurrent = points.indexOf(p) === points.length - 1;
        return (
          <div key={`${p.year}-${p.month}`} className="group flex flex-1 flex-col items-center">
            <div className="relative flex w-full flex-col-reverse">
              <div
                className={`w-full rounded-t transition-all hover:opacity-80 ${isCurrent ? 'bg-navy' : 'bg-navy/40'}`}
                style={{ height: `${Math.max(4, heightPct)}%`, minHeight: '4px' }}
                title={`${p.label}: ${brl(p.revenue)} (${p.txCount} vendas)`}
              />
            </div>
            <div className={`mt-1 text-[10px] ${isCurrent ? 'font-bold text-navy' : 'text-navy/50'}`}>
              {p.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
