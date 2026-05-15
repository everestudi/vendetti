/**
 * Atualiza uma seleção (slot) da Maquina BlueMall Rondon no Vendtef.
 *
 * Por padrão é **dry-run** — só abre o modal de edição, lê os valores atuais
 * e mostra o que seria mudado. Não submete nada.
 *
 * Pra de fato salvar: passa `--commit`.
 *
 * Uso:
 *   npx tsx ... update-slot.ts --selecao 13 --capacity 15
 *   npx tsx ... update-slot.ts --selecao 13 --capacity 15 --price 12.90 --commit
 *
 * Tudo via `dotenv -e .env.local --` (npm scripts já fazem).
 */

import { getSecret } from '../../lib/secrets';
import { dismissModals, ensurePortalSSO, launchBrowser, newAuthedContext, SESSION_PATH } from '../_shared/playwright';
import type { Page } from 'playwright';

const MASCARAS_URL = 'https://www.portalvendtef.com.br/mascaras';
const TARGET_ESTOQUE = 'Maquina BlueMall Rondon';

interface Args {
  selecao: string;
  capacity?: number;
  price?: number;
  qtdeAlerta?: number;
  qtdeCritico?: number;
  commit: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const selecao = get('--selecao');
  if (!selecao) {
    console.error('uso: --selecao <num> [--capacity <n>] [--price <n>] [--alerta <n>] [--critico <n>] [--commit]');
    process.exit(1);
  }
  return {
    selecao,
    capacity: get('--capacity') ? Number(get('--capacity')) : undefined,
    price: get('--price') ? Number(get('--price')) : undefined,
    qtdeAlerta: get('--alerta') ? Number(get('--alerta')) : undefined,
    qtdeCritico: get('--critico') ? Number(get('--critico')) : undefined,
    commit: argv.includes('--commit'),
  };
}

function brl(n: number): string {
  return n.toFixed(2).replace('.', ',');
}

