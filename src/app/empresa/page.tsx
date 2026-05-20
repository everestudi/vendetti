/**
 * /empresa — feed live de mensagens entre os agentes Vendetti.
 *
 * UI substituta da página teatro `/equipe` antiga. Aqui você "vê a empresa
 * conversando": cada AgentMessage é renderizado em ordem cronológica decrescente,
 * com origem/destino, kind (NOTE/INSIGHT/REQUEST/ALERT/PROPOSAL), e link pra
 * AgentRun que gerou.
 *
 * Sidebar: lista dos 7 agentes com status (idle, running, budget-stopped) e
 * gasto USD do mês.
 *
 * Refresh: revalidate a cada 10s (poll simples por enquanto; PR 3 adiciona SSE).
 */

import Link from 'next/link';
import { prisma } from '@/lib/db';
import { EmpresaFeed } from '@/components/EmpresaFeed';
import { PanicButton } from '@/components/PanicButton';
import { ChatVendetti } from '@/components/ChatVendetti';
import { PendingApprovals } from '@/components/PendingApprovals';
import { WakeupQueueBadge } from '@/components/WakeupQueueBadge';

export const dynamic = 'force-dynamic';
export const revalidate = 10;

export default async function EmpresaPage() {
  const [agents, recentMessages, recentRuns, totalSpent, pendingDecisions] = await Promise.all([
    prisma.agent.findMany({
      where: { active: true },
      orderBy: { slug: 'asc' },
      include: {
        _count: { select: { runs: true, messagesFrom: true, messagesTo: true } },
      },
    }),
    prisma.agentMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        fromAgent: { select: { slug: true, name: true, emoji: true } },
        toAgent: { select: { slug: true, name: true, emoji: true } },
      },
    }),
    prisma.agentRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
      include: { agent: { select: { slug: true, name: true, emoji: true } } },
    }),
    prisma.agent.aggregate({
      where: { active: true },
      _sum: { spentUsdMonth: true, budgetUsdMonth: true },
    }),
    // Decisions PENDING — inclui `data` pra renderizar outbound msg com body completo
    prisma.decision.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, kind: true, level: true, summary: true, rationale: true, createdAt: true, data: true },
    }),
  ]);

  // Wakeups QUEUED + último cron run pra mostrar status da fila visualmente
  const [queuedWakeups, oldestQueued, lastCronTick] = await Promise.all([
    prisma.agentWakeupRequest.count({ where: { status: 'QUEUED' } }),
    prisma.agentWakeupRequest.findFirst({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      include: { agent: { select: { slug: true, name: true, emoji: true } } },
    }),
    // Último workflow GH agents-tick que rodou
    prisma.workerRun.findFirst({
      where: { name: { in: ['agents_tick', 'mara_sync'] } },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true, name: true },
    }),
  ]);

  const spent = Number(totalSpent._sum.spentUsdMonth ?? 0);
  const budget = Number(totalSpent._sum.budgetUsdMonth ?? 0);
  const spentPct = budget > 0 ? (spent / budget) * 100 : 0;

  // Status do botão de pânico — empresa pausada se TODOS os ativos tão paused.
  const pausedCount = agents.filter((a) => a.paused).length;
  const isPanicNow = agents.length > 0 && pausedCount === agents.length;
  const firstPausedReason = agents.find((a) => a.paused)?.pausedReason ?? null;

  // Bootstrap empty state — se não tem agentes seedados ainda
  if (agents.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold text-navy">🏢 Empresa Vendetti</h1>
        <div className="mt-6 rounded-2xl border-2 border-dashed border-navy/25 bg-white p-8 text-center">
          <p className="text-lg font-semibold text-navy">Nenhum agente no DB ainda.</p>
          <p className="mt-3 text-sm text-navy/65">
            Rode <code className="rounded bg-navy/5 px-1.5 py-0.5 font-mono">npm run seed:agents</code> pra popular
            os 7 agentes iniciais (Augusto, Mara, Bruno, Zelda, Rita, Lúcia, Gabi).
          </p>
          <p className="mt-2 text-xs text-navy/45">
            Antes disso, certifique que a migration Prisma rodou:{' '}
            <code className="rounded bg-navy/5 px-1.5 py-0.5 font-mono">npm run db:push</code>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className={`mx-auto max-w-7xl px-4 py-8 ${isPanicNow ? 'pt-16' : ''}`}>
      {/* Banner fixo no topo quando empresa tá em panic */}
      {isPanicNow && (
        <PanicButton
          isPanicNow={true}
          pausedCount={pausedCount}
          totalActive={agents.length}
          pausedReason={firstPausedReason}
        />
      )}

      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-navy">🏢 Empresa Vendetti</h1>
          <p className="mt-1 text-sm text-navy/65">
            {agents.length} agentes · {pausedCount > 0 ? `${pausedCount} pausados · ` : ''}feed ao vivo ·{' '}
            <Link href="/" className="underline hover:text-navy">voltar à home</Link>
          </p>
        </div>
        <div className="flex items-start gap-3">
          {/* Budget global */}
          <div className="rounded-lg border border-navy/15 bg-white px-4 py-2 text-right">
            <div className="text-[10px] uppercase tracking-wide text-navy/55">Gasto do mês</div>
            <div className="font-mono text-lg font-bold text-navy">
              ${spent.toFixed(2)} <span className="text-xs font-normal text-navy/55">/ ${budget.toFixed(0)}</span>
            </div>
            <div className="mt-1 h-1.5 w-32 overflow-hidden rounded bg-navy/10">
              <div
                className={`h-full ${spentPct > 80 ? 'bg-rose-500' : spentPct > 50 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                style={{ width: `${Math.min(100, spentPct)}%` }}
              />
            </div>
          </div>
          {/* Botão de pânico — só renderiza versão idle se NÃO tá em panic já (banner cobre) */}
          {!isPanicNow && (
            <PanicButton
              isPanicNow={false}
              pausedCount={pausedCount}
              totalActive={agents.length}
            />
          )}
        </div>
      </header>

      {/* WAKEUPS PENDENTES — badge laranja quando há fila aguardando cron */}
      {queuedWakeups > 0 && (
        <div className="mb-4">
          <WakeupQueueBadge
            queuedCount={queuedWakeups}
            oldestQueued={
              oldestQueued
                ? {
                    createdAt: oldestQueued.createdAt.toISOString(),
                    agentSlug: oldestQueued.agent?.slug ?? null,
                    agentName: oldestQueued.agent?.name ?? null,
                    agentEmoji: oldestQueued.agent?.emoji ?? null,
                  }
                : null
            }
          />
        </div>
      )}

      {/* PENDENTES DE APROVAÇÃO — só Decisions com ação concreta (aprovar/rejeitar/executar).
          Perguntas/notas do Augusto ficam no chat e no feed, não aqui. */}
      {pendingDecisions.length > 0 && (
        <div className="mb-6">
          <PendingApprovals
            pendingDecisions={pendingDecisions.map((d) => {
              const data = (d.data ?? {}) as Record<string, unknown>;
              const outbound = data.outboundMessage as
                | { channel?: string; body?: string; proposedBy?: string }
                | undefined;
              return {
                id: d.id,
                kind: d.kind,
                level: d.level,
                summary: d.summary,
                rationale: d.rationale,
                createdAt: d.createdAt.toISOString(),
                outboundMessage:
                  outbound?.body && outbound.channel
                    ? { channel: outbound.channel, body: outbound.body, proposedBy: outbound.proposedBy }
                    : null,
              };
            })}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Sidebar agentes */}
        <aside className="space-y-2">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-navy/55">Agentes ativos</h2>
          {agents.map((a) => {
            const spentA = Number(a.spentUsdMonth);
            const budgetA = Number(a.budgetUsdMonth);
            const spentAPct = budgetA > 0 ? (spentA / budgetA) * 100 : 0;
            const blocked = spentAPct >= 100;
            return (
              <div
                key={a.id}
                className={`rounded-lg border p-3 transition ${
                  blocked ? 'border-rose-300 bg-rose-50/50' : 'border-navy/15 bg-white hover:border-navy/30'
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl leading-none">{a.emoji}</span>
                    <span className="font-bold text-navy">{a.name}</span>
                  </div>
                  {blocked && (
                    <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-800">
                      budget
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-wide text-navy/45">{a.role.slice(0, 60)}</div>
                <div className="mt-2 flex items-baseline justify-between text-[10px]">
                  <span className="font-mono text-navy/65">
                    ${spentA.toFixed(2)} <span className="text-navy/35">/ ${budgetA.toFixed(0)}</span>
                  </span>
                  <span className="text-navy/45">
                    {a._count.runs} runs · {a._count.messagesFrom + a._count.messagesTo} msgs
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded bg-navy/10">
                  <div
                    className={`h-full ${spentAPct > 80 ? 'bg-rose-500' : spentAPct > 50 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(100, spentAPct)}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <code className="rounded bg-navy/5 px-1.5 py-0.5 text-[9px] font-mono text-navy/55">
                    {a.model.replace('claude-', '')}
                  </code>
                  <span className="text-[9px] text-navy/45">v{a.promptRev}</span>
                  {a.humanInLoop && (
                    <span
                      className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-800"
                      title="Toda ação concreta desse agente espera aprovação do Luís"
                    >
                      🙋 you-approve
                    </span>
                  )}
                  {a.paused && (
                    <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-800">
                      ⏸ pausado
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Recent runs mini-list */}
          <div className="mt-6">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-navy/55">Últimas runs</h2>
            {recentRuns.length === 0 ? (
              <div className="rounded border border-dashed border-navy/20 p-3 text-center text-xs text-navy/45">
                Sem runs ainda — dispare wakeup pra começar
              </div>
            ) : (
              <div className="space-y-1">
                {recentRuns.map((r) => (
                  <div key={r.id} className="rounded border border-navy/10 bg-white px-2 py-1.5 text-[11px]">
                    <div className="flex items-baseline justify-between">
                      <span className="font-semibold text-navy">
                        {r.agent.emoji} {r.agent.name}
                      </span>
                      <span
                        className={
                          r.status === 'COMPLETED'
                            ? 'text-emerald-700'
                            : r.status === 'FAILED'
                              ? 'text-rose-700'
                              : 'text-amber-700'
                        }
                      >
                        {r.status === 'COMPLETED' ? '✓' : r.status === 'FAILED' ? '✗' : '·'}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-baseline justify-between text-[9px] text-navy/45">
                      <span>{r.trigger}</span>
                      <span className="font-mono">${Number(r.costUsd).toFixed(4)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Coluna principal: Chat Augusto no topo, Feed embaixo */}
        <section className="space-y-6">
          {/* Chat com Augusto — embedded compact (480px) */}
          <div className="rounded-2xl border-2 border-navy/15 bg-white p-4 shadow-sm">
            <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold text-navy">🎩 Augusto · CEO interim</h2>
              <span className="text-[11px] text-navy/45">
                fala direto · Enter envia · Shift+Enter quebra linha
              </span>
            </header>
            <ChatVendetti compact hideHeader />
          </div>

          {/* Feed da empresa */}
          <div>
            <header className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-bold text-navy">💬 Feed da empresa</h2>
              <span className="text-[11px] text-navy/45">
                últimas {recentMessages.length} msgs · refresh a cada 10s
              </span>
            </header>
            <EmpresaFeed
              initialMessages={recentMessages.map((m) => ({
                id: m.id,
                fromSlug: m.fromAgent?.slug ?? null,
                fromName: m.fromAgent?.name ?? 'Luís',
                fromEmoji: m.fromAgent?.emoji ?? '👤',
                toSlug: m.toAgent?.slug ?? null,
                toName: m.toAgent?.name ?? 'broadcast',
                toEmoji: m.toAgent?.emoji ?? '📢',
                kind: m.kind,
                body: m.body,
                status: m.status,
                createdAt: m.createdAt.toISOString(),
                threadId: m.threadId,
              }))}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
