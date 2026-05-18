import Link from 'next/link';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

function monthRange(d: Date) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return { start, end };
}

export default async function BluemallHome() {
  const now = new Date();
  const { start, end } = monthRange(now);

  const [leadsActive, leadsConverted, leadsLost, inquiriesOpen, leadsAll] = await Promise.all([
    prisma.inquiry.count({
      where: {
        category: 'LEAD_LOCACAO',
        leadStage: { notIn: ['CONVERTIDO', 'PERDIDO'] },
      },
    }),
    prisma.inquiry.count({
      where: {
        category: 'LEAD_LOCACAO',
        leadStage: 'CONVERTIDO',
        resolvedAt: { gte: start, lt: end },
      },
    }),
    prisma.inquiry.count({
      where: {
        category: 'LEAD_LOCACAO',
        leadStage: 'PERDIDO',
        resolvedAt: { gte: start, lt: end },
      },
    }),
    prisma.inquiry.count({
      where: {
        category: { not: 'LEAD_LOCACAO' },
        status: { in: ['NEW', 'ACKNOWLEDGED', 'ESCALATED', 'IN_PROGRESS'] },
      },
    }),
    prisma.inquiry.findMany({
      where: { category: 'LEAD_LOCACAO' },
      orderBy: { receivedAt: 'desc' },
      take: 5,
    }),
  ]);

  const monthLabel = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8">
        <div className="text-xs font-semibold uppercase tracking-widest text-emerald-700/70">
          Bluemall Rondon · Uberlândia / MG
        </div>
        <h1 className="mt-2 text-4xl font-bold leading-tight text-emerald-900 lg:text-5xl">
          Portal Bluemall
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-emerald-900/70">
          Gestão do shopping — leads de locação, atendimento aos visitantes,
          comunicação com lojistas. A Lúcia recebe tudo via WhatsApp, classifica
          e organiza por aqui.
        </p>
      </header>

      {/* KPIs */}
      <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          href="/bluemall/leads"
          label="Leads ativos"
          value={leadsActive}
          sub="em qualquer stage menos convertido/perdido"
          tone="emerald"
        />
        <KpiCard
          href="/bluemall/leads"
          label={`Convertidos ${monthLabel}`}
          value={leadsConverted}
          sub="locações fechadas no mês"
          tone="emerald"
        />
        <KpiCard
          href="/bluemall/leads"
          label={`Perdidos ${monthLabel}`}
          value={leadsLost}
          sub="oportunidades não-fechadas"
          tone="rose"
        />
        <KpiCard
          href="/bluemall/atendimento"
          label="Atendimentos abertos"
          value={inquiriesOpen}
          sub="estacionamento + dúvidas gerais"
          tone="amber"
        />
      </section>

      {/* Recent leads preview */}
      <section className="rounded-2xl border border-emerald-200 bg-white p-5">
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-emerald-900">Leads recentes</h2>
          <Link href="/bluemall/leads" className="text-xs text-emerald-700 hover:underline">
            ver funil completo →
          </Link>
        </header>
        {leadsAll.length === 0 ? (
          <p className="text-sm italic text-emerald-900/45">
            Sem leads ainda. Lúcia abre automaticamente quando alguém manda mensagem sobre locação.
          </p>
        ) : (
          <ul className="space-y-2">
            {leadsAll.map((l) => (
              <li
                key={l.id}
                className="flex items-baseline justify-between gap-2 rounded border border-emerald-100 bg-emerald-50/30 px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-emerald-900">{l.customerPhone}</div>
                  {l.subject && (
                    <div className="text-xs italic text-emerald-900/65">{l.subject}</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900">
                    {l.leadStage ?? 'PRE_QUALIFICACAO'}
                  </span>
                  <time className="text-[10px] text-emerald-900/40">
                    {new Date(l.receivedAt).toLocaleDateString('pt-BR')}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 rounded-xl border border-emerald-200/60 bg-white/50 p-5 text-sm text-emerald-900/75">
        <h2 className="mb-2 font-semibold text-emerald-900">Como funciona</h2>
        <p>
          Qualquer mensagem que chega no WhatsApp <strong>+55 11 99871-6386</strong> é
          analisada pela Lúcia (IA). Ela classifica em SAC vending, locação, estacionamento
          ou dúvida geral, responde cordialmente e te avisa por WhatsApp em seguida — sem
          insistir, sem prometer nada que dependa de você.
        </p>
        <p className="mt-2">
          Aqui no portal, você acompanha o funil de leads e pode responder ao cliente
          direto da plataforma — a Lúcia envia em seu nome.
        </p>
      </section>
    </main>
  );
}

function KpiCard({
  href,
  label,
  value,
  sub,
  tone,
}: {
  href: string;
  label: string;
  value: number;
  sub: string;
  tone: 'emerald' | 'amber' | 'rose';
}) {
  const cls = {
    emerald: 'border-emerald-200 bg-emerald-50/40 text-emerald-900',
    amber: 'border-amber-200 bg-amber-50/40 text-amber-900',
    rose: 'border-rose-200 bg-rose-50/40 text-rose-900',
  }[tone];
  return (
    <Link
      href={href}
      className={`rounded-xl border ${cls} px-4 py-3 transition hover:-translate-y-0.5 hover:shadow-sm`}
    >
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-3xl font-bold">{value}</div>
      <div className="mt-1 text-[10px] opacity-60">{sub}</div>
    </Link>
  );
}
