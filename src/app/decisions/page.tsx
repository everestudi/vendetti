import { prisma } from '@/lib/db';
import { approveDecision, rejectDecision, executeDecisionAction, confirmPhysical, updateDecisionItems } from './actions';

export const dynamic = 'force-dynamic';

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

interface WevertonItem {
  slotPosition?: string;
  qty?: number;
  productGuess?: string;
  slotProduct?: string | null;
  matchConfidence?: 'high' | 'mid' | 'low' | 'no-slot';
  targetProduct?: string;
  skip?: boolean;
}

function PendingCard({ d }: { d: Decision }) {
  const data = (d.data ?? {}) as { source?: string; items?: WevertonItem[] };
  const isWeverton = d.kind === 'SYSTEM_INVENTORY_SYNC' && data.source === 'weverton-group';
  const items = isWeverton && Array.isArray(data.items) ? data.items : [];

  return (
    <article className="rounded-lg border border-amber-200 bg-amber-50/30 p-4">
      <DecisionHeader d={d} />
      <h3 className="mt-2 font-semibold text-navy">{d.summary}</h3>
      <p className="mt-1 whitespace-pre-wrap text-xs text-navy/70">{d.rationale}</p>

      {/* Editor de items (só pra Decisions Weverton) */}
      {isWeverton && items.length > 0 && (
        <form action={updateDecisionItems.bind(null, d.id)} className="mt-4 rounded border border-amber-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-navy/60">
              Revisar items ({items.length} slots)
            </h4>
            <button
              type="submit"
              className="rounded border border-navy/20 px-2 py-0.5 text-[11px] font-medium text-navy hover:bg-navy/5"
            >
              💾 Atualizar
            </button>
          </div>
          <p className="mb-3 text-[10px] text-navy/55">
            ⚠️ Items <strong>low/mid</strong> match podem ser troca de produto. Edite "Produto alvo" se o Weverton trocou (ex: slot 56 com Monster Watermelon). Deixe vazio pra não trocar.
            Marque "skip" pra pular um slot sem cancelar a Decision inteira.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-navy/10 text-left text-navy/50">
                  <th className="py-1 pr-2">slot</th>
                  <th className="py-1 pr-2">no Vendtef hoje</th>
                  <th className="py-1 pr-2">Weverton mandou</th>
                  <th className="py-1 pr-2">qty</th>
                  <th className="py-1 pr-2 min-w-[160px]">produto alvo (vazio = sem troca)</th>
                  <th className="py-1 pr-2">match</th>
                  <th className="py-1 pr-2">skip</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const confidence = it.matchConfidence ?? 'no-slot';
                  const cls =
                    confidence === 'high' ? 'bg-emerald-50 text-emerald-700' :
                    confidence === 'mid' ? 'bg-amber-50 text-amber-700' :
                    'bg-rose-50 text-rose-700';
                  const defaultTarget = it.targetProduct ?? (confidence === 'low' ? (it.productGuess ?? '') : '');
                  return (
                    <tr key={i} className={`border-b border-navy/5 ${it.skip ? 'opacity-40' : ''}`}>
                      <td className="py-1 pr-2 font-mono font-semibold text-navy">{it.slotPosition?.padStart(2, '0')}</td>
                      <td className="py-1 pr-2 text-navy/70">{it.slotProduct ?? '—'}</td>
                      <td className="py-1 pr-2 text-navy/70">{it.productGuess ?? '?'}</td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          name={`qty_${i}`}
                          defaultValue={it.qty}
                          min={0}
                          className="w-14 rounded border border-navy/20 px-1 py-0.5 text-right font-mono"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="text"
                          name={`target_${i}`}
                          defaultValue={defaultTarget}
                          placeholder={confidence === 'high' ? 'sem troca' : it.productGuess ?? ''}
                          className="w-full rounded border border-navy/20 px-1 py-0.5"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{confidence}</span>
                      </td>
                      <td className="py-1 pr-2 text-center">
                        <input type="checkbox" name={`skip_${i}`} defaultChecked={it.skip} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>
      )}

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
  const data = (d.data ?? {}) as { source?: string; dispatchedAt?: string };
  const isAsync = d.kind === 'SYSTEM_INVENTORY_SYNC' && data.source === 'weverton-group';
  const dispatched = isAsync && Boolean(data.dispatchedAt);
  const dispatchedAge = dispatched
    ? Math.round((Date.now() - new Date(data.dispatchedAt!).getTime()) / 1000)
    : null;

  return (
    <article className="rounded-lg border border-blue-200 bg-blue-50/30 p-4">
      <DecisionHeader d={d} />
      <h3 className="mt-2 font-semibold text-navy">{d.summary}</h3>
      <p className="mt-1 whitespace-pre-wrap text-xs text-navy/70">{d.rationale}</p>
      {dispatched ? (
        <p className="mt-2 text-[11px] text-blue-900/80">
          🤖 Scraper rodando em GitHub Actions há {dispatchedAge}s. Quando terminar, status muda pra EXECUTED e o
          grupo Operação é notificado (~3-5min). Pode fechar essa aba.
        </p>
      ) : isAsync ? (
        <p className="mt-2 text-[11px] text-blue-900/70">
          ℹ Clicar "Executar" dispara o scraper em GitHub Actions (~3-5min). Você recebe notificação no WhatsApp
          quando terminar.
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-blue-900/70">
          ℹ Clicar "Executar" dispara o scraper agora (browser headless, ~30-60s). Aguarde o load completar.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!dispatched && (
          <form action={executeDecisionAction.bind(null, d.id)}>
            <button className="rounded bg-navy px-4 py-1.5 text-sm font-semibold text-white hover:bg-navy-900">
              🚀 Executar
            </button>
          </form>
        )}
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
