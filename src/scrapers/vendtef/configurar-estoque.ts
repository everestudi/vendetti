/**
 * Configura um produto na lista "Produtos Configurados" de um estoque Vendtef.
 *
 * Passo necessário ANTES de conseguir:
 *  - Lançar Entrada de Estoque (fluxo Bruno após NF-e)
 *  - Lançar Abastecimento (fluxo Weverton)
 *
 * Caminho manual (que Luís fazia):
 *  ERP → Estoque → Produtos Configurados → Adicionar → palavra-chave →
 *  escolher → max=100 / alerta=2 / crítico=1 → Salvar.
 *
 * Usado idempotentemente: se já tá configurado, retorna ok sem erro.
 */

import type { BrowserContext } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dismissModals } from '../_shared/playwright';

const OUT_DIR = './tmp/vendtef-configurar';
const ESTOQUES_URL = 'https://www.erpvending.com.br/erp/estoques';
const OPERACOES_URL = 'https://www.erpvending.com.br/erp/operacoes-estoque';

export interface ConfigurarOpts {
  estoqueMaximo?: number;
  alerta?: number;
  critico?: number;
}

export interface ConfigurarResult {
  ok: boolean;
  /** true se o produto JÁ estava configurado (no-op). */
  alreadyConfigured?: boolean;
  error?: string;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Garante que `productName` está em "Produtos Configurados" do `estoqueName`,
 * com os limites desejados. Se já tiver, retorna ok+alreadyConfigured.
 */
export async function configurarProdutoNoEstoque(
  ctx: BrowserContext,
  estoqueName: string,
  productName: string,
  opts: ConfigurarOpts = {},
): Promise<ConfigurarResult> {
  mkdirSync(OUT_DIR, { recursive: true });
  const estoqueMaximo = opts.estoqueMaximo ?? 100;
  const alerta = opts.alerta ?? 2;
  const critico = opts.critico ?? 1;
  const slug = `${normalize(estoqueName).slice(0, 12).replace(/ /g, '-')}_${normalize(productName).slice(0, 24).replace(/ /g, '-')}`;

  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);

