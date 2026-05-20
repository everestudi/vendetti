'use client';

/**
 * ChatVendetti — interface de conversa com Augusto.
 *
 * Estilo WhatsApp:
 *   - Bubbles direita (Luís) / esquerda (Augusto)
 *   - Timestamp pequeno em cada mensagem (hh:mm)
 *   - Separador de dia ("hoje", "ontem", "20 mai")
 *   - Mensagens consecutivas do mesmo autor agrupadas (sem repetir avatar/nome)
 *   - Indicador "Augusto está digitando…" via polling (detecta AgentRun RUNNING)
 *   - **Pensamento** (chain-of-thought) e **tool calls** separados da resposta:
 *     bloco recolhível "🧠 raciocínio" abaixo do bubble.
 *
 * Fluxo: POST /api/chat → cria AgentMessage + roda Augusto inline. UI faz polling
 * de /api/chat/history a cada 3s pra capturar resposta + estado de digitação.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { CEO, avatarUrl } from '@/lib/agents/team';

interface Props {
  /** altura do container; default usa o restante da viewport menos o header */
  heightClass?: string;
  /** se true, esconde o header (avatar+nome) */
  hideHeader?: boolean;
  /** compact mode: layout enxuto pra embed em outras páginas */
  compact?: boolean;
}

interface MessagePart {
  type: string;
  text?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];
  createdAt: string;
  meta?: {
    runId?: string;
    agentSlug?: string;
    costUsd?: number;
    thinkingMd?: string | null;
    toolCalls?: unknown;
  };
}

// =============================================================
// Helpers de tempo
// =============================================================

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/** "14:32" estilo WhatsApp */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "Hoje" · "Ontem" · "20 mai" · "20 mai 2024" (se ano diferente) */
function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, today)) return 'hoje';
  if (isSameDay(d, yesterday)) return 'ontem';
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const dayPart = `${d.getDate()} ${months[d.getMonth()]}`;
  if (d.getFullYear() !== today.getFullYear()) {
    return `${dayPart} ${d.getFullYear()}`;
  }
  return dayPart;
}

// =============================================================
// Componentes
// =============================================================

function DaySeparator({ iso }: { iso: string }) {
  return (
    <div className="my-3 flex items-center justify-center">
      <span className="rounded-full bg-navy/10 px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-navy/55">
        {formatDayLabel(iso)}
      </span>
    </div>
  );
}

/** Pensamento (chain-of-thought) — visualmente separado do bubble principal. */
function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);
  const preview = thinking.slice(0, 80).replace(/\n/g, ' ');
  return (
    <div className="ml-2 mt-1 max-w-[80%] rounded-lg border border-purple-200 bg-purple-50/50 text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-purple-800 hover:bg-purple-100/60"
      >
        <span className="font-semibold">🧠 raciocínio</span>
        <span className="truncate text-[10px] text-purple-700/70">
          {open ? '(toque pra recolher)' : preview + (thinking.length > 80 ? '…' : '')}
        </span>
        <span className="ml-auto text-[10px] text-purple-700/70">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-purple-200 bg-white/70 p-2 font-sans text-[10px] leading-relaxed text-navy/75">
          {thinking}
        </pre>
      )}
    </div>
  );
}

/** Renderiza tool calls como bloco discreto abaixo do bubble. */
function ToolCallBlock({ parts }: { parts: MessagePart[] }) {
  const toolParts = parts.filter((p) => p.type?.startsWith('tool-'));
  if (toolParts.length === 0) return null;
  return (
    <div className="ml-2 mt-1 flex flex-wrap gap-1">
      {toolParts.map((p, i) => {
        const toolName = p.toolName ?? p.type.replace('tool-', '');
        const okStyle = p.state === 'output-error'
          ? 'border-rose-200 bg-rose-50 text-rose-800'
          : 'border-amber-200 bg-amber-50/70 text-amber-900';
        return (
          <details
            key={i}
            className={`rounded border ${okStyle} px-1.5 py-0.5 text-[10px]`}
          >
            <summary className="cursor-pointer font-mono font-semibold">
              🔧 {toolName}
              {p.state === 'output-error' && ' ⚠️'}
            </summary>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[9px] opacity-80">
              {JSON.stringify(p.output ?? p.input, null, 2).slice(0, 500)}
            </pre>
          </details>
        );
      })}
    </div>
  );
}

