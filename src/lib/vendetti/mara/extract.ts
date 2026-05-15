/**
 * Mara · extração de dados crus do Vendtef via Playwright.
 *
 * Abre o browser uma vez, faz SSO e visita as 3 fontes principais:
 *   - /mascaras → modal Seleções (36 slots com preço/margem/capacidade)
 *   - /produtos                  (catálogo de SKUs)
 *   - /acompanhamentoestoque     (snapshot agregado de estado)
 */

import type { BrowserContext } from 'playwright';
import {
  captureTables,
  dismissModals,
  ensurePortalSSO,
  launchBrowser,
  newAuthedContext,
  SESSION_PATH,
} from '../../../scrapers/_shared/playwright';

export interface RawSlot {
  selecao: string;
  produtoCode: string;
  produtoNome: string;
  precoBR: string;
  lucroEstimadoBR: string;
  capacidade: number;
  qtdeAlerta: number;
  qtdeCritico: number;
}

export interface RawSku {
  code: string;
  name: string;
  descricao: string;
  category: string;
  tipo: string;
  active: boolean;
}

export interface RawInventorySnapshot {
  terminal: string;
  capacityFilledPct: number;
  ok: number;
  alert: number;
  critical: number;
}

export interface ExtractResult {
  slots: RawSlot[];
  skus: RawSku[];
  snapshot: RawInventorySnapshot;
}

const MACHINE_LABEL = 'Maquina BlueMall Rondon';

export async function extractAll(): Promise<ExtractResult> {
  const browser = await launchBrowser();
  const ctx = await newAuthedContext(browser);
  try {
    await ensurePortalSSO(ctx, 'vendtef');

    const [slots, skus, snapshot] = [
      await extractSlots(ctx),
      await extractCatalog(ctx),
      await extractSnapshot(ctx),
    ];

    await ctx.storageState({ path: SESSION_PATH });
    return { slots, skus, snapshot };
  } finally {
    await ctx.close();
    await browser.close();
  }
}

async function extractSlots(ctx: BrowserContext): Promise<RawSlot[]> {
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.portalvendtef.com.br/mascaras', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await dismissModals(page);

    const row = page.locator(`tr:has-text("${MACHINE_LABEL}")`).first();
    await row.locator('a.aSelecoes').click({ force: true });
    await page.waitForTimeout(1_500);

    const tables = await captureTables(page);
    const slotsTable = tables.find((t) => t.headers.some((h) => h === 'Seleção') && t.rows.length >= 10);
    if (!slotsTable) throw new Error('tabela de Seleções não encontrada no modal');

    const out: RawSlot[] = [];
    for (const r of slotsTable.rows) {
      const [sel, prod, , preco, lucro, , , cap, qAlerta, qCrit] = r;
      if (!sel || !prod) continue;
      const [code, ...nameRest] = prod.split(' - ');
      out.push({
        selecao: sel,
        produtoCode: code ?? '',
        produtoNome: nameRest.join(' - ').trim() || prod,
        precoBR: preco ?? '0',
        lucroEstimadoBR: lucro ?? '0',
        capacidade: parseInt(cap, 10) || 0,
        qtdeAlerta: parseInt(qAlerta, 10) || 0,
        qtdeCritico: parseInt(qCrit, 10) || 0,
      });
    }
    return out;
  } finally {
    await page.close();
  }
}

async function extractCatalog(ctx: BrowserContext): Promise<RawSku[]> {
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.portalvendtef.com.br/produtos', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await dismissModals(page);

    const tables = await captureTables(page);
    if (tables.length === 0) return [];
    const t = tables[0];
    return t.rows
      .filter((r) => r[0] && r[1])
      .map((r) => ({
        code: r[0],
        name: r[1],
        descricao: r[2] ?? '',
        category: (r[3] ?? '').replace(/\s+/g, ' ').trim(),
        tipo: r[7] ?? '',
        active: (r[8] ?? '').toLowerCase().includes('ativo'),
      }));
  } finally {
    await page.close();
  }
}

async function extractSnapshot(ctx: BrowserContext): Promise<RawInventorySnapshot> {
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.portalvendtef.com.br/acompanhamentoestoque', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await dismissModals(page);

    const tables = await captureTables(page);
    if (tables.length === 0 || tables[0].rows.length === 0) {
      throw new Error('tabela de acompanhamento de estoque vazia');
    }
    const [terminal, capPct, ok, alert, critical] = tables[0].rows[0];
    return {
      terminal: terminal ?? '',
      capacityFilledPct: parseFloat((capPct ?? '0').replace('%', '').replace(',', '.')) || 0,
      ok: parseInt(ok, 10) || 0,
      alert: parseInt(alert, 10) || 0,
      critical: parseInt(critical, 10) || 0,
    };
  } finally {
    await page.close();
  }
}
