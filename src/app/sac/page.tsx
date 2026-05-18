import { prisma } from '@/lib/db';
import {
  resolveSacComplaint,
  dismissSacWithReason,
  assumeSacComplaint,
} from './actions';
import { TEAM, avatarUrl } from '@/lib/agents/team';
import { AgentTerminal } from '@/components/AgentTerminal';

export const dynamic = 'force-dynamic';

const lucia = TEAM.find((a) => a.id === 'lucia')!;

const STATUS_BADGE = {
  RECEIVED: { cls: 'bg-amber-100 text-amber-800', label: 'recebida' },
  TRIAGE_REJECTED: { cls: 'bg-navy-50 text-navy/45', label: 'triada' },
  AWAITING_PROOF: { cls: 'bg-amber-100 text-amber-800', label: '⏳ aguarda info' },
  AWAITING_SLOT: { cls: 'bg-amber-100 text-amber-800', label: '⏳ aguarda info' },
  AWAITING_INFO: { cls: 'bg-amber-100 text-amber-800', label: '⏳ aguarda info' },
  ESCALATED: { cls: 'bg-purple-100 text-purple-800', label: '🆘 escalada' },
  ASSUMED_BY_LUIS: { cls: 'bg-blue-100 text-blue-800', label: '👤 assumida' },
  REFUNDED: { cls: 'bg-emerald-100 text-emerald-800', label: '✓ reembolsada' },
  DISMISSED: { cls: 'bg-navy-50 text-navy/45', label: 'descartada' },
  ABANDONED: { cls: 'bg-rose-50 text-rose-700', label: '🚪 abandonada' },
} as const;

type Complaint = Awaited<ReturnType<typeof prisma.complaint.findFirst>>;
type ComplaintFull = NonNullable<Complaint>;

interface ConversationEntry {
  from: string;
  at: string;
  text?: string;
  imageUrl?: string;
  audioUrl?: string;
}

function parseConv(raw: unknown): ConversationEntry[] {
  return Array.isArray(raw) ? (raw as ConversationEntry[]) : [];
}

async function fetchHistory(phone: string | null, excludeId: string): Promise<{ count: number; refundedCount: number }> {
  if (!phone) return { count: 0, refundedCount: 0 };
  const [count, refundedCount] = await Promise.all([
    prisma.complaint.count({ where: { customerPhone: phone, id: { not: excludeId } } }),
    prisma.complaint.count({
      where: { customerPhone: phone, status: 'REFUNDED', id: { not: excludeId } },
    }),
  ]);
  return { count, refundedCount };
}

