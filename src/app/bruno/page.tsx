import Link from 'next/link';
import { prisma } from '@/lib/db';
import { TEAM, avatarUrl } from '@/lib/agents/team';

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

  const [purchases, monthAgg, lastMonthAgg, supplierAgg, topItems] = await Promise.all([
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
                    <div className="mt-1">
                      <SyncBadge p={p} />
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
    </main>
  );
}

function SyncBadge({
  p,
}: {
  p: { vendtefSyncedAt: Date | null; vendtefSyncError: string | null; vendtefSyncAttempts: number };
}) {
  if (p.vendtefSyncedAt) {
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
