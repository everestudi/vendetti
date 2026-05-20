'use client';

/**
 * Lista de itens pendentes da aprovação do Luís:
 *   - AgentMessage kind ∈ {PROPOSAL, REQUEST, QUESTION} status=DELIVERED|READ
 *     com toAgentId=null (broadcast — Luís vê) e fromAgentId não-null
 *   - Decisions status=PENDING (link pra /decisions)
 *
 * Cada item tem botões: ✅ Aprovar · ❌ Rejeitar · 💬 Comentar.
 * Aprovar/rejeitar via POST /api/agents/messages/[id]/action.
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

interface Props {
  pendingMessages: PendingMessage[];
  pendingDecisions: PendingDecision[];
}

export function PendingApprovals({ pendingMessages, pendingDecisions }: Props) {
  const total = pendingMessages.length + pendingDecisions.length;

  if (total === 0) {
    return null; // não renderiza nada se não há pendências
  }

  return (
    <section className="rounded-2xl border-2 border-purple-300 bg-gradient-to-br from-purple-50/60 to-white p-4 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-bold text-navy">
          📥 Pendente da sua aprovação <span className="text-xs font-normal text-navy/55">({total})</span>
        </h2>
        {pendingDecisions.length > 0 && (
          <Link
            href="/decisions"
            className="text-xs font-semibold text-navy/70 underline hover:text-navy"
          >
            {pendingDecisions.length} Decision(s) em /decisions →
          </Link>
        )}
      </header>

      {pendingMessages.length > 0 && (
        <div className="space-y-3">
          {pendingMessages.map((m) => (
            <PendingMessageCard key={m.id} msg={m} />
          ))}
        </div>
      )}

      {pendingMessages.length === 0 && pendingDecisions.length > 0 && (
        <div className="text-sm text-navy/65">
          {pendingDecisions.length} Decision(s) PENDING — abre /decisions pra aprovar/rejeitar.
        </div>
      )}
    </section>
  );
}
