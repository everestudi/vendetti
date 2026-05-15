import Link from 'next/link';
import { prisma } from '@/lib/db';
import { CEO, avatarUrl } from '@/lib/agents/team';
import { ChatVendetti } from '@/components/ChatVendetti';
import { AutoRefresh } from '@/components/AutoRefresh';
import {
  approveDecision,
  rejectDecision,
  executeDecisionAction,
  confirmPhysical,
} from '@/app/decisions/actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const LEVEL_BADGE = {
  GREEN: { cls: 'bg-emerald-100 text-emerald-800', label: '🟢' },
  YELLOW: { cls: 'bg-amber-100 text-amber-800', label: '🟡' },
  RED: { cls: 'bg-rose-100 text-rose-800', label: '🔴' },
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
      prisma.transaction.findMany({ orderBy: { occurredAt: 'desc' }, take: 10, include: { sku: true } }),
      prisma.decision.findMany({ orderBy: { createdAt: 'desc' }, take: 6 }),
    ]);

  const events: { at: Date; emoji: string; agent: string; summary: string }[] = [];
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
      summary: `${d.summary.slice(0, 80)} · ${d.status}`,
    });
  }
  events.sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <AutoRefresh intervalMs={30_000} />
      <main className="mx-auto max-w-7xl px-4 py-6">
        {/* HERO */}
        <section className="mb-6 flex items-start gap-5 rounded-2xl border border-navy/15 bg-gradient-to-br from-navy/[0.03] via-white to-gold/[0.06] p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarUrl(CEO, 120)}
            alt="Augusto Vendetti"
            width={88}
            height={88}
            className="rounded-full ring-2 ring-navy/20"
          />
          <div className="flex-1">
            <div className="text-xs font-semibold uppercase tracking-widest text-gold">
              Painel de Controle do CEO
            </div>
            <h1 className="mt-1 text-3xl font-bold text-navy">{CEO.fullName ?? CEO.name}</h1>
            <p className="mt-1 max-w-2xl text-sm text-navy/70">
              {CEO.role}. Você fala com ele, ele analisa, decide o que executar e propõe ações.
              A palavra final ainda é sua — aqui em cima.
            </p>
          </div>
          <div className="hidden flex-col items-end gap-1 text-right text-xs text-navy/60 md:flex">
            <span>🟢 online · Claude Opus 4.7</span>
            <span>auto-refresh 30s</span>
          </div>
        </section>

        {/* KPIs */}
        <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <CeoKpi
            label="Decisões pra você"
            value={pending.length}
            tone={pending.length > 0 ? 'amber' : 'neutral'}
            href="#decisoes"
          />
          <CeoKpi
            label="Prontas pra executar"
            value={approved.length}
            tone={approved.length > 0 ? 'blue' : 'neutral'}
            href="#decisoes"
          />
          <CeoKpi
            label="SAC escaladas"
            value={complaintsOpen}
            tone={complaintsOpen > 0 ? 'rose' : 'neutral'}
            href="/sac"
          />
          <CeoKpi
            label="Compras aguardando sync"
            value={purchasesPending}
            tone={purchasesPending > 0 ? 'amber' : 'neutral'}
            href="/bruno"
          />
        </section>

        {/* GRID: chat (esq) + decisões/monitor (dir) */}
        <section className="grid gap-5 lg:grid-cols-12">
          {/* CHAT */}
          <div className="rounded-2xl border border-navy/15 bg-white p-4 lg:col-span-7">
            <header className="mb-2 flex items-baseline justify-between border-b border-navy/10 pb-2">
              <h2 className="text-sm font-semibold text-navy">💬 Conversa com Augusto</h2>
              <span className="text-[10px] text-navy/45">tools ativas · 18 capabilities</span>
            </header>
            <ChatVendetti hideHeader heightClass="h-[640px]" />
          </div>

          {/* SIDEBAR */}
          <div className="space-y-4 lg:col-span-5">
            {/* Decisões */}
            <section id="decisoes" className="rounded-2xl border border-navy/15 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-navy">
                🟡 Decisões aguardando você
              </h2>
              {pending.length === 0 && approved.length === 0 && awaitingPhysical.length === 0 ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 text-center text-xs text-emerald-900">
                  ✓ Sem pendências
                </div>
              ) : (
                <div className="space-y-3">
                  {pending.map((d) => (
                    <CompactPending key={d.id} d={d} />
                  ))}
                  {approved.map((d) => (
                    <CompactApproved key={d.id} d={d} />
                  ))}
                  {awaitingPhysical.map((d) => (
                    <CompactPhysical key={d.id} d={d} />
                  ))}
                </div>
              )}
              <div className="mt-3 text-right">
                <Link href="/decisions" className="text-xs text-navy/55 hover:text-navy">
                  Ver histórico completo →
                </Link>
              </div>
            </section>

            {/* Monitor */}
            <section className="rounded-2xl border border-navy/15 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-navy">📡 Monitor recente</h2>
              {events.length === 0 ? (
                <p className="text-xs text-navy/45">Sem eventos ainda.</p>
              ) : (
                <ul className="space-y-1.5">
                  {events.slice(0, 8).map((e, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className="text-base leading-none">{e.emoji}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${AGENT_COLOR[e.agent] ?? 'bg-navy/10 text-navy/70'}`}>
                        {e.agent}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-navy/80">{e.summary}</span>
                      <time className="shrink-0 text-[9px] text-navy/40">
                        {e.at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 text-right">
                <Link href="/monitor" className="text-xs text-navy/55 hover:text-navy">
                  Timeline completa →
                </Link>
              </div>
            </section>
          </div>
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
    <div className="flex items-baseline gap-1.5 text-[10px]">
      <span className={`rounded-full px-1.5 py-0.5 font-medium ${level.cls}`}>{level.label}</span>
      <span className="text-navy/50">{d.kind}</span>
      <span className="ml-auto text-navy/40">
        {new Date(d.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}

function CompactPending({ d }: { d: Decision }) {
  return (
    <article className="rounded-lg border border-amber-200 bg-amber-50/30 p-3">
      <DecisionMeta d={d} />
      <h3 className="mt-1 text-sm font-semibold text-navy line-clamp-2">{d.summary}</h3>
      <p className="mt-1 line-clamp-2 text-[11px] text-navy/65">{d.rationale}</p>
      <div className="mt-2 flex items-center gap-2">
        <form action={approveDecision.bind(null, d.id)}>
          <button className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700">
            ✓ Aprovar
          </button>
        </form>
        <form action={rejectDecision} className="flex flex-1 gap-1">
          <input type="hidden" name="id" value={d.id} />
          <input
            type="text"
            name="reason"
            placeholder="motivo (opcional)"
            className="min-w-0 flex-1 rounded border border-navy/15 px-1.5 py-1 text-[11px]"
          />
          <button className="rounded bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-700">
            ✗
          </button>
        </form>
      </div>
    </article>
  );
}

function CompactApproved({ d }: { d: Decision }) {
  return (
    <article className="rounded-lg border border-blue-200 bg-blue-50/30 p-3">
      <DecisionMeta d={d} />
      <h3 className="mt-1 text-sm font-semibold text-navy line-clamp-2">{d.summary}</h3>
      <p className="mt-1 line-clamp-1 text-[11px] text-navy/65">{d.rationale}</p>
      <div className="mt-2">
        <form action={executeDecisionAction.bind(null, d.id)}>
          <button className="rounded bg-navy px-3 py-1 text-[11px] font-semibold text-white hover:bg-navy-900">
            🚀 Executar (~30-60s)
          </button>
        </form>
      </div>
    </article>
  );
}

function CompactPhysical({ d }: { d: Decision }) {
  return (
    <article className="rounded-lg border border-purple-200 bg-purple-50/30 p-3">
      <DecisionMeta d={d} />
      <h3 className="mt-1 text-sm font-semibold text-navy line-clamp-2">{d.summary}</h3>
      <p className="mt-1 text-[11px] text-purple-900/75">⏳ Sistema OK · aguardando Weverton.</p>
      <div className="mt-2">
        <form action={confirmPhysical.bind(null, d.id)}>
          <button className="rounded bg-purple-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-purple-800">
            ✓ Confirmar físico
          </button>
        </form>
      </div>
    </article>
  );
}
