import Link from 'next/link';
import { prisma } from '@/lib/db';
import { TEAM, avatarUrl } from '@/lib/agents/team';
import {
  inquirySetStageAction,
  inquiryRespondAction,
  inquiryAssumeAction,
  inquiryDismissAction,
} from '@/app/atendimento/actions';

export const dynamic = 'force-dynamic';

const lucia = TEAM.find((a) => a.id === 'lucia')!;

const STAGES: { key: string; label: string; bg: string; border: string; head: string }[] = [
  { key: 'PRE_QUALIFICACAO', label: '🟡 Pré-qualif.', bg: 'bg-amber-50/40', border: 'border-amber-200', head: 'text-amber-900' },
  { key: 'QUALIFICADO', label: '✓ Qualificado', bg: 'bg-blue-50/40', border: 'border-blue-200', head: 'text-blue-900' },
  { key: 'EM_NEGOCIACAO', label: '🤝 Negociação', bg: 'bg-purple-50/40', border: 'border-purple-200', head: 'text-purple-900' },
  { key: 'PROPOSTA_ENVIADA', label: '📨 Proposta', bg: 'bg-cyan-50/40', border: 'border-cyan-200', head: 'text-cyan-900' },
  { key: 'CONVERTIDO', label: '🎉 Convertido', bg: 'bg-emerald-50/40', border: 'border-emerald-200', head: 'text-emerald-900' },
  { key: 'PERDIDO', label: '✗ Perdido', bg: 'bg-rose-50/40', border: 'border-rose-200', head: 'text-rose-900' },
];

type Inquiry = NonNullable<Awaited<ReturnType<typeof prisma.inquiry.findFirst>>>;

interface ConversationEntry {
  from: string;
  at: string;
  text?: string;
}
function parseConv(raw: unknown): ConversationEntry[] {
  return Array.isArray(raw) ? (raw as ConversationEntry[]) : [];
}

export default async function LeadsPage() {
  const leads = await prisma.inquiry.findMany({
    where: { category: 'LEAD_LOCACAO' },
    orderBy: { receivedAt: 'desc' },
  });

  const byStage = new Map<string, Inquiry[]>();
  for (const s of STAGES) byStage.set(s.key, []);
  for (const l of leads) {
    const key = l.leadStage ?? 'PRE_QUALIFICACAO';
    if (!byStage.has(key)) byStage.set(key, []);
    byStage.get(key)!.push(l);
  }

  const activeCount = leads.filter(
    (l) => l.leadStage !== 'CONVERTIDO' && l.leadStage !== 'PERDIDO',
  ).length;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6 flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl(lucia, 96)}
          alt="Lúcia"
          width={72}
          height={72}
          className="rounded-full ring-4 ring-emerald-300/40"
        />
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-navy">Leads · Locação Bluemall</h1>
          <p className="mt-1 text-sm italic text-navy/65">
            Funil CRM alimentado pela Lúcia · {leads.length} leads totais · {activeCount} ativos
          </p>
          <p className="mt-1 text-xs text-navy/45">
            <Link href="/atendimento" className="underline">
              → outros atendimentos
            </Link>
            {' · '}
            <Link href="/sac" className="underline">
              → SAC vending
            </Link>
          </p>
        </div>
      </header>

      {leads.length === 0 ? (
        <div className="rounded-lg border border-dashed border-navy/20 p-12 text-center text-sm text-navy/45">
          Sem leads ainda. Quando alguém manda mensagem sobre locação no WhatsApp, a Lúcia
          classifica e abre lead automaticamente aqui.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {STAGES.map((s) => {
            const cards = byStage.get(s.key) ?? [];
            return (
              <section
                key={s.key}
                className={`rounded-2xl border ${s.border} ${s.bg} p-3 lg:min-h-[400px]`}
              >
                <header className={`mb-3 text-xs font-semibold uppercase tracking-wide ${s.head}`}>
                  {s.label} · {cards.length}
                </header>
                <div className="space-y-2">
                  {cards.map((l) => (
                    <LeadCard key={l.id} l={l} />
                  ))}
                  {cards.length === 0 && (
                    <p className="text-[10px] italic text-navy/40">vazio</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

function LeadCard({ l }: { l: Inquiry }) {
  const conv = parseConv(l.conversation);
  const details = (l.leadDetails ?? {}) as Record<string, unknown>;
  const detailKeys = Object.keys(details).filter((k) => details[k]);

  return (
    <article className="rounded-lg border border-navy/15 bg-white p-3 text-xs shadow-sm">
      <header className="flex items-baseline justify-between gap-1">
        <span className="font-semibold text-navy">{l.customerPhone}</span>
        <span className="font-mono text-[9px] text-navy/40">#{l.id.slice(-6)}</span>
      </header>
      <p className="mt-1 text-[10px] text-navy/45">
        {new Date(l.receivedAt).toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
      {l.subject && <p className="mt-1 italic text-navy/75">&ldquo;{l.subject}&rdquo;</p>}

      {detailKeys.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded bg-navy-50/30 p-2 text-[10px] text-navy/70">
          {detailKeys.map((k) => (
            <li key={k}>
              <strong>{k}:</strong> {String(details[k])}
            </li>
          ))}
        </ul>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] text-navy/55">
          ver msg ({conv.length})
        </summary>
        <ul className="mt-1 space-y-1">
          {conv.slice(0, 5).map((e, i) => (
            <li key={i} className="rounded bg-navy-50/30 px-1.5 py-1">
              <span className="font-semibold">{e.from}:</span> {e.text?.slice(0, 200)}
            </li>
          ))}
        </ul>
      </details>

      {/* Action: mudar stage */}
      <form action={inquirySetStageAction} className="mt-2">
        <input type="hidden" name="id" value={l.id} />
        <select
          name="stage"
          defaultValue={l.leadStage ?? 'PRE_QUALIFICACAO'}
          className="w-full rounded border border-navy/15 px-1 py-0.5 text-[10px]"
        >
          <option value="PRE_QUALIFICACAO">Pré-qualif.</option>
          <option value="QUALIFICADO">Qualificado</option>
          <option value="EM_NEGOCIACAO">Em negociação</option>
          <option value="PROPOSTA_ENVIADA">Proposta enviada</option>
          <option value="CONVERTIDO">Convertido</option>
          <option value="PERDIDO">Perdido</option>
        </select>
        <button className="mt-1 w-full rounded bg-navy/90 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-navy">
          Mover stage
        </button>
      </form>

      {/* Action: responder */}
      <form action={inquiryRespondAction} className="mt-1.5 flex flex-col gap-1">
        <input type="hidden" name="id" value={l.id} />
        <input
          name="text"
          placeholder="resposta..."
          className="w-full rounded border border-navy/15 px-1.5 py-0.5 text-[10px]"
        />
        <button className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-700">
          Enviar
        </button>
      </form>

      <div className="mt-1.5 flex gap-1">
        <form action={inquiryAssumeAction.bind(null, l.id)} className="flex-1">
          <button className="w-full rounded border border-blue-200 px-1 py-0.5 text-[9px] font-semibold text-blue-700 hover:bg-blue-50">
            👤 Assumo
          </button>
        </form>
        <form action={inquiryDismissAction} className="flex-1">
          <input type="hidden" name="id" value={l.id} />
          <button className="w-full rounded border border-rose-200 px-1 py-0.5 text-[9px] font-semibold text-rose-700 hover:bg-rose-50">
            ✗ Encerrar
          </button>
        </form>
      </div>
    </article>
  );
}
