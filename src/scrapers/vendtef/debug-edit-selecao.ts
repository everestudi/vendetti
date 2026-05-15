/**
 * Inspeção do form de edição — v2 com fallback JS click + capturando todos os modais.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { getSecret } from '../../lib/secrets';
import { dismissModals, ensurePortalSSO, launchBrowser, newAuthedContext } from '../_shared/playwright';

const OUT_DIR = './tmp/selecoes';
const MASCARAS_URL = 'https://www.portalvendtef.com.br/mascaras';

async function snapshotModals(page: import('playwright').Page, label: string) {
  return page.evaluate((lbl) => {
    const all = Array.from(document.querySelectorAll('.modal, [role="dialog"], .modal-dialog'));
    return all.map((m, i) => ({
      label: lbl,
      idx: i,
      id: (m as HTMLElement).id,
      className: (m as HTMLElement).className,
      visible: (m as HTMLElement).offsetParent !== null,
      hasInClass: m.classList.contains('in') || m.classList.contains('show'),
      title: m.querySelector('.modal-title')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      inputs: m.querySelectorAll('input:not([type="hidden"]), select, textarea').length,
      formAction: m.querySelector('form')?.getAttribute('action') ?? '',
    }));
  }, label);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  await getSecret('ERPVENDING_USER');

  const browser = await launchBrowser();
  const ctx = await newAuthedContext(browser);
  try {
    await ensurePortalSSO(ctx, 'vendtef');
    const page = await ctx.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`  [console.${msg.type()}] ${msg.text().slice(0, 200)}`);
    });
    page.on('request', (req) => {
      if (req.method() === 'POST' || req.url().includes('selec')) {
        console.log(`  [${req.method()}] ${req.url().slice(0, 100)}`);
      }
    });

    await page.goto(MASCARAS_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await dismissModals(page);

    // Abre modal Seleções
    const row = page.locator(`tr:has-text("Maquina BlueMall Rondon")`).first();
    await row.locator('a.aSelecoes').click({ force: true });
    await page.waitForTimeout(2_000);

    console.log('--- ANTES do click no ✏️ ---');
    const before = await snapshotModals(page, 'before');
    before.forEach((m) => console.log(`  modal[${m.idx}] vis=${m.visible} hasIn=${m.hasInClass} title="${m.title}" inputs=${m.inputs}`));

    // Estratégia A: clique JS direto no handler
    console.log('\n--- click via JS evaluate ---');
    const clickResult = await page.evaluate(() => {
      const modal = document.querySelector('.modal.in, .modal.show');
      if (!modal) return { ok: false, reason: 'modal Seleções não está open' };
      const firstRow = modal.querySelector('tbody tr');
      if (!firstRow) return { ok: false, reason: 'sem tbody tr' };
      const editLink = firstRow.querySelector('a.edit-selecao');
      if (!editLink) return { ok: false, reason: 'a.edit-selecao não encontrado' };
      const a = editLink as HTMLAnchorElement;
      // dispara click do jQuery se existir (Bootstrap costuma usar jQuery handlers)
      try {
        // @ts-expect-error jQuery global
        if (typeof window.$ === 'function') window.$(a).trigger('click');
      } catch {}
      a.click();
      return {
        ok: true,
        href: a.href,
        dataAttrs: Object.fromEntries(Array.from(a.attributes).filter((at) => at.name.startsWith('data-')).map((at) => [at.name, at.value])),
      };
    });
    console.log(`  click result: ${JSON.stringify(clickResult)}`);

    await page.waitForTimeout(3_500);
    await page.screenshot({ path: `${OUT_DIR}/_debug-after-click.png`, fullPage: true });

    console.log('\n--- DEPOIS do click ---');
    const after = await snapshotModals(page, 'after');
    after.forEach((m) => console.log(`  modal[${m.idx}] vis=${m.visible} hasIn=${m.hasInClass} title="${m.title}" inputs=${m.inputs} action=${m.formAction}`));

    // Procura o "novo" modal (que apareceu depois do click)
    const nova = after.find((m) => m.visible && m.inputs > 0);
    if (nova) {
      console.log(`\n✓ form encontrado no modal[${nova.idx}] — title "${nova.title}" inputs=${nova.inputs}`);
      const dump = await page.evaluate((idx) => {
        const all = Array.from(document.querySelectorAll('.modal, [role="dialog"], .modal-dialog'));
        const m = all[idx] as HTMLElement;
        const fields = Array.from(m.querySelectorAll('input:not([type="hidden"]), select, textarea')).map((el) => {
          const e = el as HTMLInputElement;
          return { name: e.name, id: e.id, type: e.type, value: e.value, placeholder: e.placeholder };
        });
        const buttons = Array.from(m.querySelectorAll('button, input[type="submit"]')).map((el) => ({
          text: (el.textContent ?? '').trim() || (el as HTMLInputElement).value,
          type: (el as HTMLButtonElement).type,
          className: (el as HTMLElement).className,
        }));
        const formHtml = m.querySelector('form')?.outerHTML ?? null;
        return { fields, buttons, formHtml };
      }, nova.idx);

      writeFileSync(`${OUT_DIR}/_debug-edit-form.json`, JSON.stringify(dump, null, 2));
      if (dump.formHtml) writeFileSync(`${OUT_DIR}/_debug-edit-form.html`, dump.formHtml);

      console.log(`\nCampos (${dump.fields.length}):`);
      dump.fields.forEach((f) => console.log(`  [${f.type}] name="${f.name}" value="${f.value}"`));
      console.log(`Botões (${dump.buttons.length}):`);
      dump.buttons.forEach((b) => console.log(`  [${b.type}] "${b.text}" .${b.className.slice(0, 40)}`));
    } else {
      console.log('\n✗ nenhum modal com inputs apareceu — provavelmente é edição inline ou form na própria página');
      // Snapshot da página pra inspecionar
      const inlineFields = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea'))
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => {
            const e = el as HTMLInputElement;
            return { name: e.name, id: e.id, type: e.type, value: e.value };
          });
      });
      console.log(`Campos visíveis na página inteira: ${inlineFields.length}`);
      writeFileSync(`${OUT_DIR}/_debug-page-fields.json`, JSON.stringify(inlineFields, null, 2));
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