  try {
    // 1. Lista de estoques
    await page.goto(ESTOQUES_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await dismissModals(page);
    await page.screenshot({ path: `${OUT_DIR}/${slug}-01-estoques.png`, fullPage: true });

    // 2. Acha link "Produtos Configurados" da row do estoque alvo
    const linkInfo = await page.evaluate((target) => {
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      const targetN = norm(target);
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      for (const tr of rows) {
        const cells = Array.from(tr.querySelectorAll('td')).map((c) => (c.textContent ?? '').trim());
        const rowText = cells.join(' ');
        if (!norm(rowText).includes(targetN)) continue;
        // Acha link/btn "Produtos Configurados" na row
        const links = Array.from(tr.querySelectorAll('a, button')) as HTMLAnchorElement[];
        for (const l of links) {
          const text = (l.textContent ?? '').toLowerCase();
          const title = (l.title ?? '').toLowerCase();
          if (text.includes('produtos') || title.includes('produtos') || text.includes('configurados')) {
            return { ok: true, href: l.href ?? null, text: l.textContent?.trim() ?? '', rowText };
          }
        }
        return { ok: false, reason: `Row "${rowText.slice(0, 80)}" achada mas sem link Produtos Configurados`, rowText };
      }
      return { ok: false, reason: `estoque "${target}" não achado na lista` };
    }, estoqueName);

    if (!linkInfo.ok) {
      writeFileSync(`${OUT_DIR}/${slug}-01-rows.txt`, JSON.stringify(linkInfo, null, 2));
      return { ok: false, error: linkInfo.reason };
    }

    if (linkInfo.href) {
      await page.goto(linkInfo.href, { waitUntil: 'domcontentloaded' });
    } else {
      // Caso o link seja JS-only: usa text-match no click
      await page.locator(`text="${linkInfo.text}"`).first().click();
    }
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await dismissModals(page);
    await page.screenshot({ path: `${OUT_DIR}/${slug}-02-produtos-config.png`, fullPage: true });

    // 3. Pre-check: produto já está na lista?
    const targetTokens = normalize(productName).split(' ').filter((t) => t.length >= 3).slice(0, 4);
    const existing = await page.evaluate((tokens) => {
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      for (const tr of rows) {
        const cells = Array.from(tr.querySelectorAll('td')).map((c) => (c.textContent ?? '').trim());
        const rowText = norm(cells.join(' '));
        const allMatch = tokens.length > 0 && tokens.every((t: string) => rowText.includes(t));
        if (allMatch) return { found: true, rowText: cells.join(' | ') };
      }
      return { found: false };
    }, targetTokens);

    if (existing.found) {
      console.log(`    ✓ produto "${productName}" já configurado no estoque "${estoqueName}"`);
      return { ok: true, alreadyConfigured: true };
    }

    // 4. Clica "Adicionar"
    const addBtn = page.locator('a:has-text("Adicionar"), button:has-text("Adicionar"), #addProd, .btn:has-text("Adicionar")').first();
    if ((await addBtn.count()) === 0) {
      writeFileSync(`${OUT_DIR}/${slug}-02-no-add.txt`, await page.content().then((c) => c.slice(0, 4000)).catch(() => 'fail'));
      return { ok: false, error: 'botão "Adicionar" não achado em Produtos Configurados' };
    }
    await addBtn.click();
    await page.waitForTimeout(1_500);
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    await page.screenshot({ path: `${OUT_DIR}/${slug}-03-add-form.png`, fullPage: true });

    // 5. Procura o input de "palavra-chave" e digita
    const searchSelectors = [
      'input[placeholder*="palavra" i]',
      'input[placeholder*="buscar" i]',
      'input[placeholder*="pesquis" i]',
      'input[placeholder*="produto" i]',
      'input[name*="produto" i]',
      'input[name*="pesquisa" i]',
      'input[name*="search" i]',
      'input[type="search"]',
      'input[type="text"]:visible',
    ];
    let searchFilled = false;
    for (const sel of searchSelectors) {
      const inp = page.locator(sel).first();
      if (await inp.isVisible({ timeout: 500 }).catch(() => false)) {
        await inp.fill(productName);
        searchFilled = true;
        break;
      }
    }
    if (!searchFilled) {
      return { ok: false, error: 'input de palavra-chave não achado' };
    }
    await page.waitForTimeout(1_500); // aguarda autocomplete
    await page.screenshot({ path: `${OUT_DIR}/${slug}-04-typed.png`, fullPage: true });

    // 6. Seleciona o produto (autocomplete/dropdown/select)
    const targetN = normalize(productName);
    const tokensSearch = targetN.split(' ').filter((t) => t.length >= 3).slice(0, 4);
    const picked = await page.evaluate((tokens) => {
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      // Tenta autocomplete options visíveis
      const candidates = Array.from(document.querySelectorAll('ul.ui-autocomplete li, .autocomplete-suggestion, .select2-results__option, [role="option"]')) as HTMLElement[];
      const matchByTokens = (text: string) => {
        const n = norm(text);
        return tokens.every((t: string) => n.includes(t));
      };
      for (const c of candidates) {
        if ((c as HTMLElement).offsetParent === null) continue;
        if (matchByTokens(c.textContent ?? '')) {
          c.click();
          return { ok: true, kind: 'autocomplete', text: c.textContent };
        }
      }
      // Tenta select dropdown
      const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
      for (const sel of selects) {
        if ((sel as HTMLElement).offsetParent === null) continue;
        const opts = Array.from(sel.options);
        const match = opts.find((o) => matchByTokens(o.textContent ?? ''));
        if (match) {
          sel.value = match.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, kind: 'select', text: match.textContent };
        }
      }
      return { ok: false };
    }, tokensSearch);

    if (!picked.ok) {
      writeFileSync(`${OUT_DIR}/${slug}-04-no-pick.txt`, await page.content().then((c) => c.slice(0, 4000)).catch(() => 'fail'));
      return { ok: false, error: `produto "${productName}" não achado no autocomplete/select de Produtos Configurados` };
    }
    console.log(`    ✓ produto pickado via ${picked.kind}: "${picked.text}"`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT_DIR}/${slug}-05-picked.png`, fullPage: true });

    // 7. Preenche limites
    const fillTriplet = async () => {
      // Estoque máximo
      const maxField = page.locator(
        'input[name*="maximo" i], input[name*="estoque_max" i], input[placeholder*="máximo" i], input[placeholder*="maximo" i], #estoque_maximo',
      ).first();
      if ((await maxField.count()) > 0) await maxField.fill(String(estoqueMaximo));
      // Alerta
      const alertField = page.locator(
        'input[name*="alerta" i], input[name*="qtde_alerta" i], #qtde_alerta, input[placeholder*="alerta" i]',
      ).first();
      if ((await alertField.count()) > 0) await alertField.fill(String(alerta));
      // Crítico
      const critField = page.locator(
        'input[name*="critic" i], input[name*="qtde_critic" i], #qtde_critico, input[placeholder*="crític" i], input[placeholder*="critic" i]',
      ).first();
      if ((await critField.count()) > 0) await critField.fill(String(critico));
    };
    await fillTriplet();
    await page.screenshot({ path: `${OUT_DIR}/${slug}-06-limites.png`, fullPage: true });

    // 8. Salvar
    const saveBtn = page.locator(
      'button:has-text("Salvar"), input[type="submit"], input[name="save"], #save, button:has-text("Adicionar"):not(:has-text("Produto"))',
    ).first();
    if ((await saveBtn.count()) === 0) {
      return { ok: false, error: 'botão Salvar não achado no form de configurar produto' };
    }
    await saveBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: `${OUT_DIR}/${slug}-07-saved.png`, fullPage: true });

    // 9. Verifica sucesso (procura erro ou se voltou pra lista)
    const errAlert = await page
      .locator('.alert-danger:visible, .toast-error:visible')
      .first()
      .textContent({ timeout: 800 })
      .catch(() => null);
    if (errAlert && errAlert.trim()) {
      return { ok: false, error: `Vendtef: ${errAlert.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await page.screenshot({ path: `${OUT_DIR}/${slug}-error.png`, fullPage: true }).catch(() => undefined);
    return { ok: false, error: msg };
  } finally {
    await page.close();
  }
}

/**
 * Lança Operação de Estoque > Entrada de Estoque single-product no estoque
 * Everest. Usado pelo fluxo Weverton quando o produto é novo E não tem
 * entrada de Bruno ainda (Luís preenche `entradaEstoqueQty` na Decision).
 *
 * Diferente da entrada-estoque.ts (que processa NF-e inteira com vários
 * produtos), aqui é só 1 produto + qty + custo opcional.
 */
export async function lancarEntradaSingleProduct(
  ctx: BrowserContext,
  productName: string,
  qty: number,
  unitCost: number = 0,
): Promise<{ ok: boolean; error?: string }> {
  mkdirSync(OUT_DIR, { recursive: true });
  const slug = `entrada_${normalize(productName).slice(0, 24).replace(/ /g, '-')}`;
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);

