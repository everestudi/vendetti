/**
 * Bridge entre o runtime de agentes Vendetti e o tool-calling nativo do
 * Anthropic SDK.
 *
 * Resolve 2 coisas:
 *
 * 1. **Converte VENDETTI_TOOLS (AI SDK format) → Anthropic SDK format.**
 *    AI SDK usa `{ description, inputSchema (zod), execute }`. Anthropic SDK
 *    usa `{ name, description, input_schema (json), execute }`. Zod 4 tem
 *    z.toJSONSchema nativo.
 *
 * 2. **Define tools "internas" do runtime** (não chamam API externa, viram
 *    drafts processados ao final da run):
 *      - agent_send_message: cria AgentMessage pro mailbox
 *      - agent_save_recall: cria AgentMemoryRecall na memória
 *      - agent_handoff: marca nextAgentSlug pra disparar wakeup
 *
 *    Essas tools retornam `{ ok: true, accepted: ... }` pro modelo entender
 *    que o intent foi capturado, mas o efeito real só acontece no end of run
 *    (drafts collected → tx.create no fim).
 */

import { z } from 'zod';
import { tool } from 'ai';
import { VENDETTI_TOOLS } from '../vendetti/tools';
import type { AgentMessageKind, AgentMemoryKind } from '@prisma/client';

// ============================================================
// Tipos do tool-calling Anthropic
// ============================================================

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolExecutor {
  /** Executa a tool. Retorna json-serializable pra mandar de volta pro LLM. */
  execute: (input: unknown, ctx: ToolExecutionContext) => Promise<unknown>;
  /** Marca tool como interna — efeito só acontece no fim da run (drafts). */
  internal?: boolean;
}

export interface ToolExecutionContext {
  agentSlug: string;
  agentId: string;
  runId: string;
  /** Drafts coletados pelo runtime ao final da run. */
  drafts: {
    messages: Array<{
      toSlug: string | null;
      kind: AgentMessageKind;
      body: string;
      refs?: Record<string, unknown>;
      threadId?: string;
    }>;
    recalls: Array<{
      kind: AgentMemoryKind;
      summary: string;
      body: string;
      refs?: Record<string, unknown>;
    }>;
    nextAgentSlug?: string;
    nextPayload?: Record<string, unknown>;
  };
}

// ============================================================
// Converter Zod → JSON Schema (Anthropic format)
// ============================================================

function zodToAnthropicSchema(schema: z.ZodTypeAny): AnthropicToolDef['input_schema'] {
  // Zod 4 tem z.toJSONSchema nativo
  const json = z.toJSONSchema(schema) as Record<string, unknown>;

  // Anthropic exige type: 'object' no top level
  if (json.type !== 'object') {
    // Wrap em object se for primitivo solitário (raro mas pode acontecer)
    return {
      type: 'object',
      properties: { value: json as Record<string, unknown> },
      required: ['value'],
    };
  }

  // Remove $schema e outras meta keys que Anthropic não aceita
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { $schema, additionalProperties, ...rest } = json;
  return rest as AnthropicToolDef['input_schema'];
}

// ============================================================
// Tools internas (não chamam API — viram drafts)
// ============================================================

const agentSendMessageSchema = z.object({
  to: z
    .string()
    .describe(
      'Slug do agente destino (ex: "augusto", "mara", "bruno"). Use "luis" pra falar direto com o humano. Use "broadcast" pra todos os agentes verem (audit, transparência).',
    ),
  kind: z
    .enum(['NOTE', 'QUESTION', 'INSIGHT', 'REQUEST', 'ALERT', 'PROPOSAL'])
    .describe(
      'NOTE=info casual, QUESTION=espera resposta, INSIGHT=descoberta analítica, REQUEST=peça ação, ALERT=crítico, PROPOSAL=mudança no produto.',
    ),
  body: z.string().min(3).describe('Conteúdo da mensagem em markdown.'),
  refs: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('JSON com refs estruturadas: { decisionId?, slotPosition?, skuCode?, msgId? ... }'),
});

const agentSaveRecallSchema = z.object({
  kind: z
    .enum(['DECISION', 'INSIGHT', 'MISTAKE', 'CONVERSATION', 'RULE'])
    .describe(
      'DECISION=decisão tomada e porquê, INSIGHT=padrão observado, MISTAKE=erro pra não repetir, CONVERSATION=trecho relevante com Luís, RULE=invariante nova.',
    ),
  summary: z.string().max(200).describe('Sumário curto (≤200 chars) — usado em keyword search.'),
  body: z.string().describe('Corpo completo do que vale lembrar — markdown.'),
  refs: z.record(z.string(), z.unknown()).optional(),
});

const agentHandoffSchema = z.object({
  next: z.string().describe('Slug do próximo agente que deve rodar (ex: "mara", "bruno", "zelda").'),
  payload: z.record(z.string(), z.unknown()).optional().describe('Dados pra passar pro próximo agente.'),
});

/**
 * Tools internas do runtime — Anthropic format direto.
 * O `execute` é minimal — só registra o intent em `ctx.drafts`. O runtime
 * processa drafts no fim (cria AgentMessage/AgentMemoryRecall em transação).
 */
