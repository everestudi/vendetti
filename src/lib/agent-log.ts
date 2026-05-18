/**
 * Log unificado por agente — agrega eventos de várias tabelas em uma
 * linha-do-tempo cronológica, pra alimentar o terminal embedado nas pages
 * de cada agente.
 *
 * Cada evento vira uma LogLine com timestamp + nível + source + mensagem.
 *
 * Scopes:
 *   - mara:     scraper sync, snapshots, transactions importadas
 *   - bruno:    NF-e processadas, sync Vendtef de Purchases
 *   - lucia:    Complaints (SAC), Inquiries (não-SAC), hits webhook SAC
 *   - vendetti: Decisions, ChatMessage, todos os WorkerRuns que ele dispara
 *   - weverton: Reposicao + scraper Vendtef abastecimento + grupo Op hits
 *   - all:      união de tudo (pra /monitor e home)
 */

import { prisma } from './db';

export type AgentScope = 'mara' | 'bruno' | 'lucia' | 'vendetti' | 'weverton' | 'rita' | 'zelda' | 'all';
export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface LogLine {
  at: string; // ISO
  level: LogLevel;
  source: string; // 'worker' | 'decision' | 'chat' | 'webhook' | 'complaint' | 'inquiry' | 'tx' | 'snapshot' | 'reposicao' | 'purchase'
  message: string;
  detail?: string;
}

function workerStatusLevel(status: string): LogLevel {
  if (status === 'OK') return 'success';
  if (status === 'FAILED') return 'error';
  if (status === 'RUNNING') return 'info';
  return 'info';
}

async function maraLog(take: number): Promise<LogLine[]> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [runs, snaps] = await Promise.all([
    prisma.workerRun.findMany({
      where: { name: 'mara_sync' },
      orderBy: { startedAt: 'desc' },
      take: Math.min(take, 30),
    }),
    prisma.inventorySnapshot.findMany({
      where: { capturedAt: { gte: since } },
      orderBy: { capturedAt: 'desc' },
      take: 10,
    }),
  ]);

  const lines: LogLine[] = [];
  for (const r of runs) {
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    const itemsProcessed = meta.itemsProcessed;
    const trxCount = meta.trxCount;
    const duration = r.finishedAt
      ? `${Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)}s`
      : '...';
    lines.push({
      at: (r.finishedAt ?? r.startedAt).toISOString(),
      level: workerStatusLevel(r.status),
      source: 'worker',
      message: `mara_sync ${r.status.toLowerCase()}${r.status === 'OK' ? ` em ${duration}` : ''}${
        trxCount ? ` · ${trxCount} trx` : ''
      }${itemsProcessed ? ` · ${itemsProcessed} items` : ''}`,
      detail: r.error ?? undefined,
    });
  }
  for (const s of snaps) {
    lines.push({
      at: s.capturedAt.toISOString(),
      level: 'info',
      source: 'snapshot',
      message: `snapshot · ${s.slotsOk} ok · ${s.slotsAlert} alerta · ${s.slotsCritical} crítico · capacity ${s.capacityFilledPct?.toString() ?? '?'}%`,
    });
  }
  return lines;
}

