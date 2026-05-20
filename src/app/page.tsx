import Link from 'next/link';
import { getLatestSnapshot } from '@/lib/vendetti/mara/analytics';
import { getSlotsWithMargin } from '@/lib/vendetti/mara/slots-with-margin';
import { VendingMachineLive } from '@/components/VendingMachineLive';
import { HomeDashboard } from '@/components/HomeDashboard';
import {
  getMonthlyRevenueSeries,
  getSyncStatus,
  getPendingByAgent,
  getDailyRevenueComparison,
  getAugustoCommentary,
} from '@/lib/dashboard';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ sync?: string; err?: string; images?: string }> }) {
  const params = await searchParams;
  const syncFeedback = params.sync === 'triggered' ? 'triggered' : params.sync === 'failed' ? 'failed' : null;
  const imagesFeedback = params.images ?? undefined;

  const [snap, slots, revenueSeries, syncStatus, pending, dailyComparison, augusto] = await Promise.all([
    getLatestSnapshot(),
    getSlotsWithMargin(),
    getMonthlyRevenueSeries(12),
    getSyncStatus(),
    getPendingByAgent(),
    getDailyRevenueComparison(),
    getAugustoCommentary(),
  ]);

  const capacityPct = snap?.capacityFilledPct ? Number(snap.capacityFilledPct) : 0;
  const critical = snap?.slotsCritical ?? 0;
  const total = snap?.slotsTotal ?? slots.length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {/* Cabeçalho enxuto — detalhes do projeto migraram pra /sobre */}
      <header className="mb-6">
        <h1 className="text-3xl font-bold leading-tight text-navy lg:text-4xl">
          Vendetti · CEO da minha vending machine
        </h1>
        <p className="mt-1 text-sm text-navy/65">
          6 agentes IA operando uma vending no Blue Mall Rondon ·{' '}
          <Link href="/sobre" className="underline hover:text-navy">
            sobre o projeto
          </Link>{' '}
          ·{' '}
          <Link href="/evolucao" className="underline hover:text-navy">
            evolução
          </Link>{' '}
          ·{' '}
          <Link href="/equipe" className="underline hover:text-navy">
            equipe
          </Link>
        </p>
      </header>

      {/* DASHBOARD OPERACIONAL — 3 seções: Faturamento · Augusto CEO · Pendências */}
      <HomeDashboard
        revenueSeries={revenueSeries}
        dailyComparison={dailyComparison}
        syncStatus={syncStatus}
        pending={pending}
        augusto={augusto}
        syncFeedback={syncFeedback}
        syncFeedbackError={params.err}
        imagesFeedback={imagesFeedback}
      />

      {/* MÁQUINA INTERATIVA — visão ao vivo dos slots com badge Everest */}
      <section className="mt-10 rounded-2xl border border-navy/10 bg-gradient-to-br from-navy-50 to-white p-6">
        <header className="mb-4">
          <h2 className="text-2xl font-bold text-navy">A máquina, ao vivo</h2>
          <p className="text-sm text-navy/60">
            Passe o mouse num slot pra ver detalhes (incluindo saldo Everest pra reabastecer) · clique pra
            abrir no <Link href="/mara" className="font-semibold text-navy underline">dashboard da Mara</Link>
          </p>
        </header>

        <VendingMachineLive slots={slots} capacityPct={capacityPct} slotsCritical={critical} slotsTotal={total} />

        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/chat" className="rounded bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-900">
            Conversar com Augusto →
          </Link>
          <Link href="/mara" className="rounded border border-navy/20 px-4 py-2 text-sm font-semibold text-navy hover:bg-navy-50">
            Dashboard Mara →
          </Link>
          <Link href="/equipe/rita" className="rounded border border-navy/20 px-4 py-2 text-sm font-semibold text-navy hover:bg-navy-50">
            Operações Rita →
          </Link>
        </div>
      </section>

      <footer className="mt-10 text-center text-xs text-navy/40">
        Blue Mall Rondon, Uberlândia/MG ·{' '}
        <Link href="/sobre" className="underline hover:text-navy">
          sobre
        </Link>
        {' · '}
        <Link href="/evolucao" className="underline hover:text-navy">
          evolução
        </Link>
        {' · '}
        <a href="https://github.com/everestudi/vendetti" className="underline hover:text-navy">
          github
        </a>
      </footer>
    </main>
  );
}
