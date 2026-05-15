/**
 * Inspeção da UI de criar produto + atualizar quantidade de slot (currentQty).
 *
 * Páginas alvo:
 *   - /produtos → cadastra produto
 *   - /mascaras → drill em "Seleções" → editar slot (já mapeado, mas talvez tem campo currentQty escondido)
 *   - Pick List → completar pick list (registra abastecimento)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dismissModals, ensurePortalSSO, launchBrowser, newAuthedContext } from '../_shared/playwright';

const OUT_DIR = './tmp/rita-debug';

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launchBrowser();
  const ctx = await newAuthedContext(browser);
  try {
    await ensurePortalSSO(ctx, 'vendtef');
    const page = await ctx.newPage();

    // === 1. /produtos — botão "Cadastrar Produto" ===
    console.log('=== /produtos ===');
    await page.goto('https://www.portalvendtef.com.br/produtos', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await dismissModals(page);
    await page.screenshot({ path: `${OUT_DIR}/01-produtos-lista.png`, fullPage: true });

    // Procura botão "Cadastrar" / "Adicionar" / "Novo"
    const buttons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a, button'))
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .filter((el) => /cadastr|adicionar|novo|criar/i.test(el.textContent ?? ''))
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim().slice(0, 60),
          href: (el as HTMLAnchorElement).href ?? '',
          className: (el as HTMLElement).className,
        }));
    });
    console.log(`  ${buttons.length} botões "cadastrar/adicionar/novo":`);
    buttons.forEach((b) => console.log(`    <${b.tag}> "${b.text}" href="${b.href.split('/').pop()}"`));

    if (buttons.length > 0) {
      const first = buttons[0];
      if (first.href && /^https?:/i.test(first.href)) {
        await page.goto(first.href, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await dismissModals(page);
        await page.screenshot({ path: `${OUT_DIR}/02-cadastrar-form.png`, fullPage: true });
        console.log(`  ✓ navegou para form: ${page.url()}`);

        const formFields = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea'))
            .filter((el) => (el as HTMLElement).offsetParent !== null)
            .map((el) => {
              const e = el as HTMLInputElement;
              return {
                name: e.name,
                id: e.id,
                type: e.type ?? e.tagName.toLowerCase(),
                value: e.value,
                placeholder: e.placeholder,
                required: e.required,
              };
            });
        });
        writeFileSync(`${OUT_DIR}/_cadastrar-form.json`, JSON.stringify(formFields, null, 2));
        console.log(`  Campos do form (${formFields.length}):`);
        formFields.forEach((f) => console.log(`    [${f.type}${f.required ? '*' : ''}] name="${f.name}" placeholder="${f.placeholder}"`));
      }
    }

    // === 2. /pick-list — relatório / nova pick list ===
    console.log('\n=== /pick-list ===');
    await page.goto('https://www.portalvendtef.com.br/pick-list/relatorioPickList', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await dismissModals(page);
    await page.screenshot({ path: `${OUT_DIR}/03-pick-list.png`, fullPage: true });

    const pickButtons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a, button'))
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .filter((el) => /pick|cadastr|adicionar|novo|criar|gerar/i.test(el.textContent ?? '') && !el.className.includes('menu-items'))
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim().slice(0, 60),
          href: (el as HTMLAnchorElement).href ?? '',
        }));
    });
    console.log(`  Botões pick list (${pickButtons.length}):`);
    pickButtons.forEach((b) => console.log(`    <${b.tag}> "${b.text}" href="${b.href.split('/').pop()}"`));
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
