/**
 * NF-e parser via Claude Opus 4.7 vision.
 *
 * Recebe imagem (JPG/PNG) ou PDF de NF-e/DANFE/cupom e extrai itens estruturados.
 * Faz fuzzy match com SKUs existentes pra sugerir vínculo (sem decidir sozinho).
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db';
import { getSecret } from '../secrets';

export interface NfeParsedItem {
  productName: string;
  productCode?: string;
  qty: number;
  unitCost: number;
  totalCost: number;
  /// Sugestão de SKU existente — null se não achou
  skuMatch?: {
    id: string;
    code: string;
    name: string;
    score: number; // 0-100
  };
}

export interface NfeParsedDoc {
  supplier: 'ATACADAO' | 'VITTAL' | 'OUTRO';
  supplierName: string | null;
  invoiceRef: string | null;
  occurredAt: string | null; // ISO date
  totalAmount: number;
  items: NfeParsedItem[];
  rawText?: string;
}

const SYSTEM_PROMPT = `Você é um extrator de NF-e/DANFE/cupom fiscal brasileiro.
Sua tarefa: extrair dados estruturados em JSON do documento.

Regras:
- "supplierName" é a razão social do emitente (quem vendeu).
- "supplier" deve ser ATACADAO se o emitente for ATACADAO/Atacadão, VITTAL se for Vittal, senão OUTRO.
- "invoiceRef" é o nº da NF-e (campo "Número" ou "NF" — número longo no topo).
- "occurredAt" é a data de emissão no formato ISO yyyy-mm-dd.
- "totalAmount" é o valor total da nota (com impostos).
- Para cada item, extraia:
  * productName: descrição completa do produto exatamente como na NF
  * productCode: código do produto (GTIN/EAN/código interno do fornecedor), se houver
  * qty: quantidade (inteiro; se vier 2,000 trata como 2)
  * unitCost: valor unitário (decimal, R$)
  * totalCost: valor total do item (qty × unitCost)
- Se algum campo não estiver claro, use null (não invente).
- Retorne APENAS JSON válido, sem markdown, sem explicação.`;

const USER_PROMPT = `Extraia os dados estruturados desse documento NF-e/DANFE/cupom em JSON com este schema:
{
  "supplier": "ATACADAO" | "VITTAL" | "OUTRO",
  "supplierName": string | null,
  "invoiceRef": string | null,
  "occurredAt": "yyyy-mm-dd" | null,
  "totalAmount": number,
  "items": [
    { "productName": string, "productCode": string | null, "qty": number, "unitCost": number, "totalCost": number }
  ]
}`;

export async function parseNfeFromBase64(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf',
): Promise<NfeParsedDoc> {
  const apiKey = await getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY ausente');

  const client = new Anthropic({ apiKey });

  const sourceBlock =
    mediaType === 'application/pdf'
      ? ({
          type: 'document' as const,
          source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 },
        })
      : ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: mediaType, data: base64 },
        });

  const res = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [sourceBlock, { type: 'text', text: USER_PROMPT }],
      },
    ],
  });

  const textBlock = res.content.find((c) => c.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Vision não retornou texto');
  }

  // Limpa eventual markdown ```json ... ```
  const raw = textBlock.text.trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '');
  let parsed: Omit<NfeParsedDoc, 'items'> & { items: Omit<NfeParsedItem, 'skuMatch'>[] };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Vision retornou JSON inválido: ${(err as Error).message}\n---\n${raw.slice(0, 500)}`);
  }

  // Fuzzy match com SKUs existentes
  const allSkus = await prisma.sku.findMany({
    where: { active: true },
    select: { id: true, code: true, name: true, supplierSkuCode: true },
  });

  const matchedItems: NfeParsedItem[] = parsed.items.map((it) => ({
    ...it,
    skuMatch: matchSku(it, allSkus),
  }));

  return {
    ...parsed,
    items: matchedItems,
  };
}

function matchSku(
  item: { productName: string; productCode?: string | null },
  skus: { id: string; code: string; name: string; supplierSkuCode: string | null }[],
): NfeParsedItem['skuMatch'] {
  const code = item.productCode?.replace(/\s/g, '').toLowerCase() ?? '';
  // 1. Match exato por código fornecedor (GTIN)
  if (code) {
    const byCode = skus.find(
      (s) => s.supplierSkuCode?.toLowerCase() === code || s.code.toLowerCase() === code,
    );
    if (byCode) return { id: byCode.id, code: byCode.code, name: byCode.name, score: 100 };
  }

  // 2. Match por similaridade de nome
  const name = normalize(item.productName);
  let best: { sku: (typeof skus)[number]; score: number } | null = null;
  for (const sku of skus) {
    const skuName = normalize(sku.name);
    const score = similarity(name, skuName);
    if (score >= 60 && (!best || score > best.score)) {
      best = { sku, score };
    }
  }
  if (best) {
    return { id: best.sku.id, code: best.sku.code, name: best.sku.name, score: best.score };
  }
  return undefined;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/// Similaridade simples baseada em tokens compartilhados (0-100).
function similarity(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter((t) => t.length >= 2));
  const tb = new Set(b.split(' ').filter((t) => t.length >= 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  // Jaccard
  const union = new Set([...ta, ...tb]).size;
  return Math.round((shared / union) * 100);
}
