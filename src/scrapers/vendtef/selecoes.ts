/**
 * Drill-down na máquina BlueMall Rondon em /mascaras.
 *
 * Os botões "Seleções", "Combos", "Ingredientes" são links JS (.aSelecoes etc),
 * que abrem modal/painel dinâmico. "Editar" (.edit-mascara) abre página dedicada.
 *
 * Captura:
 *   - selecoes (modal com slots/molas)
 *   - combos (modal)
 *   - ingredientes (modal)
 *   - editar (página dedicada de edição)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { getSecret } from '../../lib/secrets';
import {
  captureTables,
  dismissModals,
  ensurePortalSSO,
  launchBrowser,
  newAuthedContext,
  SESSION_PATH,
} from '../_shared/playwright';
import type { Page } from 'playwright';

const OUT_DIR = './tmp/selecoes';
const MASCARAS_URL = 'https://www.portalvendtef.com.br/mascaras';
const TARGET = 'Maquina BlueMall Rondon';

async function captureCurrent(page: Page, slug: string) {
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: `${OUT_DIR}/${slug}.png`, fullPage: true });

  const tables = await captureTables(page);
  const modalHtml = await page
    .evaluate(() => {
      const m = document.querySelector('.modal.in, .modal.show, [role="dialog"]:not([style*="display: none"])');
      return m ? (m as HTMLElement).innerHTML.slice(0, 30_000) : null;
    })
    .catch(() => null);

  writeFileSync(
    `${OUT_DIR}/${slug}.json`,
    JSON.stringify({ slug, url: page.url(), tables, hasModal: !!modalHtml }, null, 2),
  );
  if (modalHtml) writeFileSync(`${OUT_DIR}/${slug}-modal.html`, modalHtml);

  const cols = tables.map((t, i) => `t${i}=${t.rows.length}r×${t.headers.length}c`).join(' ');
  console.log(`  ✓ ${slug}: ${tables.length} tab(s) [${cols}] · modal=${!!modalHtml}`);
}

async function closeAnyModal(page: Page) {
  await dismissModals(page);
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(400);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  await getSecret('ERPVENDING_USER');

  const browser = await launchBrowser();
  const ctx = await newAuthedContext(browser);
  try {
    await ensurePortalSSO(ctx, 'vendtef');
    const page = await ctx.newPage();

    await page.goto(MASCARAS_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await dismissModals(page);

    const row = page.locator(`tr:has-text("${TARGET}")`).first();
    if ((await row.count()) === 0) {
      console.error(`✗ linha "${TARGET}" não encontrada`);
      process.exit(1);
    }
    console.log(`linha "${TARGET}" encontrada`);

    // 1. Seleções (.aSelecoes)
    console.log('\n→ Seleções (.aSelecoes)');
    await row.locator('a.aSelecoes').click({ force: true });
    await captureCurrent(page, 'selecoes');
    await closeAnyModal(page);

    // 2. Combos
    console.log('\n→ Combos (.aCombos)');
    await row.locator('a.aCombos').click({ force: true });
    await captureCurrent(page, 'combos');
    await closeAnyModal(page);

    // 3. Ingredientes
    console.log('\n→ Ingredientes (.aIngredientes)');
    await row.locator('a.aIngredientes').click({ force: true });
    await captureCurrent(page, 'ingredientes');
    await closeAnyModal(page);

    // 4. Editar (.edit-mascara) — provável página dedicada
    console.log('\n→ Editar (.edit-mascara)');
    const editLink = row.locator('a.edit-mascara');
    // pode navegar — escuta navigation
    await Promise.race([
      page.waitForNavigation({ timeout: 5_000 }).catch(() => undefined),
      editLink.click({ force: true }),
    ]);
    await page.waitForTimeout(2_000);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await captureCurrent(page, 'editar');

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
