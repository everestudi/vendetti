/**
 * Runtime de agentes Vendetti — o coração do sistema.
 *
 * Responsável por:
 *   1. Claim atômico de wakeups pendentes (lock via Postgres)
 *   2. Carregar contexto: agent + inbox novas + recalls relevantes
 *   3. Montar system prompt e chamar Anthropic
 *   4. Parsear output estruturado (handoffs, mensagens, recalls)
 *   5. Gravar AgentRun + criar mensagens + atualizar spent + dispar wakeups novos
 *   6. Budget guard (rouba do Paperclip)
 *
 * Não usa AI SDK — usa Anthropic SDK direto pra ter controle total do loop
 * (especialmente quando adicionarmos extended thinking pra Opus).
 *
 * Chamado por:
 *   - /api/tick (cron GH Actions a cada 5min)
 *   - /chat quando Luís manda msg (wakeup imediato)
 *   - mara_sync no fim do scrape (wakeup pra Mara)
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ContentBlock,
  ToolUseBlock,
  TextBlock,
  ThinkingBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { prisma } from '../db';
import { getSecret } from '../secrets';
import {
  type AgentRunContext,
  type AgentRunResult,
  type InboxMessage,
  type RecallItem,
  type NewMessageDraft,
  type NewRecallDraft,
  type ToolCallLog,
  AgentRuntimeError,
  calcCost,
} from './types';
import { SHARED_RULES } from './seed';
import { buildToolsForAgent, type ToolExecutionContext } from './tool-bridge';
import type { Agent, AgentTrigger, AgentMessageKind, AgentMemoryKind } from '@prisma/client';

// ============================================================
// Wakeup management (claim atômico + coalescing)
// ============================================================

/** Cria um wakeup. Se já houver wakeup QUEUED com mesma idempotencyKey, incrementa coalescedCount. */
export async function enqueueWakeup(input: {
  agentSlug: string;
  trigger: AgentTrigger;
  triggerRef?: string;
  idempotencyKey?: string;
  payload?: Record<string, unknown>;
}): Promise<{ wakeupId: string; coalesced: boolean }> {
  const agent = await prisma.agent.findUnique({ where: { slug: input.agentSlug } });
  if (!agent) throw new AgentRuntimeError(`Agent "${input.agentSlug}" not found`, 'NO_AGENT');
  if (!agent.active) {
    throw new AgentRuntimeError(`Agent "${input.agentSlug}" is inactive`, 'NO_AGENT');
  }

  // Tenta coalescing por idempotencyKey
  if (input.idempotencyKey) {
    const existing = await prisma.agentWakeupRequest.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing && existing.status === 'QUEUED') {
      await prisma.agentWakeupRequest.update({
        where: { id: existing.id },
        data: { coalescedCount: { increment: 1 } },
      });
      return { wakeupId: existing.id, coalesced: true };
    }
  }

  const w = await prisma.agentWakeupRequest.create({
    data: {
      agentId: agent.id,
      trigger: input.trigger,
      triggerRef: input.triggerRef,
      idempotencyKey: input.idempotencyKey,
      payload: (input.payload ?? null) as never,
    },
  });
  return { wakeupId: w.id, coalesced: false };
}

/** Claim atômico do próximo wakeup pendente cujo agente NÃO está pausado.
 *  Usa SELECT FOR UPDATE SKIP LOCKED via raw SQL pra evitar dois ticks pegarem o mesmo. */
async function claimNextWakeup(): Promise<{
  id: string;
  agentId: string;
  trigger: AgentTrigger;
  triggerRef: string | null;
  payload: unknown;
} | null> {
  // Raw query — Prisma ainda não tem SKIP LOCKED nativo. Aceita 1 wakeup por chamada.
  // JOIN com Agent pra pular wakeups de agentes pausados ou inativos.
  const rows = await prisma.$queryRaw<
    Array<{ id: string; agentId: string; trigger: AgentTrigger; triggerRef: string | null; payload: unknown }>
  >`
    WITH next AS (
      SELECT w.id FROM "AgentWakeupRequest" w
      INNER JOIN "Agent" a ON a.id = w."agentId"
      WHERE w.status = 'QUEUED'
        AND a.active = true
        AND a.paused = false
      ORDER BY w."createdAt" ASC
      FOR UPDATE OF w SKIP LOCKED
      LIMIT 1
    )
    UPDATE "AgentWakeupRequest" w
    SET status = 'CLAIMED', "claimedAt" = NOW()
    FROM next
    WHERE w.id = next.id
    RETURNING w.id, w."agentId", w.trigger, w."triggerRef", w.payload
  `;
  return rows[0] ?? null;
}

