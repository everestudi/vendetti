/**
 * HomeDashboard · 3 seções separadas:
 *   1. Faturamento (KPIs + gráficos com toggle mês-a-mês / diário)
 *   2. Augusto Commentary (briefing CEO a cada refresh, cache 5min)
 *   3. Pendências por agente
 *
 * Sem mistura — cada seção tem propósito único.
 */

import Link from 'next/link';
import { MonthlyRevenuePoint, AgentPending, SyncStatus, DailyComparisonPoint, AugustoCommentary } from '@/lib/dashboard';
import { forceMaraSync, refreshProductImages } from '@/app/actions';
import { RevenueCharts } from './RevenueCharts';

interface Props {
  revenueSeries: MonthlyRevenuePoint[];
  dailyComparison: { points: DailyComparisonPoint[]; totals: { thisMonth: number; lastMonth: number }; monthLabels: { thisMonth: string; lastMonth: string } };
  syncStatus: SyncStatus;
  pending: AgentPending[];
  augusto: AugustoCommentary | null;
  syncFeedback?: 'triggered' | 'failed' | null;
  syncFeedbackError?: string;
}

const brl = (n: number) =>
  Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });

const LEVEL_CLS: Record<AgentPending['level'], { card: string; badge: string }> = {
  ok: { card: 'border-emerald-200 bg-emerald-50/40', badge: 'bg-emerald-100 text-emerald-800' },
  warn: { card: 'border-amber-300 bg-amber-50/60', badge: 'bg-amber-100 text-amber-800' },
  critical: { card: 'border-rose-300 bg-rose-50/60', badge: 'bg-rose-100 text-rose-800' },
};

