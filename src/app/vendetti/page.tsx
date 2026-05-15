import Link from 'next/link';
import { prisma } from '@/lib/db';
import { CEO, avatarUrl } from '@/lib/agents/team';
import { ChatVendettiDynamic } from '@/components/ChatVendettiDynamic';
import { AutoRefresh } from '@/components/AutoRefresh';
import {
  approveDecision,
  rejectDecision,
  executeDecisionAction,
  confirmPhysical,
} from '@/app/decisions/actions';

export const dynamic = 'force-dynamic';

const LEVEL_BADGE = {
  GREEN: { cls: 'bg-emerald-100 text-emerald-800', label: '🟢 verde' },
  YELLOW: { cls: 'bg-amber-100 text-amber-800', label: '🟡 amarelo' },
  RED: { cls: 'bg-rose-100 text-rose-800', label: '🔴 vermelho' },
} as const;

const AGENT_COLOR: Record<string, string> = {
  Vendetti: 'bg-navy text-white',
  Mara: 'bg-gold text-navy-900',
  Rita: 'bg-rose-500 text-white',
  Lúcia: 'bg-sky-500 text-white',
  Bruno: 'bg-emerald-600 text-white',
  Zelda: 'bg-amber-600 text-white',
  Cliente: 'bg-navy/15 text-navy',
  Luís: 'bg-purple-600 text-white',
};

