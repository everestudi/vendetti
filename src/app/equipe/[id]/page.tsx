import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TEAM, avatarUrl, type Agent } from '@/lib/agents/team';
import { VendingMachineLive } from '@/components/VendingMachineLive';
import { getSlotsWithMargin } from '@/lib/vendetti/mara/slots-with-margin';
import { getLatestSnapshot } from '@/lib/vendetti/mara/analytics';
import { AgentTerminal } from '@/components/AgentTerminal';
import type { AgentScope } from '@/lib/agent-log';
import { ZeldaSection } from '../zelda-section';

export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return TEAM.map((a) => ({ id: a.id }));
}

const STATUS = {
  active: { label: '🟢 Ativo', cls: 'bg-emerald-100 text-emerald-800' },
  building: { label: '🟡 Em construção', cls: 'bg-amber-100 text-amber-800' },
  planned: { label: '⚪ Planejado', cls: 'bg-navy-50 text-navy/60' },
} as const;

const COLOR_RING: Record<Agent['color'], string> = {
  navy: 'ring-navy/30',
  gold: 'ring-gold/40',
  emerald: 'ring-emerald-400/40',
  rose: 'ring-rose-400/40',
  amber: 'ring-amber-400/40',
  sky: 'ring-sky-400/40',
};
const COLOR_TEXT: Record<Agent['color'], string> = {
  navy: 'text-navy',
  gold: 'text-gold-900',
  emerald: 'text-emerald-700',
  rose: 'text-rose-700',
  amber: 'text-amber-700',
  sky: 'text-sky-700',
};

