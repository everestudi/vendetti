import Link from 'next/link';
import { prisma } from '@/lib/db';
import { TEAM, avatarUrl } from '@/lib/agents/team';
import { AgentTerminal } from '@/components/AgentTerminal';
import { resyncPurchase } from './actions';

export const dynamic = 'force-dynamic';

const brl = (n: unknown) =>
  Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

const SOURCE_LABEL: Record<string, string> = {
  'ui-upload': 'UI',
  'whatsapp-luis': 'WhatsApp',
  manual: 'manual',
};

const bruno = TEAM.find((a) => a.id === 'bruno')!;

function monthRange(d: Date) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return { start, end };
}

export default async function BrunoPage() {
  const now = new Date();
  const thisMonth = monthRange(now);
  const lastMonth = monthRange(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const [purchases, monthAgg, lastMonthAgg, supplierAgg, topItems, latestScraperRun, recentCorrections] = await Promise.all([
    prisma.purchase.findMany({
      orderBy: { occurredAt: 'desc' },
      take: 25,
      include: { _count: { select: { itens: true } } },
    }),
    prisma.purchase.aggregate({
      where: { occurredAt: { gte: thisMonth.start, lt: thisMonth.end } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.purchase.aggregate({
      where: { occurredAt: { gte: lastMonth.start, lt: lastMonth.end } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.purchase.groupBy({
      by: ['supplier'],
      where: { occurredAt: { gte: thisMonth.start, lt: thisMonth.end } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.purchaseItem.groupBy({
      by: ['skuId'],
      where: { purchase: { occurredAt: { gte: thisMonth.start, lt: thisMonth.end } } },
      _sum: { totalCost: true, qty: true },
      orderBy: { _sum: { totalCost: 'desc' } },
      take: 5,
    }),
    // Última execução do scraper Vendtef (Bruno) — usado pro painel "live status"
    prisma.workerRun.findFirst({
      where: { name: 'vendtef_entrada' },
      orderBy: { startedAt: 'desc' },
    }),
    // Correções de match recentes (auditoria pra Zelda) — últimas 48h
    prisma.workerRun.findMany({
      where: {
        name: 'match_correction',
        startedAt: { gte: new Date(Date.now() - 48 * 3600 * 1000) },
      },
      orderBy: { startedAt: 'desc' },
      take: 20,
    }),
  ]);

  const topSkus = await Promise.all(
    topItems
      .filter((t) => t.skuId)
      .map(async (t) => {
        const sku = await prisma.sku.findUnique({
          where: { id: t.skuId! },
          select: { name: true, code: true },
        });
        return {
          name: sku?.name ?? '(removido)',
          code: sku?.code ?? '?',
          qty: t._sum.qty ?? 0,
          totalCost: Number(t._sum.totalCost ?? 0),
        };
      }),
  );

  const monthTotal = Number(monthAgg._sum.totalAmount ?? 0);
  const lastMonthTotal = Number(lastMonthAgg._sum.totalAmount ?? 0);
  const delta = lastMonthTotal > 0 ? ((monthTotal - lastMonthTotal) / lastMonthTotal) * 100 : null;
  const monthLabel = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatarUrl(bruno)} alt={bruno.fullName} className="h-14 w-14 rounded-full ring-2 ring-emerald-400/40" />
        <div className="flex-1">
          <div className="text-xs text-navy/60">{bruno.fullName} · {bruno.role}</div>
          <h1 className="mt-1 text-2xl font-semibold text-navy">Compras</h1>
          <p className="text-sm text-navy/70">
            Entrada de NF-e/cupom (Atacadão, Vittal, etc). A Bruno cuida da pesquisa e o registro
            atualiza o custo dos SKUs automaticamente.
          </p>
        </div>
        <Link
          href="/bruno/nova"
          className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white shadow"
        >
          ＋ Nova compra
        </Link>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label={`Gasto ${monthLabel}`}
          value={brl(monthTotal)}
          sub={delta == null ? `${monthAgg._count} ${monthAgg._count === 1 ? 'compra' : 'compras'}` : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}% vs mês passado`}
        />
        <Kpi
          label="Mês passado"
          value={brl(lastMonthTotal)}
          sub={`${lastMonthAgg._count} ${lastMonthAgg._count === 1 ? 'compra' : 'compras'}`}
        />
        <Kpi
          label="Ticket médio (mês)"
          value={monthAgg._count > 0 ? brl(monthTotal / monthAgg._count) : '—'}
          sub="por NF"
        />
        <Kpi
          label="Fornecedores ativos"
          value={String(supplierAgg.length)}
          sub="no mês"
        />
      </section>

      <ScraperLiveStatus run={latestScraperRun} corrections={recentCorrections} />

      <section className="mb-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-navy/15 bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-navy">Por fornecedor · {monthLabel}</h2>
          {supplierAgg.length === 0 ? (
            <div className="text-xs text-navy/50">Sem compras esse mês.</div>
          ) : (
            <ul className="space-y-2">
              {supplierAgg
                .sort((a, b) => Number(b._sum.totalAmount ?? 0) - Number(a._sum.totalAmount ?? 0))
                .map((s) => (
                  <li key={s.supplier} className="flex items-center justify-between text-sm">
                    <span className="text-navy">
                      {s.supplier} <span className="text-navy/50">· {s._count}</span>
                    </span>
                    <span className="font-medium text-navy">{brl(s._sum.totalAmount)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-navy/15 bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-navy">Top 5 itens · {monthLabel}</h2>
          {topSkus.length === 0 ? (
            <div className="text-xs text-navy/50">Sem itens registrados esse mês.</div>
          ) : (
            <ul className="space-y-2">
              {topSkus.map((sku) => (
                <li key={sku.code} className="flex items-center justify-between text-sm">
                  <span className="text-navy">
                    {sku.name} <span className="text-navy/50">· {sku.qty}un</span>
                  </span>
                  <span className="font-medium text-navy">{brl(sku.totalCost)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-navy/15 bg-white">
        <h2 className="border-b border-navy/10 px-4 py-3 text-sm font-medium text-navy">
          Compras recentes
        </h2>
        {purchases.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-navy/60">
            Nenhuma compra registrada ainda.{' '}
            <Link href="/bruno/nova" className="text-navy underline">
              Registrar a primeira
            </Link>
            .
          </div>
        ) : (
          <ul className="divide-y divide-navy/10">
            {purchases.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-navy">
                      {p.supplier}
                      {p.supplierName && <span className="text-navy/60"> · {p.supplierName}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-navy/60">
                      {p.occurredAt.toLocaleDateString('pt-BR')}
                      {p.invoiceRef && ` · NF ${p.invoiceRef}`}
                      {' · '}
                      {p._count.itens} {p._count.itens === 1 ? 'item' : 'itens'}
                      {' · '}
                      {SOURCE_LABEL[p.source] ?? p.source}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <SyncBadge p={p} />
                      {(p.vendtefSyncError || !p.vendtefSyncedAt) && (
                        <form action={resyncPurchase.bind(null, p.id)}>
                          <button
                            type="submit"
                            className="rounded border border-navy/15 bg-white px-2 py-0.5 text-[10px] font-medium text-navy/75 hover:bg-navy/5"
                            title="Re-dispara o scraper vendtef-sync pra essa Purchase"
                          >
                            🔄 re-sync
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-lg font-semibold text-navy">
                    {brl(p.totalAmount)}
                  </div>
                </div>
                {p.notes && <div className="mt-1 text-xs text-navy/70">{p.notes}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <AgentTerminal scope="bruno" agentLabel="Bruno · Compras" />
    </main>
  );
}

function SyncBadge({
  p,
}: {
  p: { vendtefSyncedAt: Date | null; vendtefSyncError: string | null; vendtefSyncAttempts: number };
}) {
  if (p.vendtefSyncedAt) {
    // Sucesso parcial: tem warning em vendtefSyncError mesmo com syncedAt setado
    if (p.vendtefSyncError) {
      return (
        <span
          className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
          title={p.vendtefSyncError}
        >
          ⚠️ Vendtef parcial · {p.vendtefSyncError.slice(0, 60)}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
        ✓ Sincronizado no Vendtef
      </span>
    );
  }
  if (p.vendtefSyncError && p.vendtefSyncAttempts >= 3) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-800"
        title={p.vendtefSyncError}
      >
        ✗ Falhou ({p.vendtefSyncAttempts}x): {p.vendtefSyncError.slice(0, 40)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
      ⏳ Aguardando sync Vendtef
    </span>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-navy/15 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-navy/50">{label}</div>
      <div className="mt-1 text-xl font-semibold text-navy">{value}</div>
      {sub && <div className="mt-1 text-xs text-navy/60">{sub}</div>}
    </div>
  );
}

type ScraperRun = Awaited<ReturnType<typeof prisma.workerRun.findFirst>>;
type CorrectionRun = Awaited<ReturnType<typeof prisma.workerRun.findMany>>[number];

/**
 * Painel "ao vivo" do Bruno · mostra última execução do scraper Vendtef
 * (vendtef_entrada): status, duração, link pro GH Action run e correções
 * de match que ficaram pra Zelda auditar. Atualiza com refresh da página.
 */
function ScraperLiveStatus({ run, corrections }: { run: ScraperRun; corrections: CorrectionRun[] }) {
  if (!run) {
    return (
      <section className="mb-6 rounded-lg border border-navy/10 bg-navy/[0.02] p-4 text-xs text-navy/55">
        ℹ️ Scraper Vendtef (Bruno) ainda não rodou. Sobe uma NF-e em <code>/bruno/nova</code> pra disparar.
      </section>
    );
  }
  const meta = (run.meta ?? {}) as Record<string, unknown>;
  const isRunning = run.status === 'RUNNING';
  const isFailed = run.status === 'FAILED';
  const isOk = run.status === 'OK';
  const ageS = Math.round((Date.now() - run.startedAt.getTime()) / 1000);
  const age = ageS < 60 ? `${ageS}s` : ageS < 3600 ? `${Math.round(ageS / 60)}min` : `${Math.round(ageS / 3600)}h`;
  const duration = run.finishedAt
    ? `${Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)}s`
    : '...';
  const cls = isRunning
    ? 'border-blue-300 bg-blue-50'
    : isFailed
      ? 'border-rose-300 bg-rose-50'
      : 'border-emerald-300 bg-emerald-50';
  const icon = isRunning ? '⏳' : isFailed ? '❌' : '✅';

  // Group corrections by type for summary
  const correctionTypes = corrections.reduce(
    (acc, c) => {
      const m = (c.meta ?? {}) as Record<string, unknown>;
      const type = String(m.correctionType ?? 'unknown');
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <section className={`mb-6 rounded-lg border-2 p-4 ${cls}`}>
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-navy">
          {icon} Scraper Vendtef · última execução
          {isRunning && ` · rodando há ${age}`}
          {isOk && ` · OK em ${duration}`}
          {isFailed && ` · FALHOU em ${duration}`}
        </h2>
        <a
          href="https://github.com/everestudi/vendetti/actions/workflows/vendtef-sync.yml"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-navy/60 hover:underline"
        >
          📋 logs no GitHub Actions →
        </a>
      </header>
      <div className="space-y-1 text-xs text-navy/75">
        <div>
          <span className="text-navy/50">início:</span> {run.startedAt.toLocaleString('pt-BR')} ({age} atrás)
        </div>
        {isFailed && run.error && (
          <details className="mt-1 rounded bg-white p-2">
            <summary className="cursor-pointer font-medium text-rose-700">erro completo</summary>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px] text-rose-900">
{run.error}
            </pre>
          </details>
        )}
        {isOk && Object.keys(meta).length > 0 && (
          <details className="mt-1 rounded bg-white p-2">
            <summary className="cursor-pointer text-navy/65">meta da execução</summary>
            <pre className="mt-1 overflow-x-auto text-[10px] text-navy/70">
{JSON.stringify(meta, null, 2)}
            </pre>
          </details>
        )}
      </div>

      {corrections.length > 0 && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs">
          <div className="mb-2 flex items-baseline justify-between">
            <strong className="text-amber-900">
              🧪 {corrections.length} match correction(s) capturadas nas últimas 48h
            </strong>
            <Link href="/equipe/zelda" className="text-[10px] text-amber-700 hover:underline">
              Zelda audita →
            </Link>
          </div>
          <div className="mb-2 flex flex-wrap gap-2 text-[10px]">
            {Object.entries(correctionTypes).map(([t, n]) => (
              <span key={t} className="rounded-full bg-white px-2 py-0.5 text-amber-800">
                {n}× {t.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
          <div className="space-y-1">
            {corrections.slice(0, 8).map((c) => {
              const m = (c.meta ?? {}) as Record<string, unknown>;
              return (
                <div key={c.id} className="text-amber-900">
                  · <span className="font-mono text-[10px] text-amber-700">{String(m.context ?? '?')}</span>{' '}
                  <span className="font-medium">{String(m.inputText ?? '?').slice(0, 80)}</span>
                  {m.suggestedSkuName ? (
                    <span className="text-amber-700/70">
                      {' '}
                      → sugerido {String(m.suggestedScore ?? '?')}% {String(m.suggestedSkuName).slice(0, 30)}
                    </span>
                  ) : (
                    <span className="italic text-amber-700/55"> · sem sugestão</span>
                  )}
                </div>
              );
            })}
            {corrections.length > 8 && (
              <div className="text-[10px] italic text-amber-700/60">+{corrections.length - 8} outras…</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
