import Link from 'next/link';
import { prisma } from '@/lib/db';
import { TEAM, avatarUrl } from '@/lib/agents/team';
import {
  inquiryResolveAction,
  inquiryDismissAction,
  inquiryAssumeAction,
  inquiryRespondAction,
} from './actions';

export const dynamic = 'force-dynamic';

const lucia = TEAM.find((a) => a.id === 'lucia')!;

const CATEGORY_LABEL: Record<string, { label: string; cls: string; emoji: string }> = {
  LEAD_LOCACAO: { label: 'Locação', cls: 'bg-emerald-100 text-emerald-800', emoji: '🏢' },
  ESTACIONAMENTO: { label: 'Estacionamento', cls: 'bg-amber-100 text-amber-800', emoji: '🚗' },
  GERAL: { label: 'Geral', cls: 'bg-navy-50 text-navy/70', emoji: '📩' },
  SAC_VENDING: { label: 'SAC vending', cls: 'bg-purple-100 text-purple-800', emoji: '🆘' },
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  NEW: { label: 'nova', cls: 'bg-amber-100 text-amber-800' },
  ACKNOWLEDGED: { label: 'acusada', cls: 'bg-amber-100 text-amber-800' },
  ESCALATED: { label: 'escalada', cls: 'bg-purple-100 text-purple-800' },
  IN_PROGRESS: { label: 'em andamento', cls: 'bg-blue-100 text-blue-800' },
  ASSUMED_BY_LUIS: { label: 'assumida', cls: 'bg-blue-100 text-blue-800' },
  RESOLVED: { label: '✓ resolvida', cls: 'bg-emerald-100 text-emerald-800' },
  DISMISSED: { label: 'encerrada', cls: 'bg-navy-50 text-navy/45' },
  ABANDONED: { label: 'abandonada', cls: 'bg-rose-50 text-rose-700' },
};

type Inquiry = NonNullable<Awaited<ReturnType<typeof prisma.inquiry.findFirst>>>;

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

