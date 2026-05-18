'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, useRef, useEffect } from 'react';
import { CEO, avatarUrl } from '@/lib/agents/team';

interface Props {
  /** altura do container; default usa o restante da viewport menos o header */
  heightClass?: string;
  /** se true, esconde o header (avatar+nome) — útil quando o painel CEO já mostra o avatar acima */
  hideHeader?: boolean;
}

interface MessagePart {
  type: string;
  text?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}

function Message({ role, parts }: { role: 'user' | 'assistant' | 'system'; parts: MessagePart[] }) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
          isUser ? 'bg-navy text-white' : 'bg-white border border-navy/10 text-navy/90'
        }`}
      >
        {parts.map((p, i) => {
          if (p.type === 'text') {
            return (
              <p key={i} className="whitespace-pre-wrap leading-relaxed">
                {p.text}
              </p>
            );
          }
          if (p.type?.startsWith('tool-')) {
            const toolName = p.type.replace('tool-', '');
            return (
              <div key={i} className="my-1.5 rounded border border-gold/40 bg-gold-50 px-2 py-1 text-xs text-navy/70">
                <div className="font-mono font-semibold text-gold-900">🔧 {toolName}</div>
                {p.state === 'input-available' && <div className="text-navy/50">chamando...</div>}
                {p.state === 'output-available' && (
                  <div className="mt-1 max-h-32 overflow-auto font-mono text-[10px]">
                    {JSON.stringify(p.output, null, 2).slice(0, 500)}
                    {JSON.stringify(p.output).length > 500 && '...'}
                  </div>
                )}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

export function ChatVendetti({ heightClass, hideHeader }: Props) {
  const [input, setInput] = useState('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const { messages, setMessages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const bottomRef = useRef<HTMLDivElement>(null);

  // Hidrata histórico salvo no banco na primeira montagem
  useEffect(() => {
    let cancelled = false;
    fetch('/api/chat/history')
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.ok && Array.isArray(json.messages) && json.messages.length > 0) {
          // useChat aceita messages com id/role/parts — vamos passar isso direto
          setMessages(json.messages);
        }
        setHistoryLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setHistoryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status === 'streaming') return;
    sendMessage({ text: input.trim() });
    setInput('');
  };

  return (
    <div className={`flex flex-col ${heightClass ?? 'h-[calc(100vh-3.5rem)]'}`}>
      {!hideHeader && (
        <header className="mb-3 flex items-center gap-3 border-b border-navy/10 pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarUrl(CEO, 80)} alt="Vendetti" width={48} height={48} className="rounded-full ring-2 ring-navy/20" />
          <div className="flex-1">
            <h1 className="text-base font-bold text-navy">Vendetti</h1>
            <p className="text-xs text-navy/60">
              {status === 'streaming' ? '✍️ digitando…' : '🟢 online · Opus 4.7'}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!confirm('Apagar histórico do chat?')) return;
              await fetch('/api/chat/history?confirm=1', { method: 'DELETE' });
              setMessages([]);
            }}
            className="text-[10px] text-navy/40 hover:text-navy/70"
            title="Apaga todo o histórico do chat"
          >
            ⌫ novo chat
          </button>
        </header>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto py-2">
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
          <Message key={m.id} role={m.role} parts={m.parts} />
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunta pro Vendetti..."
          disabled={status === 'streaming'}
          className="flex-1 rounded-lg border border-navy/20 bg-white px-4 py-3 text-base focus:border-navy focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || status === 'streaming'}
          className="rounded-lg bg-navy px-5 py-3 font-semibold text-white hover:bg-navy-900 disabled:opacity-50"
        >
          {status === 'streaming' ? '...' : '↑'}
        </button>
      </form>
    </div>
  );
}
