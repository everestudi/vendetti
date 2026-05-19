/**
 * Captura o estado atual do Estoque Everest (warehouse) do Vendtef.
 *
 * Caminho: ERP > Estoques > linha "Estoque Everest" > click "Produtos
 * Configurados" → modal Bootstrap abre com tabela #produtos.
 *
 * Pra cada row da tabela: produto, qty atual, alerta, crítico, status.
 * Match com nossos Sku.name (fuzzy F1+noise). Updates EverestStock.
 *
 * Chamado pelo mara/run.ts no fim do sync diário. NÃO bloqueia o sync —
 * falha é warning, não error.
 */

import type { BrowserContext, Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { prisma } from '../../db';
import { dismissModals } from '../../../scrapers/_shared/playwright';

const OUT_DIR = './tmp/mara-everest';
const ESTOQUES_URL = 'https://www.erpvending.com.br/erp/estoques';

export interface EverestRow {
  productName: string;
  qty: number;
  alerta: number;
  critico: number;
  status?: string;
}

export interface ScrapeEverestResult {
  ok: boolean;
  rowsCaptured: number;
  matched: number;
  unmatched: number;
  error?: string;
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

const NOISE_TOKENS = new Set([
  'ref', 'lata', 'sleek', 'und', 'un', 'unid', 'unidade',
  'emb', 'embal', 'embalagem',
  'gar', 'garrafa', 'pet', 'pack',
  'cxa', 'cx', 'caixa', 'fardo',
  'br', 'nacional', 'naci', 'imp',
  '1x1', '6x1', '12x1', '24x1',
  'nfe', 'sa', 'sgl',
]);

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
      .filter((t) => t.length >= 2)
      .filter((t) => !NOISE_TOKENS.has(t)),
  );
}

/** F1 score idêntico ao matcher unificado em sku-match/nfe-parse/entrada. */
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  for (const d of DISCRIMINATORS) {
    if (na.includes(d) !== nb.includes(d)) return 0;
  }
  const ta = meaningfulTokens(a);
  const tb = meaningfulTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  if (shared === 0) return 0;
  const p = shared / ta.size;
  const r = shared / tb.size;
  return Math.round(((2 * p * r) / (p + r)) * 100);
}

async function openEverestProdutosConfigurados(page: Page): Promise<{ ok: boolean; modalPage?: Page; error?: string }> {
  await page.goto(ESTOQUES_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await dismissModals(page);

  // Acha row "Estoque Everest"
  const row = page.locator('tr').filter({ hasText: /estoque\s*everest/i }).first();
  if ((await row.count()) === 0) {
    return { ok: false, error: 'row Estoque Everest não achada' };
  }

  // Click "Produtos Configurados" — abre modal Bootstrap (não navega)
  const link = row.locator('a, button').filter({ hasText: /produtos\s+configurados/i }).first();
  if ((await link.count()) === 0) {
    return { ok: false, error: 'link Produtos Configurados não achado' };
  }

  const ctx = page.context();
  const newPagePromise = ctx.waitForEvent('page', { timeout: 5_000 }).catch(() => null);
  await link.click({ force: true });
  const maybeNewPage = await newPagePromise;
  const target = maybeNewPage ?? page;
  await target.waitForTimeout(2_000);
  await target.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);

  // Valida modal aberto (não chama dismissModals — fecharia)
  const modalOk = await target.evaluate(() => {
    const modals = Array.from(document.querySelectorAll('.modal, .modal-dialog'))
      .filter((m) => (m as HTMLElement).offsetParent !== null);
    for (const m of modals) {
      const title = m.querySelector('.modal-title, h4')?.textContent?.trim() ?? '';
      if (/produtos\s+configurados/i.test(title)) return true;
    }
    return false;
  });
  if (!modalOk) return { ok: false, error: 'modal Produtos Configurados não abriu' };

  return { ok: true, modalPage: target };
}

