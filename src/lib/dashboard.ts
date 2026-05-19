/**
 * Queries pra dashboard da home — agrega dados de todos os domínios.
 *
 * Faturamento histórico, última sync, pendências por agente.
 * Mantém em UM lugar pra evitar N queries espalhadas.
 */

import { prisma } from './db';
import { STALE_THRESHOLDS_H } from './infra/health';

const brl = (n: number) =>
  Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

export interface MonthlyRevenuePoint {
  year: number;
  month: number; // 0-11
  label: string; // ex "Mai/26"
  revenue: number;
  txCount: number;
}

/** Faturamento dos últimos N meses (incluindo o atual, parcial). */
export async function getMonthlyRevenueSeries(monthsBack = 12): Promise<MonthlyRevenuePoint[]> {
  const machine = await prisma.machine.findFirst({ where: { name: 'Maquina BlueMall Rondon' } });
  if (!machine) return [];

  const now = new Date();
  const series: MonthlyRevenuePoint[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = ref.getFullYear();
    const m = ref.getMonth();
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59));
    const rows = await prisma.dailyRevenue.findMany({
      where: { machineId: machine.id, date: { gte: start, lte: end } },
    });
    const txRows = await prisma.transaction.aggregate({
      where: { occurredAt: { gte: start, lte: end }, status: 'OK' },
      _count: true,
      _sum: { grossAmount: true },
    });
    const revenue = rows.reduce((s, r) => s + Number(r.totalRevenue), 0) || Number(txRows._sum.grossAmount ?? 0);
    series.push({
      year: y,
      month: m,
      label: ref.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', ''),
      revenue,
      txCount: txRows._count,
    });
  }
  return series;
}

