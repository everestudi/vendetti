import Link from 'next/link';
import { getLatestSnapshot } from '@/lib/vendetti/mara/analytics';
import { getSlotsWithMargin } from '@/lib/vendetti/mara/slots-with-margin';
import { VendingMachineLive } from '@/components/VendingMachineLive';
import { SprintProgress } from '@/components/SprintProgress';
import { IdeasBox } from '@/components/IdeasBox';
import { HomeDashboard } from '@/components/HomeDashboard';
import { TEAM, avatarUrl } from '@/lib/agents/team';
import { getMonthlyRevenueSeries, getSyncStatus, getPendingByAgent } from '@/lib/dashboard';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const [snap, slots, revenueSeries, syncStatus, pending] = await Promise.all([
    getLatestSnapshot(),
    getSlotsWithMargin(),
    getMonthlyRevenueSeries(12),
    getSyncStatus(),
    getPendingByAgent(),
  ]);

  const capacityPct = snap?.capacityFilledPct ? Number(snap.capacityFilledPct) : 0;
  const critical = snap?.slotsCritical ?? 0;
  const total = snap?.slotsTotal ?? slots.length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      {/* DASHBOARD OPERACIONAL */}
      <HomeDashboard revenueSeries={revenueSeries} syncStatus={syncStatus} pending={pending} />

      {/* HERO */}
      <section className="mb-8">
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-gold">
          inspirado no Project Vend · Anthropic
        </div>
        <h1 className="text-4xl font-bold leading-tight text-navy lg:text-5xl">
          Vendetti O CEO da minha vending machine
        </h1>
        <p className="mt-3 max-w-3xl text-lg text-navy/70">
          Um time de 6 agentes (Claude Opus 4.7) operando uma Vending Machine (FLEX COMBO 6G) no Blue
          Mall Rondon: análise de dados, compras, atendimento, operações de campo, oversight e
          orquestração.
        </p>
        <div className="mt-5 max-w-3xl space-y-3 text-sm leading-relaxed text-navy/65">
          <p>
            O caminho até aqui mistura várias técnicas. O sistema do fornecedor da máquina
            (Vendpago/Vendtef) não tem API pública — então a <strong className="text-navy/80">Mara</strong> e a{' '}
            <strong className="text-navy/80">Rita</strong> usam <strong className="text-navy/80">Playwright</strong>{' '}
            (browser headless) pra logar no ERP, baixar relatórios de vendas/cancelamentos em CSV,
            preencher tabelas e dar entrada de estoque na pele de um humano.
          </p>
          <p>
            O <strong className="text-navy/80">Bruno</strong> lê NF-e em foto ou PDF usando o vision
            do Claude Opus 4.7: extrai fornecedor, itens, qty e custo, faz fuzzy match com os SKUs
            já cadastrados, rateia desconto Assaí proporcionalmente e grava no banco. Depois, um{' '}
            <strong className="text-navy/80">GitHub Action</strong> disparado pelo Vercel sobe um runner
            com Playwright pra sincronizar a entrada no Vendtef — cadastrando produto novo se preciso —
            sem depender do meu Mac estar ligado.
          </p>
          <p>
            A <strong className="text-navy/80">Lúcia</strong> roda uma state machine de SAC ligada
            ao WhatsApp via <strong className="text-navy/80">Z-API</strong>: cliente reclama, ela pede o
            print, pede o número do slot, e escala pra mim com tudo organizado. Outbound também sai por
            ali — alertas pro grupo &ldquo;Operação TCN Vending Machine&rdquo; e mensagens pro Weverton, o
            zelador que abastece a máquina fisicamente.
          </p>
          <p>
            Segurança: secrets cifrados <strong className="text-navy/80">AES-256-GCM</strong> no Postgres
            (Neon), session cookies <strong className="text-navy/80">HMAC-SHA256</strong> via Web Crypto API.
            Tudo open-source em <a href="https://github.com/everestudi/vendetti" className="text-navy underline hover:text-gold">github.com/everestudi/vendetti</a>.
          </p>
        </div>
      </section>

      {/* TIME */}
      <section className="mt-12">
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
              <div className="mt-2 text-sm font-semibold text-navy">{a.id === 'vendetti' ? (a.fullName ?? a.name) : a.name}</div>
              <div className="text-[10px] uppercase tracking-wide text-navy/50">{a.role.split(' · ')[0].split('/')[0].trim()}</div>
              {a.status === 'active' && <span className="mt-1 text-[10px] text-emerald-600">🟢 ativo</span>}
              {a.status === 'building' && <span className="mt-1 text-[10px] text-amber-600">🟡 em build</span>}
              {a.status === 'planned' && <span className="mt-1 text-[10px] text-navy/40">⚪ planejado</span>}
            </Link>
          ))}
        </div>
      </section>

      {/* MÁQUINA INTERATIVA */}
      <section className="mt-12 rounded-2xl border border-navy/10 bg-gradient-to-br from-navy-50 to-white p-6">
        <header className="mb-4">
          <h2 className="text-2xl font-bold text-navy">A máquina, ao vivo</h2>
          <p className="text-sm text-navy/60">
            Passe o mouse num slot pra ver detalhes · clique pra abrir no <Link href="/mara" className="font-semibold text-navy underline">dashboard da Mara</Link>
          </p>
        </header>

        <VendingMachineLive slots={slots} capacityPct={capacityPct} slotsCritical={critical} slotsTotal={total} />

        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/chat" className="rounded bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-900">
            Conversar com Vendetti →
          </Link>
          <Link href="/mara" className="rounded border border-navy/20 px-4 py-2 text-sm font-semibold text-navy hover:bg-navy-50">
            Ver dashboard da Mara →
          </Link>
          <Link href="/equipe/rita" className="rounded border border-navy/20 px-4 py-2 text-sm font-semibold text-navy hover:bg-navy-50">
            Operações da Rita →
          </Link>
        </div>
      </section>

      {/* EVOLUÇÃO */}
      <section className="mt-14">
        <header className="mb-4">
          <h2 className="text-2xl font-bold text-navy">Evolução do projeto</h2>
          <p className="text-sm text-navy/60">7 sprints — Foundation → Ideias futuras</p>
        </header>
        <SprintProgress />
      </section>

      {/* IDEIAS */}
      <IdeasBox />

      {/* INSPIRAÇÃO */}
      <section className="mt-14 rounded-lg border border-gold/30 bg-gold-50 p-6">
        <h2 className="text-lg font-semibold text-navy">Inspiração — Project Vend Phase 2 (Anthropic)</h2>
        <p className="mt-2 text-sm text-navy/75">
          A Anthropic rodou um experimento onde o Claude operou uma vending machine no escritório deles ("Claudius").
          Phase 1 deu prejuízo. Phase 2 acertou com modelo melhor (Sonnet 4.5), procedimentos forçados, e
          arquitetura de 3 camadas (agente + oversight + escalação humana). Vendetti aplica essas 3 lições desde o
          dia zero.
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

