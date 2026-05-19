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

import type { BrowserContext, Page } from 'playwright';
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

  // Mutável porque pode mudar pra nova aba quando Vendtef abre Produtos
  // Configurados em target=_blank
  let page: Page = await ctx.newPage();
  page.setDefaultTimeout(30_000);

  try {
    // 1. Lista de estoques
    await page.goto(ESTOQUES_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await dismissModals(page);
    await page.screenshot({ path: `${OUT_DIR}/${slug}-01-estoques.png`, fullPage: true });

    // 2. Acha row do estoque alvo via Playwright locator (estável,
    // testável, ao contrário do evaluate hand-rolled). Usa containment
    // case-insensitive pra ser tolerante a "Estoque Everest" vs "EVEREST".
    const targetRegex = new RegExp(estoqueName.replace(/\s+/g, '\\s*'), 'i');
    const row = page.locator('tr').filter({ hasText: targetRegex }).first();
    if ((await row.count()) === 0) {
      // Dump rows pra debug
      const allRows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('tr')).map((r) => r.textContent?.replace(/\s+/g, ' ').trim().slice(0, 200)),
      );
      writeFileSync(`${OUT_DIR}/${slug}-01-no-row.json`, JSON.stringify({ estoqueName, allRows }, null, 2));
      return { ok: false, error: `row do estoque "${estoqueName}" não achada · ver -01-no-row.json` };
    }

    // 3. Clica no botão/link "Produtos Configurados" DENTRO da row alvo.
    // IMPORTANTE: scoped to row pra não pegar links de sidebar/header.
    const configLink = row.locator('a, button').filter({ hasText: /produtos\s+configurados/i }).first();
    if ((await configLink.count()) === 0) {
      // Dump elementos da row pra debug
      const rowElements = await row.evaluate((tr) =>
        Array.from(tr.querySelectorAll('a, button')).map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? '').trim(),
          href: (el as HTMLAnchorElement).href ?? '',
          onclick: el.getAttribute('onclick') ?? '',
          className: (el as HTMLElement).className,
        })),
      );
      writeFileSync(`${OUT_DIR}/${slug}-01-no-link.json`, JSON.stringify(rowElements, null, 2));
      return { ok: false, error: '"Produtos Configurados" não achado na row · ver -01-no-link.json' };
    }

    // Dump das propriedades do link pra debug
    const linkAttrs = await configLink.evaluate((el) => ({
      href: el.getAttribute('href'),
      target: el.getAttribute('target'),
      onclick: el.getAttribute('onclick'),
      dataAttrs: Object.fromEntries(
        Array.from((el as HTMLElement).attributes).filter((a) => a.name.startsWith('data-')).map((a) => [a.name, a.value]),
      ),
      className: (el as HTMLElement).className,
      outerHTML: (el as HTMLElement).outerHTML.slice(0, 500),
    }));
    writeFileSync(`${OUT_DIR}/${slug}-02a-link.json`, JSON.stringify(linkAttrs, null, 2));
    console.log(`    link attrs: target=${linkAttrs.target} href=${linkAttrs.href?.slice(0, 60)} onclick=${linkAttrs.onclick?.slice(0, 80)}`);

    // Captura URL antes pra detectar navegação
    const urlBefore = page.url();
    const browserCtx = page.context();
    const pagesBefore = browserCtx.pages().length;

    // SEMPRE escuta evento de nova page antes do click. Vendtef pode abrir
    // em nova aba via jQuery handler (target=_blank atribuído programaticamente
    // OU window.open dentro do click handler). Não dá pra detectar pelo atributo
    // estático do link — só dá pra ver depois.
    const newPagePromise = browserCtx
      .waitForEvent('page', { timeout: 6_000 })
      .catch(() => null);

    let targetPage: Page = page;
    if (linkAttrs.href && linkAttrs.href.startsWith('http') && !linkAttrs.href.includes('javascript:')) {
      // Navegação direta via href absoluto
      await page.goto(linkAttrs.href, { waitUntil: 'domcontentloaded' });
    } else {
      await configLink.click({ force: true, timeout: 5_000 });
    }

    // Aguarda nova page abrir OU page atual carregar. Se nova abriu, usa ela.
    const newPage = await newPagePromise;
    if (newPage) {
      targetPage = newPage;
      await targetPage.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
      console.log(`    ✓ aba nova aberta: ${targetPage.url()}`);
    } else {
      // Sem nova aba — checa se context tem mais pages agora (race condition)
      const pagesAfter = browserCtx.pages();
      if (pagesAfter.length > pagesBefore) {
        targetPage = pagesAfter[pagesAfter.length - 1];
        await targetPage.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
        console.log(`    ✓ nova page detectada via context: ${targetPage.url()}`);
      } else {
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
        // Espera mais tempo pra Vendtef carregar conteúdo via AJAX
        await page.waitForTimeout(3_500);
        console.log(`    sem aba nova · continua na page atual (esperou 3.5s extra)`);
      }
    }

    // Dump completo do que tá na página depois do click: HTML, modais, iframes,
    // novos elementos. Vai nos ajudar a entender como Vendtef renderiza Produtos
    // Configurados (modal? iframe? SPA route? AJAX que carrega numa div?)
    const postClickInspect = await targetPage.evaluate(() => {
      const modals = Array.from(document.querySelectorAll('.modal, [role="dialog"], .modal-dialog, .ui-dialog'))
        .filter((m) => (m as HTMLElement).offsetParent !== null)
        .map((m) => ({
          id: (m as HTMLElement).id,
          className: (m as HTMLElement).className.slice(0, 80),
          title: m.querySelector('.modal-title, .ui-dialog-title')?.textContent?.trim() ?? '',
          inputs: m.querySelectorAll('input:not([type="hidden"]), select, textarea').length,
        }));
      const iframes = Array.from(document.querySelectorAll('iframe')).map((f) => ({
        src: (f as HTMLIFrameElement).src,
        id: (f as HTMLElement).id,
        visible: (f as HTMLElement).offsetParent !== null,
      }));
      const tabPanes = Array.from(document.querySelectorAll('.tab-pane.active, [role="tabpanel"]:not([hidden])'))
        .filter((p) => (p as HTMLElement).offsetParent !== null)
        .map((p) => ({
          id: (p as HTMLElement).id,
          className: (p as HTMLElement).className.slice(0, 80),
        }));
      const visibleTables = Array.from(document.querySelectorAll('table'))
        .filter((t) => (t as HTMLElement).offsetParent !== null)
        .map((t) => ({
          id: (t as HTMLElement).id,
          firstHeader: t.querySelector('thead th')?.textContent?.trim().slice(0, 60) ?? '',
          rowCount: t.querySelectorAll('tbody tr').length,
        }));
      return { modals, iframes, tabPanes, visibleTables, bodyClass: document.body.className, h1: document.querySelector('h1')?.textContent?.trim() ?? '' };
    });
    writeFileSync(`${OUT_DIR}/${slug}-02b-post-click.json`, JSON.stringify(postClickInspect, null, 2));
    await targetPage.waitForTimeout(1_500);
    await targetPage.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    // NÃO dismissModals — o modal de "Produtos Configurados" é exatamente onde
    // queremos estar. dismissModals fecharia ele.
    await targetPage.screenshot({ path: `${OUT_DIR}/${slug}-02-produtos-config.png`, fullPage: true });

    // VERIFICA que o modal "Produtos Configurados" abriu (Vendtef não navega,
    // abre Bootstrap modal sobre a lista de estoques).
    const modalCheck = await targetPage.evaluate(() => {
      const modals = Array.from(document.querySelectorAll('.modal, [role="dialog"], .modal-dialog'))
        .filter((m) => (m as HTMLElement).offsetParent !== null);
      for (const m of modals) {
        const title = m.querySelector('.modal-title, .ui-dialog-title, h4')?.textContent?.trim() ?? '';
        if (/produtos\s+configurados/i.test(title)) {
          return { ok: true, title };
        }
      }
      const isModalOpen = document.body.classList.contains('modal-open');
      return { ok: false, isModalOpen, modalCount: modals.length };
    });
    if (!modalCheck.ok) {
      writeFileSync(
        `${OUT_DIR}/${slug}-02-no-modal.json`,
        JSON.stringify({ urlBefore, modalCheck, postClickInspect, linkAttrs }, null, 2),
      );
      return {
        ok: false,
        error: `modal "Produtos Configurados" não abriu após click. Ver -02-no-modal.json`,
      };
    }
    console.log(`    ✓ modal aberto: ${modalCheck.title}`);

    // Daqui em diante, page = targetPage e todas operações são scoped ao modal.
    page = targetPage;
    const modal = page.locator('.modal-dialog').filter({ has: page.locator('.modal-title, h4').filter({ hasText: /produtos\s+configurados/i }) }).first();

    // 3. Pre-check: produto já está na tabela do modal?
    const targetTokens = normalize(productName).split(' ').filter((t) => t.length >= 3).slice(0, 4);
    const existing = await modal.evaluate((modalEl, tokens) => {
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      const rows = Array.from(modalEl.querySelectorAll('table tbody tr'));
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
      // Fecha o modal antes de retornar
      await page.keyboard.press('Escape').catch(() => undefined);
      return { ok: true, alreadyConfigured: true };
    }

    // 4. Clica "Adicionar" DENTRO do modal (não o "+ Adicionar" do header!)
    const addBtn = modal.locator('a, button').filter({ hasText: /adicionar/i }).first();
    if ((await addBtn.count()) === 0) {
      // Dump elementos clicáveis do modal pra debug
      const modalElements = await modal.evaluate((m) =>
        Array.from(m.querySelectorAll('a, button, input[type="submit"], input[type="button"]')).map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? '').trim().slice(0, 60),
          id: (el as HTMLElement).id,
          className: (el as HTMLElement).className.slice(0, 80),
        })),
      );
      writeFileSync(`${OUT_DIR}/${slug}-03-no-add.json`, JSON.stringify(modalElements, null, 2));
      return { ok: false, error: 'botão "Adicionar" não achado no modal · ver -03-no-add.json' };
    }
    await addBtn.click({ force: true });
    await page.waitForTimeout(1_500);
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    await page.screenshot({ path: `${OUT_DIR}/${slug}-03-add-form.png`, fullPage: true });

    // Dump de todos os inputs/buttons na página pós-Adicionar
    const formFields = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea, button'))
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => {
          const e = el as HTMLInputElement;
          return {
            tag: el.tagName.toLowerCase(),
            name: e.name,
            id: e.id,
            type: e.type ?? '',
            value: (e.value ?? '').slice(0, 80),
            placeholder: e.placeholder ?? '',
            text: (el.textContent ?? '').trim().slice(0, 80),
            className: (el as HTMLElement).className.slice(0, 100),
          };
        });
    });
    writeFileSync(`${OUT_DIR}/${slug}-03b-form-fields.json`, JSON.stringify(formFields, null, 2));

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
    let usedSelector = '';
    for (const sel of searchSelectors) {
      const inp = page.locator(sel).first();
      if (await inp.isVisible({ timeout: 500 }).catch(() => false)) {
        await inp.fill(productName);
        searchFilled = true;
        usedSelector = sel;
        break;
      }
    }
    if (!searchFilled) {
      writeFileSync(`${OUT_DIR}/${slug}-04-no-search.txt`, JSON.stringify({ tried: searchSelectors, formFields }, null, 2));
      return { ok: false, error: 'input de palavra-chave não achado · ver -04-no-search.txt' };
    }
    console.log(`    palavra-chave preenchida via selector: ${usedSelector}`);
    await page.waitForTimeout(2_000); // aguarda autocomplete
    await page.screenshot({ path: `${OUT_DIR}/${slug}-04-typed.png`, fullPage: true });

    // Dump TUDO que tá visível agora (autocomplete, dropdowns, etc) pra debug
    const visibleListItems = await page.evaluate(() => {
      const candidateSelectors = [
        'ul.ui-autocomplete li',
        '.autocomplete-suggestion',
        '.select2-results__option',
        '[role="option"]',
        'ul.dropdown-menu li',
        '.tt-suggestion',
        '.typeahead.dropdown-menu li',
        'li.suggestion',
        '.results li',
        '.suggestion-list li',
      ];
      const out: Array<{ selector: string; visible: boolean; text: string; className: string }> = [];
      for (const sel of candidateSelectors) {
        const els = Array.from(document.querySelectorAll(sel));
        for (const el of els.slice(0, 20)) {
          const visible = (el as HTMLElement).offsetParent !== null;
          out.push({
            selector: sel,
            visible,
            text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
            className: (el as HTMLElement).className.slice(0, 80),
          });
        }
      }
      // Também dump select.option (caso seja dropdown nativo)
      const selects = Array.from(document.querySelectorAll('select')).filter((s) => (s as HTMLElement).offsetParent !== null);
      for (const s of selects.slice(0, 3)) {
        const opts = Array.from(s.options).slice(0, 30);
        for (const o of opts) {
          out.push({
            selector: `select#${s.id}.option`,
            visible: true,
            text: (o.textContent ?? '').trim().slice(0, 80),
            className: `value=${o.value}`,
          });
        }
      }
      return out;
    });
    writeFileSync(`${OUT_DIR}/${slug}-04b-list-items.json`, JSON.stringify(visibleListItems, null, 2));

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