const INTERNAL_TOOLS: Record<string, ToolExecutor & { def: AnthropicToolDef }> = {
  agent_send_message: {
    internal: true,
    def: {
      name: 'agent_send_message',
      description:
        'Envia mensagem no mailbox da empresa Vendetti. Use pra avisar outro agente, fazer pergunta, escalar alerta, ou pra "luis" pra falar com o Luís direto. Mensagens aparecem em /empresa em tempo real.',
      input_schema: zodToAnthropicSchema(agentSendMessageSchema),
    },
    execute: async (input, ctx) => {
      const parsed = agentSendMessageSchema.parse(input);
      const to = parsed.to.toLowerCase().trim();

      // GUARD RAIL: subagentes (não-Augusto) NÃO podem mandar direto pra "luis".
      // Augusto é o único filtro humano. Subagente que tentar é redirecionado.
      // Exceção: Rita pode (rita_send_luis é canal Z-API dela direto, mas isso é
      // OUTRA tool — agent_send_message é mailbox interno).
      if (to === 'luis' && ctx.agentSlug !== 'augusto') {
        return {
          error: 'BLOQUEADO: apenas Augusto fala direto com Luís humano. Mande pra Augusto com kind=ALERT/INSIGHT/PROPOSAL — ele decide se escala.',
          hint: `Reenvie: agent_send_message({ to: "augusto", kind: "${parsed.kind}", body: "${parsed.body.slice(0, 100)}..." })`,
          subagent: ctx.agentSlug,
        };
      }

      const toSlug = to === 'luis' || to === 'broadcast' ? null : to;
      ctx.drafts.messages.push({
        toSlug,
        kind: parsed.kind,
        body: parsed.body,
        refs: parsed.refs,
      });
      return {
        ok: true,
        delivered_to: to,
        kind: parsed.kind,
        note: 'Mensagem enfileirada — entregue ao final da run.',
      };
    },
  },
  agent_save_recall: {
    internal: true,
    def: {
      name: 'agent_save_recall',
      description:
        'Salva uma memória de longo prazo pra você lembrar em runs futuras. Use SOMENTE pra coisas que valem ser lembradas (decisões com rationale, padrões observados, erros pra não repetir). NÃO salva conversa trivial.',
      input_schema: zodToAnthropicSchema(agentSaveRecallSchema),
    },
    execute: async (input, ctx) => {
      const parsed = agentSaveRecallSchema.parse(input);
      ctx.drafts.recalls.push({
        kind: parsed.kind,
        summary: parsed.summary,
        body: parsed.body,
        refs: parsed.refs,
      });
      return { ok: true, kind: parsed.kind, summary: parsed.summary };
    },
  },
  agent_handoff: {
    internal: true,
    def: {
      name: 'agent_handoff',
      description:
        'Passa o bastão pra outro agente. Cria wakeup pra ele e termina sua run. Use quando outro agente é melhor pra continuar (ex: Augusto → Bruno pra cotar preço; Augusto → Zelda pra revisar Decision).',
      input_schema: zodToAnthropicSchema(agentHandoffSchema),
    },
    execute: async (input, ctx) => {
      const parsed = agentHandoffSchema.parse(input);
      ctx.drafts.nextAgentSlug = parsed.next.toLowerCase().trim();
      ctx.drafts.nextPayload = parsed.payload;
      return { ok: true, next: ctx.drafts.nextAgentSlug, note: 'Handoff registrado — wakeup criado ao fim da run.' };
    },
  },
};

// ============================================================
// Wrapper de VENDETTI_TOOLS (AI SDK → Anthropic)
// ============================================================

interface AiSdkTool {
  description?: string;
  inputSchema?: z.ZodTypeAny;
  execute?: (input: unknown, opts?: unknown) => Promise<unknown> | unknown;
}

/** Converte uma tool do AI SDK pro shape Anthropic + executor. */
function wrapAiSdkTool(name: string, t: AiSdkTool): { def: AnthropicToolDef; executor: ToolExecutor } | null {
  if (!t.inputSchema || !t.execute) return null;

  let inputSchema: AnthropicToolDef['input_schema'];
  try {
    inputSchema = zodToAnthropicSchema(t.inputSchema);
  } catch (e) {
    console.warn(`[tool-bridge] falha ao converter schema de "${name}":`, e);
    return null;
  }

  return {
    def: {
      name,
      description: t.description ?? `Tool ${name}`,
      input_schema: inputSchema,
    },
    executor: {
      execute: async (input) => {
        // AI SDK tools são chamadas com (input, opts). Passamos opts vazio.
        const result = await t.execute!(input, {} as never);
        return result;
      },
    },
  };
}

// ============================================================
// API pública
// ============================================================

/**
 * Monta lista de tools (formato Anthropic) + executor map pra um agente.
 * Filtra por `toolsAllowed` do Agent — agente só vê o que pode chamar.
 */
export function buildToolsForAgent(toolsAllowed: string[]): {
  tools: AnthropicToolDef[];
  executors: Record<string, ToolExecutor>;
} {
  const defs: AnthropicToolDef[] = [];
  const executors: Record<string, ToolExecutor> = {};

  // 1) Internas — disponíveis pra TODOS os agentes por default (são primitivas)
  //    Mesmo se não estiver em toolsAllowed, o agente precisa pra escrever no mailbox.
  for (const [name, t] of Object.entries(INTERNAL_TOOLS)) {
    defs.push(t.def);
    executors[name] = t;
  }

  // 2) VENDETTI_TOOLS (AI SDK) — filtra por toolsAllowed
  const vendettiTools = VENDETTI_TOOLS as unknown as Record<string, AiSdkTool>;
  for (const name of toolsAllowed) {
    if (name in INTERNAL_TOOLS) continue; // já adicionado
    const aiTool = vendettiTools[name];
    if (!aiTool) {
      // Tool listada em toolsAllowed mas não existe — pode ser uma futura. Skip.
      continue;
    }
    const wrapped = wrapAiSdkTool(name, aiTool);
    if (wrapped) {
      defs.push(wrapped.def);
      executors[name] = wrapped.executor;
    }
  }

  return { tools: defs, executors };
}

/** Exporta `tool` do ai-sdk pra criar tools novas no formato compatível. */
export { tool };
