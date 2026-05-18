'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentScope, LogLine } from '@/lib/agent-log';

/**
 * Terminal embedado nas pages de agentes. Poll cada `pollMs` (default 5s).
 * Stick-to-bottom: se o usuário scrolla pra cima, deixa quieto; se está no
 * fundo, novas linhas mantém ele lá.
 *
 * Layout: pretendido pra ficar no rodapé da página, ~280px de altura, fundo
 * preto, fonte mono. Cores por level (info=cinza, success=verde, warn=amber,
 * error=rose).
 */
export interface AgentTerminalProps {
  scope: AgentScope;
  /** Nome do agente pra exibir no header */
  agentLabel: string;
  /** Intervalo de poll em ms (default 5000) */
  pollMs?: number;
  /** Altura em px (default 320) */
  heightPx?: number;
}

const LEVEL_COLOR: Record<LogLine['level'], string> = {
  info: 'text-slate-300',
  success: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-rose-400',
};

const SOURCE_COLOR: Record<string, string> = {
  worker: 'text-sky-400',
  decision: 'text-purple-400',
  chat: 'text-cyan-400',
  webhook: 'text-blue-400',
  complaint: 'text-rose-400',
  inquiry: 'text-amber-400',
  snapshot: 'text-emerald-400',
  reposicao: 'text-emerald-400',
  purchase: 'text-cyan-400',
  idea: 'text-yellow-400',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (sameDay) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function AgentTerminal({ scope, agentLabel, pollMs = 5000, heightPx = 320 }: AgentTerminalProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchLog() {
      try {
        const res = await fetch(`/api/agent-log/${scope}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { lines: LogLine[] };
        if (cancelled) return;
        setLines(json.lines);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'erro');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchLog();
    if (paused) return () => { cancelled = true; };
    const id = setInterval(fetchLog, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [scope, pollMs, paused]);

  // Stick-to-bottom intelligent (60px tolerance)
  useEffect(() => {
    if (!scrollRef.current) return;
    if (stickToBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 60;
  }

  // Reverse to show newest at bottom (chronological asc for terminal feel)
  const ordered = [...lines].reverse();

  return (
    <section
      className="mt-8 overflow-hidden rounded-lg border border-slate-800 bg-slate-950 font-mono shadow-sm"
      style={{ height: heightPx }}
    >
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-1.5 text-[11px] text-slate-400">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.8)]"></span>
          <span className="font-semibold text-slate-300">{agentLabel}</span>
          <span className="text-slate-500">· terminal · {lines.length} eventos</span>
          {error && <span className="text-rose-400">· err: {error}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800"
            title={paused ? 'continuar polling' : 'pausar polling'}
          >
            {paused ? '▶ play' : '⏸ pause'}
          </button>
          <span className="text-[10px] text-slate-600">poll {pollMs / 1000}s</span>
        </div>
      </header>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto px-3 py-2 text-[11px] leading-relaxed"
        style={{ height: heightPx - 32 }}
      >
        {loading && <div className="text-slate-500">carregando…</div>}
        {!loading && ordered.length === 0 && (
          <div className="text-slate-500">
            <span className="text-slate-400">$</span> aguardando eventos…
          </div>
        )}
        {ordered.map((line, i) => (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 text-slate-500">{formatTime(line.at)}</span>
            <span className={`shrink-0 ${SOURCE_COLOR[line.source] ?? 'text-slate-400'}`}>
              [{line.source}]
            </span>
            <div className={`min-w-0 flex-1 ${LEVEL_COLOR[line.level]}`}>
              <span className="break-words">{line.message}</span>
              {line.detail && (
                <div className="ml-2 break-words text-slate-500">↳ {line.detail.slice(0, 200)}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
