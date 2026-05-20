/**
 * Mapeia nome do produto pra emoji + categoria.
 * Heurística simples — quando tivermos campo `imageUrl` no SKU, troca por foto real.
 */

export type ProductCategory = 'agua' | 'energetico' | 'isotonico' | 'refri' | 'cha' | 'choc' | 'barra' | 'bala' | 'wafer' | 'salgadinho' | 'amendoim' | 'outro';

export interface ProductMeta {
  emoji: string;
  category: ProductCategory;
  /** Cor de fundo do slot (Tailwind class). */
  bgClass: string;
}

// Cor de fundo padrão = branco neutro (deixa imagem ser destaque).
// Cor por categoria é só pra fallback quando NÃO tem imageUrl (emoji visível).
const RULES: Array<[RegExp, ProductMeta]> = [
  [/\bágua|agua\b/i, { emoji: '💧', category: 'agua', bgClass: 'bg-white' }],
  [/red bull|monster|energ/i, { emoji: '⚡', category: 'energetico', bgClass: 'bg-white' }],
  [/powerade|gatorade|isotôn/i, { emoji: '🏃', category: 'isotonico', bgClass: 'bg-white' }],
  [/coca|refri|cola/i, { emoji: '🥤', category: 'refri', bgClass: 'bg-white' }],
  [/chá|mate|bear mate/i, { emoji: '🍵', category: 'cha', bgClass: 'bg-white' }],
  [/kit kat|bis|m\&m|mms/i, { emoji: '🍫', category: 'choc', bgClass: 'bg-white' }],
  [/barra.*(cereal|protein|whey|crisp|delicio|buenissimo|topway|ftw|nutry)/i, { emoji: '🌾', category: 'barra', bgClass: 'bg-white' }],
  [/halls|mentos|bala/i, { emoji: '🍬', category: 'bala', bgClass: 'bg-white' }],
  [/wafer/i, { emoji: '🍪', category: 'wafer', bgClass: 'bg-white' }],
  [/club social|biscoito|cookie/i, { emoji: '🥨', category: 'salgadinho', bgClass: 'bg-white' }],
  [/amendoim|castanha|nuts/i, { emoji: '🥜', category: 'amendoim', bgClass: 'bg-white' }],
];

const DEFAULT: ProductMeta = { emoji: '📦', category: 'outro', bgClass: 'bg-white' };

export function getProductMeta(productName: string | null | undefined): ProductMeta {
  if (!productName) return DEFAULT;
  for (const [re, meta] of RULES) {
    if (re.test(productName)) return meta;
  }
  return DEFAULT;
}
