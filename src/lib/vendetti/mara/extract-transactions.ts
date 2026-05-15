/**
 * Extração de transações detalhadas via /relatorioVendasGeralDownload.
 *
 * O endpoint:
 *   1. Página com datepicker (jQuery UI) + botão "Continuar"
 *   2. Após submit aparece botão "Download" → baixa um ZIP
 *   3. ZIP contém CSV (separador literal "/t", não tab) com TRANSAÇÕES INDIVIDUAIS
 *   4. Servidor limita intervalo a 30 dias — fazemos múltiplos chunks
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import type { BrowserContext } from 'playwright';
import { dismissModals } from '../../../scrapers/_shared/playwright';

const URL = 'https://www.portalvendtef.com.br/relatoriogeral/relatorioVendasGeralDownload';
const TMP = './tmp/vendas-download';

export interface RawTransaction {
  cliente: string;
  maquina: string;
  paymentType: string;
  product: string;
  slot: string;
  unitPriceBR: string;
  totalBR: string;
  dateBR: string;
  timeBR: string;
  nsu: string;
  cardBrand: string;
  matricula: string;
}

function stripQuotes(s: string): string {
  return s.replace(/^"/, '').replace(/"$/, '').trim();
}

/** Parser do CSV com separador literal "/t". */
export function parseTransactionsCSV(content: string): RawTransaction[] {
  const lines = content.split(/\r?\n/);
  const out: RawTransaction[] = [];
  let inData = false;

  for (const raw of lines) {
    if (!raw.trim()) continue;

    // Pula metadata e linhas de header até o sub-header com "Produto" + "Mola"
    if (!inData) {
      if (raw.includes('"Produto"') && raw.includes('"Mola"')) {
        inData = true;
      }
      continue;
    }

    const fields = raw.split('/t').map(stripQuotes);
    if (fields.length < 13) continue;

    // estrutura conhecida — 22 colunas
    out.push({
      cliente: fields[0] ?? '',
      maquina: fields[1] ?? '',
      paymentType: fields[4] ?? '',
      product: fields[5] ?? '',
      slot: fields[6] ?? '',
      unitPriceBR: fields[8] ?? '',
      totalBR: fields[9] ?? '',
      dateBR: fields[11] ?? '',
      timeBR: fields[12] ?? '',
      nsu: fields[14] ?? '',
      cardBrand: fields[18] ?? '',
      matricula: fields[21] ?? '',
    });
  }
  return out;
}

/** Baixa o ZIP de 1 chunk (≤30 dias), descompacta, retorna transações. */
async function downloadChunk(
  ctx: BrowserContext,
  start: Date,
  end: Date,
): Promise<RawTransaction[]> {
  const page = await ctx.newPage();
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await dismissModals(page);

    // jQuery UI datepicker — usa API
    await page.evaluate(
      ({ s, e }) => {
        // @ts-expect-error jQuery global na página
        const $ = window.jQuery ?? window.$;
        if (typeof $ !== 'function') return;
        $('#inicio').datepicker('setDate', new Date(s));
        $('#fim').datepicker('setDate', new Date(e));
      },
      { s: start.toISOString(), e: end.toISOString() },
    );
    await page.waitForTimeout(300);

    // Etapa 1: Continuar → gera relatório no servidor
    await page
      .locator('button:has-text("Continuar"), input[type="submit"][value*="Continuar" i]')
      .first()
      .click({ force: true });
    await page.waitForTimeout(1_500);

    // Verifica se houve erro
    const erro = await page
      .locator('.alert, .error, .alert-danger')
      .first()
      .textContent({ timeout: 1_000 })
      .catch(() => null);
    if (erro && /inválido|maior que|menor que|nenhum/i.test(erro)) {
      console.warn(`     ⚠️ erro do servidor: ${erro.trim().slice(0, 80)}`);
      return [];
    }

    // Etapa 2: aguarda botão Download e clica
    const downloadBtn = page
      .locator('a:has-text("Download"), button:has-text("Download"):not(:has-text("período"))')
      .last();
    try {
      await downloadBtn.waitFor({ state: 'visible', timeout: 8_000 });
    } catch {
      return [];
    }

    mkdirSync(TMP, { recursive: true });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      downloadBtn.click({ force: true }),
    ]);

    const zipName = download.suggestedFilename();
    const zipPath = `${TMP}/${zipName}`;
    await download.saveAs(zipPath);

    const extractDir = `${TMP}/extracted`;
    mkdirSync(extractDir, { recursive: true });
    execSync(`unzip -o "${zipPath}" -d "${extractDir}" >/dev/null 2>&1`);

    const csvName = zipName.replace(/\.zip$/, '.csv');
    const csvPath = `${extractDir}/${csvName}`;
    if (!existsSync(csvPath)) {
      console.warn(`     ⚠️ csv não achado: ${csvPath}`);
      return [];
    }
    const content = readFileSync(csvPath, 'utf-8');
    return parseTransactionsCSV(content);
  } finally {
    await page.close();
  }
}

/** Sequencia chunks pra cobrir os últimos N meses. */
export async function extractTransactionsLastNMonths(
  ctx: BrowserContext,
  months = 6,
): Promise<RawTransaction[]> {
  const all: RawTransaction[] = [];
  const today = new Date();
  for (let i = 0; i < months; i++) {
    // chunk i: termina hoje - i*30 dias, começa hoje - (i+1)*30 + 1 dias
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i * 30);
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (i + 1) * 30 + 1);
    console.log(
      `  chunk ${i + 1}/${months}: ${start.toLocaleDateString('pt-BR')} → ${end.toLocaleDateString('pt-BR')}`,
    );
    const rows = await downloadChunk(ctx, start, end);
    console.log(`    + ${rows.length} transações`);
    all.push(...rows);
  }
  return all;
}
