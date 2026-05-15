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

const RULES: Array<[RegExp, ProductMeta]> = [
  [/\bágua|agua\b/i, { emoji: '💧', category: 'agua', bgClass: 'bg-sky-100' }],
  [/red bull|monster|energ/i, { emoji: '⚡', category: 'energetico', bgClass: 'bg-amber-100' }],
  [/powerade|gatorade|isotôn/i, { emoji: '🏃', category: 'isotonico', bgClass: 'bg-lime-100' }],
  [/coca|refri|cola/i, { emoji: '🥤', category: 'refri', bgClass: 'bg-rose-100' }],
  [/chá|mate|bear mate/i, { emoji: '🍵', category: 'cha', bgClass: 'bg-emerald-100' }],
  [/kit kat|bis|m\&m|mms/i, { emoji: '🍫', category: 'choc', bgClass: 'bg-orange-100' }],
  [/barra.*(cereal|protein|whey|crisp|delicio|buenissimo|topway|ftw|nutry)/i, { emoji: '🌾', category: 'barra', bgClass: 'bg-yellow-100' }],
  [/halls|mentos|bala/i, { emoji: '🍬', category: 'bala', bgClass: 'bg-pink-100' }],
  [/wafer/i, { emoji: '🍪', category: 'wafer', bgClass: 'bg-amber-50' }],
  [/club social|biscoito|cookie/i, { emoji: '🥨', category: 'salgadinho', bgClass: 'bg-yellow-50' }],
  [/amendoim|castanha|nuts/i, { emoji: '🥜', category: 'amendoim', bgClass: 'bg-orange-50' }],
];

const DEFAULT: ProductMeta = { emoji: '📦', category: 'outro', bgClass: 'bg-navy-50' };

export function getProductMeta(productName: string | null | undefined): ProductMeta {
  if (!productName) return DEFAULT;
  for (const [re, meta] of RULES) {
    if (re.test(productName)) return meta;
  }
  return DEFAULT;
}
