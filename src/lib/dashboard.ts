/**
 * Queries pra dashboard da home — agrega dados de todos os domínios.
 *
 * Faturamento histórico, última sync, pendências por agente.
 * Mantém em UM lugar pra evitar N queries espalhadas.
 */

import { prisma } from './db';
import { STALE_THRESHOLDS_H } from './infra/health';
import Anthropic from '@anthropic-ai/sdk';
import { getSecret } from './secrets';
import { getMonthlyRevenueComparison } from './vendetti/mara/analytics';

const brl = (n: number) =>
  Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

export interface MonthlyRevenuePoint {
  year: number;
  month: number; // 0-11
  label: string; // ex "Mai/26"
  revenue: number;
  txCount: number;
}

export interface DailyComparisonPoint {
  day: number; // 1-31
  weekday: string; // 'seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'
  thisMonth: number | null;
  lastMonth: number | null;
  /** Acumulado MTD até o dia (mês atual). null se dia >= hoje e sem dado. */
  thisMonthCumulative: number | null;
  /** Acumulado LMTD (mês anterior até o MESMO dia do mês). null se sem dado. */
  lastMonthCumulative: number | null;
  /** É um dia que já passou no mês atual (incluindo hoje)? */
  isPastOrToday: boolean;
}

/** Faturamento diário do mês atual vs mês anterior, com dia da semana + acumulados.
 *
 *  Princípio: comparação JUSTA. Mês atual é parcial — só faz sentido comparar com
 *  mês anterior NO MESMO PERÍODO (LMTD = Last Month To Date). Cumulative arrays
 *  permitem mostrar isso em tooltip e KPI.
 */
