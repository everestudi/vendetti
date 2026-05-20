'use client';

import { useState } from 'react';

interface FeedMessage {
  id: string;
  fromSlug: string | null;
  fromName: string;
  fromEmoji: string;
  toSlug: string | null;
  toName: string;
  toEmoji: string;
  kind: string;
  body: string;
  status: string;
  createdAt: string;
  threadId: string | null;
}

const KIND_STYLES: Record<string, { badge: string; border: string }> = {
  NOTE:     { badge: 'bg-navy/10 text-navy/70',     border: 'border-navy/10' },
  QUESTION: { badge: 'bg-blue-100 text-blue-800',   border: 'border-blue-200' },
  INSIGHT:  { badge: 'bg-emerald-100 text-emerald-800', border: 'border-emerald-200' },
  REQUEST:  { badge: 'bg-amber-100 text-amber-800', border: 'border-amber-200' },
  ALERT:    { badge: 'bg-rose-100 text-rose-800',   border: 'border-rose-300' },
  PROPOSAL: { badge: 'bg-purple-100 text-purple-800', border: 'border-purple-200' },
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s atrás`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}min atrás`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h atrás`;
  const d = Math.floor(hr / 24);
  return `${d}d atrás`;
}

export function EmpresaFeed({ initialMessages }: { initialMessages: FeedMessage[] }) {
  const [filter, setFilter] = useState<string | null>(null);

  if (initialMessages.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-navy/20 bg-white p-12 text-center">
        <p className="text-base font-semibold text-navy">A empresa ainda não conversou.</p>
        <p className="mt-2 text-sm text-navy/55">
          Dispare um tick (<code className="rounded bg-navy/5 px-1.5 py-0.5 font-mono text-xs">npm run agents:tick</code>)
          ou mande uma mensagem pro Augusto via /chat pra acordar o time.
        </p>
      </div>
    );
  }

  const filtered = filter ? initialMessages.filter((m) => m.kind === filter) : initialMessages;
  const kinds = Array.from(new Set(initialMessages.map((m) => m.kind)));

  return (
    <div className="space-y-3">
      {/* Filtros de kind */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter(null)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
            filter === null ? 'bg-navy text-white' : 'border border-navy/15 bg-white text-navy/65 hover:bg-navy/5'
          }`}
        >
          Tudo · {initialMessages.length}
        </button>
        {kinds.map((k) => {
          const count = initialMessages.filter((m) => m.kind === k).length;
          const style = KIND_STYLES[k] ?? KIND_STYLES.NOTE;
          return (
            <button
              key={k}
              onClick={() => setFilter(filter === k ? null : k)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                filter === k ? 'bg-navy text-white' : `${style.badge} hover:opacity-80`
              }`}
            >
              {k} · {count}
            </button>
          );
        })}
      </div>

      {/* Feed */}
      <div className="space-y-2">
        {filtered.map((m) => {
          const style = KIND_STYLES[m.kind] ?? KIND_STYLES.NOTE;
          const isBroadcast = m.toSlug === null;
          return (
            <article
              key={m.id}
              className={`rounded-lg border-l-4 ${style.border} bg-white p-4 shadow-sm transition hover:shadow-md`}
            >
              <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="text-lg leading-none">{m.fromEmoji}</span>
                  <span className="font-bold text-navy">{m.fromName}</span>
                  <span className="text-navy/35">→</span>
                  {isBroadcast ? (
                    <span className="rounded bg-navy/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-navy/70">
                      📢 broadcast
                    </span>
                  ) : (
                    <>
                      <span className="text-lg leading-none">{m.toEmoji}</span>
                      <span className="font-semibold text-navy/75">{m.toName}</span>
                    </>
                  )}
                </div>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style.badge}`}
                  >
                    {m.kind}
                  </span>
                  <span className="text-[10px] text-navy/45">{timeAgo(m.createdAt)}</span>
                  {m.status === 'READ' && <span className="text-[10px] text-emerald-600">✓ lida</span>}
                  {m.status === 'ACTIONED' && <span className="text-[10px] text-emerald-700">✓✓ agida</span>}
                </div>
              </header>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed text-navy/85">
                {m.body}
              </div>
              {m.threadId && (
                <div className="mt-2 text-[10px] text-navy/35">
                  thread: <code className="font-mono">{m.threadId.slice(0, 8)}</code>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
