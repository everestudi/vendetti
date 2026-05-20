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
import Anthropic from '@anthropic-ai/sdk';
import { getSecret } from '../secrets';

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

/** Discriminadores CRÍTICOS — presença unilateral derruba match a 0.
 *  Crucial pra evitar "Água sem gás" pegar imagem de "Água com gás" etc. */
const DISCRIMINATORS = [
  'zero', 'diet', 'light',
  'com gas', 'com gás', 'c gas', 'c gás', 'sem gas', 'sem gás', 's gas',
  'watermelon', 'amora', 'morango', 'baunilha', 'limao',
  'tropical', 'pipeline', 'mango', 'maracuja',
  'mountain blast', 'frutas vermelhas', 'frutas tropicais',
  'ultra', 'integral', 'original',
];

function meaningfulTokens(name: string): string[] {
  return normalize(name)
    .split(' ')
    .filter((t) => t.length >= 3)
    .filter((t) => !NOISE_TOKENS.has(t));
}

/** Pega tokens significativos do SKU pra query — 3-4 tokens dão melhor resultado.
 *  PRESERVA modificadores discriminadores (com gás / sem gás / zero / etc). */
function buildQuery(skuName: string): string {
  const norm = normalize(skuName);
  const baseTokens = meaningfulTokens(skuName).slice(0, 4);

  // Detecta discriminators presentes no nome e força inclusão na query
  const extras: string[] = [];
  for (const d of DISCRIMINATORS) {
    if (norm.includes(d) && !baseTokens.some((t) => d.includes(t))) {
      // Append a forma legível (com hyphen/space)
      extras.push(d.replace(' ', '-'));
    }
  }
  return [...baseTokens, ...extras].join(' ');
}

/** Score 0-100 entre nome SKU e nome retornado.
 *  Discriminator-aware: se um tem "sem gás" e outro "com gás" → 0. */
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  // Discriminator check — conflicto = score 0
  for (const d of DISCRIMINATORS) {
    if (na.includes(d) !== nb.includes(d)) return 0;
  }

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
  matched: { name: string; imageUrl: string; score: number; source: string } | null;
  skipped?: string;
}

