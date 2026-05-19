import Link from 'next/link';
import { TEAM, CEO, SUB_AGENTS, avatarUrl, type Agent } from '@/lib/agents/team';

export const dynamic = 'force-static';

const STATUS = {
  active: { label: '🟢 ativo', cls: 'text-emerald-600' },
  building: { label: '🟡 em build', cls: 'text-amber-600' },
  planned: { label: '⚪ planejado', cls: 'text-navy/40' },
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
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold text-navy">Time Vendetti</h1>
        <p className="mt-2 text-sm text-navy/60">
          {TEAM.length} agentes IA pra operar a máquina · <strong>{CEO.name}</strong> orquestra os{' '}
          {SUB_AGENTS.length} sub-agentes. Clique num card pra ver detalhes operacionais ao vivo.
        </p>
      </header>

      {/* CEO em destaque — maior e centralizado */}
      <section className="mb-10 flex justify-center">
        <AgentCard agent={CEO} size="large" />
      </section>

      {/* Linha-guia decorativa */}
      <div className="relative mx-auto mb-6 h-10 max-w-3xl">
        <svg className="h-full w-full" viewBox="0 0 800 40" preserveAspectRatio="none" aria-hidden>
          <line x1="400" y1="0" x2="80" y2="40" stroke="#1F3864" strokeOpacity="0.2" strokeWidth="1.5" strokeDasharray="4 4" />
          <line x1="400" y1="0" x2="240" y2="40" stroke="#1F3864" strokeOpacity="0.2" strokeWidth="1.5" strokeDasharray="4 4" />
          <line x1="400" y1="0" x2="400" y2="40" stroke="#1F3864" strokeOpacity="0.2" strokeWidth="1.5" strokeDasharray="4 4" />
          <line x1="400" y1="0" x2="560" y2="40" stroke="#1F3864" strokeOpacity="0.2" strokeWidth="1.5" strokeDasharray="4 4" />
          <line x1="400" y1="0" x2="720" y2="40" stroke="#1F3864" strokeOpacity="0.2" strokeWidth="1.5" strokeDasharray="4 4" />
        </svg>
      </div>

      {/* Sub-agentes em grid 5 cols (compact) */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {SUB_AGENTS.map((a) => (
          <AgentCard key={a.id} agent={a} size="small" />
        ))}
      </section>

      {/* Como funciona o time */}
      <section className="mt-12 rounded-lg border border-navy/10 bg-white p-5 text-sm text-navy/75">
        <strong className="text-navy">Como o time funciona:</strong> Augusto Vendetti orquestra os sub-agentes. Cada
        sub-agente tem ferramentas limitadas e segue policies. Toda decisão vira registro no decision log
        com nível 🟢🟡🔴 — o histórico é a memória persistente entre runs. Augusto fala com o Luís
        diretamente; os outros agentes trabalham em background (cron, webhook, scraper) ou via UI dedicada.
      </section>
    </main>
  );
}

function AgentCard({ agent, size }: { agent: Agent; size: 'small' | 'large' }) {
  const status = STATUS[agent.status];
  const ringCls = COLOR_RING[agent.color];
  const textCls = COLOR_TEXT[agent.color];

  if (size === 'large') {
    return (
      <Link
        href={`/equipe/${agent.id}`}
        className="group block w-full max-w-sm rounded-2xl border-2 border-navy/15 bg-white p-6 text-center shadow-sm transition hover:scale-105 hover:border-navy/40 hover:shadow-lg"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl(agent, 160)}
          alt={agent.name}
          width={120}
          height={120}
          className={`mx-auto rounded-full ring-4 ${ringCls} transition group-hover:ring-8`}
        />
        <h2 className={`mt-4 text-2xl font-bold ${textCls}`}>{agent.fullName ?? agent.name}</h2>
        <div className={`mt-1 text-sm font-medium ${textCls} opacity-75`}>{agent.role}</div>
        <p className="mt-2 text-xs italic text-navy/55">"{agent.tagline}"</p>
        <span className={`mt-3 inline-block text-xs ${status.cls}`}>{status.label}</span>
        <div className="mt-4 text-[11px] font-semibold text-navy/40 group-hover:text-navy">
          abrir perfil completo →
        </div>
      </Link>
    );
  }

  // Compact card
  return (
    <Link
      href={`/equipe/${agent.id}`}
      className="group flex flex-col items-center rounded-lg border border-navy/10 bg-white p-3 text-center transition hover:scale-110 hover:border-navy/40 hover:shadow-lg hover:z-10"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={avatarUrl(agent, 100)}
        alt={agent.name}
        width={72}
        height={72}
        className={`rounded-full ring-2 ${ringCls} transition group-hover:ring-4`}
      />
      <div className={`mt-2 text-sm font-semibold ${textCls}`}>{agent.name}</div>
      <div className="text-[10px] uppercase tracking-wide text-navy/50">
        {agent.role.split(' · ')[0].split('/')[0].trim()}
      </div>
      <span className={`mt-1 text-[10px] ${status.cls}`}>{status.label}</span>
    </Link>
  );
}