export function HomeDashboard({ revenueSeries, dailyComparison, syncStatus, pending, augusto, syncFeedback, syncFeedbackError }: Props) {
  // Filtra meses com dado (remove os 0 antigos que confundem o gráfico)
  const seriesWithData = revenueSeries.filter((p) => p.revenue > 0);
  // Mantém último mês mesmo zerado (mês atual parcial)
  const lastIdx = revenueSeries.length - 1;
  if (seriesWithData.length > 0 && seriesWithData[seriesWithData.length - 1] !== revenueSeries[lastIdx]) {
    seriesWithData.push(revenueSeries[lastIdx]);
  }
  const effectiveSeries = seriesWithData.length > 0 ? seriesWithData : revenueSeries.slice(-3);

  const currentMonth = effectiveSeries[effectiveSeries.length - 1];
  const previousMonth = effectiveSeries[effectiveSeries.length - 2];
  const monthRevenue = currentMonth?.revenue ?? 0;
  const monthTxCount = currentMonth?.txCount ?? 0;
  const previousRevenue = previousMonth?.revenue ?? 0;
  const deltaPct =
    previousRevenue > 0 ? Math.round(((monthRevenue - previousRevenue) / previousRevenue) * 100) : null;
  const totalRevenue6m = effectiveSeries.slice(-6).reduce((s, p) => s + p.revenue, 0);

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
    <>
      {/* Feedback do botão sync */}
      {syncFeedback === 'triggered' && (
        <div className="mb-4 rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          🔄 <strong>Sincronização disparada!</strong> Mara tá rodando no GitHub Actions · resultado em 3-5min.
          Recarregue a página quando quiser conferir.
          <Link href="/" className="ml-2 text-xs underline">fechar</Link>
        </div>
      )}
      {syncFeedback === 'failed' && (
        <div className="mb-4 rounded-lg border-2 border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          ❌ <strong>Sync falhou.</strong> {syncFeedbackError ? `Erro: ${syncFeedbackError}` : 'Verifique GITHUB_PAT em /settings.'}
          <Link href="/" className="ml-2 text-xs underline">fechar</Link>
        </div>
      )}

      {/* ===== SEÇÃO 1 · FATURAMENTO ===== */}
      <section className="mb-8 rounded-2xl border-2 border-navy/15 bg-white p-6 shadow-sm">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-bold text-navy">💰 Faturamento</h2>
          <div className="flex gap-2">
            <form action={refreshProductImages}>
              <button
                type="submit"
                className="rounded-lg border border-navy/20 bg-white px-3 py-1.5 text-xs font-semibold text-navy/70 hover:bg-navy/5"
                title="Busca imagens dos produtos no Atacadão VTEX e popula Sku.imageUrl"
              >
                🖼️ Imagens
              </button>
            </form>
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
        </header>

        {/* KPIs faturamento (4 cards) */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            label={`Mês atual · ${currentMonth?.label ?? ''}`}
            value={brl(monthRevenue)}
            sub={
              deltaPct == null
                ? `${monthTxCount} vendas`
                : `${monthTxCount} vendas · ${deltaPct >= 0 ? '+' : ''}${deltaPct}% vs anterior`
            }
            tone={deltaPct == null ? 'neutral' : deltaPct >= 0 ? 'positive' : 'negative'}
          />
          <Kpi
            label={`Mês anterior · ${previousMonth?.label ?? ''}`}
            value={brl(previousRevenue)}
            sub={previousMonth ? `${previousMonth.txCount} vendas` : '—'}
            tone="neutral"
          />
          <Kpi
            label="6 meses (média)"
            value={brl(totalRevenue6m / Math.min(6, effectiveSeries.length))}
            sub={`total ${brl(totalRevenue6m)}`}
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
        </div>

        {/* Gráficos com toggle (client) */}
        <RevenueCharts series={effectiveSeries} dailyPoints={dailyComparison.points} monthLabels={dailyComparison.monthLabels} />

        {syncStatus.isStale && (
          <p className="mt-2 text-[11px] text-rose-700">
            ⚠️ Dados podem estar desatualizados (última atualização {ageStr}).
          </p>
        )}
      </section>

      {/* ===== SEÇÃO 2 · AUGUSTO CEO COMMENTARY ===== */}
      {augusto && (
        <section className="mb-8 rounded-2xl border-2 border-gold/40 bg-gradient-to-br from-gold-50 to-white p-6">
          <header className="mb-3 flex items-baseline justify-between">
            <h2 className="text-xl font-bold text-navy">🤖 Augusto · briefing CEO</h2>
            <span className="text-[11px] text-navy/45">
              {augusto.cached ? 'cache' : 'gerado'} · {augusto.generatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </header>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-navy/85">{augusto.text}</p>

          {(augusto.insights.length > 0 || augusto.actions.length > 0) && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {augusto.insights.length > 0 && (
                <div>
                  <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-navy/55">🔍 Insights</h3>
                  <ul className="space-y-1 text-xs text-navy/80">
                    {augusto.insights.map((i, idx) => (
                      <li key={idx} className="flex gap-2">
                        <span className="text-gold-700">·</span>
                        <span>{i}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {augusto.actions.length > 0 && (
                <div>
                  <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-navy/55">🎯 Ações sugeridas</h3>
                  <ul className="space-y-1 text-xs text-navy/80">
                    {augusto.actions.map((a, idx) => (
                      <li key={idx} className="flex gap-2">
                        <span className="text-emerald-700">→</span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <p className="mt-3 text-[10px] text-navy/40">
            Briefing gerado por Claude Haiku · refresh a cada 5min de cache. Quer chat completo?{' '}
            <Link href="/chat" className="underline hover:text-navy/70">/chat com Augusto →</Link>
          </p>
        </section>
      )}

      {/* ===== SEÇÃO 3 · PENDÊNCIAS POR DEPARTAMENTO ===== */}
      <section className="mb-8 rounded-2xl border-2 border-navy/15 bg-white p-6 shadow-sm">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-bold text-navy">📋 Pendências por departamento</h2>
          <span className="text-xs text-navy/55">
            {totalPending} totais{criticalCount > 0 ? ` · ${criticalCount} crítica(s)` : ''}
          </span>
        </header>
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
              <span className="mt-2 text-[10px] text-navy/40">abrir →</span>
            </Link>
          ))}
        </div>
      </section>
    </>
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
