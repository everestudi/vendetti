/**
 * Tool registry do Vendetti.
 *
 * Cada tool tem: nome, schema Zod do input, descrição (que o modelo lê), e a função.
 * Pluga no Claude Agent SDK como `tools: TOOLS`.
 *
 * Status: schemas declarados. Implementações concretas em arquivos próprios:
 *   - vendtef.ts, vendpago.ts, atacadao.ts, obsidian.ts,
 *     email.ts, whatsapp.ts, decision_log.ts
 */

import { z } from 'zod';

export const toolSchemas = {
  vendtef_login_check: {
    description: 'Testa login no ERP Vending (Vendtef) e retorna sucesso/screenshot.',
    input: z.object({}),
  },
  vendtef_get_inventory: {
    description: 'Lê inventário atual da máquina no Vendtef. Retorna slot, SKU, quantidade.',
    input: z.object({ machineId: z.string().optional() }),
  },
  vendtef_get_sales: {
    description: 'Baixa relatório de vendas de um período. Datas no formato YYYY-MM-DD.',
    input: z.object({ from: z.string(), to: z.string() }),
  },
  vendtef_update_slot: {
    description: 'Atualiza um slot: SKU, preço, capacidade, quantidade atual.',
    input: z.object({
      position: z.string(),
      skuCode: z.string().optional(),
      price: z.number().optional(),
      capacity: z.number().int().optional(),
      currentQty: z.number().int().optional(),
    }),
  },

  vendpago_recent_transactions: {
    description: 'Lista transações Vendpago no período (com status e valor).',
    input: z.object({ hours: z.number().int().default(24) }),
  },

  atacadao_lookup: {
    description: 'Busca preço de um produto no Atacadão online (entrega Uberlândia).',
    input: z.object({ query: z.string() }),
  },

  vittal_price_table: {
    description: 'Lê tabela de preços da Vittal (loja 06 Bluemall) da planilha no Drive.',
    input: z.object({}),
  },

  obsidian_read: {
    description: 'Lê uma nota do Obsidian Vault.',
    input: z.object({ path: z.string() }),
  },
  obsidian_append: {
    description: 'Adiciona texto ao final de uma nota (ou cria se não existir).',
    input: z.object({ path: z.string(), content: z.string() }),
  },

  email_send: {
    description: 'Envia email via Resend para um destinatário.',
    input: z.object({
      to: z.string().email(),
      subject: z.string(),
      bodyMarkdown: z.string(),
    }),
  },

  whatsapp_send_weverton: {
    description: 'Envia mensagem WhatsApp para o Weverton via Z-API. Use tom de colega, frases curtas.',
    input: z.object({ text: z.string() }),
  },

  decision_create: {
    description: 'Cria registro no decision log. SEMPRE chamar antes de qualquer ação 🟢🟡🔴.',
    input: z.object({
      kind: z.enum([
        'PRICE_CHANGE',
        'RESTOCK_ORDER',
        'RESTOCK_TASK',
        'SLOT_REORG',
        'SKU_ADD',
        'SKU_REMOVE',
        'REFUND',
        'COMPLAINT_RESPONSE',
        'SYSTEM_INVENTORY_SYNC',
        'OTHER',
      ]),
      level: z.enum(['GREEN', 'YELLOW', 'RED']),
      summary: z.string(),
      rationale: z.string(),
      data: z.any(),
    }),
  },
  decision_execute: {
    description: 'Marca uma decisão pendente como executada (após de fato realizar a ação).',
    input: z.object({ decisionId: z.string() }),
  },
} as const;

export type ToolName = keyof typeof toolSchemas;
