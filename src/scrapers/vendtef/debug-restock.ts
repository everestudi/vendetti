/**
 * Inspeção robusta — varre múltiplas páginas procurando UI de abastecimento.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dismissModals, ensurePortalSSO, launchBrowser, newAuthedContext } from '../_shared/playwright';

const OUT_DIR = './tmp/restock';

async function dumpClickables(page: import('playwright').Page, slug: string) {
  await page.screenshot({ path: `${OUT_DIR}/${slug}.png`, fullPage: true });
  const data = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a, button'))
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: el.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60) ?? '',
        href: (el as HTMLAnchorElement).href ?? '',
        title: (el as HTMLElement).title,
        className: (el as HTMLElement).className.slice(0, 60),
      }))
      .filter((c) => c.text || c.title || c.className.match(/abas|estoq|repor|edit|action/i));
  });
  writeFileSync(`${OUT_DIR}/${slug}-clickables.json`, JSON.stringify(data, null, 2));
  return data;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launchBrowser();
  const ctx = await newAuthedContext(browser);
  try {
    await ensurePortalSSO(ctx, 'vendtef');
    const page = await ctx.newPage();

    // /resumo-terminais — botões cogwheel/clipboard à direita do card
    await page.goto('https://www.portalvendtef.com.br/resumo-terminais', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await dismissModals(page);

    const resumo = await dumpClickables(page, 'A-resumo-terminais');
    console.log(`\n=== /resumo-terminais (${resumo.length} clickables) ===`);
    for (const c of resumo.slice(0, 30)) {
      const short = (c.href || '').replace('https://www.portalvendtef.com.br', '').slice(0, 80);
      console.log(`  <${c.tag}> "${c.text}" title="${c.title}" class="${c.className.slice(0, 40)}" → ${short}`);
    }

    // /pick-list
    await page.goto('https://www.portalvendtef.com.br/pick-list/relatorioPickList', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await dismissModals(page);
    const pl = await dumpClickables(page, 'B-pick-list');
    console.log(`\n=== /pick-list (${pl.length} clickables) ===`);
    for (const c of pl.slice(0, 15)) {
      console.log(`  <${c.tag}> "${c.text}" title="${c.title}" → ${(c.href || '').slice(-60)}`);
    }
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