export default async function VendettiPage() {
  const [pending, approved, awaitingPhysical, complaintsOpen, purchasesPending, transactions, decisionsRecent] =
    await Promise.all([
      prisma.decision.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' } }),
      prisma.decision.findMany({ where: { status: 'APPROVED' }, orderBy: { createdAt: 'desc' } }),
      prisma.decision.findMany({ where: { status: 'AWAITING_PHYSICAL' }, orderBy: { createdAt: 'desc' } }),
      prisma.complaint.count({ where: { status: 'ESCALATED' } }),
      prisma.purchase.count({ where: { vendtefSyncedAt: null } }),
      prisma.transaction.findMany({ orderBy: { occurredAt: 'desc' }, take: 15, include: { sku: true } }),
      prisma.decision.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);

  const events: { at: Date; emoji: string; agent: string; summary: string; link?: string }[] = [];
  for (const t of transactions) {
    events.push({
      at: t.occurredAt,
      emoji: t.status === 'OK' ? '💰' : '❌',
      agent: 'Cliente',
      summary: `${t.status === 'OK' ? 'Venda' : 'Cancelamento'} · ${t.sku?.name ?? '?'} · R$ ${Number(t.grossAmount).toFixed(2)}`,
    });
  }
  for (const d of decisionsRecent) {
    events.push({
      at: d.createdAt,
      emoji: d.status === 'EXECUTED' ? '✅' : d.status === 'FAILED' ? '⚠️' : d.status === 'AWAITING_PHYSICAL' ? '⏳' : d.status === 'REJECTED' ? '🚫' : '🧠',
      agent: 'Vendetti',
      summary: `${d.summary.slice(0, 100)} · ${d.status}`,
      link: '/decisions',
    });
  }
  events.sort((a, b) => b.at.getTime() - a.at.getTime());

  const totalAction = pending.length + approved.length + awaitingPhysical.length;

  return (
    <>
      <AutoRefresh intervalMs={30_000} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        {/* HERO */}
        <section className="mb-8 flex flex-col items-start gap-5 rounded-2xl border border-navy/15 bg-gradient-to-br from-navy/[0.03] via-white to-gold/[0.06] p-6 sm:flex-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarUrl(CEO, 160)}
            alt="Augusto Vendetti"
            width={120}
            height={120}
            className="rounded-full ring-2 ring-navy/20"
          />
          <div className="flex-1">
            <div className="text-xs font-semibold uppercase tracking-widest text-gold">
              Painel de Controle do CEO
            </div>
            <h1 className="mt-1 text-3xl font-bold text-navy">{CEO.fullName ?? CEO.name}</h1>
            <p className="mt-2 max-w-2xl text-sm text-navy/70">{CEO.role}</p>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-navy/60">{CEO.backstory}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-navy/55">
              <span>🟢 Claude Opus 4.7</span>
              <span>·</span>
              <span>auto-refresh 30s</span>
              {totalAction > 0 && (
                <>
                  <span>·</span>
                  <span className="font-semibold text-amber-700">{totalAction} esperando sua ação ↓</span>
                </>
              )}
            </div>
          </div>
        </section>

        {/* KPIs */}
        <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CeoKpi label="Decisões pra você" value={pending.length} tone={pending.length > 0 ? 'amber' : 'neutral'} href="#decisoes" />
          <CeoKpi label="Prontas pra executar" value={approved.length} tone={approved.length > 0 ? 'blue' : 'neutral'} href="#decisoes" />
          <CeoKpi label="SAC escaladas" value={complaintsOpen} tone={complaintsOpen > 0 ? 'rose' : 'neutral'} href="/sac" />
          <CeoKpi label="Compras aguardando sync" value={purchasesPending} tone={purchasesPending > 0 ? 'amber' : 'neutral'} href="/bruno" />
        </section>

        {/* CHAT */}
        <section className="mb-8 rounded-2xl border border-navy/15 bg-white p-5">
          <header className="mb-3 flex items-baseline justify-between border-b border-navy/10 pb-3">
            <h2 className="text-lg font-semibold text-navy">💬 Conversa com Augusto</h2>
            <span className="text-[10px] text-navy/45">tools ativas · 18 capabilities</span>
          </header>
          <ChatVendettiDynamic hideHeader heightClass="h-[560px]" />
        </section>

        {/* DECISÕES */}
        <section id="decisoes" className="mb-8 rounded-2xl border border-navy/15 bg-white p-5">
          <header className="mb-4 flex items-baseline justify-between border-b border-navy/10 pb-3">
            <h2 className="text-lg font-semibold text-navy">🟡 Decisões aguardando você</h2>
            <Link href="/decisions" className="text-xs text-navy/55 hover:text-navy">
              histórico completo →
            </Link>
          </header>
          {totalAction === 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-6 text-center text-sm text-emerald-900">
              ✓ Nada esperando ação agora.
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map((d) => (
                <PendingCard key={d.id} d={d} />
              ))}
              {approved.map((d) => (
                <ApprovedCard key={d.id} d={d} />
              ))}
              {awaitingPhysical.map((d) => (
                <PhysicalCard key={d.id} d={d} />
              ))}
            </div>
          )}
        </section>

        {/* MONITOR */}
        <section className="mb-8 rounded-2xl border border-navy/15 bg-white p-5">
          <header className="mb-4 flex items-baseline justify-between border-b border-navy/10 pb-3">
            <h2 className="text-lg font-semibold text-navy">📡 Monitor recente</h2>
            <Link href="/monitor" className="text-xs text-navy/55 hover:text-navy">
              timeline completa →
            </Link>
          </header>
          {events.length === 0 ? (
            <p className="text-sm text-navy/45">Sem eventos ainda.</p>
          ) : (
            <ul className="space-y-2">
              {events.slice(0, 12).map((e, i) => (
                <li key={i} className="flex items-start gap-3 rounded-lg border border-navy/10 bg-navy-50/30 p-2.5">
                  <span className="text-xl leading-none">{e.emoji}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${AGENT_COLOR[e.agent] ?? 'bg-navy/10 text-navy/70'}`}>
                    {e.agent}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-navy/85">{e.summary}</div>
                  </div>
                  <time className="shrink-0 text-[10px] text-navy/40 font-mono">
                    {e.at.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </time>
                  {e.link && (
                    <Link href={e.link} className="shrink-0 text-[10px] text-navy/40 hover:text-navy">
                      →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

type Decision = Awaited<ReturnType<typeof prisma.decision.findMany>>[number];

function CeoKpi({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: number;
  tone: 'amber' | 'blue' | 'rose' | 'neutral';
  href: string;
}) {
  const cls = {
    amber: 'border-amber-200 bg-amber-50/40 text-amber-900',
    blue: 'border-blue-200 bg-blue-50/40 text-blue-900',
    rose: 'border-rose-200 bg-rose-50/40 text-rose-900',
    neutral: 'border-navy/10 bg-white text-navy/70',
  }[tone];
  return (
    <Link
      href={href}
      className={`rounded-xl border ${cls} px-3 py-2 transition hover:-translate-y-0.5 hover:shadow-sm`}
    >
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-2xl font-bold">{value}</div>
    </Link>
  );
}

function DecisionMeta({ d }: { d: Decision }) {
  const level = LEVEL_BADGE[d.level as keyof typeof LEVEL_BADGE];
  return (
    <div className="flex flex-wrap items-baseline gap-2 text-[10px]">
      <span className={`rounded-full px-2 py-0.5 font-medium ${level.cls}`}>{level.label}</span>
      <span className="text-navy/45">{d.kind}</span>
      <span className="font-mono text-navy/35">{d.id.slice(0, 8)}</span>
      <span className="ml-auto text-navy/40">
        {new Date(d.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}

function PendingCard({ d }: { d: Decision }) {
  return (
    <article className="rounded-lg border border-amber-200 bg-amber-50/30 p-4">
      <DecisionMeta d={d} />
      <h3 className="mt-2 font-semibold text-navy">{d.summary}</h3>
      <p className="mt-1 whitespace-pre-wrap text-xs text-navy/70">{d.rationale}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={approveDecision.bind(null, d.id)}>
          <button className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">
            ✓ Aprovar
          </button>
        </form>
        <form action={rejectDecision} className="flex items-center gap-2">
          <input type="hidden" name="id" value={d.id} />
          <input
            type="text"
            name="reason"
            placeholder="motivo (opcional)"
            className="rounded border border-navy/20 px-2 py-1 text-xs"
          />
          <button className="rounded bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700">
            ✗ Rejeitar
          </button>
        </form>
      </div>
    </article>
  );
}

function ApprovedCard({ d }: { d: Decision }) {
  return (
    <article className="rounded-lg border border-blue-200 bg-blue-50/30 p-4">
      <DecisionMeta d={d} />
      <h3 className="mt-2 font-semibold text-navy">{d.summary}</h3>
      <p className="mt-1 whitespace-pre-wrap text-xs text-navy/70">{d.rationale}</p>
      <p className="mt-2 text-[11px] text-blue-900/70">
        ℹ &ldquo;Executar&rdquo; dispara o scraper agora (browser headless, ~30-60s).
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={executeDecisionAction.bind(null, d.id)}>
          <button className="rounded bg-navy px-4 py-1.5 text-sm font-semibold text-white hover:bg-navy-900">
            🚀 Executar
          </button>
        </form>
      </div>
    </article>
  );
}

function PhysicalCard({ d }: { d: Decision }) {
  return (
    <article className="rounded-lg border border-purple-200 bg-purple-50/30 p-4">
      <DecisionMeta d={d} />
      <h3 className="mt-2 font-semibold text-navy">{d.summary}</h3>
      <p className="mt-2 text-[11px] text-purple-900/80">
        ⏳ Sistema atualizado. Aguardando Weverton ajustar fisicamente.
      </p>
      <div className="mt-3">
        <form action={confirmPhysical.bind(null, d.id)}>
          <button className="rounded bg-purple-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-purple-800">
            ✓ Confirmar físico
          </button>
        </form>
      </div>
    </article>
  );
}
