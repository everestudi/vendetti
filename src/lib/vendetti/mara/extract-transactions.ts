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

/**
 * Parser do CSV.
 *
 * Formato atual (verificado em maio/2026): separador `";"` entre fields aspados,
 * encoding latin1/cp1252 (chars com til/cedilha vêm mojibake). Header tem
 * 2 linhas: a principal + um sub-header com "Produto"/"Mola" sob "Produtos".
 *
 * Antes era separador literal "/t" — mudou em algum momento, deixei suporte
 * legacy de fallback caso voltem ao formato antigo.
 */
export function parseTransactionsCSV(content: string): RawTransaction[] {
  const lines = content.split(/\r?\n/);
  const out: RawTransaction[] = [];
  let inData = false;

  // Detecta separador olhando primeira linha de dados/header
  const useSemicolon = content.includes('";"');
  const sep = useSemicolon ? '";"' : '/t';

  for (const raw of lines) {
    if (!raw.trim()) continue;

    // Pula metadata e linhas de header até o sub-header com "Produto" + "Mola"
    if (!inData) {
      if (raw.includes('"Produto"') && raw.includes('"Mola"')) {
        inData = true;
      }
      continue;
    }

    // Split por separador, remove aspa do início/fim
    const fields = useSemicolon
      ? raw
          .replace(/^"/, '')
          .replace(/"$/, '')
          .split(sep)
      : raw.split(sep).map(stripQuotes);

    if (fields.length < 13) continue;

    // Colunas (verificadas no CSV real, separador ";"):
    // [0] cliente, [1] maquina, [2] modelo, [3] fabricante, [4] paymentType,
    // [5] product, [6] slot (mola), [7] venda, [8] unitPrice, [9] totalBR,
    // [10] cod promocional, [11] dateBR, [12] timeBR, [13] nLogico, [14] nsu,
    // [15] autorização, [16] tipoCart, [17] rede, [18] cardBrand, [19] usuario,
    // [20] nCartao, [21] matricula
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
  debugLabel = '',
): Promise<RawTransaction[]> {
  const page = await ctx.newPage();
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await dismissModals(page);
    mkdirSync(TMP, { recursive: true });
    await page.screenshot({ path: `${TMP}/dbg-${debugLabel}-01-form.png`, fullPage: true }).catch(() => undefined);

    const fmtBR = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const startBR = fmtBR(start);
    const endBR = fmtBR(end);

    // Datepicker: setDate via jQuery + fallback de fill direto
    const setDateOk = await page.evaluate(
      ({ s, e, sStr, eStr }) => {
        // @ts-expect-error jQuery global na página
        const $ = window.jQuery ?? window.$;
        if (typeof $ === 'function') {
          try {
            $('#inicio').datepicker('setDate', new Date(s));
            $('#fim').datepicker('setDate', new Date(e));
            // Dispara change event
            $('#inicio').trigger('change');
            $('#fim').trigger('change');
            return { jq: true, inicio: $('#inicio').val(), fim: $('#fim').val() };
          } catch (err) {
            return { jq: false, err: String(err) };
          }
        }
        // Fallback: input direto
        const inicio = document.querySelector<HTMLInputElement>('#inicio');
        const fim = document.querySelector<HTMLInputElement>('#fim');
        if (inicio) inicio.value = sStr;
        if (fim) fim.value = eStr;
        return { jq: false, inicio: inicio?.value, fim: fim?.value };
      },
      { s: start.toISOString(), e: end.toISOString(), sStr: startBR, eStr: endBR },
    );
    console.warn(`     [dbg ${debugLabel}] datepicker: ${JSON.stringify(setDateOk)}`);
    await page.waitForTimeout(500);

    // Etapa 1: Continuar → gera relatório no servidor
    await page
      .locator('button:has-text("Continuar"), input[type="submit"][value*="Continuar" i]')
      .first()
      .click({ force: true });
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: `${TMP}/dbg-${debugLabel}-02-after-continuar.png`, fullPage: true }).catch(() => undefined);

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
    if (erro) console.warn(`     [dbg ${debugLabel}] alert: "${erro.trim().slice(0, 80)}"`);

    // Etapa 2: aguarda botão Download e clica
    const downloadBtn = page
      .locator('a:has-text("Download"), button:has-text("Download"):not(:has-text("período"))')
      .last();
    try {
      await downloadBtn.waitFor({ state: 'visible', timeout: 8_000 });
    } catch {
      console.warn(`     [dbg ${debugLabel}] download não apareceu — ver dbg-${debugLabel}-02-after-continuar.png`);
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
    const rows = await downloadChunk(ctx, start, end, `tx-${i + 1}`);
    console.log(`    + ${rows.length} transações`);
    all.push(...rows);
  }
  return all;
}
