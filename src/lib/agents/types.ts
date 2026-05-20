/**
 * Contratos do runtime de agentes Vendetti.
 *
 * Modelo mental:
 *   wakeup → tick claim → carrega Agent + Recall relevante + msgs pendentes
 *          → monta prompt = promptCore + recall + trigger context
 *          → chama Anthropic com toolsAllowed
 *          → parse output (handoffs, mensagens novas, decisions, recalls)
 *          → grava AgentRun + cria msgs + atualiza spent
 *          → publica live event (futuro)
 *
 * Inspirações:
 *   - Paperclip adapter contract (execute(ctx) → result com usage+cost)
 *   - LangGraph handoffs explícitos (nextAgentSlug no output)
 *   - Letta memory promotion (recall.hitCount + lastUsedAt)
 */

import type { AgentTrigger, AgentMessageKind, AgentMemoryKind } from '@prisma/client';

/** Contexto de input passado pro runner de um agente. */
export interface AgentRunContext {
  agentSlug: string;
  trigger: AgentTrigger;
  triggerRef?: string;
  /** Msgs novas no inbox desse agente (não lidas). Limita a N pra não estourar context. */
  inboxMessages: InboxMessage[];
  /** Recalls mais relevantes (keyword search no body + lastUsedAt desc). */
  recalls: RecallItem[];
  /** Payload custom do wakeup, se houver. */
  payload?: Record<string, unknown>;
}

export interface InboxMessage {
  id: string;
  fromSlug: string | null; // null = humano (Luís)
  kind: AgentMessageKind;
  body: string;
  refs?: Record<string, unknown> | null;
  createdAt: Date;
  threadId?: string | null;
}

export interface RecallItem {
  id: string;
  kind: AgentMemoryKind;
  summary: string;
  body: string;
  refs?: Record<string, unknown> | null;
  hitCount: number;
  createdAt: Date;
}

/** Resultado de uma execução de agente. */
export interface AgentRunResult {
  /** Markdown do raciocínio (chain-of-thought visível na UI /empresa). */
  thinkingMd?: string;
  /** Output final em markdown — vai pro Luís OU pro próximo agente. */
  outputMd: string;
  /** Tool calls feitas durante o run, em ordem. */
  toolCalls: ToolCallLog[];
  /** Mensagens novas criadas por esse agente (vai gerar wakeups nos destinos). */
  newMessages: NewMessageDraft[];
  /** Recalls novos pra persistir (memória de longo prazo). */
  newRecalls: NewRecallDraft[];
  /** Handoff explícito — outro agente que deve rodar a seguir. */
  nextAgentSlug?: string;
  /** Custo USD calculado a partir de tokens × modelo. */
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
}

export interface ToolCallLog {
  name: string;
  input: unknown;
  output: unknown;
  ms: number;
  error?: string;
}

export interface NewMessageDraft {
  toSlug: string | null; // null = broadcast (todos veem)
  kind: AgentMessageKind;
  body: string;
  refs?: Record<string, unknown>;
  threadId?: string;
}

export interface NewRecallDraft {
  kind: AgentMemoryKind;
  summary: string;
  body: string;
  refs?: Record<string, unknown>;
}

/** Erro estruturado de runtime — pra diferenciar budget-stop, tool-fail, llm-fail. */
export class AgentRuntimeError extends Error {
  constructor(
    message: string,
    public readonly code: 'BUDGET_STOPPED' | 'LLM_FAILED' | 'TOOL_FAILED' | 'NO_AGENT' | 'PARSE_FAILED',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AgentRuntimeError';
  }
}

/** Preço por 1M tokens (input/output) — atualizar quando Anthropic mudar tabela. */
export const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  'claude-opus-4-7':            { in: 15, out: 75 },
  'claude-opus-4-7-20251022':   { in: 15, out: 75 },
  'claude-sonnet-4-5':          { in: 3,  out: 15 },
  'claude-sonnet-4-5-20250929': { in: 3,  out: 15 },
  'claude-haiku-4-5':           { in: 0.8, out: 4 },
  'claude-haiku-4-5-20251001':  { in: 0.8, out: 4 },
};

/** Calcula custo USD de uma run. */
export function calcCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = MODEL_PRICES[model];
  if (!p) return 0;
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}