async function brunoLog(take: number): Promise<LogLine[]> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [runs, purchases] = await Promise.all([
    prisma.workerRun.findMany({
      where: { name: 'vendtef_entrada' },
      orderBy: { startedAt: 'desc' },
      take: Math.min(take, 20),
    }),
    prisma.purchase.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ]);

  const lines: LogLine[] = [];
  for (const r of runs) {
    const duration = r.finishedAt
      ? `${Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)}s`
      : '...';
    lines.push({
      at: (r.finishedAt ?? r.startedAt).toISOString(),
      level: workerStatusLevel(r.status),
      source: 'worker',
      message: `vendtef_entrada ${r.status.toLowerCase()}${r.status === 'OK' ? ` em ${duration}` : ''}`,
      detail: r.error ?? undefined,
    });
  }
  for (const p of purchases) {
    const synced = p.vendtefSyncedAt;
    lines.push({
      at: p.createdAt.toISOString(),
      level: 'info',
      source: 'purchase',
      message: `NF-e ${p.supplierName ?? '?'} · R$ ${Number(p.totalAmount).toFixed(2)} · ${p.invoiceRef ?? 'sem ref'}`,
    });
    if (synced) {
      lines.push({
        at: synced.toISOString(),
        level: 'success',
        source: 'purchase',
        message: `NF-e ${p.invoiceRef ?? p.id.slice(-6)} sincronizada no Vendtef`,
        detail: p.vendtefSyncError ?? undefined,
      });
    } else if (p.vendtefSyncError) {
      lines.push({
        at: p.updatedAt.toISOString(),
        level: 'warn',
        source: 'purchase',
        message: `NF-e ${p.invoiceRef ?? p.id.slice(-6)} sync falhou`,
        detail: p.vendtefSyncError,
      });
    }
  }
  return lines;
}

async function luciaLog(take: number): Promise<LogLine[]> {
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const [complaints, inquiries, webhooks] = await Promise.all([
    prisma.complaint.findMany({
      where: { receivedAt: { gte: since } },
      orderBy: { receivedAt: 'desc' },
      take: 30,
    }),
    prisma.inquiry.findMany({
      where: { receivedAt: { gte: since } },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    }),
    prisma.workerRun.findMany({
      where: {
        name: 'webhook_zapi',
        startedAt: { gte: since },
      },
      orderBy: { startedAt: 'desc' },
      take: Math.min(take, 50),
    }),
  ]);

  const lines: LogLine[] = [];
  for (const c of complaints) {
    const phoneTail = c.customerPhone?.slice(-4) ?? '?';
    lines.push({
      at: c.receivedAt.toISOString(),
      level: 'info',
      source: 'complaint',
      message: `🔴 SAC ${phoneTail} · status=${c.status}`,
      detail: c.customerNote?.slice(0, 200) ?? undefined,
    });
    if (c.resolvedAt) {
      lines.push({
        at: c.resolvedAt.toISOString(),
        level: c.status === 'REFUNDED' ? 'success' : 'info',
        source: 'complaint',
        message: `SAC ${phoneTail} → ${c.status}`,
      });
    }
    if (c.escalatedAt) {
      lines.push({
        at: c.escalatedAt.toISOString(),
        level: 'warn',
        source: 'complaint',
        message: `SAC ${phoneTail} escalada pro Luís`,
      });
    }
  }
  for (const inq of inquiries) {
    const phoneTail = inq.customerPhone?.slice(-4) ?? '?';
    lines.push({
      at: inq.receivedAt.toISOString(),
      level: 'info',
      source: 'inquiry',
      message: `📞 ${inq.category} · ${phoneTail} · ${inq.subject ?? 'sem assunto'}`,
    });
    if (inq.resolvedAt) {
      lines.push({
        at: inq.resolvedAt.toISOString(),
        level: 'success',
        source: 'inquiry',
        message: `inquiry ${phoneTail} → ${inq.status}`,
      });
    }
  }
  // hits de webhook que viraram SAC / Inquiry (filtrando os ignored)
  for (const w of webhooks) {
    const meta = (w.meta ?? {}) as Record<string, unknown>;
    const route = String(meta.route ?? '');
    if (route !== 'admin-cmd' && !route.startsWith('ignored') && !route.startsWith('rejected') && !route.startsWith('weverton')) {
      lines.push({
        at: w.startedAt.toISOString(),
        level: 'info',
        source: 'webhook',
        message: `inbound · ${meta.phone ?? '?'} · ${route}`,
        detail: typeof meta.text === 'string' ? meta.text.slice(0, 120) : undefined,
      });
    }
  }
  return lines;
}

