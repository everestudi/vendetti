/**
 * Busca imagens dos produtos via Atacadão VTEX e popula Sku.imageUrl.
 *
 * Estratégia:
 *   1. Pra cada Sku sem imageUrl, busca no Atacadão pelo nome
 *   2. Pega o primeiro resultado com confidence razoável (token match)
 *   3. Salva imageUrl no DB
 *
 * Pode ser chamado de:
 *   - Server action (botão manual pra popular imagens em massa)
 *   - Bruno ao confirmar NF-e (pra produto recém-cadastrado)
 *   - Cron diário (atualiza imagens com URLs novas)
 */

import { prisma } from '../db';
import { searchAtacadao } from '../../scrapers/atacadao/search';

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

function meaningfulTokens(name: string): string[] {
  return normalize(name)
    .split(' ')
    .filter((t) => t.length >= 3)
    .filter((t) => !NOISE_TOKENS.has(t));
}

/** Pega tokens significativos do SKU pra query — 3-4 tokens dão melhor resultado */
function buildQuery(skuName: string): string {
  return meaningfulTokens(skuName).slice(0, 4).join(' ');
}

/** Score 0-100 entre nome SKU e nome retornado pelo Atacadão */
function similarity(a: string, b: string): number {
  const ta = new Set(meaningfulTokens(a));
  const tb = new Set(meaningfulTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  if (shared === 0) return 0;
  const p = shared / ta.size;
  const r = shared / tb.size;
  return Math.round(((2 * p * r) / (p + r)) * 100);
}

export interface FetchImageResult {
  skuId: string;
  skuName: string;
  query: string;
  matched: { name: string; imageUrl: string; score: number } | null;
  skipped?: string;
}

/** Busca imagem pra UM Sku específico (não persiste — chamada externa decide). */
export async function fetchImageForSku(skuName: string): Promise<{ name: string; imageUrl: string; score: number } | null> {
  const query = buildQuery(skuName);
  if (!query) return null;
  try {
    const results = await searchAtacadao(query, 5);
    if (results.length === 0) return null;
    // Pega o melhor match por similaridade
    let best: { name: string; imageUrl: string; score: number } | null = null;
    for (const r of results) {
      if (!r.imageUrl) continue;
      const score = similarity(skuName, r.name);
      if (score >= 50 && (!best || score > best.score)) {
        best = { name: r.name, imageUrl: r.imageUrl, score };
      }
    }
    return best;
  } catch (e) {
    console.warn(`[fetchImageForSku] ${skuName}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Popula imagens em massa pra todos os SKUs sem imageUrl. */
export async function backfillProductImages(opts: { force?: boolean; max?: number } = {}): Promise<{
  ok: boolean;
  total: number;
  matched: number;
  skipped: number;
  failed: number;
  details: FetchImageResult[];
}> {
  const max = opts.max ?? 100;
  const where = opts.force ? { active: true } : { active: true, imageUrl: null };
  const skus = await prisma.sku.findMany({
    where,
    select: { id: true, name: true, imageUrl: true },
    take: max,
  });

  const details: FetchImageResult[] = [];
  let matched = 0;
  let skipped = 0;
  let failed = 0;

  for (const sku of skus) {
    const query = buildQuery(sku.name);
    if (!query) {
      details.push({ skuId: sku.id, skuName: sku.name, query: '', matched: null, skipped: 'sem tokens' });
      skipped++;
      continue;
    }
    const result = await fetchImageForSku(sku.name);
    if (!result) {
      details.push({ skuId: sku.id, skuName: sku.name, query, matched: null });
      failed++;
      // small throttle pra ser educado com Atacadão
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    await prisma.sku.update({
      where: { id: sku.id },
      data: { imageUrl: result.imageUrl },
    });
    details.push({ skuId: sku.id, skuName: sku.name, query, matched: result });
    matched++;
    await new Promise((r) => setTimeout(r, 200));
  }

  return {
    ok: true,
    total: skus.length,
    matched,
    skipped,
    failed,
    details,
  };
}