export interface SyncStatus {
  /** Última transação registrada (proxy de "estamos atualizados"). */
  lastTransactionAt: Date | null;
  /** Última snapshot de estoque. */
  lastSnapshotAt: Date | null;
  /** Última execução OK do scraper mara_sync. */
  lastSyncRunAt: Date | null;
  lastSyncStatus: 'OK' | 'FAILED' | 'RUNNING' | null;
  isStale: boolean;
  ageHours: number | null;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const [lastTx, lastSnap, lastRun] = await Promise.all([
    prisma.transaction.findFirst({ orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
    prisma.inventorySnapshot.findFirst({ orderBy: { capturedAt: 'desc' }, select: { capturedAt: true } }),
    prisma.workerRun.findFirst({
      where: { name: 'mara_sync' },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true, finishedAt: true, status: true },
    }),
  ]);
  const ref = lastSnap?.capturedAt ?? lastTx?.occurredAt ?? null;
  const ageHours = ref ? Math.round(((Date.now() - ref.getTime()) / 3_600_000) * 10) / 10 : null;
  return {
    lastTransactionAt: lastTx?.occurredAt ?? null,
    lastSnapshotAt: lastSnap?.capturedAt ?? null,
    lastSyncRunAt: lastRun?.finishedAt ?? lastRun?.startedAt ?? null,
    lastSyncStatus: (lastRun?.status as 'OK' | 'FAILED' | 'RUNNING' | null) ?? null,
    isStale: !ref || (ageHours ?? 0) > STALE_THRESHOLDS_H.snapshot,
    ageHours,
  };
}

export interface AgentPending {
  agentId: 'bruno' | 'lucia' | 'rita' | 'zelda';
  label: string;
  emoji: string;
  href: string;
  count: number; // total pra mostrar como badge
  /** 1-3 itens resumidos pra mostrar inline */
  summaryLines: string[];
  /** Cor do card (green = nada urgente, amber = atenção, red = urgente) */
  level: 'ok' | 'warn' | 'critical';
}

export async function getPendingByAgent(): Promise<AgentPending[]> {
  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const [
    purchasesUnsynced,
    purchasesMonth,
    complaintsOpen,
    complaintsEscalated,
    inquiriesNew,
    weventonPending,
    zeldaFindings,
  ] = await Promise.all([
    prisma.purchase.findMany({
      where: { OR: [{ vendtefSyncedAt: null }, { vendtefSyncError: { not: null } }] },
      orderBy: { occurredAt: 'desc' },
      take: 5,
    }),
    prisma.purchase.aggregate({
      where: { occurredAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.complaint.count({
      where: { status: { in: ['RECEIVED', 'AWAITING_PROOF', 'AWAITING_SLOT', 'AWAITING_INFO'] } },
    }),
    prisma.complaint.count({ where: { status: 'ESCALATED' } }),
    prisma.inquiry.count({ where: { status: { in: ['NEW', 'ESCALATED'] } } }),
    prisma.decision.findMany({
      where: { kind: 'SYSTEM_INVENTORY_SYNC', status: { in: ['PENDING', 'APPROVED'] } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.idea.findMany({
      where: { content: { startsWith: '[Zelda' }, status: 'NEW', createdAt: { gte: since30d } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  // Bruno · Compras
  const brunoSyncIssues = purchasesUnsynced.length;
  const monthSpend = Number(purchasesMonth._sum.totalAmount ?? 0);
  const brunoLines: string[] = [];
  if (brunoSyncIssues > 0) brunoLines.push(`${brunoSyncIssues} NF-e(s) sem sync no Vendtef`);
  brunoLines.push(`${purchasesMonth._count} compras · ${brl(monthSpend)} no mês`);
  const bruno: AgentPending = {
    agentId: 'bruno',
    label: 'Compras · Bruno',
    emoji: '🧾',
    href: '/bruno',
    count: brunoSyncIssues,
    summaryLines: brunoLines,
    level: brunoSyncIssues > 0 ? 'warn' : 'ok',
  };

  // Lúcia · SAC + Inquiries
  const luciaTotal = complaintsOpen + complaintsEscalated + inquiriesNew;
  const luciaLines: string[] = [];
  if (complaintsEscalated > 0) luciaLines.push(`${complaintsEscalated} SAC escaladas pra você`);
  if (complaintsOpen > 0) luciaLines.push(`${complaintsOpen} SAC abertas`);
  if (inquiriesNew > 0) luciaLines.push(`${inquiriesNew} inquéritos novos (locação, estacionamento, geral)`);
  if (luciaLines.length === 0) luciaLines.push('sem pendências');
  const lucia: AgentPending = {
    agentId: 'lucia',
    label: 'Atendimento · Lúcia',
    emoji: '💬',
    href: '/sac',
    count: luciaTotal,
    summaryLines: luciaLines,
    level: complaintsEscalated > 0 ? 'critical' : luciaTotal > 0 ? 'warn' : 'ok',
  };

  // Rita · Operações (reposição Weverton)
  const ritaLines: string[] = [];
  if (weventonPending.length > 0) {
    ritaLines.push(`${weventonPending.length} reposição(ões) aguardando aprovação/execução`);
    for (const d of weventonPending.slice(0, 2)) {
      ritaLines.push(`· ${d.summary.slice(0, 60)} (${d.status})`);
    }
  } else {
    ritaLines.push('sem reposições pendentes');
  }
  const rita: AgentPending = {
    agentId: 'rita',
    label: 'Operações · Rita',
    emoji: '🔧',
    href: '/decisions',
    count: weventonPending.length,
    summaryLines: ritaLines,
    level: weventonPending.length > 0 ? 'warn' : 'ok',
  };

  // Zelda · Auditoria
  const zeldaLines: string[] = [];
  if (zeldaFindings.length > 0) {
    zeldaFindings.slice(0, 3).forEach((i) => {
      const firstLine = i.content.split('\n')[0].slice(0, 80);
      zeldaLines.push(`· ${firstLine}`);
    });
  } else {
    zeldaLines.push('sem findings novos');
  }
  const zelda: AgentPending = {
    agentId: 'zelda',
    label: 'Auditoria · Zelda',
    emoji: '🔍',
    href: '/equipe/zelda',
    count: zeldaFindings.length,
    summaryLines: zeldaLines,
    level: zeldaFindings.length > 0 ? 'warn' : 'ok',
  };

  return [bruno, lucia, rita, zelda];
}
