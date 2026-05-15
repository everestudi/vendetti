/**
 * Inspeciona em detalhe a linha "Maquina BlueMall Rondon" em /mascaras —
 * dump completo de todos os <a> e <button> com hrefs, classes e títulos.
 *
 * Uso: `npx dotenv -e .env.local -- tsx src/scrapers/vendtef/debug-mascaras.ts`
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dismissModals, ensurePortalSSO, launchBrowser, newAuthedContext } from '../_shared/playwright';

const OUT_DIR = './tmp/selecoes';
const TARGET = 'Maquina BlueMall Rondon';

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await launchBrowser();
  const ctx = await newAuthedContext(browser);
  try {
    await ensurePortalSSO(ctx, 'vendtef');
    const page = await ctx.newPage();
    await page.goto('https://www.portalvendtef.com.br/mascaras', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await dismissModals(page);

    const data = await page.evaluate((target) => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const target_row = rows.find((r) => r.textContent?.includes(target));
      if (!target_row) return { html: null, clickables: [] };
      const html = target_row.outerHTML;
      const clickables = Array.from(target_row.querySelectorAll('a, button')).map((el) => {
        const e = el as HTMLAnchorElement | HTMLButtonElement;
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50),
          href: 'href' in e ? e.href : '',
          title: (el as HTMLElement).title,
          ariaLabel: (el as HTMLElement).getAttribute('aria-label'),
          className: (el as HTMLElement).className,
          dataAttrs: Object.fromEntries(
            Array.from((el as HTMLElement).attributes)
              .filter((a) => a.name.startsWith('data-') || a.name === 'onclick')
              .map((a) => [a.name, a.value]),
          ),
          innerHTML: (el as HTMLElement).innerHTML.slice(0, 200),
        };
      });
      return { html, clickables };
    }, TARGET);

    writeFileSync(`${OUT_DIR}/_debug-mascaras-row.json`, JSON.stringify(data, null, 2));
    writeFileSync(`${OUT_DIR}/_debug-mascaras-row.html`, data.html ?? '(não encontrada)');

    console.log(`linha encontrada: ${data.html ? 'sim' : 'NÃO'}`);
    console.log(`elementos clicáveis: ${data.clickables.length}`);
    console.log('');
    data.clickables.forEach((c, i) => {
      console.log(`[${i}] <${c.tag}> "${c.text}"`);
      if (c.href) console.log(`    href: ${c.href.slice(0, 100)}`);
      if (c.title) console.log(`    title: ${c.title}`);
      if (c.ariaLabel) console.log(`    aria-label: ${c.ariaLabel}`);
      if (c.className) console.log(`    class: ${c.className.slice(0, 80)}`);
      if (Object.keys(c.dataAttrs).length) console.log(`    data: ${JSON.stringify(c.dataAttrs).slice(0, 100)}`);
      const html = c.innerHTML.replace(/\n/g, ' ').slice(0, 80);
      if (html && html !== c.text) console.log(`    inner: ${html}`);
      console.log('');
    });
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
