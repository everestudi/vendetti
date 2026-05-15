import Link from 'next/link';
import { getLatestSnapshot, getSlotCount, getSkuCount } from '@/lib/vendetti/mara/analytics';
import { CartoonMachine } from '@/components/CartoonMachine';
import { SprintProgress } from '@/components/SprintProgress';
import { TEAM, avatarUrl } from '@/lib/agents/team';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const [snap, slots, skus] = await Promise.all([
    getLatestSnapshot(),
    getSlotCount(),
    getSkuCount(),
  ]);

  const capacityPct = snap?.capacityFilledPct ? Number(snap.capacityFilledPct) : 0;
  const critical = snap?.slotsCritical ?? 0;
  const total = snap?.slotsTotal ?? slots;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      {/* HERO */}
      <section className="grid items-center gap-8 lg:grid-cols-[1fr_280px]">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-gold">
            inspirado no Project Vend · Anthropic
          </div>
          <h1 className="text-4xl font-bold leading-tight text-navy lg:text-5xl">
            Vendetti — CEO autônomo da minha vending machine
          </h1>
          <p className="mt-3 text-lg text-navy/70">
            Um time de 6 agentes (Claude Opus 4.7) operando a TCN Pro 6G no Blue Mall Rondon: análise de
            dados, compras, atendimento, operações de campo, oversight e orquestração.
          </p>

          {/* KPIs rápidos */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="SKUs" value={skus} />
            <Kpi label="Slots" value={total} />
            <Kpi label="Capacidade" value={`${capacityPct.toFixed(0)}%`} tone={capacityPct < 40 ? 'red' : capacityPct < 70 ? 'amber' : 'emerald'} />
            <Kpi label="Críticos" value={critical} tone={critical > 0 ? 'red' : 'emerald'} />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/mara" className="rounded bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-900">
              Ver análise da Mara →
            </Link>
            <Link href="/equipe" className="rounded border border-navy/20 px-4 py-2 text-sm font-semibold text-navy hover:bg-navy-50">
              Conhecer o time →
            </Link>
          </div>
        </div>

        <CartoonMachine capacityPct={capacityPct} slotsCritical={critical} slotsTotal={total} online />
      </section>

      {/* TIME — mini-strip de avatares com link */}
      <section className="mt-14">
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="text-2xl font-bold text-navy">O time</h2>
          <Link href="/equipe" className="text-sm text-navy/60 hover:text-navy">
            ver todos →
          </Link>
        </header>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {TEAM.map((a) => (
            <Link
              key={a.id}
              href={`/equipe/${a.id}`}
              className="group flex flex-col items-center rounded-lg border border-navy/10 bg-white p-3 transition hover:-translate-y-1 hover:shadow-md"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarUrl(a, 80)}
                alt={a.name}
                width={64}
                height={64}
                className="rounded-full ring-2 ring-navy/10 transition group-hover:ring-navy/30"
              />
              <div className="mt-2 text-sm font-semibold text-navy">{a.name}</div>
              <div className="text-[10px] uppercase tracking-wide text-navy/50">{a.role.split(' · ')[0].split('/')[0].trim()}</div>
              {a.status === 'active' && <span className="mt-1 text-[10px] text-emerald-600">🟢 ativo</span>}
              {a.status === 'building' && <span className="mt-1 text-[10px] text-amber-600">🟡 em build</span>}
              {a.status === 'planned' && <span className="mt-1 text-[10px] text-navy/40">⚪ planejado</span>}
            </Link>
          ))}
        </div>
      </section>

      {/* EVOLUÇÃO DO PROJETO */}
      <section className="mt-14">
        <header className="mb-4">
          <h2 className="text-2xl font-bold text-navy">Evolução do projeto</h2>
          <p className="text-sm text-navy/60">6 sprints — Foundation → Time completo</p>
        </header>
        <SprintProgress />
      </section>

      {/* INSPIRAÇÃO */}
      <section className="mt-14 rounded-lg border border-gold/30 bg-gold-50 p-6">
        <h2 className="text-lg font-semibold text-navy">Inspiração — Project Vend Phase 2 (Anthropic)</h2>
        <p className="mt-2 text-sm text-navy/75">
          A Anthropic rodou um experimento onde o Claude operou uma vending machine no escritório deles ("Claudius").
          Phase 1 deu prejuízo — alucinações, descontos descontrolados, crise de identidade. Phase 2 acertou com
          modelo melhor (Sonnet 4.5), procedimentos forçados, e arquitetura de 3 camadas (agente + oversight +
          escalação humana). O Vendetti aplica essas 3 lições desde o dia zero.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <a href="https://www.anthropic.com/research/project-vend-1" target="_blank" rel="noopener" className="rounded bg-navy/10 px-2 py-1 text-navy hover:bg-navy/20">
            Phase 1 ↗
          </a>
          <a href="https://www.anthropic.com/research/project-vend-2" target="_blank" rel="noopener" className="rounded bg-navy/10 px-2 py-1 text-navy hover:bg-navy/20">
            Phase 2 ↗
          </a>
        </div>
      </section>

      <footer className="mt-12 text-center text-xs text-navy/40">
        Vendetti · Operação física: Blue Mall Rondon, Uberlândia/MG · Operação remota: SP
      </footer>
    </main>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: 'red' | 'amber' | 'emerald' }) {
  const toneCls = {
    red: 'text-rose-700',
    amber: 'text-amber-700',
    emerald: 'text-emerald-700',
  } as const;
  return (
    <div className="rounded-lg border border-navy/10 bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-navy/50">{label}</div>
      <div className={`text-xl font-bold ${tone ? toneCls[tone] : 'text-navy'}`}>{value}</div>
    </div>
  );
}
