/**
 * Debug v2 — preenche `inicio` + `fim`, ouve response E download events,
 * captura body de qualquer XHR que retorne arquivo.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { getSecret } from '../../lib/secrets';
import { dismissModals, ensurePortalSSO, launchBrowser, newAuthedContext } from '../_shared/playwright';

const OUT_DIR = './tmp/download';
const URL = 'https://www.portalvendtef.com.br/relatoriogeral/relatorioVendasGeralDownload';

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  await getSecret('ERPVENDING_USER');

  const browser = await launchBrowser();
  const ctx = await newAuthedContext(browser);
  try {
    await ensurePortalSSO(ctx, 'vendtef');
    const page = await ctx.newPage();

    const downloads: Array<{ url: string; status: number; contentType: string; size: number; filename?: string }> = [];

    page.on('response', async (res) => {
      const ct = res.headers()['content-type'] ?? '';
      const cd = res.headers()['content-disposition'] ?? '';
      // só logamos respostas "interessantes"
      if (cd.includes('attachment') || ct.includes('csv') || ct.includes('excel') || ct.includes('octet-stream') || ct.includes('zip')) {
        const buf = await res.body().catch(() => null);
        const filename = /filename="?([^";]+)"?/.exec(cd)?.[1];
        if (buf && filename) {
          const path = `${OUT_DIR}/captured-${filename}`;
          writeFileSync(path, buf);
          downloads.push({ url: res.url(), status: res.status(), contentType: ct, size: buf.length, filename });
          console.log(`  📦 capturado: ${path} (${buf.length} bytes, ${ct})`);
        }
      }
    });

    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await dismissModals(page);

    // Período de 29 dias (limite do servidor é 30)
    const dateResult = await page.evaluate(() => {
      // @ts-expect-error jQuery é global na página
      const $ = window.jQuery ?? window.$;
      if (typeof $ !== 'function') return { ok: false, reason: 'jQuery não disponível' };
      $('#inicio').datepicker('setDate', new Date(2026, 3, 1)); // 01/04/2026
      $('#fim').datepicker('setDate', new Date(2026, 3, 29));   // 29/04/2026
      return {
        ok: true,
        inicio: ($('#inicio').val() as string) ?? '',
        fim: ($('#fim').val() as string) ?? '',
      };
    });
    console.log('✓ datepicker (29 dias):', dateResult);

    await page.screenshot({ path: `${OUT_DIR}/01-filled.png`, fullPage: true });

    // Etapa 1: clicar Continuar (gera o relatório no servidor)
    console.log('\n→ etapa 1: clicando Continuar...');
    await page.locator('button:has-text("Continuar"), input[type="submit"][value*="Continuar" i]').first().click({ force: true });
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: `${OUT_DIR}/02-after-continuar.png`, fullPage: true });

    // Etapa 2: aguardar botão Download aparecer e clicar
    console.log('→ etapa 2: aguardando botão Download...');
    const downloadBtn = page.locator('a:has-text("Download"), button:has-text("Download"):not(:has-text("período"))').last();
    try {
      await downloadBtn.waitFor({ state: 'visible', timeout: 10_000 });
      console.log('   ✓ botão Download visível');
    } catch {
      console.log('   ⊘ botão Download não apareceu');
      await page.screenshot({ path: `${OUT_DIR}/02b-no-button.png`, fullPage: true });
      return;
    }

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }).catch(() => null),
      downloadBtn.click({ force: true }),
    ]);

    if (download) {
      const filename = download.suggestedFilename();
      const filepath = `${OUT_DIR}/downloaded-${filename}`;
      await download.saveAs(filepath);
      console.log(`✓ download capturado: ${filepath} (${filename})`);
    } else {
      console.log('  ⊘ download não disparou via event');
    }

    await page.screenshot({ path: `${OUT_DIR}/02-after.png`, fullPage: true });

    if (downloads.length === 0) {
      console.log('\n⊘ também não capturei nada via response listener.');
      // Captura mensagens de alerta/erro visíveis
      const messages = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.alert, .alert-danger, .alert-warning, .error, [class*="erro"]'))
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '')
          .filter(Boolean);
      });
      console.log(`\nmensagens visíveis (${messages.length}):`);
      messages.forEach((m) => console.log(`  ⚠️ ${m}`));

      // Estado dos campos
      const fieldsNow = await page.evaluate(() => ({
        inicio: (document.querySelector('input[name="inicio"]') as HTMLInputElement)?.value ?? '',
        fim: (document.querySelector('input[name="fim"]') as HTMLInputElement)?.value ?? '',
      }));
      console.log(`\ncampos depois do submit:`, fieldsNow);

      const html = await page.content();
      writeFileSync(`${OUT_DIR}/_post-submit.html`, html.slice(0, 30_000));
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
