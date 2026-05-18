/**
 * Extração de cancelamentos via /relatorioCancelamentosGeralDownload.
 *
 * Mesma mecânica do extract-transactions: jQuery datepicker + Continuar +
 * botão Download → ZIP → CSV (separador "/t"). Chunks de 30 dias.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import type { BrowserContext } from 'playwright';
import { dismissModals } from '../../../scrapers/_shared/playwright';

const URL_CANDIDATES = [
  'https://www.portalvendtef.com.br/relatoriogeral/relatorioCancelamentosGeralDownload',
  'https://www.portalvendtef.com.br/relatoriogeral/relatorioCancelamentosDownload',
];
const TMP = './tmp/cancellations-download';

export interface RawCancellation {
  cliente: string;
  maquina: string;
  paymentType: string;
  product: string;
  slot: string;
  unitPriceBR: string;
  totalBR: string;
  dateBR: string;
  timeBR: string;
  description: string;
  nsu: string;
}

function stripQuotes(s: string): string {
  return s.replace(/^"/, '').replace(/"$/, '').trim();
}

/**
 * CSV de cancelamentos tem 16 colunas:
 *   Cliente, Nome Máquina, Modelo, Fabricante, Produto, Mola, Preço,
 *   Data (DD/MM/YYYY HH:MM:SS), Motivo, N° Lógico, NSU, Autorização,
 *   Tipo Cartão, Rede, Bandeira, Usuário
 */
export function parseCancellationsCSV(content: string): RawCancellation[] {
  const lines = content.split(/\r?\n/);
  const out: RawCancellation[] = [];
  let inData = false;
  // Suporta ambos formatos — semicolon-quoted (atual) e /t literal (legacy)
  const useSemicolon = content.includes('";"');
  const sep = useSemicolon ? '";"' : '/t';

  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (!inData) {
      if (
        raw.includes('"Cliente"') &&
        (raw.includes('"Nome Máquina"') || raw.includes('"Máquina"') || raw.includes('"M�quina"')) &&
        raw.includes('"Motivo"')
      ) {
        inData = true;
        continue;
      }
      continue;
    }
    const fields = useSemicolon
      ? raw.replace(/^"/, '').replace(/"$/, '').split(sep)
      : raw.split(sep).map(stripQuotes);
    if (fields.length < 9) continue;

    // idx 7 tem "DD/MM/YYYY HH:MM:SS" junto
    const dateTime = fields[7] ?? '';
    const [dateBR = '', timeBR = ''] = dateTime.split(/\s+/);

    out.push({
      cliente: fields[0] ?? '',
      maquina: fields[1] ?? '',
      paymentType: '',
      product: fields[4] ?? '',
      slot: fields[5] ?? '',
      unitPriceBR: fields[6] ?? '0',
      totalBR: fields[6] ?? '0',
      dateBR,
      timeBR,
      description: fields[8] ?? '',
      nsu: fields[10] ?? '',
    });
  }
  return out;
}

async function downloadCancellationsChunk(
  ctx: BrowserContext,
  start: Date,
  end: Date,
): Promise<{ rows: RawCancellation[]; rawCsv: string | null; usedUrl: string | null }> {
  for (const url of URL_CANDIDATES) {
    const page = await ctx.newPage();
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (resp && resp.status() >= 400) {
        await page.close();
        continue;
      }
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await dismissModals(page);

      // Se a página tem o datepicker, é a página certa
      const hasDatepicker = (await page.locator('input[name="inicio"]').count()) > 0;
      if (!hasDatepicker) {
        await page.close();
        continue;
      }

      await page.evaluate(
        ({ s, e }) => {
          // @ts-expect-error jQuery global
          const $ = window.jQuery ?? window.$;
          if (typeof $ !== 'function') return;
          $('#inicio').datepicker('setDate', new Date(s));
          $('#fim').datepicker('setDate', new Date(e));
        },
        { s: start.toISOString(), e: end.toISOString() },
      );
      await page.waitForTimeout(300);

      await page
        .locator('button:has-text("Continuar"), input[type="submit"][value*="Continuar" i]')
        .first()
        .click({ force: true });
      await page.waitForTimeout(1_500);

      const downloadBtn = page.locator('a:has-text("Download"), button:has-text("Download"):not(:has-text("período"))').last();
      try {
        await downloadBtn.waitFor({ state: 'visible', timeout: 8_000 });
      } catch {
        await page.close();
        return { rows: [], rawCsv: null, usedUrl: url };
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
        await page.close();
        return { rows: [], rawCsv: null, usedUrl: url };
      }
      const content = readFileSync(csvPath, 'utf-8');
      await page.close();
      return { rows: parseCancellationsCSV(content), rawCsv: content, usedUrl: url };
    } catch {
      await page.close().catch(() => undefined);
    }
  }
  return { rows: [], rawCsv: null, usedUrl: null };
}

export async function extractCancellationsLastNMonths(
  ctx: BrowserContext,
  months = 3,
): Promise<RawCancellation[]> {
  const all: RawCancellation[] = [];
  const today = new Date();
  let sampleSaved = false;
  for (let i = 0; i < months; i++) {
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i * 30);
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (i + 1) * 30 + 1);
    console.log(
      `  chunk ${i + 1}/${months} (cancelamentos): ${start.toLocaleDateString('pt-BR')} → ${end.toLocaleDateString('pt-BR')}`,
    );
    const result = await downloadCancellationsChunk(ctx, start, end);
    if (result.usedUrl && !sampleSaved && result.rawCsv) {
      mkdirSync(TMP, { recursive: true });
      const fs = await import('node:fs');
      fs.writeFileSync(`${TMP}/_sample.csv`, result.rawCsv.slice(0, 5000));
      sampleSaved = true;
      console.log(`    (URL usada: ${result.usedUrl.split('/').pop()})`);
    }
    console.log(`    + ${result.rows.length} cancelamentos`);
    all.push(...result.rows);
  }
  return all;
}
