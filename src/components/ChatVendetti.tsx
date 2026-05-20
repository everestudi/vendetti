'use client';

/**
 * ChatVendetti — interface de conversa com Augusto via novo runtime de agentes.
 *
 * Antes: usava @ai-sdk/react useChat com streamText (token-by-token streaming).
 * Agora: POST /api/chat (cria AgentMessage + roda Augusto inline) + GET history
 * polling pra atualizar a timeline. Perde streaming mas ganha:
 *   - Thinking visível (chain-of-thought do Augusto)
 *   - Tool calls renderizados estruturados
 *   - Mensagens aparecem em /empresa pros outros agentes verem (broadcast interno)
 *   - Memory Recall ativo (Augusto lembra de conversa anterior)
 *
 * Layout idêntico ao antigo pra não estranhar visualmente.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { CEO, avatarUrl } from '@/lib/agents/team';

interface Props {
  /** altura do container; default usa o restante da viewport menos o header */
  heightClass?: string;
  /** se true, esconde o header (avatar+nome) — útil quando o painel CEO já mostra o avatar acima */
  hideHeader?: boolean;
  /** compact mode: layout enxuto pra embed em outras páginas (ex: /empresa) */
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

function Message({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const [showThinking, setShowThinking] = useState(false);
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
          isUser ? 'bg-navy text-white' : 'bg-white border border-navy/10 text-navy/90'
        }`}
      >
        {msg.parts.map((p, i) => {
          if (p.type === 'text') {
            return (
              <p key={i} className="whitespace-pre-wrap leading-relaxed">
                {p.text}
              </p>
            );
          }
          if (p.type?.startsWith('tool-')) {
            const toolName = p.toolName ?? p.type.replace('tool-', '');
            return (
              <div key={i} className="my-1.5 rounded border border-gold/40 bg-gold-50 px-2 py-1 text-xs text-navy/70">
                <div className="font-mono font-semibold text-gold-900">🔧 {toolName}</div>
                {p.state === 'output-available' && (
                  <div className="mt-1 max-h-32 overflow-auto font-mono text-[10px]">
                    {JSON.stringify(p.output, null, 2).slice(0, 500)}
                    {JSON.stringify(p.output).length > 500 && '...'}
                  </div>
                )}
                {p.state === 'output-error' && (
                  <div className="mt-1 text-[10px] text-rose-700">{JSON.stringify(p.output)}</div>
                )}
              </div>
            );
          }
          return null;
        })}
        {/* Thinking visível (collapsible) — só pra assistant */}
        {!isUser && msg.meta?.thinkingMd && (
          <div className="mt-2 border-t border-navy/10 pt-2 text-[11px]">
            <button
              type="button"
              onClick={() => setShowThinking((s) => !s)}
              className="text-navy/50 hover:text-navy/80"
            >
              {showThinking ? '▼' : '▶'} raciocínio
            </button>
            {showThinking && (
              <pre className="mt-1 whitespace-pre-wrap rounded bg-navy-50 p-2 font-sans text-[10px] text-navy/70">
                {msg.meta.thinkingMd}
              </pre>
            )}
          </div>
        )}
        {!isUser && msg.meta?.costUsd != null && msg.meta.costUsd > 0 && (
          <div className="mt-1 text-right text-[9px] text-navy/35 font-mono">
            ${msg.meta.costUsd.toFixed(4)}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatVendetti({ heightClass, hideHeader, compact }: Props) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch('/api/chat/history');
      const j = await r.json();
      if (j.ok && Array.isArray(j.messages)) {
        setMessages(j.messages);
      }
    } catch {
      // silencia falhas de polling
    }
  }, []);

  // Hidrata histórico
  useEffect(() => {
    let cancelled = false;
    fetchHistory().finally(() => {
      if (!cancelled) setHistoryLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchHistory]);

  // Auto-scroll
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, sending]);

  function onContainerScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    stickToBottomRef.current = distFromBottom < 60;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    setSending(true);

    // Optimistic update — adiciona msg do user na timeline antes da resposta
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
      // Recarrega histórico real (substitui optimistic + traz resposta do Augusto)
      await fetchHistory();
      setSending(false);
    }
  }

  // Default height: compact = altura fixa (embed), full = viewport menos header
  const defaultHeight = compact ? 'h-[480px]' : 'h-[calc(100vh-3.5rem)]';

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter = envia, Shift+Enter = nova linha. Padrão Slack/iMessage/ChatGPT.
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) form.requestSubmit();
    }
  }

  return (
    <div className={`flex flex-col ${heightClass ?? defaultHeight}`}>
      {!hideHeader && (
        <header className="mb-3 flex items-center gap-3 border-b border-navy/10 pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarUrl(CEO, 80)} alt="Vendetti" width={48} height={48} className="rounded-full ring-2 ring-navy/20" />
          <div className="flex-1">
            <h1 className="text-base font-bold text-navy">Augusto Vendetti</h1>
            <p className="text-xs text-navy/60">
              {sending ? '🧠 pensando…' : '🟢 online · Opus 4.7 · Chief of Staff'}
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
        className="flex-1 min-h-0 space-y-3 overflow-y-auto overscroll-contain py-2"
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
              <li>&ldquo;Como tá o estoque da máquina?&rdquo;</li>
              <li>&ldquo;Detalhe do slot 13&rdquo;</li>
              <li>&ldquo;Últimas decisões&rdquo;</li>
            </ul>
          </div>
        )}

        {messages.map((m) => (
          <Message key={m.id} msg={m} />
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl border border-navy/10 bg-white px-4 py-2.5 text-sm text-navy/60">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-navy/40" />
                <span className="text-xs italic">Augusto pensando, lendo recall, chamando tools…</span>
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

      <form onSubmit={submit} className="mt-3 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          placeholder="Pergunta pro Augusto... (Enter envia, Shift+Enter quebra linha)"
          disabled={sending}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-navy/20 bg-white px-4 py-3 text-base leading-snug focus:border-navy focus:outline-none disabled:opacity-50"
          style={{
            minHeight: '52px',
            maxHeight: '180px',
            // auto-resize via inline style — textarea cresce conforme digita
            height: 'auto',
          }}
          // Auto-resize: ajusta height conforme conteúdo (cresce até maxHeight)
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
          className="shrink-0 rounded-lg bg-navy px-5 py-3 font-semibold text-white hover:bg-navy-900 disabled:opacity-50"
          style={{ minHeight: '52px' }}
        >
          {sending ? '...' : '↑'}
        </button>
      </form>
    </div>
  );
}
