/**
 * Crawl amplo do VendTEF — visita as principais URLs operacionais e relatórios,
 * captura tabelas + screenshots de tudo. Gera um índice consolidado.
 *
 * Útil pra mapear o site inteiro de uma vez e descobrir onde tá cada dado.
 *
 * Uso: `npm run scrape:crawl`
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { getSecret } from '../../lib/secrets';
import {
  captureTables,
  dismissModals,
  ensurePortalSSO,
  isOnLoginPage,
  launchBrowser,
  newAuthedContext,
  SESSION_PATH,
} from '../_shared/playwright';
import type { BrowserContext } from 'playwright';

const OUT_DIR = './tmp/crawl';

interface CrawlTarget {
  slug: string;
  label: string;
  path: string;
  category: 'operacional' | 'relatorio' | 'cadastro' | 'gestao';
}

const TARGETS: CrawlTarget[] = [
  // Operação
  { slug: '01-dashboard', label: 'Dashboard / Gráficos', path: '/dashboard', category: 'operacional' },
  { slug: '02-maquinas', label: 'Listagem de Máquinas', path: '/maquina', category: 'operacional' },
  { slug: '03-resumo-terminais', label: 'Resumo Terminais', path: '/resumo-terminais', category: 'operacional' },
  { slug: '04-acomp-estoque', label: 'Acompanhamento de Estoque', path: '/acompanhamentoestoque', category: 'operacional' },
  { slug: '05-mascaras', label: 'Definições de Estoque (molas)', path: '/mascaras', category: 'operacional' },
  // Cadastros
  { slug: '06-produtos', label: 'Produtos', path: '/produtos', category: 'cadastro' },
  { slug: '07-ingredientes', label: 'Ingredientes', path: '/ingredientes', category: 'cadastro' },
  { slug: '08-clientes', label: 'Clientes', path: '/cliente', category: 'cadastro' },
  // Relatórios
  { slug: '09-rel-vendas-geral', label: 'Vendas (geral)', path: '/relatoriogeral/relatorioVendasGeral', category: 'relatorio' },
  { slug: '10-rel-vendas-produtos', label: 'Vendas por Produtos', path: '/relatoriogeral/relatorioVendasPorProdutosGeral', category: 'relatorio' },
  { slug: '11-rel-fat-diario', label: 'Faturamento Diário', path: '/relatoriogeral/relatorioFaturamentoDiarioGeral', category: 'relatorio' },
  { slug: '12-rel-fat-mensal', label: 'Faturamento Mensal das Máquinas', path: '/relatoriogeral/faturamento', category: 'relatorio' },
  { slug: '13-rel-pick-list', label: 'Pick List', path: '/relatoriogeral/relatorioPickListGeral', category: 'relatorio' },
  { slug: '14-rel-abastecimento', label: 'Abastecimentos', path: '/relatoriogeral/relatorioGeralAbastecimento', category: 'relatorio' },
  { slug: '15-rel-fechamento-estoque', label: 'Fechamento de Estoque', path: '/estoque-maquinas/relatorio-fechamento-estoque-geral', category: 'relatorio' },
  { slug: '16-rel-cancelamentos', label: 'Cancelamentos', path: '/relatoriogeral/relatorioCancelamentosGeral', category: 'relatorio' },
  { slug: '17-rel-transacoes-pendentes', label: 'Transações Pendentes', path: '/relatoriogeral/relatorioTransacoesPendentesGeral', category: 'relatorio' },
  { slug: '18-rel-coletas', label: 'Coletas', path: '/relatoriogeral/relatorioColetasGeral', category: 'relatorio' },
  { slug: '19-rel-status-entrega', label: 'Status de Entrega', path: '/relatoriogeral/relatorioStatusEntrega', category: 'relatorio' },
  { slug: '20-rel-vendas-prods-vadts', label: 'Vendas Produtos+Máquina (eVADTS)', path: '/reportvendasporprodutosevadts/relatorioProdutosTerminalGeral', category: 'relatorio' },
];

interface CrawlResult {
  slug: string;
  label: string;
  category: string;
  url: string;
  title: string;
  ok: boolean;
  redirectedToLogin: boolean;
  tableCount: number;
  rowCounts: number[];
  visibleHeaders: string[][];
  formFields: { name: string; type: string; placeholder?: string }[];
}

async function visitOne(ctx: BrowserContext, target: CrawlTarget): Promise<CrawlResult> {
  const url = `https://www.portalvendtef.com.br${target.path}`;
  const page = await ctx.newPage();
  const result: CrawlResult = {
    slug: target.slug,
    label: target.label,
    category: target.category,
    url,
    title: '',
    ok: false,
    redirectedToLogin: false,
    tableCount: 0,
    rowCounts: [],
    visibleHeaders: [],
    formFields: [],
  };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
    await dismissModals(page);

    if (isOnLoginPage(page)) {
      result.redirectedToLogin = true;
      return result;
    }

    result.title = await page.title();
    await page.screenshot({ path: `${OUT_DIR}/${target.slug}.png`, fullPage: true });

    const tables = await captureTables(page);
    result.tableCount = tables.length;
    result.rowCounts = tables.map((t) => t.rows.length);
    result.visibleHeaders = tables.map((t) => t.headers);

    // Captura campos de form (filtros) — útil pra entender o que cada relatório precisa
    result.formFields = await page.evaluate(() => {
      const fields: { name: string; type: string; placeholder?: string }[] = [];
      document.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach((el) => {
        if ((el as HTMLElement).offsetParent === null) return;
        const e = el as HTMLInputElement;
        if (e.name) fields.push({ name: e.name, type: e.type ?? e.tagName.toLowerCase(), placeholder: e.placeholder });
      });
      return fields;
    });

    writeFileSync(
      `${OUT_DIR}/${target.slug}.json`,
      JSON.stringify({ url, title: result.title, tables, formFields: result.formFields }, null, 2),
    );
    result.ok = true;
  } catch (err) {
    console.error(`  ✗ ${target.slug}: ${(err as Error).message.split('\n')[0]}`);
  } finally {
    await page.close();
  }
  return result;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  await getSecret('ERPVENDING_USER'); // smoke check

  const browser = await launchBrowser();
  const ctx = await newAuthedContext(browser);
  try {
    await ensurePortalSSO(ctx, 'vendtef');

    const results: CrawlResult[] = [];
    for (const t of TARGETS) {
      const r = await visitOne(ctx, t);
      const status = r.redirectedToLogin ? '🔒' : r.ok ? '✓' : '✗';
      const tables = r.tableCount > 0 ? ` ${r.tableCount}t [${r.rowCounts.join(',')}r]` : '';
      const forms = r.formFields.length > 0 ? ` ${r.formFields.length} fields` : '';
      console.log(`  ${status} ${t.slug} — ${t.label}${tables}${forms}`);
      results.push(r);
    }

    writeFileSync(`${OUT_DIR}/_summary.json`, JSON.stringify(results, null, 2));
    await ctx.storageState({ path: SESSION_PATH });

    const byCat = results.reduce<Record<string, CrawlResult[]>>((acc, r) => {
      (acc[r.category] ||= []).push(r);
      return acc;
    }, {});
    console.log('\n=== resumo por categoria ===');
    for (const [cat, items] of Object.entries(byCat)) {
      const withData = items.filter((i) => i.tableCount > 0).length;
      console.log(`  ${cat}: ${withData}/${items.length} com dados`);
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
