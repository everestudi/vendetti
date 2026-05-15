import Link from 'next/link';
import { TEAM, CEO, SUB_AGENTS, avatarUrl, type Agent } from '@/lib/agents/team';

export const dynamic = 'force-static';

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

export default function TeamPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold text-navy">Time Vendetti</h1>
        <p className="mt-2 text-navy/60">
          {TEAM.length} agentes pra operar a máquina. <strong>{CEO.name}</strong> orquestra os {SUB_AGENTS.length} sub-agentes.
        </p>
      </header>

      {/* CEO em destaque */}
      <section className="mb-6 flex justify-center">
        <AgentCard agent={CEO} featured />
      </section>

      {/* Linha-guia decorativa */}
      <div className="relative mx-auto mb-8 h-12 max-w-4xl">
        <svg className="h-full w-full" viewBox="0 0 800 48" preserveAspectRatio="none" aria-hidden>
          <line x1="400" y1="0" x2="100" y2="48" stroke="#1F3864" strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="4 4" />
          <line x1="400" y1="0" x2="300" y2="48" stroke="#1F3864" strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="4 4" />
          <line x1="400" y1="0" x2="500" y2="48" stroke="#1F3864" strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="4 4" />
          <line x1="400" y1="0" x2="700" y2="48" stroke="#1F3864" strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="4 4" />
        </svg>
      </div>

      {/* Sub-agentes em grid (5 agora, 2/3 cols responsivo) */}
      <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {SUB_AGENTS.map((a) => (
          <AgentCard key={a.id} agent={a} />
        ))}
      </section>

      <footer className="mt-12 rounded-lg border border-navy/10 bg-white p-5 text-sm text-navy/70">
        <strong className="text-navy">Como o time funciona:</strong> Vendetti recebe ticks (cron diário, mensagem do Luís via
        chat ou reclamação) e delega para o sub-agente certo. Cada sub-agente tem ferramentas limitadas e segue as policies
        da Zelda. Toda decisão vira registro no decision log com nível 🟢🟡🔴 — o histórico é a memória persistente entre runs.
      </footer>
    </main>
  );
}

function AgentCard({ agent, featured }: { agent: Agent; featured?: boolean }) {
  const status = STATUS[agent.status];
  const ringCls = COLOR_RING[agent.color];
  const textCls = COLOR_TEXT[agent.color];
  const size = featured ? 144 : 88;

  return (
    <Link
      href={`/equipe/${agent.id}`}
      className={`block rounded-2xl border border-navy/10 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-navy/25 hover:shadow-md ${
        featured ? 'w-full max-w-md text-center' : ''
      }`}
    >
      <div className={featured ? 'flex flex-col items-center' : 'flex items-start gap-4'}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl(agent, size)}
          alt={agent.name}
          width={size}
          height={size}
          className={`shrink-0 rounded-full ring-4 ${ringCls} ${featured ? 'mb-4' : ''}`}
        />
        <div className={featured ? '' : 'min-w-0 flex-1'}>
          <div className={`flex items-center gap-2 ${featured ? 'justify-center' : ''}`}>
            <h2 className={`${featured ? 'text-2xl' : 'text-lg'} font-bold ${textCls}`}>{agent.name}</h2>
            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${status.cls}`}>
              {status.label}
            </span>
          </div>
          <p className={`text-sm font-medium ${textCls} opacity-80`}>{agent.role}</p>
          <p className={`mt-1 ${featured ? 'text-sm' : 'text-xs'} italic text-navy/55`}>"{agent.tagline}"</p>
          {agent.fullName && featured && (
            <p className="mt-1 text-xs text-navy/45">Nome formal: {agent.fullName}</p>
          )}
        </div>
      </div>

      <p className={`${featured ? 'mt-5' : 'mt-3'} text-sm leading-relaxed text-navy/75`}>{agent.description}</p>

      <div className={`${featured ? 'mt-3' : 'mt-2'} flex items-center gap-1.5 text-xs text-navy/45`}>
        <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current opacity-60"><circle cx="8" cy="8" r="3" /></svg>
        {agent.origin}
      </div>

      <div className={`mt-4 grid gap-3 ${featured ? 'sm:grid-cols-2' : ''}`}>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-navy/40">O que faz</div>
          <ul className="mt-1 space-y-0.5 text-xs text-navy/70">
            {agent.responsibilities.map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-navy/40">Ferramentas</div>
          <ul className="mt-1 space-y-0.5 text-xs text-navy/55 font-mono">
            {agent.tools.map((t) => (
              <li key={t}>· {t}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 text-right text-xs font-semibold text-navy/40">ver perfil →</div>
    </Link>
  );
}