/// Mapa agent.id → scope do agent-log. Nem todo agente tem feed direto (ainda).
const AGENT_SCOPE: Record<string, AgentScope | undefined> = {
  vendetti: 'vendetti',
  mara: 'mara',
  bruno: 'bruno',
  lucia: 'lucia',
  rita: 'rita',
  zelda: 'zelda',
};

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = TEAM.find((a) => a.id === id);
  if (!agent) notFound();

  const supervisor = agent.reportsTo ? TEAM.find((a) => a.id === agent.reportsTo) : null;
  const subordinates = TEAM.filter((a) => a.reportsTo === agent.id);
  const status = STATUS[agent.status];

  // Rita ganha a visão da máquina (operações = dela)
  const isRita = agent.id === 'rita';
  const ritaData = isRita
    ? await Promise.all([getSlotsWithMargin(), getLatestSnapshot()]).then(([slots, snap]) => ({
        slots,
        capacityPct: snap?.capacityFilledPct ? Number(snap.capacityFilledPct) : 0,
        critical: snap?.slotsCritical ?? 0,
        total: snap?.slotsTotal ?? slots.length,
      }))
    : null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <nav className="mb-6 text-sm">
        <Link href="/equipe" className="text-navy/60 hover:text-navy">← voltar pra equipe</Link>
      </nav>

      {/* Header */}
      <header className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl(agent, 192)}
          alt={agent.name}
          width={160}
          height={160}
          className={`rounded-full ring-4 ${COLOR_RING[agent.color]}`}
        />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className={`text-4xl font-bold ${COLOR_TEXT[agent.color]}`}>{agent.id === 'vendetti' ? (agent.fullName ?? agent.name) : agent.name}</h1>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.cls}`}>{status.label}</span>
          </div>
          <p className={`mt-1 text-lg font-medium ${COLOR_TEXT[agent.color]} opacity-80`}>{agent.role}</p>
          <p className="mt-2 text-base italic text-navy/60">"{agent.tagline}"</p>
          {agent.fullName && (
            <p className="mt-1 text-xs text-navy/45">Nome formal: <strong>{agent.fullName}</strong></p>
          )}
        </div>
      </header>

      {/* Backstory — quem é a Zelda/Rita/etc */}
      <section className="mt-8 rounded-lg border border-gold/30 bg-gold-50 p-6">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gold-900">
          <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 14a6 6 0 110-12 6 6 0 010 12z M9 7h2v6H9z M9 5h2v1.5H9z" /></svg>
          {agent.origin}
        </div>
        <p className="text-base leading-relaxed text-navy/85 italic">"{agent.backstory}"</p>
        <div className="mt-3 text-[10px] text-navy/40">
          (persona ficcional — todos os agentes são instâncias do Claude Opus 4.7 com prompts diferentes)
        </div>
      </section>

      {/* O que faz profissionalmente */}
      <section className="mt-6 rounded-lg border border-navy/10 bg-white p-6">
        <h2 className="text-base font-semibold uppercase tracking-wide text-navy/50">No trabalho</h2>
        <p className="mt-2 text-base leading-relaxed text-navy/85">{agent.description}</p>
      </section>

      {/* O que faz + Ferramentas */}
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <section className="rounded-lg border border-navy/10 bg-white p-6">
          <h2 className="text-base font-semibold uppercase tracking-wide text-navy/50">Responsabilidades</h2>
          <ul className="mt-3 space-y-2 text-sm text-navy/80">
            {agent.responsibilities.map((r) => (
              <li key={r} className="flex items-start gap-2">
                <span className="text-navy/30">·</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-navy/10 bg-white p-6">
          <h2 className="text-base font-semibold uppercase tracking-wide text-navy/50">Ferramentas</h2>
          <ul className="mt-3 space-y-1.5 font-mono text-xs text-navy/70">
            {agent.tools.map((t) => (
              <li key={t}>· {t}</li>
            ))}
          </ul>
        </section>
      </div>

      {/* Visão da máquina — só pra Rita */}
      {isRita && ritaData && (
        <section className="mt-8 rounded-2xl border-2 border-rose-200 bg-gradient-to-br from-rose-50 to-white p-6">
          <header className="mb-4">
            <h2 className="text-xl font-bold text-navy">A máquina, no chão de fábrica</h2>
            <p className="text-sm text-navy/60">
              Visão operacional da Rita. Cada slot mostra produto e status — clique pra abrir o detalhe no dashboard da Mara.
            </p>
          </header>
          <VendingMachineLive
            slots={ritaData.slots}
            capacityPct={ritaData.capacityPct}
            slotsCritical={ritaData.critical}
            slotsTotal={ritaData.total}
          />
        </section>
      )}

      {/* Zelda · oversight loop */}
      {agent.id === 'zelda' && <ZeldaSection />}

      {/* Terminal — log de eventos do agente */}
      {AGENT_SCOPE[agent.id] && (
        <AgentTerminal scope={AGENT_SCOPE[agent.id]!} agentLabel={`${agent.name} · ${agent.role.split('·')[0].trim()}`} />
      )}

      {/* Hierarquia */}
      {(supervisor || subordinates.length > 0) && (
        <section className="mt-6 rounded-lg border border-navy/10 bg-white p-6">
          <h2 className="text-base font-semibold uppercase tracking-wide text-navy/50">Hierarquia</h2>
          {supervisor && (
            <p className="mt-2 text-sm text-navy/75">
              Reporta a:{' '}
              <Link href={`/equipe/${supervisor.id}`} className="font-semibold text-navy hover:underline">
                {supervisor.name}
              </Link>{' '}
              ({supervisor.role})
            </p>
          )}
          {subordinates.length > 0 && (
            <div className="mt-3">
              <div className="text-xs uppercase tracking-wide text-navy/45">Coordena</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {subordinates.map((sub) => (
                  <Link
                    key={sub.id}
                    href={`/equipe/${sub.id}`}
                    className="inline-flex items-center gap-2 rounded-full border border-navy/15 bg-navy-50 px-3 py-1 text-xs font-medium text-navy hover:bg-navy/10"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={avatarUrl(sub, 48)} alt={sub.name} className="h-5 w-5 rounded-full" />
                    {sub.name} · {sub.role.split(' · ')[0].split('/')[0].trim()}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
