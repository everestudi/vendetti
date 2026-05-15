/**
 * Busca produto no Atacadão via API VTEX.
 * Sem Playwright — request HTTP direto, ~500ms.
 */

export interface AtacadaoProduct {
  name: string;
  productId: string;
  brand: string;
  price: number | null;
  imageUrl?: string;
  link?: string;
  /** Tamanho/quantidade no nome (ex: "350ml", "500g") — best-effort. */
  size?: string;
  /** Preço por unidade de medida, se a API retorna. */
  pricePerUnit?: string;
}

interface VtexCommercialOffer {
  Price?: number;
  ListPrice?: number;
  PriceWithoutDiscount?: number;
  AvailableQuantity?: number;
}

interface VtexSku {
  itemId?: string;
  name?: string;
  measurementUnit?: string;
  unitMultiplier?: number;
  images?: Array<{ imageUrl: string }>;
  sellers?: Array<{
    sellerId?: string;
    commertialOffer?: VtexCommercialOffer;
  }>;
}

interface VtexProduct {
  productId: string;
  productName: string;
  brand?: string;
  link?: string;
  linkText?: string;
  description?: string;
  priceRange?: {
    sellingPrice?: { lowPrice?: number; highPrice?: number };
  };
  items?: VtexSku[];
}

interface VtexResponse {
  products?: VtexProduct[];
  recordsFiltered?: number;
}

const EXTRACT_SIZE = /(\d+(?:[.,]\d+)?\s?(?:ml|l|g|kg|un)\b)/i;

function pickPrice(p: VtexProduct): number | null {
  const offer = p.items?.[0]?.sellers?.[0]?.commertialOffer;
  if (offer?.Price !== undefined) return offer.Price;
  const range = p.priceRange?.sellingPrice?.lowPrice;
  return range ?? null;
}

export async function searchAtacadao(query: string, limit = 8): Promise<AtacadaoProduct[]> {
  const url = `https://www.atacadao.com.br/api/io/_v/api/intelligent-search/product_search/?query=${encodeURIComponent(query)}&count=${limit}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Vendetti-CEO/1.0)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Atacadão HTTP ${res.status}`);
  const data = (await res.json()) as VtexResponse;
  const products = data.products ?? [];

  return products.slice(0, limit).map((p) => {
    const sizeMatch = EXTRACT_SIZE.exec(p.productName);
    return {
      name: p.productName,
      productId: p.productId,
      brand: p.brand ?? '',
      price: pickPrice(p),
      imageUrl: p.items?.[0]?.images?.[0]?.imageUrl,
      link: p.link ? `https://www.atacadao.com.br${p.link.startsWith('/') ? '' : '/'}${p.link}` : undefined,
      size: sizeMatch?.[1],
    };
  });
}