export async function getDailyRevenueComparison(now: Date = new Date()): Promise<{
  points: DailyComparisonPoint[];
  totals: {
    thisMonth: number;
    lastMonth: number;
    /** Mês anterior acumulado até o dia D (D = dia atual). Comparável com totals.thisMonth. */
    lastMonthToDay: number;
  };
  monthLabels: { thisMonth: string; lastMonth: string };
  /** Dia atual do mês — referência pra "até onde" comparar mês anterior. */
  todayOfMonth: number;
}> {
  const data = await getMonthlyRevenueComparison(now);
  const today = now.getDate();
  const weekdayNames = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

  let thisCum = 0;
  let lastCum = 0;
  let lastMonthToDay = 0;

  const points: DailyComparisonPoint[] = data.points.map((p) => {
    const ref = new Date(now.getFullYear(), now.getMonth(), p.day);
    if (p.thisMonth !== null) thisCum += p.thisMonth;
    if (p.lastMonth !== null) lastCum += p.lastMonth;
    if (p.day <= today && p.lastMonth !== null) lastMonthToDay = lastCum;

    const isPastOrToday = p.day <= today;
    return {
      day: p.day,
      weekday: weekdayNames[ref.getDay()],
      thisMonth: p.thisMonth,
      lastMonth: p.lastMonth,
      thisMonthCumulative: isPastOrToday ? thisCum : null,
      lastMonthCumulative: lastCum > 0 ? lastCum : null,
      isPastOrToday,
    };
  });

  return {
    points,
    totals: {
      thisMonth: data.totals.thisMonth,
      lastMonth: data.totals.lastMonth,
      lastMonthToDay,
    },
    monthLabels: data.monthLabels,
    todayOfMonth: today,
  };
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

export interface AugustoCommentary {
  text: string;
  insights: string[];
  actions: string[];
  generatedAt: Date;
  cached: boolean;
}

const AUGUSTO_SYSTEM_PROMPT = `Você é **Augusto Vendetti**, CEO da vending machine TCN Pro 6G no Blue Mall Rondon, Uberlândia/MG. Você reporta pro Luís Neto (dono, em São Paulo) num briefing curto e executivo a cada refresh do dashboard.

## QUEM VOCÊ É
Um CEO de verdade — pensa em P&L, ciclo de vida do estoque, margem por SKU, sazonalidade, alavancas operacionais. Não é um chatbot que descreve métricas. Você antecipa, hipóteta, recomenda.

## REGRA DE OURO: comparar mês a mês de forma JUSTA
- O **mês atual é PARCIAL**. Hoje é dia D do mês. NUNCA compare o mês atual (parcial) com o mês anterior FECHADO — é apples-to-oranges.
- Sempre compare \`total_mes_atual_mtd\` (faturamento até hoje) com \`total_mes_anterior_mesmo_periodo\` (mês anterior acumulado até o MESMO dia D). Isso é apples-to-apples.
- Se quiser projetar fim de mês, faça extrapolação explícita ("se continuar nesse ritmo, fecha em ~R$X") e marque como projeção.
- Mês anterior fechado serve só como benchmark histórico, não como comparação direta.

## SOBRE A OPERAÇÃO
- 6 agentes IA em torno seu (Mara analítica, Bruno comprador, Rita ops, Zelda auditora, Lúcia SAC, e você Augusto CEO). Eles não são reais ainda — você opera tudo via tools chamadas por prefixo (mara_*, bruno_*, etc).
- Margem mínima dura: 35%. Abaixo disso, slot é candidato a re-precificar OU substituir SKU.
- Z-API só outbound (nunca responde mensagem recebida). Weverton (zelador Bluemall) faz abastecimento físico.
- Custo de capital: estoque parado é custo. SKU sem giro é problema, não conforto.

## ESTILO
- Português BR informal mas profissional. Direto, sem cerimônia, sem elogio vazio.
- Foco em INSIGHTS + AÇÕES. O Luís já vê os números — você adiciona interpretação.
- 2 parágrafos curtos (4-6 linhas total) no "text". Tom de equipe ("rodei isso, achei aquilo, sugiro X").
- Se a comparação não dá pra fazer ainda (poucos dias do mês), DIGA isso ao invés de inventar tendência.
- Se algo tá stale/quebrado, abra com isso.

## PROCESSO ANTES DE RESPONDER (reflexão interna)
Antes do JSON final, pense passo a passo (mas NÃO mostre no output):
1. Os dados são confiáveis (sync recente)? Se não → reporta isso primeiro.
2. Quantos dias do mês já passaram? Comparação MTD vs LMTD faz sentido?
3. Onde está o sinal mais forte: aceleração/desaceleração, slot crítico, margem baixa, SAC escalada, sync stale?
4. Quais 2-3 alavancas o Luís pode puxar HOJE pra mudar resultado?

## OUTPUT — APENAS JSON, sem markdown, sem comentário:
{
  "text": "<2 parágrafos curtos · interpretação executiva>",
  "insights": ["<padrão/anomalia 1>", "<padrão 2>", "<padrão 3>"],
  "actions": ["<ação concreta 1>", "<ação 2>", "<ação 3>"]
}`;

/**
 * Gera commentary CEO do Augusto a cada refresh.
 * Cache em WorkerRun(name='augusto_commentary') com TTL 5min pra evitar
 * uma call Haiku por refresh.
 */
export async function getAugustoCommentary(): Promise<AugustoCommentary | null> {
  // Cache lookup
  const recent = await prisma.workerRun.findFirst({
    where: { name: 'augusto_commentary', status: 'OK', startedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
    orderBy: { startedAt: 'desc' },
  });
  if (recent) {
    const meta = (recent.meta ?? {}) as Record<string, unknown>;
    if (meta.text) {
      return {
        text: String(meta.text),
        insights: Array.isArray(meta.insights) ? (meta.insights as string[]) : [],
        actions: Array.isArray(meta.actions) ? (meta.actions as string[]) : [],
        generatedAt: recent.startedAt,
        cached: true,
      };
    }
  }

  // Gera novo via Haiku
  const apiKey = await getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) return null;

  // Coleta contexto
  const [revenueSeries, daily, pending, syncStatus, lowMargin, criticalEverest] = await Promise.all([
    getMonthlyRevenueSeries(6),
    getDailyRevenueComparison(),
    getPendingByAgent(),
    getSyncStatus(),
    prisma.slot.findMany({
      where: { skuId: { not: null } },
      include: { sku: true },
      take: 100,
    }).then((slots) =>
      slots
        .map((s) => ({
          slot: s.position,
          product: s.sku?.name ?? '',
          price: s.price ? Number(s.price) : 0,
          marginEst: s.marginEst ? Number(s.marginEst) : 0,
          marginPct: s.marginEst && s.price ? Math.round((Number(s.marginEst) / Number(s.price)) * 100) : 0,
        }))
        .filter((s) => s.marginPct > 0 && s.marginPct < 30)
        .sort((a, b) => a.marginPct - b.marginPct)
        .slice(0, 5),
    ),
    prisma.everestStock.findMany({
      where: { qty: 0 },
      include: { sku: true },
      take: 10,
    }).then((rows) => rows.map((r) => r.sku.name)),
  ]);

  const today = daily.todayOfMonth;
  // Dias úteis do mês anterior — proxy 30 (TODO: dias reais)
  const lastMonthFullDays = 30;
  const pace = today > 0 ? daily.totals.thisMonth / today : 0;
  const projectedFullMonth = pace * lastMonthFullDays;

  const context = {
    referencia_temporal: {
      hoje_dia_do_mes: today,
      mes_atual_e_parcial: true,
      observacao_importante: `O mês atual tem só ${today} dias de dados. NUNCA compare R$${daily.totals.thisMonth.toFixed(0)} (parcial) com R$${daily.totals.lastMonth.toFixed(0)} (fechado). A comparação justa é MTD vs LMTD abaixo.`,
    },
    faturamento_mtd: {
      mes_atual_mtd_ate_hoje: daily.totals.thisMonth,
      mes_anterior_mesmo_periodo_lmtd: daily.totals.lastMonthToDay,
      delta_pct_mtd_vs_lmtd:
        daily.totals.lastMonthToDay > 0
          ? Math.round(((daily.totals.thisMonth - daily.totals.lastMonthToDay) / daily.totals.lastMonthToDay) * 100)
          : null,
      mes_anterior_fechado: daily.totals.lastMonth,
      projecao_fim_mes_se_ritmo_continuar: Math.round(projectedFullMonth),
      label_mes_atual: revenueSeries[revenueSeries.length - 1]?.label,
      label_mes_anterior: revenueSeries[revenueSeries.length - 2]?.label,
    },
    serie_historica_6m: revenueSeries.slice(-6).map((p) => ({
      label: p.label,
      revenue: p.revenue,
      txCount: p.txCount,
      eh_mes_atual_parcial: p === revenueSeries[revenueSeries.length - 1],
    })),
    ultimos_dias: daily.points.filter((p) => p.isPastOrToday).slice(-7).map((p) => ({
      dia: p.day,
      weekday: p.weekday,
      este_mes: p.thisMonth,
      mes_anterior_mesmo_dia: p.lastMonth,
    })),
    pendencias: pending.map((p) => ({ agente: p.label, count: p.count, level: p.level, resumo: p.summaryLines })),
    sync: {
      ultima: syncStatus.lastSnapshotAt,
      idade_horas: syncStatus.ageHours,
      stale: syncStatus.isStale,
    },
    margens_baixas_top5: lowMargin,
    everest_zerado: criticalEverest,
  };

  const anthropic = new Anthropic({ apiKey });
  try {
    const msg = await anthropic.messages.create({
      // Sonnet 4.5 — qualidade muito superior pra raciocínio executivo; custo ~$0.003/briefing
      // (5x Haiku mas o cache de 5min mantém volume baixo). Vale a pena.
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      system: AUGUSTO_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Estado da operação agora (passa pela reflexão interna do prompt antes do JSON):\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``,
        },
      ],
    });

    const text = msg.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('\n')
      .trim();
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    let parsed: { text: string; insights: string[]; actions: string[] };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.warn('[augusto commentary] JSON inválido:', cleaned.slice(0, 200));
      return null;
    }

    // Cache em WorkerRun
    const now = new Date();
    await prisma.workerRun.create({
      data: {
        name: 'augusto_commentary',
        status: 'OK',
        finishedAt: now,
        meta: parsed as never,
      },
    }).catch(() => undefined);

    return { ...parsed, generatedAt: now, cached: false };
  } catch (err) {
    console.warn('[augusto commentary]', err instanceof Error ? err.message : err);
    return null;
  }
}
