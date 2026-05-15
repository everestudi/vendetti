/**
 * Smoke test: loga no ERP Vending (Vendtef) e captura screenshots.
 *
 * Uso: `npm run scrape:login`
 *       `HEADLESS=false npm run scrape:login` (pra ver o browser na tela)
 *
 * Credenciais lidas do banco via getSecret('ERPVENDING_USER'/'ERPVENDING_PASS').
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { getSecret } from '../../lib/secrets';

const LOGIN_URL = 'https://www.erpvending.com.br/auth/login/index';
const HEADLESS = process.env.HEADLESS !== 'false';
const SCREENSHOT_DIR = './tmp';

async function main() {
  const user = await getSecret('ERPVENDING_USER');
  const pass = await getSecret('ERPVENDING_PASS');
  if (!user || !pass) {
    console.error('✗ ERPVENDING_USER / ERPVENDING_PASS não configurados.');
    console.error('  Abre /settings no app e preenche.');
    process.exit(1);
  }

  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'pt-BR',
  });
  const page = await ctx.newPage();

  try {
    console.log(`→ ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-pre-login.png`, fullPage: true });
    console.log('  ✓ screenshot 01-pre-login.png');

    // Heurística pra encontrar campos
    const userField = page
      .locator(
        'input[name="login"], input[name="usuario"], input[name="username"], input[name="user"], input[type="text"]:visible',
      )
      .first();
    const passField = page.locator('input[type="password"]:visible').first();
    const submitBtn = page
      .locator(
        'button[type="submit"], input[type="submit"], button:has-text("Entrar"), button:has-text("Acessar"), button:has-text("Login")',
      )
      .first();

    await userField.fill(user);
    await passField.fill(pass);

    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined),
      submitBtn.click(),
    ]);

    await page.waitForTimeout(2_000); // dá um respiro pra qualquer redirect ou JS
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-post-login.png`, fullPage: true });
    console.log('  ✓ screenshot 02-post-login.png');

    const stillOnLogin = page.url().includes('/auth/login');
    if (stillOnLogin) {
      console.error(`✗ ainda na URL de login: ${page.url()}`);
      console.error('  Veja 02-post-login.png — talvez seletores estejam errados ou credenciais inválidas.');
      process.exit(2);
    }

    console.log(`✓ login OK — URL: ${page.url()}`);
    console.log(`  cookies: ${(await ctx.cookies()).length}`);

    await ctx.storageState({ path: `${SCREENSHOT_DIR}/vendtef-session.json` });
    console.log(`  ✓ session salva em ${SCREENSHOT_DIR}/vendtef-session.json`);

    // Tira screenshot da home e captura URL + título pra depois
    console.log(`  title: ${await page.title()}`);
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
