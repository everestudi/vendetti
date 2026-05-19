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
  productCode?: string; // código Vendtef pra cross-ref com Acompanhamento
  qty: number; // saldo atual (vem de Acompanhamento). 0 se não capturado.
  alerta: number;
  critico: number;
  estoqueMaximo: number; // capacity
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

/** Captura LIMITS (config) do modal Produtos Configurados.
 *  Headers: Produto · Código · Qtde Crítica · Qtde Alerta · Estoque Máximo.
 *  NÃO retorna saldo atual — pra isso ver extractSaldoFromAcompanhamento. */
async function extractRowsFromModal(page: Page): Promise<EverestRow[]> {
  return page.evaluate(() => {
    // `:visible` é jQuery, não CSS válido — usa filter manual via offsetParent
    const visibleModal = Array.from(document.querySelectorAll('.modal, .modal-dialog')).find((m) => {
      if ((m as HTMLElement).offsetParent === null) return false;
      const title = m.querySelector('.modal-title, h4')?.textContent?.trim() ?? '';
      return /produtos\s+configurados/i.test(title);
    });
    let trList: HTMLTableRowElement[] = [];
    if (visibleModal) {
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
      // Layout: [0]=Produto, [1]=Código, [2]=Qtde Crítica, [3]=Qtde Alerta, [4]=Estoque Máximo
      const productName = cells[0] ?? '';
      const productCode = cells[1] ?? '';
      const critico = parseNumU(cells[2] ?? '');
      const alerta = parseNumU(cells[3] ?? '');
      const estoqueMaximo = parseNumU(cells[4] ?? '');
      const cls = tr.className.toLowerCase();
      const status = cls.includes('danger') || cls.includes('critico')
        ? 'crítico'
        : cls.includes('warning') || cls.includes('alerta')
          ? 'alerta'
          : 'ok';
      return {
        productName,
        productCode,
        qty: 0, // placeholder — preenchido pelo merge com Acompanhamento depois
        alerta,
        critico,
        estoqueMaximo,
        status,
      };
    }).filter((r) => r.productName.length > 1);
  });
}

/** Captura SALDO ATUAL (qty) da tela "Acompanhamento" do Estoque Everest.
 *  Link na mesma row da lista de estoques. */