/** Uma bubble de mensagem (já SEM o timestamp — fica fora). */
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const textParts = msg.parts.filter((p) => p.type === 'text');
  const text = textParts.map((p) => p.text).join('\n').trim();

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm ${
          isUser
            ? 'rounded-br-md bg-emerald-600 text-white'
            : 'rounded-bl-md border border-navy/10 bg-white text-navy/90'
        }`}
      >
        {text && <p className="whitespace-pre-wrap">{text}</p>}
        {!text && !isUser && (
          <p className="italic text-navy/45">(sem resposta textual — só ações)</p>
        )}
      </div>

      {/* Anexos: tool calls e raciocínio — só pra assistant */}
      {!isUser && (
        <>
          <ToolCallBlock parts={msg.parts} />
          {msg.meta?.thinkingMd && <ThinkingBlock thinking={msg.meta.thinkingMd} />}
        </>
      )}
    </div>
  );
}

interface MessageGroupData {
  role: 'user' | 'assistant';
  messages: ChatMessage[];
}

/** Grupo de mensagens consecutivas do mesmo autor (mostra timestamp só no final). */
function MessageGroup({ group }: { group: MessageGroupData }) {
  const isUser = group.role === 'user';
  const last = group.messages[group.messages.length - 1];
  const cost = group.messages.reduce((s, m) => s + (m.meta?.costUsd ?? 0), 0);

  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      {group.messages.map((m) => (
        <MessageBubble key={m.id} msg={m} />
      ))}
      <div className={`flex items-center gap-1.5 px-1 text-[9px] text-navy/40 ${isUser ? 'flex-row-reverse' : ''}`}>
        <span>{formatTime(last.createdAt)}</span>
        {!isUser && cost > 0 && (
          <span className="font-mono opacity-60">· ${cost.toFixed(4)}</span>
        )}
      </div>
    </div>
  );
}

// =============================================================
// Componente principal
// =============================================================

export function ChatVendetti({ heightClass, hideHeader, compact }: Props) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false); // Augusto em RUNNING
  const [error, setError] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch('/api/chat/history');
      const j = await r.json();
      if (j.ok && Array.isArray(j.messages)) {
        setMessages(j.messages);
        setIsTyping(Boolean(j.isTyping));
      }
    } catch {
      // silencia falhas de polling
    }
  }, []);

  // Hidrata histórico inicial
  useEffect(() => {
    let cancelled = false;
    fetchHistory().finally(() => {
      if (!cancelled) setHistoryLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchHistory]);

  // Polling automático — só quando aba está visível, com backoff:
  // 3s se está esperando resposta (sending OU isTyping), 30s ocioso.
  useEffect(() => {
    const interval = sending || isTyping ? 3000 : 30000;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchHistory();
      }
    }, interval);
    return () => clearInterval(id);
  }, [fetchHistory, sending, isTyping]);

  // Auto-scroll
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, sending, isTyping]);

  function onContainerScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    stickToBottomRef.current = distFromBottom < 60;
  }

  // Agrupa msgs consecutivas do mesmo autor + insere day separators
  const renderItems = useMemo(() => {
    const out: Array<
      | { kind: 'day'; iso: string }
      | { kind: 'group'; group: MessageGroupData }
    > = [];
    let prevDay: Date | null = null;
    let currentGroup: MessageGroupData | null = null;

    for (const m of messages) {
      const d = new Date(m.createdAt);
      if (!prevDay || !isSameDay(prevDay, d)) {
        // Fecha grupo atual
        if (currentGroup) out.push({ kind: 'group', group: currentGroup });
        currentGroup = null;
        out.push({ kind: 'day', iso: m.createdAt });
        prevDay = d;
      }
      const role = m.role === 'user' ? 'user' : 'assistant';
      if (currentGroup && currentGroup.role === role) {
        currentGroup.messages.push(m);
      } else {
        if (currentGroup) out.push({ kind: 'group', group: currentGroup });
        currentGroup = { role, messages: [m] };
      }
    }
    if (currentGroup) out.push({ kind: 'group', group: currentGroup });
    return out;
  }, [messages]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    setSending(true);

    // Optimistic update
    const optimisticId = `tmp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        role: 'user',
        parts: [{ type: 'text', text }],
        createdAt: new Date().toISOString(),
      },
    ]);
    setInput('');

    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j.error ?? 'falha ao enviar');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'falha de rede');
    } finally {
      await fetchHistory();
      setSending(false);
    }
  }

  const defaultHeight = compact ? 'h-[480px]' : 'h-[calc(100vh-3.5rem)]';

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) form.requestSubmit();
    }
  }

  const showTyping = sending || isTyping;

  return (
    <div className={`flex flex-col ${heightClass ?? defaultHeight} bg-navy/[0.02]`}>
      {!hideHeader && (
        <header className="mb-2 flex items-center gap-3 border-b border-navy/10 bg-white/80 px-3 py-2.5 backdrop-blur">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarUrl(CEO, 80)} alt="Augusto" width={40} height={40} className="rounded-full ring-2 ring-navy/15" />
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold text-navy">Augusto Vendetti</h1>
            <p className="truncate text-[10px] text-navy/60">
              {showTyping ? (
                <>
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 mr-1" />
                  digitando…
                </>
              ) : (
                <>🟢 online · Opus 4.7 · Chief of Staff</>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!confirm('Apagar histórico desta conversa? (Memória/Recall do Augusto fica preservada)')) return;
              await fetch('/api/chat/history?confirm=1', { method: 'DELETE' });
              setMessages([]);
            }}
            className="text-[10px] text-navy/40 hover:text-navy/70"
            title="Apaga apenas a thread visível. Memória de longo prazo do Augusto é preservada."
          >
            ⌫ novo chat
          </button>
        </header>
      )}

      <div
        ref={scrollContainerRef}
        onScroll={onContainerScroll}
        className="flex-1 min-h-0 space-y-2 overflow-y-auto overscroll-contain px-3 py-2"
      >
        {!historyLoaded && (
          <div className="rounded-lg bg-navy-50/50 p-3 text-xs italic text-navy/50">
            Carregando histórico…
          </div>
        )}
        {historyLoaded && messages.length === 0 && (
          <div className="rounded-lg bg-navy-50 p-4 text-sm text-navy/65">
            <strong className="text-navy">Pergunta algo:</strong>
            <ul className="mt-2 list-disc pl-5 text-xs">
              <li>&ldquo;Quais slots tão críticos agora?&rdquo;</li>
              <li>&ldquo;Qual o produto com pior margem?&rdquo;</li>
              <li>&ldquo;Detalhe do slot 13&rdquo;</li>
              <li>&ldquo;Últimas decisões&rdquo;</li>
            </ul>
          </div>
        )}

        {renderItems.map((item, idx) => {
          if (item.kind === 'day') return <DaySeparator key={`day-${item.iso}-${idx}`} iso={item.iso} />;
          return <MessageGroup key={`g-${idx}-${item.group.messages[0].id}`} group={item.group} />;
        })}

        {showTyping && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-navy/10 bg-white px-3 py-2 text-sm">
              <div className="flex items-center gap-1.5">
                <span className="flex gap-0.5">
                  <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-navy/50" style={{ animationDelay: '0ms' }} />
                  <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-navy/50" style={{ animationDelay: '150ms' }} />
                  <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-navy/50" style={{ animationDelay: '300ms' }} />
                </span>
                <span className="text-[10px] italic text-navy/55">Augusto está digitando…</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
            ❌ {error}
          </div>
        )}
      </div>

      <form onSubmit={submit} className="flex items-end gap-2 border-t border-navy/10 bg-white/80 px-3 py-2 backdrop-blur">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          placeholder="Pergunta pro Augusto... (Enter envia, Shift+Enter quebra linha)"
          disabled={sending}
          rows={1}
          className="flex-1 resize-none rounded-2xl border border-navy/20 bg-white px-4 py-2.5 text-base leading-snug focus:border-navy focus:outline-none disabled:opacity-50"
          style={{
            minHeight: '44px',
            maxHeight: '180px',
            height: 'auto',
          }}
          ref={(el) => {
            if (el) {
              el.style.height = 'auto';
              el.style.height = Math.min(180, el.scrollHeight) + 'px';
            }
          }}
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="shrink-0 rounded-full bg-emerald-600 px-4 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          style={{ minHeight: '44px' }}
        >
          {sending ? '...' : '↑'}
        </button>
      </form>
    </div>
  );
}
