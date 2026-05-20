'use client';

/**
 * Lista de itens pendentes da aprovação do Luís — SÓ DECISIONS.
 *
 * Versão anterior incluía AgentMessages do Augusto (kind QUESTION/ALERT/etc),
 * mas isso poluía com perguntas conversacionais ("Qual texto?", "Me dá pista")
 * que pertencem ao /chat, não a uma fila de aprovação.
 *
 * Critério atual: **aprovação significa ação concreta** (aprovar/rejeitar/executar).
 * Decision PENDING tem isso. Mensagens não.
 *
 * Conversa fica no /chat (thread luis-augusto) + feed da empresa abaixo.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export interface PendingMessage {
  id: string;
  fromSlug: string;
  fromName: string;
  fromEmoji: string;
  kind: 'PROPOSAL' | 'REQUEST' | 'QUESTION' | string;
  body: string;
  createdAt: string;
  threadId: string | null;
}

export interface PendingDecision {
  id: string;
  kind: string;
  level: 'GREEN' | 'YELLOW' | 'RED' | string;
  summary: string;
  rationale: string;
  createdAt: string;
  /** Body completo da outbound message se houver (data.outboundMessage.body). */
  outboundMessage?: { channel: string; body: string; proposedBy?: string } | null;
}

const KIND_BADGE: Record<string, { bg: string; label: string }> = {
  PROPOSAL: { bg: 'bg-purple-100 text-purple-800', label: 'PROPOSTA' },
  REQUEST: { bg: 'bg-amber-100 text-amber-800', label: 'PEDIDO' },
  QUESTION: { bg: 'bg-blue-100 text-blue-800', label: 'PERGUNTA' },
  ALERT: { bg: 'bg-rose-100 text-rose-800', label: 'ALERTA' },
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function PendingMessageCard({ msg }: { msg: PendingMessage }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const badge = KIND_BADGE[msg.kind] ?? { bg: 'bg-navy/10 text-navy/70', label: msg.kind };

  async function callAction(action: 'approve' | 'reject' | 'comment', body?: string) {
    const r = await fetch(`/api/agents/messages/${msg.id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, body }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(`Falha: ${j.error ?? r.status}`);
      return;
    }
    setCommenting(false);
    setCommentBody('');
    startTransition(() => router.refresh());
  }

  const preview = msg.body.length > 280 && !expanded ? msg.body.slice(0, 280) + '…' : msg.body;

  return (
    <article className="rounded-lg border-2 border-purple-200 bg-purple-50/30 p-4 transition hover:shadow-sm">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-lg leading-none">{msg.fromEmoji}</span>
          <span className="text-sm font-bold text-navy">{msg.fromName}</span>
          <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge.bg}`}>
            {badge.label}
          </span>
        </div>
        <span className="text-[10px] text-navy/45">há {timeAgo(msg.createdAt)}</span>
      </header>

      <div className="whitespace-pre-wrap text-sm leading-relaxed text-navy/85">
        {preview}
        {msg.body.length > 280 && (
          <button
            onClick={() => setExpanded((s) => !s)}
            className="ml-1 text-[11px] text-purple-700 underline hover:text-purple-900"
          >
            {expanded ? 'recolher' : 'ver tudo'}
          </button>
        )}
      </div>

      {!commenting && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => callAction('approve')}
            disabled={isPending}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            ✅ Aprovar
          </button>
          <button
            onClick={() => setCommenting(true)}
            disabled={isPending}
            className="rounded-lg border-2 border-navy/20 bg-white px-3 py-1.5 text-xs font-bold text-navy transition hover:bg-navy/5 disabled:opacity-50"
          >
            💬 Comentar
          </button>
          <button
            onClick={() => {
              const reason = prompt('Motivo da rejeição (opcional):') ?? undefined;
              if (reason !== null) callAction('reject', reason);
            }}
            disabled={isPending}
            className="rounded-lg border-2 border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
          >
            ❌ Rejeitar
          </button>
          {msg.threadId && (
            <span className="ml-auto self-center text-[10px] text-navy/40">
              thread: {msg.threadId}
            </span>
          )}
        </div>
      )}

      {commenting && (
        <div className="mt-3 space-y-2">
          <textarea
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder="Comentário (Enter+Shift pra quebrar linha)..."
            rows={3}
            className="w-full rounded-lg border-2 border-navy/20 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => callAction('comment', commentBody)}
              disabled={!commentBody.trim() || isPending}
              className="rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              Enviar
            </button>
            <button
              onClick={() => {
                setCommenting(false);
                setCommentBody('');
              }}
              className="rounded-lg border border-navy/20 px-3 py-1.5 text-xs text-navy/70"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * Decision card rich — especialmente bom pra Decision com data.outboundMessage:
 * mostra body completo + botões Aprovar/Rejeitar inline (call endpoints REST).
 * Pra outras Decisions (PRICE_CHANGE, RESTOCK_TASK etc), link pra /decisions.
 */
function PendingDecisionCard({ dec }: { dec: PendingDecision }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<'approve' | 'reject' | null>(null);
  const isOutbound = Boolean(dec.outboundMessage?.body);
  const levelClass =
    dec.level === 'RED'
      ? 'border-rose-300 bg-rose-50/40'
      : dec.level === 'YELLOW'
        ? 'border-amber-300 bg-amber-50/40'
        : 'border-emerald-300 bg-emerald-50/40';

  async function callApprove() {
    setConfirming(null);
    const r = await fetch(`/api/decisions/${dec.id}/approve`, { method: 'POST' });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(`Falha: ${j.error ?? r.status}`);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function callReject() {
    setConfirming(null);
    const reasonText = prompt('Motivo da rejeição (opcional):') ?? '';
    const r = await fetch(`/api/decisions/${dec.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reasonCategory: 'rejected-from-empresa', reasonText }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(`Falha: ${j.error ?? r.status}`);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <article className={`rounded-lg border-2 p-4 ${levelClass}`}>
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="rounded bg-navy/10 px-2 py-0.5 text-[10px] font-bold uppercase text-navy/70">
            DECISION · {dec.kind} · {dec.level}
          </span>
          {isOutbound && (
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
              📤 outbound
            </span>
          )}
        </div>
        <span className="text-[10px] text-navy/45">há {timeAgo(dec.createdAt)}</span>
      </header>

      {/* Pra outbound: body completo destacado num "envelope" */}
      {isOutbound && dec.outboundMessage && (
        <div className="mb-2 rounded-lg border-2 border-emerald-200 bg-white p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
            mensagem que vai ser enviada → {dec.outboundMessage.channel === 'grupo_operacao' ? 'Grupo Operação TCN (Weverton)' : dec.outboundMessage.channel}
          </div>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-navy/90">
            {dec.outboundMessage.body}
          </pre>
        </div>
      )}

      {/* Pra outras Decisions: summary + rationale */}
      {!isOutbound && (
        <>
          <div className="mb-1 text-sm font-semibold text-navy/85">{dec.summary}</div>
          <div className="text-xs text-navy/70">{dec.rationale.slice(0, 200)}{dec.rationale.length > 200 ? '…' : ''}</div>
        </>
      )}

      {/* Motivação curta */}
      {isOutbound && dec.rationale && (
        <div className="mb-2 text-xs italic text-navy/55">Motivo: {dec.rationale}</div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={callApprove}
          disabled={isPending}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isPending ? '...' : isOutbound ? '✅ Aprovar e enviar' : '✅ Aprovar'}
        </button>
        <button
          onClick={callReject}
          disabled={isPending}
          className="rounded-lg border-2 border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          ❌ Rejeitar
        </button>
        <Link
          href={`/decisions#${dec.id}`}
          className="ml-auto text-[11px] text-navy/55 underline hover:text-navy/85"
        >
          ver em /decisions →
        </Link>
      </div>
    </article>
  );
}

interface Props {
  pendingDecisions: PendingDecision[];
  /** @deprecated kept pra backward compat — não é mais usado */
  pendingMessages?: PendingMessage[];
}

export function PendingApprovals({ pendingDecisions }: Props) {
  if (pendingDecisions.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border-2 border-purple-300 bg-gradient-to-br from-purple-50/60 to-white p-4 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-bold text-navy">
          📥 Pendente da sua aprovação{' '}
          <span className="text-xs font-normal text-navy/55">({pendingDecisions.length})</span>
        </h2>
      </header>

      <div className="space-y-3">
        {pendingDecisions.map((d) => (
          <PendingDecisionCard key={`dec:${d.id}`} dec={d} />
        ))}
      </div>
    </section>
  );
}
