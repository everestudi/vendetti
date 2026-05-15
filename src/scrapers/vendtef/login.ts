/**
 * Smoke test: loga no ERP Vending (Vendtef) e captura screenshot.
 *
 * Uso: `npm run scrape:login`
 *
 * Pré-requisitos:
 *   - .env.local com ERPVENDING_USER, ERPVENDING_PASS
 *   - npx playwright install chromium
 */

import { chromium } from 'playwright';
import 'dotenv/config';

const LOGIN_URL = 'https://www.erpvending.com.br/auth/login/index';
const HEADLESS = process.env.HEADLESS !== 'false';
const SCREENSHOT_DIR = './tmp';

async function main() {
  const user = process.env.ERPVENDING_USER;
  const pass = process.env.ERPVENDING_PASS;
  if (!user || !pass) {
    console.error('Faltam ERPVENDING_USER e ERPVENDING_PASS no .env.local');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'pt-BR',
  });
  const page = await ctx.newPage();

  try {
    console.log(`→ ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

    // Os seletores abaixo são *suposições iniciais*. Após o primeiro run real
    // ajustamos com base no DOM atual capturado em pre-login.png.
    await page.screenshot({ path: `${SCREENSHOT_DIR}/pre-login.png`, fullPage: true });
    console.log('  screenshot pre-login.png salvo');

    // Heurística — tenta múltiplos seletores comuns de form de login
    const userField = page.locator(
      'input[name="login"], input[name="usuario"], input[name="username"], input[type="text"]'
    ).first();
    const passField = page.locator(
      'input[name="senha"], input[name="password"], input[type="password"]'
    ).first();
    const submitBtn = page.locator(
      'button[type="submit"], input[type="submit"], button:has-text("Entrar"), button:has-text("Acessar")'
    ).first();

    await userField.fill(user);
    await passField.fill(pass);
    await Promise.all([page.waitForLoadState('networkidle'), submitBtn.click()]);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/post-login.png`, fullPage: true });
    console.log('  screenshot post-login.png salvo');

    const isStillOnLogin = page.url().includes('/auth/login');
    if (isStillOnLogin) {
      console.error('✗ ainda na tela de login — credenciais ou seletores podem estar errados.');
      process.exit(2);
    }

    console.log(`✓ login OK — URL atual: ${page.url()}`);
    console.log('  cookies:', (await ctx.cookies()).length);

    // Guarda storage state para reaproveitar (skip login em runs subsequentes)
    await ctx.storageState({ path: `${SCREENSHOT_DIR}/vendtef-session.json` });
    console.log('  session salva em tmp/vendtef-session.json');
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