async function vendettiLog(take: number): Promise<LogLine[]> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [decisions, chats, workerRuns] = await Promise.all([
    prisma.decision.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.chatMessage.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.workerRun.findMany({
      where: { startedAt: { gte: since }, name: { not: 'webhook_zapi' } },
      orderBy: { startedAt: 'desc' },
      take: Math.min(take, 40),
    }),
  ]);

  const lines: LogLine[] = [];
  for (const d of decisions) {
    const emoji =
      d.level === 'RED' ? '🔴' : d.level === 'YELLOW' ? '🟡' : '🟢';
    lines.push({
      at: d.createdAt.toISOString(),
      level: 'info',
      source: 'decision',
      message: `${emoji} decision · ${d.kind} · ${d.summary.slice(0, 100)}`,
    });
    if (d.executedAt) {
      lines.push({
        at: d.executedAt.toISOString(),
        level: 'success',
        source: 'decision',
        message: `✓ executada · ${d.id.slice(-6)} · ${d.kind}`,
      });
    }
    if (d.status === 'FAILED') {
      lines.push({
        at: d.createdAt.toISOString(),
        level: 'error',
        source: 'decision',
        message: `✗ FAILED · ${d.id.slice(-6)} · ${d.kind}`,
      });
    }
    if (d.status === 'REJECTED') {
      lines.push({
        at: d.createdAt.toISOString(),
        level: 'warn',
        source: 'decision',
        message: `rejeitada · ${d.id.slice(-6)} · ${d.rejectReason ?? 'sem motivo'}`,
      });
    }
  }
  for (const c of chats) {
    const parts = (c.parts ?? []) as Array<{ type?: string; text?: string }>;
    const text = parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join(' ')
      .slice(0, 120);
    if (text) {
      lines.push({
        at: c.createdAt.toISOString(),
        level: 'info',
        source: 'chat',
        message: `${c.role === 'user' ? '🟪 Luís' : '🤖 Augusto'} · ${text}`,
      });
    }
  }
  for (const r of workerRuns) {
    const duration = r.finishedAt
      ? `${Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)}s`
      : '...';
    lines.push({
      at: (r.finishedAt ?? r.startedAt).toISOString(),
      level: workerStatusLevel(r.status),
      source: 'worker',
      message: `${r.name} ${r.status.toLowerCase()}${r.status === 'OK' ? ` em ${duration}` : ''}`,
      detail: r.error ?? undefined,
    });
  }
  return lines;
}

