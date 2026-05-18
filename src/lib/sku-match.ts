/**
 * Fuzzy matching pra produtos cadastrados no nosso catálogo Sku.
 *
 * Usado quando o usuário marca um slot pra troca de produto em /decisions —
 * antes de aprovar, queremos saber se o "produto alvo" já existe no banco
 * (vai usar o existente) ou se é NOVO (precisa cadastrar com custo+categoria).
 */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SkuLike {
  id: string;
  name: string;
  category?: string;
}

export interface SkuMatchResult {
  match: SkuLike | null;
  score: number; // 0-100
  confidence: 'high' | 'mid' | 'low' | 'none';
}

/**
 * Busca o melhor match de `target` na lista de skus pelo nome.
 * Score = (tokens compartilhados / tokens da target) * 100, ajustado pra
 * penalizar mismatches em discriminadores conhecidos (sabor, com/sem gás).
 */
export function matchSku(target: string, skus: SkuLike[]): SkuMatchResult {
  const t = normalize(target);
  if (!t || skus.length === 0) return { match: null, score: 0, confidence: 'none' };
  const tTokens = t.split(' ').filter((w) => w.length >= 3);
  if (tTokens.length === 0) return { match: null, score: 0, confidence: 'none' };

  // Discriminadores: se um tem e outro não, score 0 (não é match)
  const DISCR = ['zero', 'diet', 'light', 'watermelon', 'amora', 'morango', 'baunilha', 'tropical', 'pipeline', 'mango'];

  let best: SkuMatchResult = { match: null, score: 0, confidence: 'none' };
  for (const sku of skus) {
    const n = normalize(sku.name);
    // Discriminator check
    let discrConflict = false;
    for (const d of DISCR) {
      if (t.includes(d) !== n.includes(d)) {
        discrConflict = true;
        break;
      }
    }
    if (discrConflict) continue;

    const nTokens = new Set(n.split(' ').filter((w) => w.length >= 3));
    let shared = 0;
    for (const tk of tTokens) if (nTokens.has(tk)) shared++;
    if (shared === 0) continue;
    const score = Math.round((shared / tTokens.length) * 100);
    if (score > best.score) {
      const confidence: SkuMatchResult['confidence'] =
        score >= 80 ? 'high' : score >= 50 ? 'mid' : 'low';
      best = { match: sku, score, confidence };
    }
  }
  return best;
}
