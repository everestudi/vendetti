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

/// Palavras-ruído de descrições NF-e (Atacadão, Assaí) — não ajudam a
/// distinguir entre produtos.
const NOISE_TOKENS = new Set([
  'ref', 'lata', 'sleek', 'und', 'un', 'unid', 'unidade',
  'emb', 'embal', 'embalagem',
  'gar', 'garrafa', 'pet', 'pack',
  'cxa', 'cx', 'caixa', 'fardo',
  'br', 'nacional', 'naci', 'imp',
  '1x1', '6x1', '12x1', '24x1',
  'nfe', 'sa', 'sgl',
]);

/// Discriminadores: presença unilateral derruba o score a 0.
const DISCRIMINATORS = [
  'zero', 'diet', 'light', 'sem',
  'watermelon', 'amora', 'morango', 'baunilha', 'limao',
  'tropical', 'pipeline', 'mango', 'maracuja',
  'ultra',
];

function meaningfulTokens(name: string): Set<string> {
  return new Set(
    normalize(name)
      .split(' ')
      .filter((w) => w.length >= 2)
      .filter((w) => !NOISE_TOKENS.has(w)),
  );
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
 * Busca o melhor match de `target` (nome com ruído da NF-e ou input do user)
 * na lista de skus do catálogo limpo.
 *
 * Score = containment do MENOR conjunto no MAIOR (asymmetric):
 *   shared / min(tokens-significativos) · 100
 *
 * Discriminadores conflitantes → score 0 (evita Coca ↔ Coca Zero, Monster
 * Pipeline ↔ Monster Watermelon).
 *
 * Noise tokens (REF, LATA, SLEEK, etc) são descontados antes de medir.
 */
export function matchSku(target: string, skus: SkuLike[]): SkuMatchResult {
  if (!target.trim() || skus.length === 0) return { match: null, score: 0, confidence: 'none' };
  const t = normalize(target);
  const tTokens = meaningfulTokens(target);
  if (tTokens.size === 0) return { match: null, score: 0, confidence: 'none' };

  let best: SkuMatchResult = { match: null, score: 0, confidence: 'none' };
  for (const sku of skus) {
    const n = normalize(sku.name);
    // Discriminator check (em raw normalized string pra pegar palavras pequenas)
    let discrConflict = false;
    for (const d of DISCRIMINATORS) {
      if (t.includes(d) !== n.includes(d)) {
        discrConflict = true;
        break;
      }
    }
    if (discrConflict) continue;

    const nTokens = meaningfulTokens(sku.name);
    if (nTokens.size === 0) continue;

    // F1 score: precision (shared/target) + recall (shared/catalog).
    // Penaliza catálogo genérico vs target específico: ex target tem 7 tokens
    // {beb, energ, red, bull, 250ml, frutas, vermelhas}, catálogo "Red Bull
    // 250ml" tem 3 tokens — recall=100% mas precision=3/7=43% → F1=60%.
    // Já catálogo "Red Bull Frutas Vermelhas 250ml" com 7 tokens iguais → F1=100%.
    let shared = 0;
    for (const tk of tTokens) if (nTokens.has(tk)) shared++;
    if (shared === 0) continue;
    const precision = shared / tTokens.size;
    const recall = shared / nTokens.size;
    const f1 = (2 * precision * recall) / (precision + recall);
    const score = Math.round(f1 * 100);
    if (score > best.score) {
      const confidence: SkuMatchResult['confidence'] =
        score >= 80 ? 'high' : score >= 50 ? 'mid' : 'low';
      best = { match: sku, score, confidence };
    }
  }
  return best;
}
