/**
 * Exploração: lista de estoques + acompanhamento + qualquer página
 * onde vejamos o estado das operações remotas que disparamos.
 *
 * Sem mutação — só navega e captura.
 */

import { chromium, type BrowserContext } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getSecret } from '../../lib/secrets';
import { dismissModals } from '../_shared/playwright';

const OUT_DIR = './tmp/vendtef-entrada';
const LOGIN_URL = 'https://www.erpvending.com.br/auth/login/index';
const HEADLESS = process.env.HEADLESS !== 'false';

const CANDIDATE_URLS = [
  'https://www.erpvending.com.br/erp/lista-estoques',
  'https://www.erpvending.com.br/erp/operacoes-estoque',
  'https://www.erpvending.com.br/erp/acompanhamento-estoque',
  'https://www.erpvending.com.br/erp/acompanhamento-estoques',
  'https://www.erpvending.com.br/erp/historico-estoque',
  'https://www.erpvending.com.br/erp/operacoes',
];

async function freshLogin(ctx: BrowserContext) {
  const user = await getSecret('ERPVENDING_USER');
  const pass = await getSecret('ERPVENDING_PASS');
  if (!user || !pass) throw new Error('ERPVENDING_USER/PASS ausentes');
  const page = await ctx.newPage();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="text"]:visible, input[name="login"]').first().fill(user);
  await page.locator('input[type="password"]:visible').first().fill(pass);
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => undefined),
    page.locator('button[type="submit"], input[type="submit"], button:has-text("Entrar")').first().click({ timeout: 15_000 }),
  ]);
  await page.waitForTimeout(2_000);
  if (page.url().includes('/auth/login')) throw new Error('login falhou');
  await page.close();
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' });
  await ctx.addInitScript(() => {
    // @ts-expect-error global pro page.evaluate
    if (typeof window.__name === 'undefined') window.__name = (fn) => fn;
  });
  try {
    await freshLogin(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(20_000);

    // 1. Página inicial do ERP — descobrir links do menu Estoques
    await page.goto('https://www.erpvending.com.br/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await dismissModals(page);

    const estoqueLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .filter((a) => /estoque|operac|invent/i.test(a.textContent ?? '') || /estoque|operac|invent/i.test(a.href ?? ''))
        .map((a) => ({
          text: (a.textContent ?? '').trim(),
          href: a.href,
        }))
        .filter((l) => l.href && l.text);
    });
    writeFileSync(`${OUT_DIR}/explore-links.json`, JSON.stringify(estoqueLinks, null, 2));
    console.log(`${estoqueLinks.length} links relacionados a estoque/operação/inventário`);
    for (const l of estoqueLinks.slice(0, 30)) console.log(`  ${l.text} → ${l.href.split('.com.br').pop()}`);

    // 2. Tenta URLs candidatas
    for (const url of CANDIDATE_URLS) {
      const slug = url.split('/').pop();
      console.log(`\n→ ${url}`);
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((e) => {
        console.log(`  err: ${(e as Error).message.slice(0, 80)}`);
        return null;
      });
      if (!resp) continue;
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
      const finalUrl = page.url();
      const is404 = finalUrl.includes('404') || finalUrl !== url;
      console.log(`  status=${resp.status()} url=${finalUrl}${is404 ? ' (redirected)' : ''}`);
      if (!is404 && resp.status() === 200) {
        await page.screenshot({ path: `${OUT_DIR}/explore-${slug}.png`, fullPage: true });
        // Captura primeiras 30 linhas de tabelas se houver
        const tables = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('table'))
            .filter((t) => (t as HTMLElement).offsetParent !== null)
            .map((t) => ({
              headers: Array.from(t.querySelectorAll('thead th, thead td')).map((c) => (c.textContent ?? '').trim()),
              rows: Array.from(t.querySelectorAll('tbody tr')).slice(0, 20).map((tr) =>
                Array.from(tr.querySelectorAll('td')).map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim()),
              ),
            }));
        });
        writeFileSync(`${OUT_DIR}/explore-${slug}-tables.json`, JSON.stringify(tables, null, 2));
        console.log(`  ${tables.length} tabela(s) capturada(s) em explore-${slug}-tables.json`);
      }
    }
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
