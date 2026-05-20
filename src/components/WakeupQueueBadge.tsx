'use client';

/**
 * Indicador de wakeups pendentes na fila do runtime.
 *
 * Aparece quando há AgentWakeupRequest status=QUEUED.
 * Mostra:
 *   - quantos pendentes
 *   - quem mais antigo (agente + slug)
 *   - tempo até próximo cron (estimado: ≤15min)
 *   - botão "▶ Forçar tick agora" — POST /api/tick que processa N wakeups
 *
 * Some quando fila vazia.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  queuedCount: number;
  oldestQueued?: {
    createdAt: string;
    agentSlug: string | null;
    agentName: string | null;
    agentEmoji: string | null;
  } | null;
}

function minutesAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export function WakeupQueueBadge({ queuedCount, oldestQueued }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (queuedCount === 0) return null;

  async function forceTick() {
    setConfirming(false);
    try {
      const r = await fetch('/api/agents/force-tick', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) {
        alert(`Falha: ${j.error ?? r.status}`);
        return;
      }
      // Reload pra ver fila vazia
      startTransition(() => router.refresh());
    } catch (e) {
      alert(`Erro: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const oldestMin = oldestQueued ? minutesAgo(oldestQueued.createdAt) : 0;
  const isLagging = oldestMin >= 15; // se passou 15min sem cron processar

  return (
    <div
      className={`rounded-lg border-2 px-3 py-2 ${
        isLagging ? 'border-amber-400 bg-amber-50' : 'border-amber-200 bg-amber-50/50'
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-base">⏳</span>
          <span className="text-sm font-semibold text-amber-900">
            {queuedCount} {queuedCount === 1 ? 'agente' : 'agentes'} aguardando
          </span>
        </div>
        {oldestQueued && (
          <span className="text-xs text-amber-800/80">
            {oldestQueued.agentEmoji} {oldestQueued.agentName} ·{' '}
            {oldestMin < 1 ? 'agora' : `há ${oldestMin}min`}
            {isLagging && ' · ⚠️ atrasado'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-amber-800/65">
            cron processa a cada ~15min
          </span>
          {confirming ? (
            <>
              <button
                onClick={forceTick}
                disabled={isPending}
                className="rounded-md bg-amber-700 px-2 py-1 text-[11px] font-bold text-white hover:bg-amber-800 disabled:opacity-50"
              >
                {isPending ? '...' : 'Confirmar'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded-md border border-amber-300 px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-100"
              >
                cancelar
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={isPending}
              className="rounded-md border-2 border-amber-400 bg-white px-2 py-1 text-[11px] font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              ▶ Processar agora
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
