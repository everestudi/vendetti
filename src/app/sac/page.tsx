import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveSacComplaint, dismissSacComplaint } from './actions';
import { TEAM, avatarUrl } from '@/lib/agents/team';

export const dynamic = 'force-dynamic';

const lucia = TEAM.find((a) => a.id === 'lucia')!;

const STATUS_BADGE = {
  RECEIVED: { cls: 'bg-amber-100 text-amber-800', label: 'recebida' },
  TRIAGE_REJECTED: { cls: 'bg-navy-50 text-navy/45', label: 'triada' },
  AWAITING_PROOF: { cls: 'bg-amber-100 text-amber-800', label: '⏳ aguarda print' },
  AWAITING_SLOT: { cls: 'bg-amber-100 text-amber-800', label: '⏳ aguarda slot' },
  ESCALATED: { cls: 'bg-purple-100 text-purple-800', label: '🆘 escalada' },
  REFUNDED: { cls: 'bg-emerald-100 text-emerald-800', label: '✓ reembolsada' },
  DISMISSED: { cls: 'bg-navy-50 text-navy/45', label: 'descartada' },
} as const;

export default async function SacPage() {
  const [open, escalated, recent] = await Promise.all([
    prisma.complaint.findMany({
      where: { status: { in: ['RECEIVED', 'AWAITING_PROOF', 'AWAITING_SLOT'] } },
      orderBy: { receivedAt: 'desc' },
    }),
    prisma.complaint.findMany({
      where: { status: 'ESCALATED' },
      orderBy: { escalatedAt: 'desc' },
    }),
    prisma.complaint.findMany({
      where: { status: { in: ['REFUNDED', 'DISMISSED', 'TRIAGE_REJECTED'] } },
      orderBy: { receivedAt: 'desc' },
      take: 20,
    }),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8 flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatarUrl(lucia, 96)} alt="Lúcia" width={72} height={72} className="rounded-full ring-4 ring-sky-300/40" />
        <div>
          <h1 className="text-3xl font-bold text-navy">SAC · Lúcia</h1>
          <p className="mt-1 text-sm italic text-navy/65">"{lucia.tagline}"</p>
          <p className="mt-1 text-xs text-navy/45">
            Reclamações dos clientes via Z-API · webhook em <code className="rounded bg-navy-50 px-1.5 py-0.5">/api/webhook/zapi</code>
          </p>
        </div>
      </header>

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

      {open.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-amber-900">
            ⏳ Em conversa · {open.length}
          </h2>
          <div className="space-y-2">
            {open.map((c) => (
              <OpenCard key={c.id} c={c} />
            ))}
          </div>
        </section>
      )}

      {escalated.length + open.length === 0 && (
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
                <div className="flex items-baseline justify-between gap-2">
                  <span>
                    <span className={`mr-2 rounded-full px-1.5 py-0.5 text-[10px] ${STATUS_BADGE[c.status as keyof typeof STATUS_BADGE].cls}`}>
                      {STATUS_BADGE[c.status as keyof typeof STATUS_BADGE].label}
                    </span>
                    {c.customerPhone ?? '?'} · slot {c.slotPosition ?? '?'}
                  </span>
                  <time className="text-[10px] text-navy/40">{new Date(c.receivedAt).toLocaleDateString('pt-BR')}</time>
                </div>
                {c.resolution && <p className="mt-0.5 text-emerald-700/70 italic">→ {c.resolution}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="mt-8 rounded border border-navy/10 bg-navy-50/30 p-4 text-xs">
        <summary className="cursor-pointer font-semibold text-navy/70">🧪 Simular inbound (dev)</summary>
        <p className="mt-2 text-navy/55">
          Pra testar localmente sem Z-API real, faz POST em <code>/api/webhook/zapi/simulate</code>:
        </p>
        <pre className="mt-2 rounded bg-white p-2 font-mono text-[10px]">
{`# 1. Primeiro contato (texto)
curl -X POST http://localhost:3000/api/webhook/zapi/simulate \\
  -H 'Content-Type: application/json' \\
  -d '{"phone":"5534999999999","text":"comprei e a máquina não soltou"}'

# 2. Envia print (imagem)
curl ... -d '{"phone":"5534999999999","text":"","imageUrl":"https://exemplo.com/print.jpg"}'

# 3. Informa slot
curl ... -d '{"phone":"5534999999999","text":"foi o 32"}'`}
        </pre>
      </details>
    </main>
  );
}

type Complaint = Awaited<ReturnType<typeof prisma.complaint.findFirst>>;

function EscalatedCard({ c }: { c: NonNullable<Complaint> }) {
  return (
    <article className="rounded-2xl border border-purple-200 bg-purple-50/30 p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-bold text-navy">📞 {c.customerPhone ?? '(sem telefone)'}</h3>
          <p className="text-xs text-navy/55">
            slot <strong>{c.slotPosition ?? '?'}</strong> ·{' '}
            recebida {new Date(c.receivedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">aguarda decisão</span>
      </header>

      <div className="mt-3 rounded bg-white/70 p-3 text-sm">
        <div className="text-[10px] uppercase tracking-wide text-navy/40">cliente reclamou</div>
        <p className="mt-1 text-navy/85 italic">"{c.customerNote.slice(0, 280)}{c.customerNote.length > 280 ? '…' : ''}"</p>
      </div>

      {c.proofUrl && (
        <a href={c.proofUrl} target="_blank" rel="noopener" className="mt-2 inline-block text-xs text-purple-700 underline">
          📎 ver comprovante
        </a>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form action={resolveSacComplaint} className="flex flex-1 items-center gap-2">
          <input type="hidden" name="id" value={c.id} />
          <input
            type="number"
            step="0.01"
            name="refund"
            placeholder="valor reembolso (R$)"
            className="w-32 rounded border border-navy/20 px-2 py-1 text-xs"
          />
          <input
            type="text"
            name="resolution"
            placeholder="nota (opcional)"
            className="flex-1 min-w-0 rounded border border-navy/20 px-2 py-1 text-xs"
          />
          <button className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
            ✓ Reembolsar
          </button>
        </form>
        <form action={dismissSacComplaint.bind(null, c.id)}>
          <button className="rounded border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">
            ✗ Descartar
          </button>
        </form>
      </div>
    </article>
  );
}

function OpenCard({ c }: { c: NonNullable<Complaint> }) {
  const status = STATUS_BADGE[c.status as keyof typeof STATUS_BADGE];
  return (
    <article className="rounded-lg border border-amber-200 bg-amber-50/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-navy/80">📞 {c.customerPhone ?? '?'}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] ${status.cls}`}>{status.label}</span>
      </div>
      <p className="mt-1 text-xs text-navy/70 italic">"{c.customerNote.slice(0, 140)}{c.customerNote.length > 140 ? '…' : ''}"</p>
      <p className="mt-1 text-[10px] text-navy/40">
        {new Date(c.receivedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
      </p>
    </article>
  );
}