async function openSelectionEditor(page: Page, selecao: string) {
  await page.goto(MASCARAS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await dismissModals(page);

  // Abre modal Seleções
  const row = page.locator(`tr:has-text("${TARGET_ESTOQUE}")`).first();
  await row.locator('a.aSelecoes').click({ force: true });
  await page.waitForTimeout(1_500);

  // Clica ✏️ da seleção alvo via JS (mais confiável que CSS selector compound)
  const clicked = await page.evaluate((sel) => {
    const modal = document.querySelector('.modal.in, .modal.show');
    if (!modal) return { ok: false, reason: 'modal Seleções não está open' };
    const rows = Array.from(modal.querySelectorAll('tbody tr'));
    const target = rows.find((r) => (r.children[0] as HTMLElement)?.textContent?.trim() === sel);
    if (!target) return { ok: false, reason: `seleção "${sel}" não encontrada no modal` };
    const link = target.querySelector('a.edit-selecao') as HTMLAnchorElement | null;
    if (!link) return { ok: false, reason: 'a.edit-selecao não achado na row' };
    link.click();
    return { ok: true };
  }, selecao);
  if (!clicked.ok) throw new Error(clicked.reason);

  // Aguarda modal Editar Produto aparecer
  await page.waitForFunction(
    () => {
      const all = Array.from(document.querySelectorAll('.modal.in, .modal.show'));
      return all.some((m) => m.querySelector('.modal-title')?.textContent?.includes('Editar Produto'));
    },
    { timeout: 10_000 },
  );
}

async function readForm(page: Page) {
  return page.evaluate(() => {
    const modals = Array.from(document.querySelectorAll('.modal.in, .modal.show'));
    const editModal = modals.find((m) => m.querySelector('.modal-title')?.textContent?.includes('Editar Produto'));
    if (!editModal) return null;
    const get = (name: string) =>
      ((editModal.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value ?? null);
    return {
      pid: get('pid'),
      selecao: get('selecao'),
      preco: get('preco'),
      capacidade: get('capacidade'),
      qtde_estoque_alerta: get('qtde_estoque_alerta'),
      qtde_estoque_critico: get('qtde_estoque_critico'),
      qtde_dias: get('qtde_dias'),
      unidades_liberadas: get('unidades_liberadas'),
    };
  });
}

async function fillAndSubmit(page: Page, args: Args, current: NonNullable<Awaited<ReturnType<typeof readForm>>>) {
  const editModalSelector = '.modal.in:has(.modal-title:has-text("Editar Produto")), .modal.show:has(.modal-title:has-text("Editar Produto"))';
  // fallback: pega o último modal.in (top)
  const topModalLocator = page.locator('.modal.in, .modal.show').last();

  async function setField(name: string, value: string) {
    const input = topModalLocator.locator(`[name="${name}"]`);
    await input.fill(value, { timeout: 5_000 });
  }

  if (args.capacity !== undefined) await setField('capacidade', String(args.capacity));
  if (args.price !== undefined) await setField('preco', brl(args.price));
  if (args.qtdeAlerta !== undefined) await setField('qtde_estoque_alerta', String(args.qtdeAlerta));
  if (args.qtdeCritico !== undefined) await setField('qtde_estoque_critico', String(args.qtdeCritico));

  // Submit
  console.log('  → submetendo (botão "Editar")...');
  await topModalLocator.locator('button:has-text("Editar")').first().click({ force: true });

  // Aguarda fechamento ou erro
  await Promise.race([
    page
      .waitForFunction(
        () => !document.querySelector('.modal.in:has(.modal-title:has-text("Editar Produto"))'),
        { timeout: 10_000 },
      )
      .catch(() => undefined),
    page.waitForTimeout(6_000),
  ]);
}

async function main() {
  const args = parseArgs();
  await getSecret('ERPVENDING_USER'); // smoke

  console.log(`\n=== update-slot ${args.commit ? 'COMMIT' : 'DRY-RUN'} ===`);
  console.log(`seleção: ${args.selecao}`);
  if (args.capacity !== undefined) console.log(`capacity → ${args.capacity}`);
  if (args.price !== undefined) console.log(`price → ${brl(args.price)}`);
  if (args.qtdeAlerta !== undefined) console.log(`qtde_estoque_alerta → ${args.qtdeAlerta}`);
  if (args.qtdeCritico !== undefined) console.log(`qtde_estoque_critico → ${args.qtdeCritico}`);

  const browser = await launchBrowser();
  const ctx = await newAuthedContext(browser);
  try {
    await ensurePortalSSO(ctx, 'vendtef');
    const page = await ctx.newPage();

    await openSelectionEditor(page, args.selecao);
    const before = await readForm(page);
    if (!before) throw new Error('form de edição não foi lido');

    console.log('\nestado ATUAL:');
    console.log(`  pid:          ${before.pid}`);
    console.log(`  selecao:      ${before.selecao}`);
    console.log(`  preco:        ${before.preco}`);
    console.log(`  capacidade:   ${before.capacidade}`);
    console.log(`  alerta/crit:  ${before.qtde_estoque_alerta} / ${before.qtde_estoque_critico}`);

    if (!args.commit) {
      console.log('\n(dry-run — nada submetido. passe --commit pra salvar.)');
      return;
    }

    await fillAndSubmit(page, args, before);
    await page.waitForTimeout(2_000);

    // Re-abre modal de edição da MESMA seleção e relê — confirma persistência
    console.log('\nverificando persistência...');
    await page.goto(MASCARAS_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await openSelectionEditor(page, args.selecao);
    const after = await readForm(page);
    if (!after) throw new Error('falhou re-abrir form pra verificar');

    console.log('\nestado APÓS:');
    console.log(`  preco:        ${after.preco}    ${before.preco !== after.preco ? '✓ mudou' : ''}`);
    console.log(`  capacidade:   ${after.capacidade}    ${before.capacidade !== after.capacidade ? '✓ mudou' : ''}`);
    console.log(`  alerta/crit:  ${after.qtde_estoque_alerta} / ${after.qtde_estoque_critico}`);

    await ctx.storageState({ path: SESSION_PATH });
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
