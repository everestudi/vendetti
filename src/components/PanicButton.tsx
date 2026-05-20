'use client';

/**
 * Botão de pânico — para a empresa toda em 1 clique.
 *
 * UX:
 *   - Idle: botão vermelho "⏸ Pausar empresa" no canto direito do header /empresa
 *   - Click → modal de confirmação com campo opcional "motivo"
 *   - POST /api/agents/panic → todos os agentes ficam paused=true, wakeups QUEUED viram FAILED
 *   - Banner vermelho fixo no topo enquanto pausada com botão "▶ Retomar"
 *   - Retomar: DELETE /api/agents/panic → todos paused=false
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  isPanicNow: boolean;
  pausedCount: number;
  totalActive: number;
  pausedReason?: string | null;
}

export function PanicButton({ isPanicNow, pausedCount, totalActive, pausedReason }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [isPending, startTransition] = useTransition();

  async function triggerPanic() {
    const r = await fetch('/api/agents/panic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason || 'botão de pânico' }),
    });
    if (!r.ok) {
      alert('Falha ao pausar — veja console.');
      return;
    }
    setConfirming(false);
    setReason('');
    startTransition(() => router.refresh());
  }

  async function resume() {
    if (!confirm('Retomar todos os agentes pausados?')) return;
    const r = await fetch('/api/agents/panic', { method: 'DELETE' });
    if (!r.ok) {
      alert('Falha ao retomar — veja console.');
      return;
    }
    startTransition(() => router.refresh());
  }

  // Estado: empresa pausada → banner vermelho + botão retomar
  if (isPanicNow) {
    return (
      <div className="fixed inset-x-0 top-0 z-50 border-b-2 border-rose-700 bg-rose-600 text-white shadow-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-lg">⏸</span>
            <strong>Empresa PAUSADA</strong>
            <span className="opacity-85">
              · {pausedCount}/{totalActive} agentes parados
              {pausedReason && ` · "${pausedReason}"`}
            </span>
          </div>
          <button
            onClick={resume}
            disabled={isPending}
            className="rounded bg-white px-3 py-1 text-xs font-bold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
          >
            {isPending ? 'Retomando...' : '▶ Retomar tudo'}
          </button>
        </div>
      </div>
    );
  }

  // Estado: rodando normal → botão de pânico discreto
  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        title="Pausa toda a empresa em emergência"
        className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
      >
        ⏸ Pausar empresa
      </button>
    );
  }

  // Modal de confirmação
  return (
    <div className="rounded-lg border-2 border-rose-400 bg-rose-50 p-3 shadow-md">
      <div className="text-xs font-bold text-rose-900">Pausar todos os agentes?</div>
      <p className="mt-1 text-[10px] text-rose-700">
        Wakeups na fila serão dropados. Runs em andamento terminam naturalmente.
      </p>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="motivo (opcional)"
        className="mt-2 w-full rounded border border-rose-300 bg-white px-2 py-1 text-xs text-navy placeholder:text-navy/40 focus:outline-none focus:ring-1 focus:ring-rose-500"
      />
      <div className="mt-2 flex gap-2">
        <button
          onClick={triggerPanic}
          disabled={isPending}
          className="flex-1 rounded bg-rose-600 px-3 py-1 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {isPending ? 'Pausando...' : 'Confirmar PAUSE'}
        </button>
        <button
          onClick={() => {
            setConfirming(false);
            setReason('');
          }}
          className="rounded border border-rose-300 px-3 py-1 text-xs text-rose-700 hover:bg-rose-100"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
