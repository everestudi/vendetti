/**
 * Helpers compartilhados pelos scrapers do VendTEF/VendPago.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getSecret } from '../../lib/secrets';

export const SESSION_PATH = './tmp/vendtef-session.json';
const LOGIN_URL = 'https://www.erpvending.com.br/auth/login/index';

export async function launchBrowser(headless = process.env.HEADLESS !== 'false'): Promise<Browser> {
  return chromium.launch({ headless });
}

/**
 * Faz fresh login no ERP Vending e salva a session em SESSION_PATH.
 * Usado quando rodamos em CI (sem session pré-salva).
 */
async function freshLoginAndSaveSession(browser: Browser): Promise<BrowserContext> {
  const user = await getSecret('ERPVENDING_USER');
  const pass = await getSecret('ERPVENDING_PASS');
  if (!user || !pass) {
    throw new Error('ERPVENDING_USER / ERPVENDING_PASS ausentes — configure em /settings');
  }
  console.log('  session ausente — fazendo fresh login...');

  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'pt-BR',
  });
  await ctx.addInitScript(() => {
    // @ts-expect-error globais pro page.evaluate
    if (typeof window.__name === 'undefined') window.__name = (fn) => fn;
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45_000);
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

  await page
    .locator(
      'input[name="login"], input[name="usuario"], input[name="username"], input[name="user"], input[type="text"]:visible',
    )
    .first()
    .fill(user);
  await page.locator('input[type="password"]:visible').first().fill(pass);
  const submit = page
    .locator(
      'button[type="submit"], input[type="submit"], button:has-text("Entrar"), button:has-text("Acessar"), button:has-text("Login")',
    )
    .first();
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined),
    submit.click({ timeout: 15_000 }),
  ]);
  await page.waitForTimeout(2_000);
  if (page.url().includes('/auth/login')) {
    throw new Error(`Login falhou — ainda em ${page.url()}`);
  }
  await page.close();

  // Persiste pra runs subsequentes na mesma máquina
  mkdirSync(dirname(SESSION_PATH), { recursive: true });
  await ctx.storageState({ path: SESSION_PATH });
  console.log('  ✓ login OK, session salva');
  return ctx;
}

export async function newAuthedContext(browser: Browser): Promise<BrowserContext> {
  if (!existsSync(SESSION_PATH)) {
    // Em CI (GH Actions) ou primeira run: tenta fresh login automaticamente.
    // Se não tiver credenciais, lança erro com mensagem clara.
    return freshLoginAndSaveSession(browser);
  }
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'pt-BR',
    storageState: SESSION_PATH,
  });
  // Polyfill: tsx/esbuild emite __name() em arrows compiladas — não existe no browser
  await ctx.addInitScript(() => {
    // @ts-expect-error globais pro page.evaluate
    if (typeof window.__name === 'undefined') window.__name = (fn) => fn;
  });
  return ctx;
}

/** Faz SSO num portal externo (VendTEF/PayBlu) via link com token no ERP. */
export async function ensurePortalSSO(ctx: BrowserContext, portal: 'vendtef' | 'payblu') {
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.erpvending.com.br/', { waitUntil: 'domcontentloaded' });
    await dismissModals(page);
    const label = portal === 'vendtef' ? 'VendTEF' : 'PayBlu';
    const link = page.locator(`a:has-text("${label}")`).first();
    const href = await link.getAttribute('href');
    if (!href || !href.includes('token/')) {
      throw new Error(`link SSO de ${portal} não encontrado no ERP — sessão expirou?`);
    }
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  } finally {
    await page.close();
  }
}

export async function dismissModals(page: Page) {
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
      /* ok */
    }
  }
}

export interface CapturedTable {
  headers: string[];
  rows: string[][];
}

/** Extrai todas as tabelas visíveis da página com headers + rows. */
export async function captureTables(page: Page): Promise<CapturedTable[]> {
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

export function isOnLoginPage(page: Page): boolean {
  return page.url().includes('/auth/login');
}
