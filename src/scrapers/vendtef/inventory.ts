/**
 * Captura inventário completo da operação no VendTEF:
 *   1. Lista de máquinas (/maquina)
 *   2. Def. Estoque — configuração de slots/molas (/mascaras)
 *   3. Acompanhamento de estoque — qty atual por slot (/acompanhamentoestoque)
 *   4. Pick List geral (/relatoriogeral/relatorioPickListGeral)
 *   5. Dashboard ERP — tabela "Produtos mais rentáveis"
 *
 * Saída: tmp/inventory/<page>.{png,json}
 *
 * Uso: `npm run scrape:inventory`
 */

import { chromium, type BrowserContext, type Page } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { getSecret } from '../../lib/secrets';

const HEADLESS = process.env.HEADLESS !== 'false';
const OUT_DIR = './tmp/inventory';
const SESSION_PATH = './tmp/vendtef-session.json';

interface CapturedTable {
  headers: string[];
  rows: string[][];
}

async function setupContext(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  if (!existsSync(SESSION_PATH)) {
    console.error('✗ session não encontrada — rode `npm run scrape:login` primeiro.');
    process.exit(1);
  }
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'pt-BR',
    storageState: SESSION_PATH,
  });
  await ctx.addInitScript(() => {
    // @ts-expect-error globais pro page.evaluate
    if (typeof window.__name === 'undefined') window.__name = (fn) => fn;
  });
  return ctx;
}

async function dismissModals(page: Page) {
  const selectors = [
    '.modal:visible button:has-text("Fechar")',
    '[role="dialog"]:visible button:has-text("Fechar")',
    '.modal:visible .close',
    'button[data-dismiss="modal"]:visible',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 300 })) {
        await el.click({ force: true });
        await page.waitForTimeout(300);
        return;
      }
    } catch {
      /* segue */
    }
  }
}

async function captureTables(page: Page): Promise<CapturedTable[]> {
  return page.evaluate(() => {
    const cleanText = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('table'))
      .filter((t) => (t as HTMLElement).offsetParent !== null)
      .map((t) => {
        const headerCells = t.querySelectorAll('thead th, thead td');
        const headers = headerCells.length
          ? Array.from(headerCells).map(cleanText)
          : (() => {
              const firstRow = t.querySelector('tr');
              return firstRow ? Array.from(firstRow.children).map(cleanText) : [];
            })();
        const rows = Array.from(t.querySelectorAll('tbody tr')).map((r) =>
          Array.from(r.children).map(cleanText),
        );
        return { headers, rows };
      })
      .filter((t) => t.rows.length > 0);
  });
}

async function visitAndCapture(ctx: BrowserContext, name: string, url: string) {
  console.log(`→ ${name}`);
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    await dismissModals(page);

    if (page.url().includes('/auth/login')) {
      console.error(`  ✗ ${name}: redirecionou pro login (sessão expirou?)`);
      return null;
    }

    await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true });
    const tables = await captureTables(page);
    writeFileSync(`${OUT_DIR}/${name}.json`, JSON.stringify({ url: page.url(), tables }, null, 2));

    const rowSummary = tables.map((t, i) => `t${i}=${t.rows.length}r×${t.headers.length}c`).join(' ');
    console.log(`  ✓ ${tables.length} tabela(s) [${rowSummary}]`);
    return tables;
  } finally {
    await page.close();
  }
}

interface Target {
  name: string;
  url: string;
  portal?: 'vendtef' | 'payblu';
}

const TARGETS: Target[] = [
  { name: '01-erp-home', url: 'https://www.erpvending.com.br/' },
  { name: '02-maquinas', portal: 'vendtef', url: 'https://www.portalvendtef.com.br/maquina' },
  { name: '03-resumo-maquinas', portal: 'vendtef', url: 'https://www.portalvendtef.com.br/resumo-terminais' },
  { name: '04-def-estoque', portal: 'vendtef', url: 'https://www.portalvendtef.com.br/mascaras' },
  { name: '05-acompanhamento-estoque', portal: 'vendtef', url: 'https://www.portalvendtef.com.br/acompanhamentoestoque' },
  { name: '06-produtos', portal: 'vendtef', url: 'https://www.portalvendtef.com.br/produtos' },
  { name: '07-pick-list', portal: 'vendtef', url: 'https://www.portalvendtef.com.br/relatoriogeral/relatorioPickListGeral' },
];

/**
 * VendTEF e PayBlu são domínios separados do erpvending. Pra criar sessão lá,
 * temos que navegar via SSO token (link "VendTEF"/"PayBlu" no header do ERP).
 */
async function ensurePortalSSO(ctx: BrowserContext, portal: 'vendtef' | 'payblu') {
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.erpvending.com.br/', { waitUntil: 'domcontentloaded' });
    await dismissModals(page);

    const label = portal === 'vendtef' ? 'VendTEF' : 'PayBlu';
    const link = page.locator(`a:has-text("${label}")`).first();
    const href = await link.getAttribute('href');
    if (!href || !href.includes('token/')) {
      throw new Error(`link SSO de ${portal} não encontrado`);
    }
    console.log(`  SSO ${portal} via token`);
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  } finally {
    await page.close();
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const user = await getSecret('ERPVENDING_USER');
  if (!user) {
    console.error('credenciais Vendtef não configuradas');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await setupContext(browser);

  try {
    const portalsAuth = new Set<string>();

    for (const t of TARGETS) {
      if (t.portal && !portalsAuth.has(t.portal)) {
        await ensurePortalSSO(ctx, t.portal);
        portalsAuth.add(t.portal);
      }
      await visitAndCapture(ctx, t.name, t.url);
    }

    await ctx.storageState({ path: SESSION_PATH });
    console.log(`\n✓ tudo em ${OUT_DIR}/`);
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