async function wevertonLog(take: number): Promise<LogLine[]> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [reposicoes, runs, decisions] = await Promise.all([
    prisma.reposicao.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { itens: { include: { sku: true } } },
    }),
    prisma.workerRun.findMany({
      where: { name: 'vendtef_abastecimento' },
      orderBy: { startedAt: 'desc' },
      take: Math.min(take, 20),
    }),
    prisma.decision.findMany({
      where: {
        kind: 'SYSTEM_INVENTORY_SYNC',
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  const lines: LogLine[] = [];
  for (const r of reposicoes) {
    const totalUnits = r.itens.reduce((s, i) => s + i.qty, 0);
    lines.push({
      at: r.createdAt.toISOString(),
      level: 'success',
      source: 'reposicao',
      message: `📦 reposição registrada · ${r.itens.length} slots · ${totalUnits} unidades${r.notes ? ` · ${r.notes}` : ''}`,
    });
  }
  for (const w of runs) {
    const duration = w.finishedAt
      ? `${Math.round((w.finishedAt.getTime() - w.startedAt.getTime()) / 1000)}s`
      : '...';
    lines.push({
      at: (w.finishedAt ?? w.startedAt).toISOString(),
      level: workerStatusLevel(w.status),
      source: 'worker',
      message: `🤖 scraper abastecimento ${w.status.toLowerCase()}${w.status === 'OK' ? ` em ${duration}` : ''}`,
      detail: w.error ?? undefined,
    });
  }
  for (const d of decisions) {
    const data = (d.data ?? {}) as Record<string, unknown>;
    if (data.source !== 'weverton-group') continue;
    const items = Array.isArray(data.items) ? data.items.length : '?';
    const emoji = d.level === 'RED' ? '🔴' : d.level === 'YELLOW' ? '🟡' : '🟢';
    lines.push({
      at: d.createdAt.toISOString(),
      level: 'info',
      source: 'decision',
      message: `${emoji} Decision criada · ${items} slot(s) · status=${d.status}`,
    });
    if (data.dispatchedAt) {
      lines.push({
        at: String(data.dispatchedAt),
        level: 'info',
        source: 'decision',
        message: `🚀 GH Action disparada · ${d.id.slice(-6)}`,
      });
    }
  }
  return lines;
}

async function ritaLog(take: number): Promise<LogLine[]> {
  // Rita = Operações. Por enquanto puxa decisions kind=SLOT_UPDATE, PRICE_CHANGE
  // + WorkerRuns de scrapers de operação
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [decisions, runs] = await Promise.all([
    prisma.decision.findMany({
      where: {
        createdAt: { gte: since },
        kind: { in: ['PRICE_CHANGE', 'SLOT_REORG', 'SYSTEM_INVENTORY_SYNC'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.workerRun.findMany({
      where: {
        name: { in: ['vendtef_abastecimento', 'vendtef_slot_update', 'vendtef_entrada'] },
        startedAt: { gte: since },
      },
      orderBy: { startedAt: 'desc' },
      take: Math.min(take, 20),
    }),
  ]);

  const lines: LogLine[] = [];
  for (const d of decisions) {
    lines.push({
      at: d.createdAt.toISOString(),
      level: 'info',
      source: 'decision',
      message: `${d.kind} · ${d.summary.slice(0, 100)}`,
    });
  }
  for (const r of runs) {
    const duration = r.finishedAt
      ? `${Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)}s`
      : '...';
    lines.push({
      at: (r.finishedAt ?? r.startedAt).toISOString(),
      level: workerStatusLevel(r.status),
      source: 'worker',
      message: `${r.name} ${r.status.toLowerCase()}${r.status === 'OK' ? ` em ${duration}` : ''}`,
      detail: r.error ?? undefined,
    });
  }
  return lines;
}

async function zeldaLog(take: number): Promise<LogLine[]> {
  // Zelda = Oversight. Por enquanto puxa Ideas + decisions REJECTED + audits
  void take;
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const [ideas, rejected] = await Promise.all([
    prisma.idea.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.decision.findMany({
      where: { createdAt: { gte: since }, status: 'REJECTED' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);
  const lines: LogLine[] = [];
  for (const i of ideas) {
    lines.push({
      at: i.createdAt.toISOString(),
      level: 'info',
      source: 'idea',
      message: `💡 ideia · ${i.content.slice(0, 100)}`,
    });
  }
  for (const d of rejected) {
    lines.push({
      at: d.createdAt.toISOString(),
      level: 'warn',
      source: 'decision',
      message: `decision rejeitada · ${d.kind} · ${d.rejectReason ?? 'sem motivo'}`,
    });
  }
  return lines;
}

export async function getAgentLog(scope: AgentScope, take = 80): Promise<LogLine[]> {
  let lines: LogLine[] = [];
  switch (scope) {
    case 'mara':
      lines = await maraLog(take);
      break;
    case 'bruno':
      lines = await brunoLog(take);
      break;
    case 'lucia':
      lines = await luciaLog(take);
      break;
    case 'vendetti':
      lines = await vendettiLog(take);
      break;
    case 'weverton':
      lines = await wevertonLog(take);
      break;
    case 'rita':
      lines = await ritaLog(take);
      break;
    case 'zelda':
      lines = await zeldaLog(take);
      break;
    case 'all': {
      const all = await Promise.all([
        maraLog(20),
        brunoLog(20),
        luciaLog(20),
        vendettiLog(20),
        wevertonLog(20),
      ]);
      lines = all.flat();
      break;
    }
  }
  // Ordena desc por timestamp e corta
  return lines
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, take);
}
