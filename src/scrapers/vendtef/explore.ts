/**
 * Explorador do Vendpago/Vendtef.
 *
 * Reaproveita a session salva por `npm run scrape:login` e navega pelas 3 abas
 * (ERP, VendTEF, PayBlu), capturando screenshots e listando links/botões/tabelas.
 *
 * Saída: tmp/explore/<aba>-{screenshot,links,inventory}.{png,json}
 *
 * Uso: `npm run scrape:explore`
 *      `HEADLESS=false npm run scrape:explore` (pra ver no browser)
 */

import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { getSecret } from '../../lib/secrets';

const BASE_URL = 'https://www.erpvending.com.br';
const HEADLESS = process.env.HEADLESS !== 'false';
const OUT_DIR = './tmp/explore';
const SESSION_PATH = './tmp/vendtef-session.json';

async function ensureSession() {
  if (existsSync(SESSION_PATH)) return;
  console.log('  session não encontrada — rode `npm run scrape:login` primeiro.');
  process.exit(1);
}

async function dismissTutorialModal(page: Page) {
  const selectors = [
    '.modal:visible button:has-text("Fechar")',
    '.modal-dialog:visible button:has-text("Fechar")',
    '[role="dialog"]:visible button:has-text("Fechar")',
    '.modal:visible .close',
    '.modal:visible button.close',
    '.modal:visible [aria-label="Close"]',
    'button[data-dismiss="modal"]:visible',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 })) {
        await el.click({ force: true });
        await page.waitForTimeout(400);
        console.log(`  modal fechado via ${sel}`);
        return;
      }
    } catch {
      /* tenta próximo seletor */
    }
  }
  // Plano B: ESC
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  } catch {
    /* ok */
  }
}

interface TabSnapshot {
  tab: string;
  url: string;
  title: string;
  links: { text: string; href: string }[];
  buttons: string[];
  tables: { headers: string[]; rowCount: number }[];
}

async function snapshot(page: Page, tabName: string): Promise<TabSnapshot> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  await dismissTutorialModal(page);

  await page.screenshot({ path: `${OUT_DIR}/${tabName}.png`, fullPage: true });

  const data = await page.evaluate(() => {
    const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .filter((a) => a.offsetParent !== null) // visíveis
      .map((a) => ({ text: text(a), href: a.href }))
      .filter((l) => l.text.length > 0 && l.text.length < 100);

    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'))
      .filter((b) => (b as HTMLElement).offsetParent !== null)
      .map((b) => text(b) || (b as HTMLInputElement).value || '')
      .filter((t) => t && t.length < 60);

    const tables = Array.from(document.querySelectorAll('table'))
      .filter((t) => (t as HTMLElement).offsetParent !== null)
      .map((t) => ({
        headers: Array.from(t.querySelectorAll('thead th, thead td')).map(text),
        rowCount: t.querySelectorAll('tbody tr').length,
      }))
      .filter((t) => t.headers.length > 0 || t.rowCount > 0);

    return { links, buttons, tables };
  });

  return {
    tab: tabName,
    url: page.url(),
    title: await page.title(),
    ...data,
  };
}

async function clickTab(page: Page, label: string) {
  await dismissTutorialModal(page);
  const link = page.locator(`a:has-text("${label}"), button:has-text("${label}")`).first();
  const href = await link.getAttribute('href').catch(() => null);

  // Se for um link externo (ex: VendTEF abre portalvendtef.com.br via SSO token),
  // navega direto — clicar pode abrir em nova janela ou ter problemas de visibilidade.
  if (href && /^https?:\/\//i.test(href)) {
    console.log(`  → ${href.slice(0, 80)}…`);
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } else if (href && href !== '#' && href !== '') {
    await page.goto(new URL(href, page.url()).toString(), { waitUntil: 'domcontentloaded' });
  } else {
    await link.click({ force: true, timeout: 10_000 });
  }
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
}

async function main() {
  await ensureSession();
  mkdirSync(OUT_DIR, { recursive: true });

  const user = await getSecret('ERPVENDING_USER');
  const pass = await getSecret('ERPVENDING_PASS');
  if (!user || !pass) {
    console.error('credenciais não configuradas');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'pt-BR',
    storageState: SESSION_PATH,
  });
  // Polyfill: tsx/esbuild injeta __name() pra keep-names em arrows; nao existe no browser
  await ctx.addInitScript(() => {
    // @ts-expect-error - injetando globals só pra page.evaluate
    if (typeof window.__name === 'undefined') window.__name = (fn) => fn;
  });
  const page = await ctx.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    // Caso a session tenha expirado e tenha redirecionado pro login
    if (page.url().includes('/auth/login')) {
      console.log('  session expirada — relogando');
      await page.locator('input[type="text"]:visible').first().fill(user);
      await page.locator('input[type="password"]:visible').first().fill(pass);
      await Promise.all([
        page.waitForLoadState('networkidle').catch(() => undefined),
        page.locator('button[type="submit"], button:has-text("Entrar")').first().click(),
      ]);
      await ctx.storageState({ path: SESSION_PATH });
    }

    const snaps: TabSnapshot[] = [];

    // 1. ERP (já está na home)
    console.log('→ ERP');
    snaps.push(await snapshot(page, 'erp'));

    // 2. VendTEF
    console.log('→ VendTEF');
    await clickTab(page, 'VendTEF');
    snaps.push(await snapshot(page, 'vendtef'));

    // 3. PayBlu
    console.log('→ PayBlu');
    await clickTab(page, 'PayBlu');
    snaps.push(await snapshot(page, 'payblu'));

    writeFileSync(`${OUT_DIR}/_index.json`, JSON.stringify(snaps, null, 2));
    console.log('');
    console.log('Resumo:');
    for (const s of snaps) {
      console.log(`  [${s.tab}] ${s.title} — ${s.links.length} links · ${s.buttons.length} botões · ${s.tables.length} tabelas`);
    }
    console.log(`\nArquivos em ${OUT_DIR}/`);
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