/** Tenta Atacadão (rápido, F1 com discriminator). */
async function tryAtacadao(skuName: string): Promise<{ name: string; imageUrl: string; score: number } | null> {
  const query = buildQuery(skuName);
  if (!query) return null;
  try {
    const results = await searchAtacadao(query, 8);
    if (results.length === 0) return null;
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
    console.warn(`[tryAtacadao] ${skuName}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Fallback via Claude com web_search — busca em qualquer site do mercado BR.
 *  Mais caro/lento que Atacadão (~$0.001-0.003) mas funciona pra produtos
 *  raros ou variantes que o Atacadão não tem. */
async function tryClaudeWebSearch(skuName: string): Promise<{ name: string; imageUrl: string; score: number } | null> {
  const apiKey = await getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  const anthropic = new Anthropic({ apiKey });

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `Você é um buscador de imagens de produtos brasileiros. Recebe um nome de produto, pesquisa na web, e retorna a URL de uma imagem confiável do produto.

REGRAS:
- Use web_search pra encontrar o produto em sites confiáveis: atacadao.com.br, carrefour.com.br, paodeacucar.com.br, mercadolivre.com.br, sitedo fabricante (cocacola.com, redbull.com, etc).
- A URL retornada deve ser de uma IMAGEM (termina em .jpg, .png, .webp ou tem 'image' no path).
- Priorize URLs de CDNs (vtexassets, mlstatic, etc) que são estáveis.
- Output APENAS JSON: {"imageUrl": "<url>", "source": "<site/loja>", "confidence": <0-100>}
- Se não conseguir encontrar com confiança razoável, retorne {"imageUrl": null, "source": "", "confidence": 0}`,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 } as never],
      messages: [
        {
          role: 'user',
          content: `Encontre uma imagem boa do produto: "${skuName}". Pesquise na web e retorne JSON com URL da imagem.`,
        },
      ],
    });

    const text = msg.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('\n')
      .trim();
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    let parsed: { imageUrl: string | null; source: string; confidence: number };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return null;
    }
    if (!parsed.imageUrl) return null;
    // Validate URL básica
    if (!/^https?:\/\//.test(parsed.imageUrl)) return null;
    return {
      name: skuName,
      imageUrl: parsed.imageUrl,
      score: parsed.confidence,
    };
  } catch (e) {
    console.warn(`[tryClaudeWebSearch] ${skuName}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Busca imagem pra UM Sku — tenta Atacadão → Claude web search.
 *  Retorna URL + score + source pra audit. */
export async function fetchImageForSku(
  skuName: string,
): Promise<{ name: string; imageUrl: string; score: number; source: string } | null> {
  // 1. Atacadão (rápido, ~500ms)
  const atacadao = await tryAtacadao(skuName);
  if (atacadao && atacadao.score >= 60) {
    return { ...atacadao, source: 'atacadao' };
  }

  // 2. Claude web search (mais lento, ~5-10s mas funciona pra variantes raras)
  const claude = await tryClaudeWebSearch(skuName);
  if (claude && claude.imageUrl) {
    return { ...claude, source: 'claude-web' };
  }

  // 3. Se Atacadão deu match parcial (40-59%), aceita como último recurso
  if (atacadao && atacadao.score >= 40) {
    return { ...atacadao, source: 'atacadao-low' };
  }

  return null;
}

/** Re-busca imagem pra UM SKU específico (match por nome fuzzy).
 *  Retorna o SKU encontrado + resultado da busca. Usado por Augusto via tool
 *  quando ele detecta match errado ou Luís reporta produto sem imagem. */
export async function refetchImageForSkuByName(skuName: string): Promise<{
  ok: boolean;
  skuFound: { id: string; name: string; previousImageUrl: string | null } | null;
  matched: { name: string; imageUrl: string; score: number; source: string } | null;
  error?: string;
}> {
  // Match fuzzy: tenta nome exato (case-insensitive) → tokens significativos
  let sku = await prisma.sku.findFirst({
    where: { active: true, name: { equals: skuName, mode: 'insensitive' } },
    select: { id: true, name: true, imageUrl: true },
  });
  if (!sku) {
    // tenta contains
    sku = await prisma.sku.findFirst({
      where: { active: true, name: { contains: skuName, mode: 'insensitive' } },
      select: { id: true, name: true, imageUrl: true },
    });
  }
  if (!sku) {
    // fallback token search — pega o SKU com maior similarity
    const all = await prisma.sku.findMany({
      where: { active: true },
      select: { id: true, name: true, imageUrl: true },
    });
    let best: { id: string; name: string; imageUrl: string | null; score: number } | null = null;
    for (const s of all) {
      const score = similarity(skuName, s.name);
      if (score >= 50 && (!best || score > best.score)) {
        best = { ...s, score };
      }
    }
    if (best) {
      sku = { id: best.id, name: best.name, imageUrl: best.imageUrl };
    }
  }
  if (!sku) {
    return { ok: false, skuFound: null, matched: null, error: `SKU "${skuName}" não encontrado no catálogo` };
  }

  const result = await fetchImageForSku(sku.name);
  if (!result) {
    return {
      ok: false,
      skuFound: { id: sku.id, name: sku.name, previousImageUrl: sku.imageUrl },
      matched: null,
      error: 'Atacadão + Claude web search falharam — nenhuma imagem com confiança suficiente',
    };
  }
  await prisma.sku.update({
    where: { id: sku.id },
    data: { imageUrl: result.imageUrl },
  });
  return {
    ok: true,
    skuFound: { id: sku.id, name: sku.name, previousImageUrl: sku.imageUrl },
    matched: result,
  };
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
      console.log(`  ✗ ${sku.name} — sem imagem (Atacadão + Claude falharam)`);
      // throttle
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    await prisma.sku.update({
      where: { id: sku.id },
      data: { imageUrl: result.imageUrl },
    });
    details.push({ skuId: sku.id, skuName: sku.name, query, matched: result });
    matched++;
    console.log(`  ✓ ${sku.name} (${result.source} · ${result.score}%)`);
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
