/**
 * Saúde da infra · permite ao Vendetti detectar staleness sem precisar que
 * alguém aponte. Cobre:
 *
 *  - Pipelines de dados: última Transaction, último InventorySnapshot,
 *    última Decision (proxy de "agente tá vivo").
 *  - Workers: última execução por nome em WorkerRun, com status.
 *
 * STALE_THRESHOLDS são por pipeline — Mara faz sync 1x/dia então 26h é OK,
 * mas transactions é contínuo (cada venda) então > 6h é suspeito.
 */

import { prisma } from '../db';
import type { Prisma } from '@prisma/client';

export const STALE_THRESHOLDS_H = {
  transactions: 24, // 1 dia (Mara sync diário)
  snapshot: 26, // 26h (Mara cron diário)
  decision: 168, // 7 dias (agente pode ficar parado legitimamente)
  workerDefault: 26,
} as const;

export type WorkerName =
  | 'mara_sync'
  | 'vendtef_entrada'
  | 'sac_cleanup'
  | 'inquiry_audit'
  | string;

export interface PipelineHealth {
  pipeline: string;
  lastUpdate: Date | null;
  ageHours: number | null;
  isStale: boolean;
  threshold: number;
}

export interface WorkerHealth {
  name: string;
  lastRun: Date | null;
  ageHours: number | null;
  status: 'OK' | 'FAILED' | 'RUNNING' | 'NEVER';
  isStale: boolean;
  error?: string | null;
}

export interface InfraHealth {
  isStale: boolean;
  reasons: string[];
  pipelines: PipelineHealth[];
  workers: WorkerHealth[];
  capturedAt: Date;
}

function hoursBetween(now: Date, then: Date | null | undefined): number | null {
  if (!then) return null;
  return Math.round(((now.getTime() - then.getTime()) / 3_600_000) * 10) / 10;
}

export async function getInfraHealth(): Promise<InfraHealth> {
  const now = new Date();
  const [lastTx, lastSnap, lastDec, workers] = await Promise.all([
    prisma.transaction.findFirst({ orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
    prisma.inventorySnapshot.findFirst({ orderBy: { capturedAt: 'desc' }, select: { capturedAt: true } }),
    prisma.decision.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    // Últimas runs por worker (1 por nome, mais recente)
    prisma.$queryRaw<Array<{ name: string; startedAt: Date; finishedAt: Date | null; status: string; error: string | null }>>`
      SELECT DISTINCT ON (name) name, "startedAt", "finishedAt", status, error
      FROM "WorkerRun"
      ORDER BY name, "startedAt" DESC
    `.catch(() => []),
  ]);

  const pipelines: PipelineHealth[] = [
    {
      pipeline: 'transactions',
      lastUpdate: lastTx?.occurredAt ?? null,
      ageHours: hoursBetween(now, lastTx?.occurredAt),
      threshold: STALE_THRESHOLDS_H.transactions,
      isStale:
        !lastTx?.occurredAt ||
        (hoursBetween(now, lastTx.occurredAt) ?? 0) > STALE_THRESHOLDS_H.transactions,
    },
    {
      pipeline: 'snapshot',
      lastUpdate: lastSnap?.capturedAt ?? null,
      ageHours: hoursBetween(now, lastSnap?.capturedAt),
      threshold: STALE_THRESHOLDS_H.snapshot,
      isStale:
        !lastSnap?.capturedAt ||
        (hoursBetween(now, lastSnap.capturedAt) ?? 0) > STALE_THRESHOLDS_H.snapshot,
    },
    {
      pipeline: 'decision',
      lastUpdate: lastDec?.createdAt ?? null,
      ageHours: hoursBetween(now, lastDec?.createdAt),
      threshold: STALE_THRESHOLDS_H.decision,
      // Decision não é stale por inatividade — só marca pra visibilidade
      isStale: false,
    },
  ];

  const workersHealth: WorkerHealth[] = workers.map((w) => {
    const ref = w.finishedAt ?? w.startedAt;
    const age = hoursBetween(now, ref);
    const status =
      (w.status as 'OK' | 'FAILED' | 'RUNNING') === 'OK'
        ? 'OK'
        : w.status === 'FAILED'
          ? 'FAILED'
          : 'RUNNING';
    return {
      name: w.name,
      lastRun: ref,
      ageHours: age,
      status,
      error: w.error,
      isStale:
        status === 'FAILED' ||
        (status !== 'RUNNING' && (age ?? Infinity) > STALE_THRESHOLDS_H.workerDefault),
    };
  });

  const reasons: string[] = [];
  for (const p of pipelines) {
    if (p.isStale) {
      reasons.push(
        p.lastUpdate
          ? `${p.pipeline}: última atualização há ${p.ageHours}h (limite ${p.threshold}h)`
          : `${p.pipeline}: sem registros`,
      );
    }
  }
  for (const w of workersHealth) {
    if (w.status === 'FAILED') reasons.push(`worker ${w.name}: última run FALHOU${w.error ? ` — ${w.error.slice(0, 80)}` : ''}`);
    else if (w.isStale) reasons.push(`worker ${w.name}: última run há ${w.ageHours}h`);
  }

  return {
    isStale: reasons.length > 0,
    reasons,
    pipelines,
    workers: workersHealth,
    capturedAt: now,
  };
}

/**
 * Wrap pra gravar uma execução de worker.
 *
 * Uso:
 *   await runWithWorkerLog('mara_sync', async () => {
 *     // ...
 *     return { itemsProcessed: 42 };
 *   });
 *
 * Se a fn throw, status=FAILED com error.
 * Se OK, status=OK com meta = retorno da fn.
 */
export async function runWithWorkerLog<T>(
  name: WorkerName,
  fn: () => Promise<T>,
): Promise<T> {
  const run = await prisma.workerRun.create({
    data: { name, status: 'RUNNING' },
  });
  try {
    const result = await fn();
    await prisma.workerRun.update({
      where: { id: run.id },
      data: {
        status: 'OK',
        finishedAt: new Date(),
        meta: (result ?? null) as unknown as Prisma.InputJsonValue,
      },
    });
    return result;
  } catch (err) {
    await prisma.workerRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}`.slice(0, 4000) : String(err),
      },
    });
    throw err;
  }
}

export interface DataFreshness {
  lastUpdate: Date | null;
  ageHours: number | null;
  isStale: boolean;
}

export async function getFreshness(pipeline: 'transactions' | 'snapshot'): Promise<DataFreshness> {
  const now = new Date();
  if (pipeline === 'transactions') {
    const last = await prisma.transaction.findFirst({
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    });
    const age = hoursBetween(now, last?.occurredAt);
    return {
      lastUpdate: last?.occurredAt ?? null,
      ageHours: age,
      isStale: !last?.occurredAt || (age ?? 0) > STALE_THRESHOLDS_H.transactions,
    };
  }
  const last = await prisma.inventorySnapshot.findFirst({
    orderBy: { capturedAt: 'desc' },
    select: { capturedAt: true },
  });
  const age = hoursBetween(now, last?.capturedAt);
  return {
    lastUpdate: last?.capturedAt ?? null,
    ageHours: age,
    isStale: !last?.capturedAt || (age ?? 0) > STALE_THRESHOLDS_H.snapshot,
  };
}