// ============================================================
// Context building (inbox + recalls)
// ============================================================

/** TTL pra DELIVERED virar STALE — SPEC #3 Gabi. */
const INBOX_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

async function loadInbox(agentId: string, limit = 10): Promise<InboxMessage[]> {
  // SPEC #3: sweep msgs DELIVERED > 48h → STALE (auto-self-healing, inline,
  // 1 query indexed por run — barato). Mantém hot inbox enxuto.
  const staleBefore = new Date(Date.now() - INBOX_STALE_AFTER_MS);
  await prisma.agentMessage.updateMany({
    where: {
      OR: [{ toAgentId: agentId }, { toAgentId: null }],
      status: 'DELIVERED',
      createdAt: { lt: staleBefore },
    },
    data: { status: 'STALE' },
  });

  // Carrega só DELIVERED recentes
  const msgs = await prisma.agentMessage.findMany({
    where: {
      OR: [{ toAgentId: agentId }, { toAgentId: null }],
      status: 'DELIVERED',
      createdAt: { gte: staleBefore },
    },
    include: { fromAgent: { select: { slug: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return msgs.map((m) => ({
    id: m.id,
    fromSlug: m.fromAgent?.slug ?? null,
    kind: m.kind,
    body: m.body,
    refs: (m.refs as Record<string, unknown> | null) ?? null,
    createdAt: m.createdAt,
    threadId: m.threadId,
  }));
}

async function loadRecalls(agentId: string, hint: string, limit = 5): Promise<RecallItem[]> {
  // Keyword search v1 — extrai 2-3 keywords do hint e procura no summary/body.
  // SPEC #3 Gabi: index GIN trigram em pg_trgm faz ILIKE virar O(log n).
  // Embedding semântico fica deferido pra quando recall > 1000 entries.
  const keywords = hint
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 3);

  // Guard: pg_trgm precisa >=3 chars pra usar GIN index — abaixo cai pra seq scan.
  const validKeywords = keywords.filter((k) => k.length >= 3).map((k) => k.slice(0, 200));

  const where = validKeywords.length
    ? {
        agentId,
        OR: validKeywords.flatMap((k) => [
          { summary: { contains: k, mode: 'insensitive' as const } },
          { body: { contains: k, mode: 'insensitive' as const } },
        ]),
      }
    : { agentId };

  // Ordem: RULE/DECISION antes de INSIGHT/CONVERSATION (qualidade do contexto),
  // depois por hitCount/lastUsedAt (signals de relevância).
  const items = await prisma.agentMemoryRecall.findMany({
    where,
    orderBy: [{ kind: 'asc' }, { hitCount: 'desc' }, { lastUsedAt: 'desc' }],
    take: limit,
  });
  return items.map((r) => ({
    id: r.id,
    kind: r.kind,
    summary: r.summary,
    body: r.body,
    refs: (r.refs as Record<string, unknown> | null) ?? null,
    hitCount: r.hitCount,
    createdAt: r.createdAt,
  }));
}

// ============================================================
// Prompt building
// ============================================================

function buildSystemPrompt(agent: Agent): string {
  return `${agent.promptCore}\n\n---\n${SHARED_RULES}`;
}

function buildUserMessage(ctx: AgentRunContext): string {
  const parts: string[] = [];

  parts.push(`# Trigger\n- type: ${ctx.trigger}`);
  if (ctx.triggerRef) parts.push(`- ref: ${ctx.triggerRef}`);
  parts.push('');

  if (ctx.inboxMessages.length > 0) {
    parts.push(`# Inbox (${ctx.inboxMessages.length} mensagens não lidas)\n`);
    for (const m of ctx.inboxMessages) {
      const from = m.fromSlug ?? 'luis (humano)';
      parts.push(`### [${m.kind}] de ${from} · ${m.createdAt.toISOString()}`);
      if (m.threadId) parts.push(`thread: ${m.threadId}`);
      parts.push(m.body);
      if (m.refs) parts.push(`refs: ${JSON.stringify(m.refs)}`);
      parts.push('');
    }
  }

  if (ctx.recalls.length > 0) {
    parts.push(`# Memória relevante (recalls)\n`);
    for (const r of ctx.recalls) {
      parts.push(`### [${r.kind}] ${r.summary} (usado ${r.hitCount}x)`);
      parts.push(r.body);
      parts.push('');
    }
  }

  if (ctx.payload && Object.keys(ctx.payload).length > 0) {
    parts.push(`# Payload extra\n\n\`\`\`json\n${JSON.stringify(ctx.payload, null, 2)}\n\`\`\``);
  }

  parts.push('---\n\nAja. Use o formato de output do seu prompt Core.');

  return parts.join('\n');
}

// ============================================================
// Output parser
// ============================================================

/** Parse do markdown estruturado em seções. Tolerante — se faltar seção, omite. */
function parseAgentOutput(raw: string): {
  thinkingMd?: string;
  outputMd: string;
  newMessages: NewMessageDraft[];
  newRecalls: NewRecallDraft[];
  nextAgentSlug?: string;
} {
  const sections = splitSections(raw);

  const thinking = sections['raciocínio'] ?? sections['raciocinio'];
  const output = sections['resposta / ação'] ?? sections['resposta'] ?? sections['ação'] ?? sections['acao'] ?? raw;

  const messages = parseMessageSection(sections['mensagens']);
  const recalls = parseRecallSection(sections['recalls']);

  let nextAgentSlug: string | undefined;
  const handoff = sections['handoff'];
  if (handoff) {
    const m = handoff.match(/next:\s*([a-z_-]+)/i);
    if (m) nextAgentSlug = m[1].trim();
  }

  return {
    thinkingMd: thinking,
    outputMd: output,
    newMessages: messages,
    newRecalls: recalls,
    nextAgentSlug,
  };
}

function splitSections(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Split antes de cada "## " — mantém o título junto do conteúdo.
  // Mais robusto que regex com lookahead — JS não tem \Z e o lookbehind do
  // multiline mode é frágil.
  const parts = md.split(/(?=^##\s+)/m);
  for (const part of parts) {
    const m = part.match(/^##\s+([^\n]+)\n?([\s\S]*)/);
    if (m) {
      out[m[1].toLowerCase().trim()] = m[2].trim();
    }
  }
  return out;
}

function parseMessageSection(section: string | undefined): NewMessageDraft[] {
  if (!section) return [];
  const items: NewMessageDraft[] = [];
  // Cada item começa com "- [ ] to: <slug> | kind: <KIND>\n  Body...\n  refs: {...}"
  const blocks = section.split(/^-\s*\[\s*\]\s+/m).filter((b) => b.trim());
  for (const block of blocks) {
    const header = block.split('\n')[0];
    const toMatch = header.match(/to:\s*([a-z_-]+|luis|null)/i);
    const kindMatch = header.match(/kind:\s*([A-Z_]+)/);
    if (!toMatch || !kindMatch) continue;
    const to = toMatch[1].toLowerCase();
    const kind = kindMatch[1] as AgentMessageKind;

    // Resto do block é body + opcional refs
    const rest = block.split('\n').slice(1).join('\n').trim();
    let body = rest;
    let refs: Record<string, unknown> | undefined;
    const refsMatch = rest.match(/^refs:\s*(\{[\s\S]*\})\s*$/m);
    if (refsMatch) {
      try {
        refs = JSON.parse(refsMatch[1]);
        body = rest.replace(refsMatch[0], '').trim();
      } catch {
        // ignora refs inválido
      }
    }

    items.push({
      toSlug: to === 'null' || to === 'luis' ? (to === 'luis' ? 'luis' : null) : to,
      kind,
      body,
      refs,
    });
  }
  return items;
}

function parseRecallSection(section: string | undefined): NewRecallDraft[] {
  if (!section) return [];
  const items: NewRecallDraft[] = [];
  const blocks = section.split(/^-\s+kind:\s*/m).filter((b) => b.trim());
  for (const block of blocks) {
    const lines = block.split('\n');
    const kindLine = lines[0].trim();
    const kind = kindLine.split(/\s+/)[0].toUpperCase() as AgentMemoryKind;
    const summaryMatch = block.match(/summary:\s*(.+)/i);
    const bodyMatch = block.match(/body:\s*([\s\S]+?)(?=^-\s+kind:|\Z)/m);
    if (!summaryMatch || !bodyMatch) continue;
    items.push({
      kind,
      summary: summaryMatch[1].trim().slice(0, 200),
      body: bodyMatch[1].trim(),
    });
  }
  return items;
}

// ============================================================
// LLM call
// ============================================================

/**
 * Agentic loop com tool calling nativo do Anthropic SDK.
 *
 * Enquanto `stop_reason === 'tool_use'`, executa os tool_use blocks, coleta os
 * resultados, adiciona ao histórico, e chama o modelo de novo. Para quando
 * `stop_reason === 'end_turn'` (modelo terminou) ou bate em maxSteps.
 *
 * Drafts (mensagens novas, recalls, handoff) são acumulados em `ctx.drafts`
 * via tools internas (agent_send_message, agent_save_recall, agent_handoff)
 * e processados pelo runtime no fim da run.
 */
async function callAnthropicWithLoop(
  apiKey: string,
  agent: Agent,
  systemPrompt: string,
  userMessage: string,
  runId: string,
  maxSteps = 10,
): Promise<{
  textOutput: string;
  thinking: string | null;
  drafts: ToolExecutionContext['drafts'];
  tokensIn: number;
  tokensOut: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  toolCallLogs: ToolCallLog[];
}> {
  const client = new Anthropic({ apiKey });
  const { tools, executors } = buildToolsForAgent(agent.toolsAllowed);

  const drafts: ToolExecutionContext['drafts'] = {
    messages: [],
    recalls: [],
  };
  const toolCallLogs: ToolCallLog[] = [];
  const ctx: ToolExecutionContext = {
    agentSlug: agent.slug,
    agentId: agent.id,
    runId,
    drafts,
  };

  const messages: MessageParam[] = [{ role: 'user', content: userMessage }];
  const textChunks: string[] = [];
  const thinkingChunks: string[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let totalCacheWrite = 0;
  let totalCacheRead = 0;

  for (let step = 0; step < maxSteps; step++) {
    // Prompt caching: marca o system prompt como cacheable (ephemeral TTL 5min).
    // Anthropic cacheia automaticamente o conjunto [tools + system até o último
    // cache_control], o que cobre 5-15K tokens estáveis por agente. Cache hit
    // economiza 90% do input cost; cache write custa +25% na 1ª call.
    // Break-even em ~3 runs do mesmo agente em janela de 5min.
    //
    // Limitação: system precisa ser BYTE-EQUAL entre runs pra cache hit. Como
    // promptCore + SHARED_RULES não mudam entre runs do mesmo agente, OK.
    const response = await client.messages.create({
      model: agent.model,
      // 8192 (era 4096) — Gabi truncou 3x escrevendo SPECs ricas. Custo extra
      // marginal (~$0.0006/run em Opus). Resolve runs que precisam output longo.
      max_tokens: 8192,
      system: [
        {
          type: 'text' as const,
          text: systemPrompt,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      tools: tools.length > 0
        ? (tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema as never,
          })) as never)
        : undefined,
      messages,
    });

    totalIn += response.usage.input_tokens;
    totalOut += response.usage.output_tokens;
    // Anthropic retorna usage com cache stats quando cache_control é usado.
    // Os campos podem ou não existir dependendo da versão do SDK — defensivo.
    const usage = response.usage as typeof response.usage & {
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    totalCacheWrite += usage.cache_creation_input_tokens ?? 0;
    totalCacheRead += usage.cache_read_input_tokens ?? 0;

    // Coleta text + thinking blocks pra log/UI
    for (const block of response.content) {
      if (block.type === 'text') {
        textChunks.push((block as TextBlock).text);
      } else if (block.type === 'thinking') {
        thinkingChunks.push((block as ThinkingBlock).thinking);
      }
    }

    // Anexa resposta do assistant ao histórico (REQUIRED pelo Anthropic SDK)
    messages.push({ role: 'assistant', content: response.content as ContentBlock[] });

    if (response.stop_reason !== 'tool_use') {
      break;
    }

    // Executa cada tool_use, coleta resultados, monta tool_result block
    const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    const toolResults: Array<{
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }> = [];

    for (const tu of toolUses) {
      const exec = executors[tu.name];
      const t0 = Date.now();
      if (!exec) {
        toolCallLogs.push({
          name: tu.name,
          input: tu.input,
          output: null,
          ms: 0,
          error: `tool "${tu.name}" não tem executor — não chame essa`,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify({ error: `unknown tool: ${tu.name}` }),
          is_error: true,
        });
        continue;
      }
      try {
        const out = await exec.execute(tu.input, ctx);
        const ms = Date.now() - t0;
        toolCallLogs.push({ name: tu.name, input: tu.input, output: out, ms });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(out).slice(0, 50_000), // anthropic limita
        });
      } catch (err) {
        const ms = Date.now() - t0;
        const msg = err instanceof Error ? err.message : String(err);
        toolCallLogs.push({
          name: tu.name,
          input: tu.input,
          output: null,
          ms,
          error: msg,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify({ error: msg }),
          is_error: true,
        });
      }
    }

    // Adiciona tool_result e segue o loop
    messages.push({
      role: 'user',
      content: toolResults as never,
    });
  }

  return {
    textOutput: textChunks.join('\n\n').trim(),
    thinking: thinkingChunks.length > 0 ? thinkingChunks.join('\n\n') : null,
    drafts,
    tokensIn: totalIn,
    tokensOut: totalOut,
    cacheWriteTokens: totalCacheWrite,
    cacheReadTokens: totalCacheRead,
    toolCallLogs,
  };
}

// ============================================================
// Execute one agent run
// ============================================================

export async function runAgent(input: {
  agentSlug: string;
  trigger: AgentTrigger;
  triggerRef?: string;
  payload?: Record<string, unknown>;
}): Promise<{ runId: string; result: AgentRunResult }> {
  const agent = await prisma.agent.findUnique({ where: { slug: input.agentSlug } });
  if (!agent) throw new AgentRuntimeError(`Agent ${input.agentSlug} not found`, 'NO_AGENT');

  // Guards
  if (!agent.active) {
    throw new AgentRuntimeError(`Agent ${input.agentSlug} está inativo`, 'NO_AGENT');
  }
  if (agent.paused) {
    throw new AgentRuntimeError(
      `Agent ${input.agentSlug} está pausado: ${agent.pausedReason ?? 'sem motivo'}`,
      'NO_AGENT',
    );
  }
  if (Number(agent.spentUsdMonth) >= Number(agent.budgetUsdMonth)) {
    throw new AgentRuntimeError(
      `Budget mensal estourado: $${agent.spentUsdMonth} / $${agent.budgetUsdMonth}`,
      'BUDGET_STOPPED',
    );
  }

  const apiKey = await getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) throw new AgentRuntimeError('ANTHROPIC_API_KEY ausente', 'LLM_FAILED');

  // Cria run em RUNNING
  const run = await prisma.agentRun.create({
    data: {
      agentId: agent.id,
      trigger: input.trigger,
      triggerRef: input.triggerRef,
      status: 'RUNNING',
    },
  });

  try {
    // Carrega contexto
    const [inbox, recalls] = await Promise.all([
      loadInbox(agent.id, 8),
      loadRecalls(agent.id, JSON.stringify(input.payload ?? {}) + ' ' + (input.triggerRef ?? ''), 5),
    ]);

    const ctx: AgentRunContext = {
      agentSlug: agent.slug,
      trigger: input.trigger,
      triggerRef: input.triggerRef,
      inboxMessages: inbox,
      recalls,
      payload: input.payload,
    };

    const systemPrompt = buildSystemPrompt(agent);
    const userMessage = buildUserMessage(ctx);

    // Agentic loop com tool calling nativo
    const loopResult = await callAnthropicWithLoop(apiKey, agent, systemPrompt, userMessage, run.id);
    const {
      textOutput,
      thinking,
      drafts: toolDrafts,
      tokensIn,
      tokensOut,
      cacheWriteTokens,
      cacheReadTokens,
      toolCallLogs: toolCalls,
    } = loopResult;
    // calcCost com breakdown: tokensIn aqui exclui os cached, então não dupla-conta.
    // Anthropic API: input_tokens = NOVOS tokens não-cacheados, cache_creation = escrita, cache_read = leitura.
    const costUsd = calcCost(agent.model, tokensIn, tokensOut, {
      tokensIn,
      tokensOut,
      cacheWriteTokens,
      cacheReadTokens,
    });

    // Parse fallback do output (caso modelo escreva markdown estruturado em vez
    // de chamar tools internas — agentes Haiku às vezes fazem isso)
    const parsedMd = parseAgentOutput(textOutput);

    // Merge: tools nativas têm prioridade; markdown parsing complementa o que faltou
    const finalThinking = thinking || parsedMd.thinkingMd || null;
    const finalOutput = parsedMd.outputMd || textOutput;
    const finalMessages: NewMessageDraft[] = [
      ...toolDrafts.messages,
      // Inclui parsed só se tool calls não produziu nada (evita duplicação)
      ...(toolDrafts.messages.length === 0 ? parsedMd.newMessages : []),
    ];
    const finalRecalls: NewRecallDraft[] = [
      ...toolDrafts.recalls,
      ...(toolDrafts.recalls.length === 0 ? parsedMd.newRecalls : []),
    ];
    const finalNextAgentSlug = toolDrafts.nextAgentSlug || parsedMd.nextAgentSlug;

    const parsed = {
      thinkingMd: finalThinking,
      outputMd: finalOutput,
      newMessages: finalMessages,
      newRecalls: finalRecalls,
      nextAgentSlug: finalNextAgentSlug,
    };

    // Persiste: marca msgs do inbox como READ, cria mensagens novas, cria recalls, atualiza run, atualiza spent
    await prisma.$transaction(async (tx) => {
      // Marca inbox como lido
      if (inbox.length > 0) {
        await tx.agentMessage.updateMany({
          where: { id: { in: inbox.map((m) => m.id) } },
          data: { status: 'READ', readAt: new Date() },
        });
      }

      // Promove recalls usados (hitCount++)
      if (recalls.length > 0) {
        await tx.agentMemoryRecall.updateMany({
          where: { id: { in: recalls.map((r) => r.id) } },
          data: { hitCount: { increment: 1 }, lastUsedAt: new Date() },
        });
      }

      // Se foi ON_DEMAND com threadId, cria msg de resposta direta na thread
      // (humano fica como toAgentId=null pra UI do /chat ler).
      // Body = outputMd completo (a "Resposta / Ação" parseada).
      const threadId = typeof input.payload?.threadId === 'string' ? input.payload.threadId : null;
      if (input.trigger === 'ON_DEMAND' && threadId && parsed.outputMd) {
        await tx.agentMessage.create({
          data: {
            fromAgentId: agent.id,
            toAgentId: null, // humano não é Agent — null = direto pro thread/humano
            threadId,
            kind: 'NOTE',
            body: parsed.outputMd,
            triggeredByRunId: run.id,
            status: 'DELIVERED',
          },
        });
      }

      // Cria mensagens novas (resolvendo slug→id pros destinos)
      for (const draft of parsed.newMessages) {
        let toAgentId: string | null = null;
        if (draft.toSlug && draft.toSlug !== 'luis') {
          const dest = await tx.agent.findUnique({ where: { slug: draft.toSlug } });
          if (!dest) {
            console.warn(`[runtime] dest ${draft.toSlug} não existe, msg vai como broadcast`);
          } else {
            toAgentId = dest.id;
          }
        }
        const newMsg = await tx.agentMessage.create({
          data: {
            fromAgentId: agent.id,
            toAgentId,
            kind: draft.kind,
            body: draft.body,
            refs: (draft.refs ?? null) as never,
            threadId: draft.threadId,
            triggeredByRunId: run.id,
          },
        });

        // Se msg é pra outro agente, enfileira wakeup
        if (toAgentId) {
          await tx.agentWakeupRequest.create({
            data: {
              agentId: toAgentId,
              trigger: 'MAILBOX',
              triggerRef: newMsg.id,
              idempotencyKey: `mailbox:${draft.toSlug}:${newMsg.id}`,
              payload: { messageId: newMsg.id } as never,
            },
          });
        }
      }

      // Cria recalls novos
      for (const r of parsed.newRecalls) {
        await tx.agentMemoryRecall.create({
          data: {
            agentId: agent.id,
            kind: r.kind,
            summary: r.summary,
            body: r.body,
            refs: (r.refs ?? null) as never,
          },
        });
      }

      // Finaliza run
      await tx.agentRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          thinkingMd: parsed.thinkingMd,
          outputMd: parsed.outputMd,
          toolCalls: toolCalls as never,
          nextAgentSlug: parsed.nextAgentSlug,
          costUsd,
          tokensIn,
          tokensOut,
          finishedAt: new Date(),
        },
      });

      // Atualiza spent
      await tx.agent.update({
        where: { id: agent.id },
        data: { spentUsdMonth: { increment: costUsd } },
      });

      // Se handoff explícito, enfileira wakeup do próximo agente.
      // Loop protection: handoffDepth no payload — máx 3 hops em cadeia,
      // se ultrapassar dropa o wakeup (evita Augusto↔Mara infinito).
      if (parsed.nextAgentSlug) {
        const currentDepth = (input.payload as { handoffDepth?: number } | undefined)?.handoffDepth ?? 0;
        if (currentDepth >= 3) {
          console.warn(`[runtime] handoff depth ${currentDepth} >= 3 — dropando handoff de ${agent.slug} → ${parsed.nextAgentSlug}`);
        } else {
          const next = await tx.agent.findUnique({ where: { slug: parsed.nextAgentSlug } });
          if (next) {
            await tx.agentWakeupRequest.create({
              data: {
                agentId: next.id,
                trigger: 'AUTOMATION',
                triggerRef: `handoff-from-${agent.slug}-run-${run.id}`,
                payload: {
                  handoffFromRunId: run.id,
                  handoffFromAgent: agent.slug,
                  handoffDepth: currentDepth + 1,
                } as never,
              },
            });
          }
        }
      }
    });

    return {
      runId: run.id,
      result: {
        thinkingMd: parsed.thinkingMd ?? undefined,
        outputMd: parsed.outputMd,
        toolCalls,
        newMessages: parsed.newMessages,
        newRecalls: parsed.newRecalls,
        nextAgentSlug: parsed.nextAgentSlug,
        costUsd,
        tokensIn,
        tokensOut,
      },
    };
  } catch (err) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        errorMsg: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

// ============================================================
// Tick — processa N wakeups por chamada
// ============================================================

/** Processa até maxRuns wakeups. Chamado por /api/tick. */
export async function tickAgents(maxRuns = 5): Promise<{
  processed: number;
  results: Array<{ wakeupId: string; agentSlug: string; status: 'ok' | 'failed'; error?: string; costUsd?: number }>;
}> {
  const results: Array<{ wakeupId: string; agentSlug: string; status: 'ok' | 'failed'; error?: string; costUsd?: number }> = [];

  for (let i = 0; i < maxRuns; i++) {
    const wakeup = await claimNextWakeup();
    if (!wakeup) break; // fila vazia

    const agent = await prisma.agent.findUnique({ where: { id: wakeup.agentId } });
    if (!agent) {
      await prisma.agentWakeupRequest.update({
        where: { id: wakeup.id },
        data: { status: 'FAILED', completedAt: new Date() },
      });
      results.push({ wakeupId: wakeup.id, agentSlug: 'unknown', status: 'failed', error: 'agent not found' });
      continue;
    }

    try {
      const { runId, result } = await runAgent({
        agentSlug: agent.slug,
        trigger: wakeup.trigger,
        triggerRef: wakeup.triggerRef ?? undefined,
        payload: (wakeup.payload as Record<string, unknown> | null) ?? undefined,
      });
      await prisma.agentWakeupRequest.update({
        where: { id: wakeup.id },
        data: { status: 'COMPLETED', completedAt: new Date(), processedByRunId: runId },
      });
      results.push({ wakeupId: wakeup.id, agentSlug: agent.slug, status: 'ok', costUsd: result.costUsd });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isBudget = err instanceof AgentRuntimeError && err.code === 'BUDGET_STOPPED';
      await prisma.agentWakeupRequest.update({
        where: { id: wakeup.id },
        data: { status: 'FAILED', completedAt: new Date() },
      });
      results.push({
        wakeupId: wakeup.id,
        agentSlug: agent.slug,
        status: 'failed',
        error: isBudget ? `budget stopped: ${errorMsg}` : errorMsg,
      });
    }
  }

  return { processed: results.length, results };
}