  try {
    await page.goto(OPERACOES_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await dismissModals(page);
    await page.screenshot({ path: `${OUT_DIR}/${slug}-01-operacoes.png`, fullPage: true });

    // Estoque = Everest
    const estoque = page.locator('#estoque');
    const estoqueOpts = await estoque.locator('option').allTextContents();
    const everestIdx = estoqueOpts.findIndex((o) => /everest/i.test(o));
    if (everestIdx < 0) return { ok: false, error: '"Estoque Everest" não está na lista' };
    await estoque.selectOption({ index: everestIdx });
    await page.waitForTimeout(800);

    // Tipo = Entrada de Estoque
    await page.locator('#tipoOperacao').selectOption({ label: 'Entrada de Estoque' });
    await page.waitForTimeout(2_500);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await page.waitForSelector('input.qtdes-lancar', { timeout: 15_000 });
    await page.screenshot({ path: `${OUT_DIR}/${slug}-02-entrada-form.png`, fullPage: true });

    // Acha o produto na lista
    const tokens = normalize(productName).split(' ').filter((t) => t.length >= 3).slice(0, 4);
    const productInput = await page.evaluate((tokensJson) => {
      const tokens = tokensJson as string[];
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input.qtdes-lancar'));
      for (const inp of inputs) {
        const tr = inp.closest('tr');
        const nameCell = tr?.querySelector('td');
        const name = (nameCell?.textContent ?? '').replace(/\s+/g, ' ').trim();
        const n = norm(name);
        if (tokens.length > 0 && tokens.every((t) => n.includes(t))) {
          return { ok: true, pid: inp.name, name };
        }
      }
      return { ok: false };
    }, tokens);

    if (!productInput.ok) {
      writeFileSync(`${OUT_DIR}/${slug}-02-no-product.txt`, JSON.stringify({ productName, tokens }, null, 2));
      return { ok: false, error: `produto "${productName}" não achado na lista de Entrada de Estoque (Everest). Foi cadastrado e configurado?` };
    }

    // Preenche qty
    await page.locator(`input[name="${productInput.pid}"]`).fill(String(qty));

    // Se houver campo de custo unit, preenche
    const costInputs = page.locator(`input[name*="custo"], input[name*="preco"], input[name*="valor"]`);
    if ((await costInputs.count()) > 0 && unitCost > 0) {
      // Tenta achar o custo associado a essa row
      const costInRow = page.locator(`tr:has(input[name="${productInput.pid}"]) input[name*="custo"], tr:has(input[name="${productInput.pid}"]) input[name*="preco"]`).first();
      if ((await costInRow.count()) > 0) {
        await costInRow.fill(unitCost.toFixed(2).replace('.', ',')).catch(() => undefined);
      }
    }

    await page.screenshot({ path: `${OUT_DIR}/${slug}-03-filled.png`, fullPage: true });

    // Salva
    await page.locator('input[name="save"], button:has-text("Salvar")').first().click();
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: `${OUT_DIR}/${slug}-04-modal.png`, fullPage: true });

    // Confirma modal
    const confirmBtn = page.locator('.modal:visible button:has-text("Confirmar"), [role="dialog"]:visible button:has-text("Confirmar"), button.btn-primary:has-text("Confirmar")').first();
    if ((await confirmBtn.count()) === 0) {
      return { ok: false, error: 'modal de confirmação não apareceu na entrada' };
    }
    await confirmBtn.click({ force: true });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: `${OUT_DIR}/${slug}-05-after.png`, fullPage: true });

    const successText = await page.locator('.modal:visible, [role="dialog"]:visible').first().textContent({ timeout: 2_000 }).catch(() => '');
    const txt = successText ?? '';
    if (/erro|falhou|invalida|invál/i.test(txt)) {
      return { ok: false, error: `Vendtef: ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await page.screenshot({ path: `${OUT_DIR}/${slug}-error.png`, fullPage: true }).catch(() => undefined);
    return { ok: false, error: msg };
  } finally {
    await page.close();
  }
}
