import { prisma } from '@/lib/db';
import { approveDecision, rejectDecision, executeDecisionAction, confirmPhysical } from './actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // executor pode levar ~30-60s

const LEVEL_BADGE = {
  GREEN: { cls: 'bg-emerald-100 text-emerald-800', label: '🟢 verde' },
  YELLOW: { cls: 'bg-amber-100 text-amber-800', label: '🟡 amarelo' },
  RED: { cls: 'bg-rose-100 text-rose-800', label: '🔴 vermelho' },
} as const;

const STATUS_BADGE = {
  PENDING: { cls: 'bg-amber-100 text-amber-800', label: 'pendente' },
  APPROVED: { cls: 'bg-blue-100 text-blue-800', label: 'aprovada' },
  REJECTED: { cls: 'bg-navy-50 text-navy/60', label: 'rejeitada' },
  AWAITING_PHYSICAL: { cls: 'bg-purple-100 text-purple-800', label: 'aguardando físico' },
  EXECUTED: { cls: 'bg-emerald-100 text-emerald-800', label: 'executada' },
  FAILED: { cls: 'bg-rose-100 text-rose-800', label: 'falhou' },
} as const;

export default async function DecisionsPage() {
  const [pending, approved, awaitingPhysical, recent] = await Promise.all([
    prisma.decision.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' } }),
    prisma.decision.findMany({ where: { status: 'APPROVED' }, orderBy: { createdAt: 'desc' } }),
    prisma.decision.findMany({ where: { status: 'AWAITING_PHYSICAL' }, orderBy: { createdAt: 'desc' } }),
    prisma.decision.findMany({
      where: { status: { in: ['EXECUTED', 'REJECTED', 'FAILED'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  const totalAction = pending.length + approved.length + awaitingPhysical.length;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-navy">Decisões</h1>
        <p className="mt-1 text-sm text-navy/60">
          Toda ação proposta pelo Vendetti vira uma Decision. Aprovações, execução e confirmação física passam por aqui.
          {totalAction > 0 && <strong className="ml-2 text-navy">{totalAction} esperando ação.</strong>}
        </p>
      </header>

      {pending.length > 0 && (
        <Section title="🟡 Pendentes — sua aprovação" count={pending.length}>
          {pending.map((d) => (
            <PendingCard key={d.id} d={d} />
          ))}
        </Section>
      )}

      {approved.length > 0 && (
        <Section title="🚀 Aprovadas — prontas pra executar" count={approved.length}>
          {approved.map((d) => (
            <ApprovedCard key={d.id} d={d} />
          ))}
        </Section>
      )}

      {awaitingPhysical.length > 0 && (
        <Section title="⏳ Aguardando físico (Weverton)" count={awaitingPhysical.length}>
          {awaitingPhysical.map((d) => (
            <PhysicalCard key={d.id} d={d} />
          ))}
        </Section>
      )}

      {pending.length + approved.length + awaitingPhysical.length === 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-6 text-center">
          <div className="text-3xl">✓</div>
          <p className="mt-2 text-sm text-emerald-900">Nenhuma decisão esperando ação.</p>
        </div>
      )}

      <Section title="Histórico recente" count={recent.length} muted>
        {recent.length === 0 && <p className="text-sm text-navy/45">Sem registros ainda.</p>}
        {recent.map((d) => (
          <HistoryCard key={d.id} d={d} />
        ))}
      </Section>
    </main>
  );
}

type Decision = Awaited<ReturnType<typeof prisma.decision.findMany>>[number];

function Section({ title, count, children, muted }: { title: string; count: number; children: React.ReactNode; muted?: boolean }) {
  return (
    <section className={`mb-8 ${muted ? 'opacity-90' : ''}`}>
      <h2 className="mb-3 text-lg font-semibold text-navy">
        {title} <span className="text-navy/45">· {count}</span>
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function DecisionHeader({ d }: { d: Decision }) {
  const level = LEVEL_BADGE[d.level as keyof typeof LEVEL_BADGE];
  const status = STATUS_BADGE[d.status as keyof typeof STATUS_BADGE];
  return (
    <header className="flex flex-wrap items-baseline gap-2">
      <span className="font-mono text-[10px] text-navy/40">{d.id.slice(0, 10)}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${level.cls}`}>{level.label}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status.cls}`}>{status.label}</span>
      <span className="text-[10px] text-navy/40">{d.kind}</span>
      <span className="ml-auto text-[10px] text-navy/40">
        {new Date(d.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
      </span>
    </header>
  );
}

function PendingCard({ d }: { d: Decision }) {
  return (
    <article className="rounded-lg border border-amber-200 bg-amber-50/30 p-4">
      <DecisionHeader d={d} />
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
      <DecisionHeader d={d} />
      <h3 className="mt-2 font-semibold text-navy">{d.summary}</h3>
      <p className="mt-1 whitespace-pre-wrap text-xs text-navy/70">{d.rationale}</p>
      <p className="mt-2 text-[11px] text-blue-900/70">
        ℹ Clicar "Executar" dispara o scraper agora (browser headless, ~30-60s). Aguarde o load completar.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={executeDecisionAction.bind(null, d.id)}>
          <button className="rounded bg-navy px-4 py-1.5 text-sm font-semibold text-white hover:bg-navy-900">
            🚀 Executar
          </button>
        </form>
        <form action={rejectDecision} className="flex items-center gap-2">
          <input type="hidden" name="id" value={d.id} />
          <input type="hidden" name="reason" value="rejeitada após aprovação" />
          <button className="rounded border border-rose-300 px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-50">
            cancelar
          </button>
        </form>
      </div>
    </article>
  );
}

function PhysicalCard({ d }: { d: Decision }) {
  return (
    <article className="rounded-lg border border-purple-200 bg-purple-50/30 p-4">
      <DecisionHeader d={d} />
      <h3 className="mt-2 font-semibold text-navy">{d.summary}</h3>
      <p className="mt-1 whitespace-pre-wrap text-xs text-navy/70">{d.rationale}</p>
      <p className="mt-2 text-[11px] text-purple-900/80">
        ℹ️ Sistema atualizado. Aguardando Weverton ajustar fisicamente. Quando ele confirmar no grupo, clique "Confirmar físico" — webhook automático vem depois.
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

function HistoryCard({ d }: { d: Decision }) {
  return (
    <article className="rounded border border-navy/10 bg-white p-3 text-xs">
      <DecisionHeader d={d} />
      <div className="mt-1 text-navy/85">{d.summary}</div>
      {d.rejectReason && <div className="mt-1 text-rose-700/70">motivo: {d.rejectReason}</div>}
    </article>
  );
}