export default async function AtendimentoPage() {
  const [open, recent] = await Promise.all([
    prisma.inquiry.findMany({
      where: {
        category: { not: 'LEAD_LOCACAO' }, // leads aparecem em /leads
        status: { in: ['NEW', 'ACKNOWLEDGED', 'ESCALATED', 'IN_PROGRESS', 'ASSUMED_BY_LUIS'] },
      },
      orderBy: { receivedAt: 'desc' },
    }),
    prisma.inquiry.findMany({
      where: {
        category: { not: 'LEAD_LOCACAO' },
        status: { in: ['RESOLVED', 'DISMISSED', 'ABANDONED'] },
      },
      orderBy: { receivedAt: 'desc' },
      take: 20,
    }),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl(lucia, 96)}
          alt="Lúcia"
          width={72}
          height={72}
          className="rounded-full ring-4 ring-sky-300/40"
        />
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-navy">Atendimento Bluemall</h1>
          <p className="mt-1 text-sm italic text-navy/65">
            Inquiries gerais classificadas pela Lúcia (estacionamento, dúvidas, etc) ·{' '}
            <Link href="/leads" className="underline">
              ver leads de locação →
            </Link>{' '}
            ·{' '}
            <Link href="/sac" className="underline">
              ver SAC vending →
            </Link>
          </p>
        </div>
      </header>

      {open.length > 0 ? (
        <section className="mb-8 space-y-3">
          <h2 className="text-lg font-semibold text-navy">
            Em aberto · {open.length}
          </h2>
          {open.map((i) => (
            <InquiryCard key={i.id} i={i} />
          ))}
        </section>
      ) : (
        <div className="mb-8 rounded-lg border border-emerald-200 bg-emerald-50/40 p-6 text-center">
          <div className="text-3xl">✓</div>
          <p className="mt-2 text-sm text-emerald-900">Sem atendimentos abertos.</p>
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-navy/55">Histórico recente</h2>
        {recent.length === 0 ? (
          <p className="text-xs italic text-navy/40">sem registros ainda</p>
        ) : (
          <ul className="space-y-1.5">
            {recent.map((i) => {
              const cat = CATEGORY_LABEL[i.category] ?? CATEGORY_LABEL.GERAL;
              const st = STATUS_BADGE[i.status] ?? STATUS_BADGE.RESOLVED;
              return (
                <li key={i.id} className="rounded border border-navy/5 bg-navy-50/30 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>
                      <span className={`mr-2 rounded-full px-1.5 py-0.5 text-[10px] ${cat.cls}`}>
                        {cat.emoji} {cat.label}
                      </span>
                      <span className={`mr-2 rounded-full px-1.5 py-0.5 text-[10px] ${st.cls}`}>
                        {st.label}
                      </span>
                      {i.customerPhone}
                    </span>
                    <time className="text-[10px] text-navy/40">
                      {new Date(i.receivedAt).toLocaleDateString('pt-BR')}
                    </time>
                  </div>
                  {i.subject && <p className="mt-0.5 italic text-navy/70">{i.subject}</p>}
                  {i.resolution && (
                    <p className="mt-0.5 italic text-emerald-700/70">→ {i.resolution}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

function InquiryCard({ i }: { i: Inquiry }) {
  const cat = CATEGORY_LABEL[i.category] ?? CATEGORY_LABEL.GERAL;
  const st = STATUS_BADGE[i.status] ?? STATUS_BADGE.NEW;
  const conv = parseConv(i.conversation);

  return (
    <article className="rounded-2xl border border-navy/15 bg-white p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-bold text-navy">
            <span className="mr-2">{cat.emoji}</span>
            {i.customerPhone}
            <span className="ml-2 font-mono text-[10px] text-navy/40">#{i.id.slice(-6)}</span>
          </h3>
          <p className="mt-0.5 text-xs text-navy/55">
            {new Date(i.receivedAt).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {i.subject && ` · ${i.subject}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${cat.cls}`}>{cat.label}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${st.cls}`}>{st.label}</span>
        </div>
      </header>

      <div className="mt-3 rounded bg-navy-50/40 p-3 text-sm">
        <div className="text-[10px] uppercase tracking-wide text-navy/40">cliente disse</div>
        <p className="mt-1 italic text-navy/85">&ldquo;{i.originalMessage.slice(0, 300)}&rdquo;</p>
      </div>

      {conv.length > 1 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-navy/55">
            conversa completa ({conv.length} mensagens)
          </summary>
          <ul className="mt-2 space-y-1 text-[11px]">
            {conv.map((e, idx) => (
              <li key={idx} className="rounded border border-navy/5 bg-white/60 px-2 py-1">
                <span className="font-semibold text-navy/70">{e.from}:</span>{' '}
                <span className="text-navy/80">{(e.text ?? '').slice(0, 240)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form action={inquiryRespondAction} className="flex flex-1 items-center gap-2 min-w-0">
          <input type="hidden" name="id" value={i.id} />
          <input
            type="text"
            name="text"
            placeholder="resposta direta ao cliente..."
            className="min-w-0 flex-1 rounded border border-navy/20 px-2 py-1 text-xs"
          />
          <button className="rounded bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-900">
            Enviar
          </button>
        </form>
        <form action={inquiryAssumeAction.bind(null, i.id)}>
          <button className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            👤 Eu assumo
          </button>
        </form>
        <form action={inquiryResolveAction.bind(null, i.id)}>
          <button className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
            ✓ Resolvida
          </button>
        </form>
        <form action={inquiryDismissAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={i.id} />
          <input
            type="text"
            name="reason"
            placeholder="motivo"
            className="w-24 rounded border border-navy/20 px-2 py-1 text-xs"
          />
          <button className="rounded border border-rose-300 px-2 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">
            ✗ Encerrar
          </button>
        </form>
      </div>
    </article>
  );
}