async function extractRowsFromModal(page: Page): Promise<EverestRow[]> {
  // Tabela #produtos dentro do modal. Headers: Produto, Código, Atual, Alerta, Crítico (assumido)
  return page.evaluate(() => {
    // `:visible` é jQuery, não CSS válido — usa filter manual via offsetParent
    const visibleModal = Array.from(document.querySelectorAll('.modal, .modal-dialog')).find((m) => {
      if ((m as HTMLElement).offsetParent === null) return false;
      const title = m.querySelector('.modal-title, h4')?.textContent?.trim() ?? '';
      return /produtos\s+configurados/i.test(title);
    });
    let trList: HTMLTableRowElement[] = [];
    if (visibleModal) {
      // Primeiro tenta table#produtos especificamente; fallback pra qualquer table
      const produtosTable = visibleModal.querySelector('table#produtos');
      const targetTable = (produtosTable ?? visibleModal.querySelector('table')) as HTMLTableElement | null;
      if (targetTable) {
        trList = Array.from(targetTable.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
      }
    }

    const parseNumU = (s: string): number => {
      const m = s.match(/(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    };
    return trList.map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td')).map((c) => (c.textContent ?? '').trim());
      const productName = cells[0] ?? '';
      // Headers podem ser: Produto | Código | Qtde Atual | Qtde Alerta | Qtde Crítica
      // OU outra ordem. Vamos pegar os 3 últimos campos numéricos da row como qty, alerta, crítico.
      const numerics = cells.slice(1).map(parseNumU).filter((n) => !Number.isNaN(n));
      // Status (se houver classe css indicando)
      const cls = tr.className.toLowerCase();
      const status = cls.includes('danger') || cls.includes('critico')
        ? 'crítico'
        : cls.includes('warning') || cls.includes('alerta')
          ? 'alerta'
          : 'ok';
      return {
        productName,
        qty: numerics[numerics.length - 3] ?? 0,
        alerta: numerics[numerics.length - 2] ?? 0,
        critico: numerics[numerics.length - 1] ?? 0,
        status,
      };
    }).filter((r) => r.productName.length > 1);
  });
}

export async function scrapeEverestStock(ctx: BrowserContext): Promise<ScrapeEverestResult> {
  mkdirSync(OUT_DIR, { recursive: true });

  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);

  try {
    await page.screenshot({ path: `${OUT_DIR}/01-before.png`, fullPage: true }).catch(() => undefined);
    const opened = await openEverestProdutosConfigurados(page);
    if (!opened.ok || !opened.modalPage) {
      return { ok: false, rowsCaptured: 0, matched: 0, unmatched: 0, error: opened.error };
    }
    const target = opened.modalPage;
    await target.screenshot({ path: `${OUT_DIR}/02-modal-open.png`, fullPage: true }).catch(() => undefined);

    const rows = await extractRowsFromModal(target);
    writeFileSync(`${OUT_DIR}/03-rows.json`, JSON.stringify(rows, null, 2));
    console.log(`  ✓ Everest: ${rows.length} produtos capturados`);

    if (rows.length === 0) {
      return { ok: false, rowsCaptured: 0, matched: 0, unmatched: 0, error: 'zero rows capturadas — possivelmente seletor mudou' };
    }

    // Match contra catálogo SKU + persiste
    const allSkus = await prisma.sku.findMany({ where: { active: true }, select: { id: true, name: true } });

    let matched = 0;
    let unmatched = 0;
    const matchResults: Array<{ productName: string; matched: string | null; score: number; qty: number; alerta: number; critico: number; status?: string }> = [];

    for (const r of rows) {
      let best: { sku: typeof allSkus[number]; score: number } | null = null;
      for (const s of allSkus) {
        const score = similarity(r.productName, s.name);
        if (score >= 60 && (!best || score > best.score)) {
          best = { sku: s, score };
        }
      }
      matchResults.push({
        productName: r.productName,
        matched: best?.sku.name ?? null,
        score: best?.score ?? 0,
        qty: r.qty,
        alerta: r.alerta,
        critico: r.critico,
        status: r.status,
      });
      if (!best) {
        unmatched++;
        continue;
      }
      matched++;
      // Upsert EverestStock
      await prisma.everestStock.upsert({
        where: { skuId: best.sku.id },
        create: {
          skuId: best.sku.id,
          qty: r.qty,
          alerta: r.alerta,
          critico: r.critico,
          status: r.status,
        },
        update: {
          qty: r.qty,
          alerta: r.alerta,
          critico: r.critico,
          status: r.status,
          capturedAt: new Date(),
        },
      });
    }
    writeFileSync(`${OUT_DIR}/04-match-result.json`, JSON.stringify(matchResults, null, 2));
    console.log(`  ✓ Everest match: ${matched} ok, ${unmatched} sem match`);

    return { ok: true, rowsCaptured: rows.length, matched, unmatched };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await page.screenshot({ path: `${OUT_DIR}/error.png`, fullPage: true }).catch(() => undefined);
    return { ok: false, rowsCaptured: 0, matched: 0, unmatched: 0, error: msg };
  } finally {
    await page.close();
  }
}