export default async function SacPage() {
  const [escalated, awaiting, assumed, recent] = await Promise.all([
    prisma.complaint.findMany({
      where: { status: 'ESCALATED' },
      orderBy: { escalatedAt: 'desc' },
    }),
    prisma.complaint.findMany({
      where: {
        status: { in: ['AWAITING_INFO', 'AWAITING_PROOF', 'AWAITING_SLOT', 'RECEIVED'] },
      },
      orderBy: { receivedAt: 'desc' },
    }),
    prisma.complaint.findMany({
      where: { status: 'ASSUMED_BY_LUIS' },
      orderBy: { receivedAt: 'desc' },
    }),
    prisma.complaint.findMany({
      where: {
        status: { in: ['REFUNDED', 'DISMISSED', 'ABANDONED', 'TRIAGE_REJECTED'] },
      },
      orderBy: { receivedAt: 'desc' },
      take: 25,
    }),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8 flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl(lucia, 96)}
          alt="Lúcia"
          width={72}
          height={72}
          className="rounded-full ring-4 ring-sky-300/40"
        />
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-navy">SAC Vending · Lúcia</h1>
          <p className="mt-1 text-sm italic text-navy/65">&ldquo;{lucia.tagline}&rdquo;</p>
          <p className="mt-1 text-xs text-navy/45">
            Máximo 4 mensagens por reclamação · escala pro Luís via WhatsApp · cron marca ABANDONED após 2h sem resposta
          </p>
        </div>
      </header>

      {/* KPI cards */}
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="🆘 Escaladas (aguarda você)" value={escalated.length} tone={escalated.length > 0 ? 'purple' : 'neutral'} />
        <Kpi label="⏳ Aguardando info" value={awaiting.length} tone={awaiting.length > 0 ? 'amber' : 'neutral'} />
        <Kpi label="👤 Assumidas por você" value={assumed.length} tone={assumed.length > 0 ? 'blue' : 'neutral'} />
        <Kpi label="Histórico recente" value={recent.length} tone="neutral" />
      </section>

      {escalated.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-purple-900">
            🆘 Escaladas · {escalated.length} esperando sua decisão
          </h2>
          <div className="space-y-3">
            {escalated.map((c) => (
              <EscalatedCard key={c.id} c={c} />
            ))}
          </div>
        </section>
      )}

      {awaiting.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-amber-900">
            ⏳ Aguardando cliente responder · {awaiting.length}
          </h2>
          <div className="space-y-2">
            {awaiting.map((c) => (
              <AwaitingCard key={c.id} c={c} />
            ))}
          </div>
        </section>
      )}

      {assumed.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-blue-900">
            👤 Assumidas por você · {assumed.length}
          </h2>
          <div className="space-y-2">
            {assumed.map((c) => (
              <AssumedCard key={c.id} c={c} />
            ))}
          </div>
        </section>
      )}

      {escalated.length + awaiting.length + assumed.length === 0 && (
        <div className="mb-8 rounded-lg border border-emerald-200 bg-emerald-50/40 p-6 text-center">
          <div className="text-3xl">✓</div>
          <p className="mt-2 text-sm text-emerald-900">Nenhuma reclamação aberta. Lúcia tá tranquila.</p>
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-navy/55">Histórico recente</h2>
        {recent.length === 0 ? (
          <p className="text-xs text-navy/40 italic">sem reclamações resolvidas ainda</p>
        ) : (
          <ul className="space-y-1.5">
            {recent.map((c) => (
              <li key={c.id} className="rounded border border-navy/5 bg-navy-50/30 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <span
                      className={`mr-2 rounded-full px-1.5 py-0.5 text-[10px] ${STATUS_BADGE[c.status as keyof typeof STATUS_BADGE]?.cls ?? 'bg-navy/10'}`}
                    >
                      {STATUS_BADGE[c.status as keyof typeof STATUS_BADGE]?.label ?? c.status}
                    </span>
                    {c.customerPhone ?? '?'} · slot {c.slotPosition ?? '?'}
                  </span>
                  <time className="text-[10px] text-navy/40">
                    {new Date(c.receivedAt).toLocaleDateString('pt-BR')}
                  </time>
                </div>
                {c.resolution && <p className="mt-0.5 italic text-emerald-700/70">→ {c.resolution}</p>}
                {c.refundAmount && (
                  <p className="mt-0.5 text-emerald-700/70">
                    R$ {Number(c.refundAmount).toFixed(2)} reembolsado
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="mt-8 rounded border border-navy/10 bg-navy-50/30 p-4 text-xs">
        <summary className="cursor-pointer font-semibold text-navy/70">📖 Comandos via WhatsApp</summary>
        <p className="mt-2 text-navy/70">Você pode responder o zap da Lúcia direto com:</p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-navy/65">
          <li>
            <code className="rounded bg-white px-1.5 py-0.5">/listar</code> — vê reclamações abertas
          </li>
          <li>
            <code className="rounded bg-white px-1.5 py-0.5">/assumir</code> — Lúcia muta, você fala direto
          </li>
          <li>
            <code className="rounded bg-white px-1.5 py-0.5">/dispensar [razão]</code> — recusa cordial
          </li>
          <li>
            <code className="rounded bg-white px-1.5 py-0.5">/aprovar [valor]</code> — marca REFUNDED (você faz o estorno no PagBank)
          </li>
        </ul>
        <p className="mt-2 text-navy/55">
          Sem #id, aplica na última ESCALATED. Pra direcionar use{' '}
          <code className="rounded bg-white px-1.5 py-0.5">#abc123</code>.
        </p>
      </details>

      <AgentTerminal scope="lucia" agentLabel="Lúcia · SAC + Inquiries" />
    </main>
  );
}

async function EscalatedCard({ c }: { c: ComplaintFull }) {
  const history = await fetchHistory(c.customerPhone, c.id);
  const conv = parseConv(c.conversation);
  return (
    <article className="rounded-2xl border border-purple-200 bg-purple-50/30 p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-bold text-navy">
            📞 {c.customerPhone ?? '(sem telefone)'}
            <span className="ml-2 font-mono text-[10px] text-navy/40">#{c.id.slice(-6)}</span>
          </h3>
          <p className="text-xs text-navy/55">
            slot <strong>{c.slotPosition ?? '?'}</strong> · recebida{' '}
            {new Date(c.receivedAt).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {c.escalatedAt && (
              <>
                {' '}
                · escalada{' '}
                {new Date(c.escalatedAt).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </>
            )}
          </p>
          {history.count > 0 && (
            <p className="mt-0.5 text-xs text-purple-900/75">
              ⚠️ {history.count} reclamação(ões) anterior(es)
              {history.refundedCount > 0 && ` · ${history.refundedCount} reembolsada(s)`}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
            aguarda decisão
          </span>
          {c.transactionMatched != null && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                c.transactionMatched ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {c.transactionMatched ? '✓ venda confirmada no banco' : '✗ sem venda no banco'}
            </span>
          )}
        </div>
      </header>

      <div className="mt-3 rounded bg-white/70 p-3 text-sm">
        <div className="text-[10px] uppercase tracking-wide text-navy/40">cliente reclamou</div>
        <p className="mt-1 italic text-navy/85">
          &ldquo;{c.customerNote.slice(0, 280)}
          {c.customerNote.length > 280 ? '…' : ''}&rdquo;
        </p>
      </div>

      {c.proofUrl && (
        <a
          href={c.proofUrl}
          target="_blank"
          rel="noopener"
          className="mt-2 inline-block text-xs text-purple-700 underline"
        >
          📎 ver comprovante
        </a>
      )}

      {conv.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-navy/55">
            conversa completa ({conv.length} mensagens)
          </summary>
          <ul className="mt-2 space-y-1 text-[11px]">
            {conv.map((e, i) => (
              <li key={i} className="rounded border border-navy/5 bg-white/60 px-2 py-1">
                <span className="font-semibold text-navy/70">{e.from}:</span>{' '}
                <span className="text-navy/80">{(e.text ?? '').slice(0, 200)}</span>
                {e.imageUrl && (
                  <a href={e.imageUrl} target="_blank" rel="noopener" className="ml-1 text-purple-700">
                    [img]
                  </a>
                )}
                {e.audioUrl && (
                  <a href={e.audioUrl} target="_blank" rel="noopener" className="ml-1 text-purple-700">
                    [áudio]
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form action={resolveSacComplaint} className="flex items-center gap-2">
          <input type="hidden" name="id" value={c.id} />
          <input
            type="number"
            step="0.01"
            name="refund"
            placeholder="valor (R$)"
            className="w-24 rounded border border-navy/20 px-2 py-1 text-xs"
          />
          <button className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
            ✓ Marcar reembolsada
          </button>
        </form>
        <form action={assumeSacComplaint.bind(null, c.id)}>
          <button className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            👤 Eu assumo
          </button>
        </form>
        <form action={dismissSacWithReason} className="flex items-center gap-2">
          <input type="hidden" name="id" value={c.id} />
          <input
            type="text"
            name="reason"
            placeholder="motivo"
            className="w-28 rounded border border-navy/20 px-2 py-1 text-xs"
          />
          <button className="rounded border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">
            ✗ Dispensar
          </button>
        </form>
      </div>
    </article>
  );
}

function AwaitingCard({ c }: { c: ComplaintFull }) {
  const status = STATUS_BADGE[c.status as keyof typeof STATUS_BADGE] ?? STATUS_BADGE.AWAITING_INFO;
  const sinceMin = Math.floor((Date.now() - new Date(c.lastClientMessageAt ?? c.receivedAt).getTime()) / 60000);
  return (
    <article className="rounded-lg border border-amber-200 bg-amber-50/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-navy/80">
          📞 {c.customerPhone ?? '?'}{' '}
          <span className="text-navy/40">#{c.id.slice(-6)}</span>
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] ${status.cls}`}>{status.label}</span>
      </div>
      <p className="mt-1 italic text-xs text-navy/70">
        &ldquo;{c.customerNote.slice(0, 140)}
        {c.customerNote.length > 140 ? '…' : ''}&rdquo;
      </p>
      <p className="mt-1 text-[10px] text-navy/40">
        última msg cliente há {sinceMin}min · proof: {c.proofUrl ? '✓' : '✗'} · slot:{' '}
        {c.slotPosition ?? '?'} · {c.luciaMessageCount} msg da Lúcia
      </p>
    </article>
  );
}

function AssumedCard({ c }: { c: ComplaintFull }) {
  return (
    <article className="rounded-lg border border-blue-200 bg-blue-50/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-navy/80">
          📞 {c.customerPhone ?? '?'}{' '}
          <span className="text-navy/40">#{c.id.slice(-6)}</span>
        </span>
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-800">
          👤 assumida — você fala direto
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <form action={resolveSacComplaint} className="flex items-center gap-2">
          <input type="hidden" name="id" value={c.id} />
          <input
            type="number"
            step="0.01"
            name="refund"
            placeholder="valor"
            className="w-20 rounded border border-navy/20 px-2 py-1 text-xs"
          />
          <button className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700">
            ✓ Reembolsada
          </button>
        </form>
        <form action={dismissSacWithReason} className="flex items-center gap-2">
          <input type="hidden" name="id" value={c.id} />
          <input
            type="text"
            name="reason"
            placeholder="motivo"
            className="w-24 rounded border border-navy/20 px-2 py-1 text-xs"
          />
          <button className="rounded border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50">
            ✗ Dispensar
          </button>
        </form>
      </div>
    </article>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: 'purple' | 'amber' | 'blue' | 'neutral' }) {
  const cls = {
    purple: 'border-purple-200 bg-purple-50/40 text-purple-900',
    amber: 'border-amber-200 bg-amber-50/40 text-amber-900',
    blue: 'border-blue-200 bg-blue-50/40 text-blue-900',
    neutral: 'border-navy/10 bg-white text-navy/70',
  }[tone];
  return (
    <div className={`rounded-xl border ${cls} px-3 py-2`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-2xl font-bold">{value}</div>
    </div>
  );
}