async function extractSaldoFromAcompanhamento(page: Page): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    await page.goto(ESTOQUES_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
    await dismissModals(page);
    const row = page.locator('tr').filter({ hasText: /estoque\s*everest/i }).first();
    if ((await row.count()) === 0) {
      console.warn('  ⚠ Acompanhamento: row Everest não achada');
      return out;
    }
    const link = row.locator('a, button').filter({ hasText: /acompanhamento/i }).first();
    if ((await link.count()) === 0) {
      console.warn('  ⚠ Acompanhamento: link não achado');
      return out;
    }
    const ctx = page.context();
    const newPagePromise = ctx.waitForEvent('page', { timeout: 5_000 }).catch(() => null);
    await link.click({ force: true });
    const maybeNewPage = await newPagePromise;
    const target = maybeNewPage ?? page;
    await target.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
    await target.waitForTimeout(2_500);
    await target.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
    await target.screenshot({ path: `${OUT_DIR}/05-acompanhamento.png`, fullPage: true }).catch(() => undefined);

    // Captura tabela de acompanhamento (não sei o seletor exato — tenta heurísticas)
    const rows = await target.evaluate(() => {
      // Quaisquer tabelas visíveis na page; pega a que tem mais rows + colunas com produto
      const tables = Array.from(document.querySelectorAll('table')).filter((t) => (t as HTMLElement).offsetParent !== null);
      const candidates = tables.map((t) => {
        const rowCount = t.querySelectorAll('tbody tr').length;
        const headers = Array.from(t.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim().toLowerCase());
        return { table: t, rowCount, headers };
      });
      // Prefere tabela com headers tipo "produto" + saldo/qtde
      const best = candidates.sort((a, b) => b.rowCount - a.rowCount)[0];
      if (!best) return [];

      // Detecta índice das colunas "Produto" e "Saldo/Qtde"
      const headers = best.headers;
      const idxProduto = headers.findIndex((h) => /produto|nome/i.test(h));
      const idxSaldo = headers.findIndex((h) => /saldo|atual|qtde|estoque/i.test(h));

      const out: Array<{ productName: string; qty: number; allCells: string[]; headers: string[] }> = [];
      const trs = Array.from(best.table.querySelectorAll('tbody tr'));
      for (const tr of trs) {
        const cells = Array.from(tr.querySelectorAll('td')).map((c) => (c.textContent ?? '').trim());
        if (cells.length < 2) continue;
        const productName = idxProduto >= 0 ? cells[idxProduto] : cells[0];
        // Saldo: usa coluna idxSaldo se achou, senão a primeira coluna numérica
        let qtyStr = idxSaldo >= 0 ? cells[idxSaldo] : '';
        if (!qtyStr) {
          for (const c of cells.slice(1)) {
            if (/\d/.test(c)) { qtyStr = c; break; }
          }
        }
        const qtyMatch = qtyStr.match(/(\d+)/);
        const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 0;
        out.push({ productName, qty, allCells: cells, headers });
      }
      return out;
    });
    writeFileSync(`${OUT_DIR}/05-acompanhamento-rows.json`, JSON.stringify(rows, null, 2));
    for (const r of rows) {
      if (r.productName) out.set(r.productName.toLowerCase().trim(), r.qty);
    }
    console.log(`  ✓ Acompanhamento: ${rows.length} rows · ${out.size} saldos capturados`);
  } catch (e) {
    console.warn('  ⚠ Acompanhamento falhou:', e instanceof Error ? e.message : e);
  }
  return out;
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
    writeFileSync(`${OUT_DIR}/03-rows-limits.json`, JSON.stringify(rows, null, 2));
    console.log(`  ✓ Produtos Configurados: ${rows.length} produtos (limits)`);

    if (rows.length === 0) {
      return { ok: false, rowsCaptured: 0, matched: 0, unmatched: 0, error: 'zero rows capturadas — possivelmente seletor mudou' };
    }

    // Fecha modal antes de navegar pra Acompanhamento (Esc)
    await target.keyboard.press('Escape').catch(() => undefined);
    await target.waitForTimeout(500);

    // Captura saldo atual via Acompanhamento (página separada)
    const saldoMap = await extractSaldoFromAcompanhamento(target);

    // Merge: cada row de limits + saldo do mesmo produto (lookup case-insensitive)
    const merged = rows.map((r) => {
      const saldo = saldoMap.get(r.productName.toLowerCase().trim()) ?? 0;
      return { ...r, qty: saldo };
    });

    // Match contra catálogo SKU + persiste
    const allSkus = await prisma.sku.findMany({ where: { active: true }, select: { id: true, name: true } });

    let matched = 0;
    let unmatched = 0;
    const matchResults: Array<{ productName: string; matched: string | null; score: number; qty: number; alerta: number; critico: number; estoqueMaximo: number; status?: string }> = [];

    for (const r of merged) {
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
        estoqueMaximo: r.estoqueMaximo,
        status: r.status,
      });
      if (!best) {
        unmatched++;
        continue;
      }
      matched++;
      // Recalcula status com base na qty + limits:
      // crítico se qty <= critico, alerta se qty <= alerta, ok caso contrário
      const computedStatus = r.qty <= r.critico ? 'crítico' : r.qty <= r.alerta ? 'alerta' : 'ok';
      // Upsert EverestStock
      await prisma.everestStock.upsert({
        where: { skuId: best.sku.id },
        create: {
          skuId: best.sku.id,
          qty: r.qty,
          alerta: r.alerta,
          critico: r.critico,
          status: computedStatus,
        },
        update: {
          qty: r.qty,
          alerta: r.alerta,
          critico: r.critico,
          status: computedStatus,
          capturedAt: new Date(),
        },
      });
    }
    writeFileSync(`${OUT_DIR}/04-match-result.json`, JSON.stringify(matchResults, null, 2));
    console.log(`  ✓ Everest match: ${matched} ok, ${unmatched} sem match · com saldo de Acompanhamento`);

    return { ok: true, rowsCaptured: merged.length, matched, unmatched };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await page.screenshot({ path: `${OUT_DIR}/error.png`, fullPage: true }).catch(() => undefined);
    return { ok: false, rowsCaptured: 0, matched: 0, unmatched: 0, error: msg };
  } finally {
    await page.close();
  }
}
