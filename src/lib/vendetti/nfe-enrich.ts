/**
 * Enriquece items da NF-e que ficaram com match baixo/ausente usando
 * Claude com tool web_search.
 *
 * Cenário típico: NF-e do Atacadão lista "POWERADE 500ML AZUL" — não bate
 * com nenhum SKU porque ninguém cadastrou variante por cor. LLM com web
 * search consegue inferir: "Powerade azul = sabor Mountain Blast".
 *
 * Estratégia:
 *  1. Filtra items com skuMatch baixo (< 60%) ou ausente
 *  2. Pra cada um, chama Claude Haiku 4.5 com tool web_search
 *  3. Pede: interpretar o nome, sugerir variante real, dar confidence
 *  4. Tenta re-matchar com nome interpretado contra catálogo
 *  5. Anexa aiSuggestion no item original
 *
 * Custo: ~$0.001 por item enriquecido. Só roda quando F1 falhou.
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db';
import { getSecret } from '../secrets';
import type { NfeParsedItem } from './nfe-parse';

interface CatalogSku {
  id: string;
  code: string;
  name: string;
}

interface InterpretResult {
  interpretedName: string;
  reasoning: string;
  confidence: number;
}

const SYSTEM_PROMPT = `Você é um intérprete de descrições de NF-e de produtos brasileiros pra vending machine. Quando recebe um nome de produto curto/abreviado/com cor (ex: "Powerade Azul 500ml" ou "Coca Lt 350"), faz uma busca rápida na web e retorna o nome PADRÃO/COMPLETO do produto (ex: "Powerade Mountain Blast 500ml" ou "Coca-Cola Original Lata 350ml").

REGRAS:
- Use web_search só pra descrições ambíguas (cor, abreviação, sabor implícito). Não use pra descrições óbvias.
- Retorne APENAS JSON, sem markdown: {"interpretedName": "<nome completo>", "reasoning": "<1-2 linhas explicando>", "confidence": <0-100>}
- Se não conseguir descobrir com certeza, confidence baixo (<50) e interpretedName igual ao input
- Foco em variantes/sabores conhecidos do mercado BR
- Mantém o tamanho/quantidade do input no interpretedName`;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOISE_TOKENS = new Set([
  'ref', 'lata', 'sleek', 'und', 'un', 'unid', 'unidade',
  'emb', 'embal', 'embalagem', 'gar', 'garrafa', 'pet',
  'cxa', 'cx', 'caixa', 'fardo', 'br', 'nacional', 'naci',
]);

function tokens(s: string): Set<string> {
  return new Set(
    normalize(s)
      .split(' ')
      .filter((t) => t.length >= 2)
      .filter((t) => !NOISE_TOKENS.has(t)),
  );
}

function f1Score(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  if (shared === 0) return 0;
  const p = shared / ta.size;
  const r = shared / tb.size;
  return Math.round(((2 * p * r) / (p + r)) * 100);
}

async function interpretItem(item: NfeParsedItem): Promise<InterpretResult | null> {
  const apiKey = await getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  const anthropic = new Anthropic({ apiKey });

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      // Tool web_search da Anthropic (disponível em Haiku/Sonnet/Opus)
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 2,
        } as never,
      ],
      messages: [
        {
          role: 'user',
          content: `Item da NF-e:
- Nome: "${item.productName}"
- Código: ${item.productCode ?? '(sem)'}
- Quantidade: ${item.qty}
- Custo unitário: R$ ${item.unitCost.toFixed(2)}

Interprete o nome do produto. Use web_search se for ambíguo (cor, abreviação). Retorne JSON.`,
        },
      ],
    });

    // Pega o último bloco de texto (resposta final do modelo)
    const text = msg.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('\n')
      .trim();

    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as InterpretResult;
    return parsed;
  } catch (e) {
    console.warn('[interpretItem]', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Enriquece items low-confidence com sugestão de IA + re-match contra catálogo.
 * Modifica items in-place adicionando `aiSuggestion` quando aplicável.
 */
export async function enrichLowConfidenceItems(
  items: NfeParsedItem[],
  opts: { minScoreToSkip?: number; max?: number } = {},
): Promise<{ enriched: number; matched: number; skipped: number }> {
  const minScore = opts.minScoreToSkip ?? 60;
  const max = opts.max ?? 5;

  // Filtra items que precisam enrichment
  const candidates = items.filter(
    (it) => !it.skuMatch || it.skuMatch.score < minScore,
  );
  if (candidates.length === 0) {
    return { enriched: 0, matched: 0, skipped: 0 };
  }

  // Carrega catálogo pra re-match após interpretação
  const catalog = await prisma.sku.findMany({
    where: { active: true },
    select: { id: true, code: true, name: true },
  });

  let enriched = 0;
  let matchedNew = 0;
  let skipped = 0;

  for (const item of candidates.slice(0, max)) {
    const interp = await interpretItem(item);
    if (!interp) {
      skipped++;
      continue;
    }

    // Re-match contra catálogo com nome interpretado
    let bestSku: CatalogSku | null = null;
    let bestScore = 0;
    for (const sku of catalog) {
      const score = f1Score(interp.interpretedName, sku.name);
      if (score >= 60 && score > bestScore) {
        bestScore = score;
        bestSku = sku;
      }
    }

    item.aiSuggestion = {
      interpretedName: interp.interpretedName,
      reasoning: interp.reasoning,
      confidence: interp.confidence,
      skuMatch: bestSku ? { ...bestSku, score: bestScore } : undefined,
    };
    enriched++;
    if (bestSku) matchedNew++;

    // Throttle pra não estourar rate limit + ser educado com web search
    await new Promise((r) => setTimeout(r, 300));
  }

  return { enriched, matched: matchedNew, skipped };
}
