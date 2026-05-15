import Link from 'next/link';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface TimelineEvent {
  at: Date;
  kind: string;
  emoji: string;
  agent: string;
  agentColor: string;
  summary: string;
  detail?: string;
  link?: string;
}

const AGENT_COLOR: Record<string, string> = {
  Vendetti: 'bg-navy text-white',
  Mara: 'bg-gold text-navy-900',
  Rita: 'bg-rose-500 text-white',
  Lúcia: 'bg-sky-500 text-white',
  Bruno: 'bg-emerald-600 text-white',
  Zelda: 'bg-amber-600 text-white',
  Cliente: 'bg-navy/15 text-navy',
  Luís: 'bg-purple-600 text-white',
  Sistema: 'bg-navy/10 text-navy/60',
};

export default async function MonitorPage() {
  const [transactions, decisions, ideas, latestSnapshot, snapshotCount] = await Promise.all([
    prisma.transaction.findMany({ orderBy: { occurredAt: 'desc' }, take: 30, include: { sku: true } }),
    prisma.decision.findMany({ orderBy: { createdAt: 'desc' }, take: 15 }),
    prisma.idea.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.inventorySnapshot.findFirst({ orderBy: { capturedAt: 'desc' } }),
    prisma.inventorySnapshot.count(),
  ]);

  const events: TimelineEvent[] = [];

  for (const t of transactions) {
    const isOk = t.status === 'OK';
    events.push({
      at: t.occurredAt,
      kind: t.status,
      emoji: isOk ? '💰' : '❌',
      agent: 'Cliente',
      agentColor: AGENT_COLOR.Cliente,
      summary: `${isOk ? 'Venda' : 'Cancelamento'} · ${t.sku?.name ?? '(sem SKU)'} · R$ ${Number(t.grossAmount).toFixed(2)}${t.slotPosition ? ` · sel ${t.slotPosition}` : ''}`,
      detail: t.failureReason ?? undefined,
    });
  }

  for (const d of decisions) {
    events.push({
      at: d.createdAt,
      kind: d.status,
      emoji: d.status === 'EXECUTED' ? '✅' : d.status === 'FAILED' ? '⚠️' : d.status === 'AWAITING_PHYSICAL' ? '⏳' : d.status === 'REJECTED' ? '🚫' : '🧠',
      agent: 'Vendetti',
      agentColor: AGENT_COLOR.Vendetti,
      summary: `Decision ${d.level} ${d.status} · ${d.summary}`,
      detail: d.rationale?.slice(0, 240),
      link: '/decisions',
    });
  }

  for (const i of ideas) {
    events.push({
      at: i.createdAt,
      kind: i.status === 'NEW' ? 'IDEA' : 'IDEA_RESOLVED',
      emoji: i.status === 'NEW' ? '💡' : '✓',
      agent: 'Luís',
      agentColor: AGENT_COLOR.Luís,
      summary: `${i.status === 'NEW' ? 'Ideia nova' : 'Ideia resolvida'}: ${i.content.slice(0, 120)}${i.content.length > 120 ? '...' : ''}`,
      detail: i.note ?? undefined,
    });
  }

  if (latestSnapshot) {
    events.push({
      at: latestSnapshot.capturedAt,
      kind: 'SYNC',
      emoji: '🔄',
      agent: 'Mara',
      agentColor: AGENT_COLOR.Mara,
      summary: `Sync Vendtef · ${latestSnapshot.slotsOk}🟢 / ${latestSnapshot.slotsAlert}🟡 / ${latestSnapshot.slotsCritical}🔴 · ${Number(latestSnapshot.capacityFilledPct ?? 0).toFixed(1)}% cap`,
      detail: `snapshot #${snapshotCount}`,
      link: '/mara',
    });
  }

  events.sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <meta httpEquiv="refresh" content="20" />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <header className="mb-6 flex items-baseline justify-between">
          <div>
            <h1 className="text-3xl font-bold text-navy">📡 Monitor</h1>
            <p className="mt-1 text-sm text-navy/60">
              Tempo real · auto-refresh a cada 20s · {events.length} eventos
            </p>
          </div>
          <div className="text-xs text-navy/45">
            atualizado{' '}
            <time dateTime={new Date().toISOString()}>
              {new Date().toLocaleTimeString('pt-BR')}
            </time>
          </div>
        </header>

        <ul className="space-y-2">
          {events.slice(0, 80).map((e, i) => (
            <li key={i} className="flex gap-3 rounded-lg border border-navy/10 bg-white p-3">
              <div className="text-2xl leading-none shrink-0">{e.emoji}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${e.agentColor}`}>
                    {e.agent}
                  </span>
                  <time className="text-[10px] text-navy/40 font-mono">
                    {e.at.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </time>
                  {e.link && (
                    <Link href={e.link} className="ml-auto text-[10px] text-navy/40 hover:text-navy">
                      ver →
                    </Link>
                  )}
                </div>
                <div className="mt-1 text-sm text-navy/85">{e.summary}</div>
                {e.detail && (
                  <div className="mt-1 text-xs text-navy/50 italic line-clamp-2">{e.detail}</div>
                )}
              </div>
            </li>
          ))}
        </ul>

        {events.length === 0 && (
          <div className="rounded-lg border border-dashed border-navy/20 p-12 text-center text-sm text-navy/45">
            ainda sem eventos. comece pelo <Link href="/chat" className="underline">chat</Link> ou rode <code>npm run mara:sync</code>
          </div>
        )}

        <p className="mt-8 text-center text-xs text-navy/40">
          📝 versão temporária — quando tools instrumentadas (call logs), eventos vão ficar muito mais detalhados
        </p>
      </main>
    </>
  );
}
