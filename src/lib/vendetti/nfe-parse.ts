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
  /// Custo unitário efetivo (já com desconto rateado, se houver).
  unitCost: number;
  /// Total efetivo (qty × unitCost) — já com desconto rateado.
  totalCost: number;
  /// Custo unitário ORIGINAL impresso na NF, antes do rateio de desconto.
  /// Igual a unitCost quando não há desconto global.
  originalUnitCost?: number;
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
  /// Soma bruta dos itens (antes de desconto). Pode vir null se vision não detectar.
  subtotalAmount?: number | null;
  /// Desconto total aplicado no rodapé da NF (Assaí, p.ex.). 0 se não houver.
  discountAmount?: number;
  /// Total final pago (após desconto).
  totalAmount: number;
  items: NfeParsedItem[];
  rawText?: string;
}

const SYSTEM_PROMPT = `Você é um extrator de NF-e/DANFE/cupom fiscal brasileiro.
Sua tarefa: extrair dados estruturados em JSON do documento.

Regras:
- "supplierName" é a razão social do emitente (quem vendeu). Atacadão e Assaí são distintos: se for Assaí, use OUTRO em "supplier" e ponha "Assaí" em "supplierName".
- "supplier" deve ser ATACADAO se o emitente for ATACADAO/Atacadão, VITTAL se for Vittal, senão OUTRO.
- "invoiceRef" é o nº da NF-e (campo "Número" ou "NF" — número longo no topo).
- "occurredAt" é a data de emissão no formato ISO yyyy-mm-dd.
- "subtotalAmount" é a soma bruta dos itens (antes de qualquer desconto no rodapé). Se a NF mostrar "Subtotal", use; senão calcule pela soma dos valores totais dos itens. Se não tiver certeza, use null.
- "discountAmount" é o desconto global aplicado no rodapé da NF (Assaí costuma fazer isso, exibido como "Desconto" ou "Vlr Desc"). Se não houver desconto global, use 0.
- "totalAmount" é o valor total final pago (após desconto). Costuma vir como "Valor Total", "Total a Pagar" ou "Total Líquido".
- Para cada item, extraia o valor IMPRESSO na NF (sem aplicar desconto global, esse rateio é feito depois):
  * productName: descrição completa do produto exatamente como na NF
  * productCode: código do produto (GTIN/EAN/código interno do fornecedor), se houver
  * qty: quantidade (inteiro; se vier 2,000 trata como 2)
  * unitCost: valor unitário impresso (decimal, R$)
  * totalCost: valor total impresso do item (qty × unitCost)
- Se algum campo não estiver claro, use null (não invente).
- Retorne APENAS JSON válido, sem markdown, sem explicação.`;

const USER_PROMPT = `Extraia os dados estruturados desse documento NF-e/DANFE/cupom em JSON com este schema:
{
  "supplier": "ATACADAO" | "VITTAL" | "OUTRO",
  "supplierName": string | null,
  "invoiceRef": string | null,
  "occurredAt": "yyyy-mm-dd" | null,
  "subtotalAmount": number | null,
  "discountAmount": number,
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

  // Rateio do desconto global (caso Assaí etc): distribui proporcionalmente
  // ao peso de cada item no subtotal. Preserva o original em originalUnitCost.
  const discountAmount = parsed.discountAmount ?? 0;
  const subtotal =
    parsed.subtotalAmount ?? parsed.items.reduce((s, it) => s + (it.totalCost || 0), 0);
  const discountRatio = discountAmount > 0 && subtotal > 0 ? discountAmount / subtotal : 0;

  const proratedItems = parsed.items.map((it) => {
    if (discountRatio === 0) {
      return { ...it, originalUnitCost: it.unitCost };
    }
    const originalUnitCost = it.unitCost;
    const adjustedUnit = round2(it.unitCost * (1 - discountRatio));
    const adjustedTotal = round2(adjustedUnit * it.qty);
    return {
      ...it,
      originalUnitCost,
      unitCost: adjustedUnit,
      totalCost: adjustedTotal,
    };
  });

  // Fuzzy match com SKUs existentes
  const allSkus = await prisma.sku.findMany({
    where: { active: true },
    select: { id: true, code: true, name: true, supplierSkuCode: true },
  });

  const matchedItems: NfeParsedItem[] = proratedItems.map((it) => ({
    ...it,
    skuMatch: matchSku(it, allSkus),
  }));

  return {
    ...parsed,
    subtotalAmount: parsed.subtotalAmount ?? null,
    discountAmount,
    items: matchedItems,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

/// Palavras-ruído de descrições NF-e (Atacadão, Assaí) — não ajudam a
/// distinguir entre produtos. Vão ser ignoradas no score.
const NOISE_TOKENS = new Set([
  'ref', 'lata', 'sleek', 'und', 'un', 'unid', 'unidade',
  'emb', 'embal', 'embalagem',
  'gar', 'garrafa', 'pet', 'pack',
  'cxa', 'cx', 'caixa', 'fardo',
  'br', 'nacional', 'naci', 'imp',
  '1x1', '6x1', '12x1', '24x1',
  'nfe', 'sa', 'sgl', // sleek single
]);

/// Tokens DISCRIMINADORES: presença unilateral derruba o score a 0 (são
/// variantes de produto que NÃO podem ser confundidas).
const DISCRIMINATORS = [
  'zero', 'diet', 'light', 'sem',
  'watermelon', 'amora', 'morango', 'baunilha', 'limao', 'limão',
  'tropical', 'pipeline', 'mango', 'maracuja',
  'ultra', // variantes Monster Ultra X
];

function tokensFor(name: string): Set<string> {
  return new Set(
    name
      .split(' ')
      .filter((t) => t.length >= 2)
      .filter((t) => !NOISE_TOKENS.has(t)),
  );
}

/**
 * Score 0-100 entre nome A (geralmente da NF-e, com ruído) e nome B
 * (do catálogo, limpo). Asymmetric containment: quantos dos tokens do
 * catálogo aparecem na NF-e (descontando ruído). Mais robusto que Jaccard
 * pra nomes com prefixos do fornecedor (REF, LATA, etc).
 *
 * Discriminadores conflitantes → score 0 (evita Coca ↔ Coca Zero etc).
 */
function similarity(a: string, b: string): number {
  const ta = tokensFor(a);
  const tb = tokensFor(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  // Discriminator check: se um tem e outro não, fail-fast
  // (em normalized raw pra pegar palavras pequenas tipo "sem")
  const ra = a;
  const rb = b;
  for (const d of DISCRIMINATORS) {
    if (ra.includes(d) !== rb.includes(d)) return 0;
  }

  // F1 score: harmonic mean de precision (shared/A) e recall (shared/B).
  // Penaliza match com candidato "genérico" quando o target tem tokens extras
  // que sugerem variante específica (Frutas Vermelhas, Watermelon, etc).
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  if (shared === 0) return 0;
  const precision = shared / ta.size;
  const recall = shared / tb.size;
  const f1 = (2 * precision * recall) / (precision + recall);
  return Math.round(f1 * 100);
}
