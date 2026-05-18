/**
 * Abastecimento automático Vendtef.
 *
 * Pra cada item {slotPosition, qty}, executa:
 *   1. (Se necessário) cadastra produto novo no ERP
 *   2. (Se necessário) troca a seleção (pid) do slot pra novo produto
 *   3. Lança Operação de Estoque > Abastecimento no estoque "Maquina BlueMall Rondon"
 *
 * Importado pelo CLI `abastecimento.ts` que lê uma Decision e dispara a operação.
 * Pode rodar em CI (GH Actions) ou local.
 *
 * Inputs:
 *   items: lista de { slotPosition, qty, targetProductName?, currentSlotProduct? }
 *     - slotPosition: ex "02", "56"
 *     - qty: unidades a adicionar
 *     - targetProductName: se Weverton trocou de produto (ex Monster Watermelon
 *       no slot 56), nome do produto novo. Se igual ao currentSlotProduct, swap
 *       é pulado.
 *     - currentSlotProduct: o que está cadastrado na seleção HOJE (do banco)
 *
 * Returns por item: { ok, error?, beforeQty?, afterQty? }
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getSecret } from '../../lib/secrets';
import { dismissModals } from '../_shared/playwright';

const OUT_DIR = './tmp/vendtef-abastecimento';
const LOGIN_URL = 'https://www.erpvending.com.br/auth/login/index';
const ERP_HOME = 'https://www.erpvending.com.br/';
const OPERACOES_URL = 'https://www.erpvending.com.br/erp/operacoes-estoque';
const PRODUTOS_URL = 'https://www.erpvending.com.br/produtos';
const MASCARAS_URL = 'https://www.portalvendtef.com.br/mascaras';
const HEADLESS = process.env.HEADLESS !== 'false';
const TARGET_MACHINE = 'Maquina BlueMall Rondon';

export interface AbastecimentoItemInput {
  slotPosition: string;
  qty: number;
  /** Nome do produto que o Weverton colocou. Se diferente do que está cadastrado, força swap. */
  targetProductName?: string;
  /** O que está cadastrado HOJE na seleção (do banco, pra detectar swap). */
  currentSlotProduct?: string | null;
  /** Dados pra cadastrar produto novo no Vendtef (custo, categoria). Se ausente,
   *  scraper usa defaults (custo 0, primeira categoria). */
  newProductData?: {
    cost?: number;
    category?: string;
    supplier?: string;
  };
}

export interface AbastecimentoItemResult {
  slotPosition: string;
  qty: number;
  ok: boolean;
  error?: string;
  productSwapped?: boolean;
  productCreated?: boolean;
  /** PID Vendtef do produto efetivo após swap (se houve) */
  finalPid?: string;
}

export interface AbastecimentoRunResult {
  ok: boolean;
  error?: string;
  items: AbastecimentoItemResult[];
}

/** Login fresh + salva session na ctx atual. */
async function freshLogin(ctx: BrowserContext): Promise<void> {
  const user = await getSecret('ERPVENDING_USER');
  const pass = await getSecret('ERPVENDING_PASS');
  if (!user || !pass) throw new Error('ERPVENDING_USER/PASS ausentes no DB (configure em /settings)');

  const page = await ctx.newPage();
  page.setDefaultTimeout(45_000);
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.screenshot({ path: `${OUT_DIR}/00-login.png`, fullPage: true }).catch(() => undefined);

  await page
    .locator(
      'input[name="login"], input[name="usuario"], input[name="username"], input[name="user"], input[type="text"]:visible',
    )
    .first()
    .fill(user);
  await page.locator('input[type="password"]:visible').first().fill(pass);
  const submit = page
    .locator(
      'button[type="submit"], input[type="submit"], button:has-text("Entrar"), button:has-text("Acessar"), button:has-text("Login")',
    )
    .first();
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined),
    submit.click({ timeout: 15_000 }),
  ]);
  await page.waitForTimeout(2_000);
  if (page.url().includes('/auth/login')) {
    throw new Error(`Login falhou — ainda em ${page.url()}`);
  }
  await page.close();
}

/** SSO no portalvendtef (pra /mascaras). */
async function ssoVendtef(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage();
  try {
    await page.goto(ERP_HOME, { waitUntil: 'domcontentloaded' });
    await dismissModals(page);
    const link = page.locator('a:has-text("VendTEF")').first();
    const href = await link.getAttribute('href');
    if (!href || !href.includes('token/')) {
      throw new Error('link SSO VendTEF não achado no ERP home');
    }
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  } finally {
    await page.close();
  }
}

async function dumpFields(page: Page, label: string): Promise<void> {
  const fields = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea, button'))
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => {
        const e = el as HTMLInputElement;
        return {
          tag: el.tagName.toLowerCase(),
          name: e.name,
          id: e.id,
          type: e.type ?? '',
          value: (e.value ?? '').slice(0, 100),
          placeholder: e.placeholder ?? '',
          text: (el.textContent ?? '').trim().slice(0, 60),
          className: (el as HTMLElement).className.slice(0, 80),
        };
      });
  });
  writeFileSync(`${OUT_DIR}/${label}.json`, JSON.stringify(fields, null, 2));
}

/**
 * Lista produtos da operação Abastecimento (rows da tabela).
 * Cada slot tem position + product + input de qty.
 */
interface AbastSlot {
  position: string;
  productName: string;
  currentQty: number;
  capacity: number;
  inputName: string | null; // name do input qty pra esse slot
}

async function openAbastecimento(page: Page): Promise<AbastSlot[]> {
  await page.goto(OPERACOES_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await dismissModals(page);
  await page.screenshot({ path: `${OUT_DIR}/01-operacoes.png`, fullPage: true });

  // Seleciona estoque = Maquina BlueMall Rondon
  const estoque = page.locator('#estoque');
  const estoqueOpts = await estoque.locator('option').allTextContents();
  const machineIdx = estoqueOpts.findIndex((o) => /bluemall.*rondon/i.test(o));
  if (machineIdx < 0) {
    writeFileSync(`${OUT_DIR}/estoque-options.json`, JSON.stringify(estoqueOpts, null, 2));
    throw new Error(`estoque "${TARGET_MACHINE}" não está na lista (${estoqueOpts.length} opções, ver estoque-options.json)`);
  }
  await estoque.selectOption({ index: machineIdx });
  await page.waitForTimeout(800);

  // Seleciona tipoOperacao = Abastecimento
  const tipoOpt = page.locator('#tipoOperacao');
  const tipoOpts = await tipoOpt.locator('option').allTextContents();
  const abastIdx = tipoOpts.findIndex((o) => /abastec/i.test(o));
  if (abastIdx < 0) {
    writeFileSync(`${OUT_DIR}/tipo-options.json`, JSON.stringify(tipoOpts, null, 2));
    throw new Error(`tipoOperacao "Abastecimento" não está na lista (${tipoOpts.length} opções, ver tipo-options.json)`);
  }
  await tipoOpt.selectOption({ index: abastIdx });
  await page.waitForTimeout(2_500);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.screenshot({ path: `${OUT_DIR}/02-abast-loaded.png`, fullPage: true });
  await dumpFields(page, '02-abast-fields');

  // Espera tabela aparecer — tenta múltiplos seletores
  await page
    .waitForSelector('input.qtdes-lancar, input[class*="qtde"], table tbody tr input[type="text"]:not([class*="filter"])', { timeout: 15_000 })
    .catch(() => undefined);

  // Captura slots: estrutura esperada — tabela com cols posição, produto, qty atual, capacidade, input
  const slots = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('table tbody tr')).filter(
      (r) => (r as HTMLElement).offsetParent !== null,
    );
    return rows
      .map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td'));
        const text = (i: number) => (cells[i]?.textContent ?? '').replace(/\s+/g, ' ').trim();
        // Input dentro da row
        const inp = tr.querySelector<HTMLInputElement>(
          'input.qtdes-lancar, input[class*="qtde"], input[type="text"]:not([class*="filter"])',
        );
        // Heurística: 1ª coluna costuma ser posição (número), 2ª produto
        const position = text(0);
        const productName = text(1);
        // Pode ter colunas de qty atual e capacidade
        const qtyAtual = parseInt(text(2).replace(/\D/g, ''), 10);
        const capacidade = parseInt(text(3).replace(/\D/g, ''), 10);
        return {
          position,
          productName,
          currentQty: Number.isFinite(qtyAtual) ? qtyAtual : 0,
          capacity: Number.isFinite(capacidade) ? capacidade : 0,
          inputName: inp?.name ?? null,
        };
      })
      .filter((s) => s.position && s.inputName);
  });

  writeFileSync(`${OUT_DIR}/02-slots.json`, JSON.stringify(slots, null, 2));
  console.log(`  ✓ Abastecimento aberto, ${slots.length} slots disponíveis`);
  return slots;
}

/**
 * Cadastra produto novo no ERP. Returns ok+vendtefId se conseguiu, ok=false+error se falhou.
 * (Reaproveita lógica de entrada-estoque.ts mas standalone aqui pra evitar coupling.)
 *
 * `newProductData` permite passar custo/categoria reais (Luís preencheu em /decisions).
 * Sem isso, usa defaults: custo 0, primeira categoria do dropdown.
 */
async function cadastrarProduto(
  ctx: BrowserContext,
  productName: string,
  newProductData?: { cost?: number; category?: string },
): Promise<{ ok: boolean; error?: string }> {
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  const slug = productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  try {
    await page.goto(PRODUTOS_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await dismissModals(page);

    // Pre-check duplicate
    const tokens = productName
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter((t) => t.length >= 3)
      .slice(0, 3);
    const searchTerm = tokens.join(' ');
    if (searchTerm) {
      await page.locator('input#nome').first().fill(searchTerm);
      await page.locator('input#pesquisa, input[name="pesquisa"]').first().click().catch(() => undefined);
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(800);
      const productNames = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('table tbody tr')).map((tr) => {
          const cells = tr.querySelectorAll('td');
          return (cells[1]?.textContent ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
        });
      });
      const exists = productNames.some((n) => tokens.every((t) => n.includes(t)));
      if (exists) {
        console.log(`    produto "${productName}" já cadastrado`);
        return { ok: true };
      }
    }

    // Abre form
    const addBtn = page.locator('#addProd');
    if ((await addBtn.count()) === 0) {
      return { ok: false, error: '#addProd não encontrado' };
    }
    await addBtn.click();
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: `${OUT_DIR}/cad-${slug}-form.png`, fullPage: true });

    const nomeField = page.locator('#nome').last();
    if ((await nomeField.count()) === 0) return { ok: false, error: 'campo nome não achado' };
    await nomeField.fill(productName);

    // Custo: usa o que Luís preencheu, senão 0
    const cost = newProductData?.cost ?? 0;
    await page.locator('#preco').fill(cost.toFixed(2).replace('.', ',')).catch(() => undefined);

    // Categoria: usa o que Luís preencheu (match no select), senão primeira válida
    const catOpts = await page.locator('#categoria option').allInnerTexts();
    if (newProductData?.category) {
      const target = newProductData.category.toLowerCase();
      const matchIdx = catOpts.findIndex((t) => t.toLowerCase().includes(target));
      if (matchIdx >= 0) {
        await page.locator('#categoria').selectOption({ index: matchIdx });
      } else {
        // Fallback: primeira categoria válida
        const firstRealCat = catOpts.findIndex((t) => t.trim() && !/selecione|escolha/i.test(t));
        if (firstRealCat > 0) await page.locator('#categoria').selectOption({ index: firstRealCat });
        console.log(`    ⚠ categoria "${newProductData.category}" não bate com nenhuma do Vendtef · usando primeira`);
      }
    } else {
      const firstRealCat = catOpts.findIndex((t) => t.trim() && !/selecione|escolha/i.test(t));
      if (firstRealCat > 0) await page.locator('#categoria').selectOption({ index: firstRealCat });
    }

    await page.locator('#tipo_estoque').selectOption({ label: 'Unidade' }).catch(() => undefined);

    await page.screenshot({ path: `${OUT_DIR}/cad-${slug}-filled.png`, fullPage: true });
    await page.locator('input#save, input[name="save"]').first().click();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);

    const errAlert = await page
      .locator('.alert-danger:visible, .toast-error:visible')
      .first()
      .textContent({ timeout: 500 })
      .catch(() => null);
    if (errAlert && errAlert.trim()) {
      return { ok: false, error: `Vendtef: ${errAlert.slice(0, 200)}` };
    }
    console.log(`    ✓ produto "${productName}" cadastrado`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await page.close();
  }
}

/**
 * Troca o produto (pid) de uma seleção no slot. Acessa via /mascaras → tabela
 * Seleções → Editar Produto. Muda o campo pid.
 */
async function swapSlotProduct(
  ctx: BrowserContext,
  slotPosition: string,
  targetProductName: string,
): Promise<{ ok: boolean; error?: string; newPid?: string }> {
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  try {
    await page.goto(MASCARAS_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await dismissModals(page);

    // Abre modal "Seleções" da máquina
    const row = page.locator(`tr:has-text("${TARGET_MACHINE}")`).first();
    await row.locator('a.aSelecoes').click({ force: true });
    await page.waitForTimeout(1_500);

    // Clica ✏️ da seleção alvo
    const clicked = await page.evaluate((sel) => {
      const modal = document.querySelector('.modal.in, .modal.show');
      if (!modal) return { ok: false, reason: 'modal Seleções fechado' };
      const rows = Array.from(modal.querySelectorAll('tbody tr'));
      const target = rows.find((r) => (r.children[0] as HTMLElement)?.textContent?.trim() === sel);
      if (!target) return { ok: false, reason: `seleção "${sel}" não achada` };
      const link = target.querySelector('a.edit-selecao') as HTMLAnchorElement | null;
      if (!link) return { ok: false, reason: 'a.edit-selecao não achado' };
      link.click();
      return { ok: true };
    }, slotPosition);
    if (!clicked.ok) return { ok: false, error: clicked.reason };

    await page.waitForFunction(
      () => {
        const all = Array.from(document.querySelectorAll('.modal.in, .modal.show'));
        return all.some((m) => m.querySelector('.modal-title')?.textContent?.includes('Editar Produto'));
      },
      { timeout: 10_000 },
    );

    // Acha select de produto (pid) e seleciona pelo label que bate
    const swapResult = await page.evaluate((targetName) => {
      const modals = Array.from(document.querySelectorAll('.modal.in, .modal.show'));
      const editModal = modals.find((m) => m.querySelector('.modal-title')?.textContent?.includes('Editar Produto'));
      if (!editModal) return { ok: false, reason: 'modal Editar Produto não achado' };
      const pidSelect = editModal.querySelector<HTMLSelectElement>('[name="pid"]');
      if (!pidSelect) return { ok: false, reason: 'campo pid não achado' };
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      const t = norm(targetName);
      const tokens = t.split(' ').filter((w) => w.length >= 3);
      const opts = Array.from(pidSelect.options);
      // Match: todos os tokens significativos da target aparecem no label da option
      const best = opts.find((o) => {
        const n = norm(o.textContent ?? '');
        return tokens.length > 0 && tokens.every((tok) => n.includes(tok));
      });
      if (!best) {
        return {
          ok: false,
          reason: `produto "${targetName}" não bate com nenhuma option do select pid`,
          sampleOptions: opts.slice(0, 20).map((o) => o.textContent?.trim()),
        };
      }
      pidSelect.value = best.value;
      pidSelect.dispatchEvent(new Event('input', { bubbles: true }));
      pidSelect.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, newPid: best.value, newLabel: best.textContent?.trim() };
    }, targetProductName);

    if (!swapResult.ok) {
      writeFileSync(
        `${OUT_DIR}/swap-${slotPosition}-fail.json`,
        JSON.stringify(swapResult, null, 2),
      );
      return { ok: false, error: swapResult.reason };
    }
    await page.screenshot({ path: `${OUT_DIR}/swap-${slotPosition}-set.png`, fullPage: true });

    // Submit do modal — botão "Editar"
    const submitInfo = await page.evaluate(() => {
      const modals = Array.from(document.querySelectorAll('.modal.in, .modal.show'));
      const top = modals[modals.length - 1] as HTMLElement | undefined;
      if (!top) return { ok: false };
      const cands = Array.from(top.querySelectorAll<HTMLElement>('button, input[type="submit"], input[type="button"]')).filter((b) => {
        const visible = b.offsetParent !== null && b.getBoundingClientRect().width > 0;
        if (!visible) return false;
        const text = (b.tagName === 'INPUT' ? (b as HTMLInputElement).value : (b.textContent ?? '')).trim();
        return /^Editar$/i.test(text);
      });
      if (cands.length === 0) return { ok: false };
      const primary = cands.find((c) => c.className.includes('btn-primary')) ?? cands[0];
      primary.click();
      return { ok: true };
    });
    if (!submitInfo.ok) {
      await page.evaluate(() => {
        const top = Array.from(document.querySelectorAll('.modal.in, .modal.show')).pop() as HTMLElement | undefined;
        top?.querySelector('form')?.requestSubmit();
      });
    }
    await page.waitForTimeout(3_500);
    await page.screenshot({ path: `${OUT_DIR}/swap-${slotPosition}-after.png`, fullPage: true });

    return { ok: true, newPid: swapResult.newPid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await page.close();
  }
}

/**
 * Confirma operação de estoque no modal de confirmação Vendtef.
 * Returns ok se sucesso, error com texto se Vendtef recusou.
 */
async function confirmAndCheckSuccess(page: Page): Promise<{ ok: boolean; error?: string }> {
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: `${OUT_DIR}/04-modal-confirm.png`, fullPage: true });

  const confirmBtn = page
    .locator(
      '.modal:visible button:has-text("Confirmar"), [role="dialog"]:visible button:has-text("Confirmar"), button.btn-primary:has-text("Confirmar")',
    )
    .first();
  if ((await confirmBtn.count()) === 0) {
    return { ok: false, error: 'modal Confirmar não apareceu' };
  }
  await confirmBtn.click({ force: true });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: `${OUT_DIR}/05-after-confirm.png`, fullPage: true });

  const successText = await page
    .locator('.modal:visible, [role="dialog"]:visible')
    .first()
    .textContent({ timeout: 2_000 })
    .catch(() => '');
  const txt = successText ?? '';
  const hasError = /erro|falhou|invalida|invál/i.test(txt);
  const hasSuccess = /sucesso|configurada e iniciada|conclu[ií]da|realizada/i.test(txt);
  if (hasError) return { ok: false, error: `Vendtef: ${txt.slice(0, 200)}` };
  if (!hasSuccess) return { ok: false, error: `status ambíguo: ${txt.slice(0, 200)}` };

  await page
    .locator('.modal:visible button:has-text("Fechar"), [role="dialog"]:visible button:has-text("Fechar")')
    .first()
    .click({ force: true, timeout: 3_000 })
    .catch(() => undefined);
  return { ok: true };
}

/**
 * Entry point. Executa abastecimento pra lista de items.
 *
 * Estratégia em duas passadas:
 *  1. Pass 1: pre-resolve produtos. Pra cada item com targetProductName diferente
 *     do currentSlotProduct → cadastrarProduto se não existe + swapSlotProduct.
 *  2. Pass 2: abrir Abastecimento, preencher qty pra cada slot, submit, confirmar.
 */
export async function runAbastecimento(items: AbastecimentoItemInput[]): Promise<AbastecimentoRunResult> {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/.touch`, new Date().toISOString());
  writeFileSync(`${OUT_DIR}/input.json`, JSON.stringify(items, null, 2));

  const results: AbastecimentoItemResult[] = items.map((it) => ({
    slotPosition: it.slotPosition,
    qty: it.qty,
    ok: false,
  }));

  const browser: Browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' });
  await ctx.addInitScript(() => {
    // @ts-expect-error global pro page.evaluate
    if (typeof window.__name === 'undefined') window.__name = (fn) => fn;
  });

  try {
    console.log('→ login ERP…');
    await freshLogin(ctx);
    console.log('✓ logado');

    // === PASS 1: product swaps ===
    const swapTargets = items
      .map((it, idx) => ({ it, idx }))
      .filter(
        ({ it }) =>
          it.targetProductName &&
          it.currentSlotProduct &&
          normalize(it.targetProductName) !== normalize(it.currentSlotProduct),
      );

    if (swapTargets.length > 0) {
      console.log(`→ ${swapTargets.length} swap(s) de produto necessário(s)`);
      // SSO no portal pra acessar /mascaras
      await ssoVendtef(ctx);
      for (const { it, idx } of swapTargets) {
        const target = it.targetProductName!;
        console.log(`  · slot ${it.slotPosition}: "${it.currentSlotProduct}" → "${target}"`);
        // Cadastra antes (se já existe, retorna ok). Passa custo/categoria se Luís preencheu.
        const cad = await cadastrarProduto(ctx, target, it.newProductData);
        if (!cad.ok) {
          results[idx] = {
            ...results[idx],
            error: `cadastro falhou: ${cad.error}`,
            productCreated: false,
          };
          continue;
        }
        results[idx].productCreated = true;
        // Re-faz SSO caso navegação pra /produtos tenha invalidado contexto
        await ssoVendtef(ctx).catch(() => undefined);
        const sw = await swapSlotProduct(ctx, it.slotPosition, target);
        if (!sw.ok) {
          results[idx] = { ...results[idx], error: `swap falhou: ${sw.error}` };
          continue;
        }
        results[idx].productSwapped = true;
        results[idx].finalPid = sw.newPid;
      }
    }

    // === PASS 2: abastecimento ===
    const page = await ctx.newPage();
    page.setDefaultTimeout(30_000);
    try {
      await page.goto(ERP_HOME, { waitUntil: 'domcontentloaded' });
      if (page.url().includes('/auth/login')) throw new Error('sessão perdeu');
      await dismissModals(page);

      const slots = await openAbastecimento(page);

      // Mapeia position → slot Vendtef
      const slotByPos = new Map<string, AbastSlot>();
      for (const s of slots) {
        // normaliza: "02" === "(02)" === "2"
        slotByPos.set(s.position.replace(/[^\d]/g, '').padStart(2, '0'), s);
      }

      let filled = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        // Pula se já falhou no swap
        if (results[i].error) continue;
        const key = it.slotPosition.replace(/[^\d]/g, '').padStart(2, '0');
        const slot = slotByPos.get(key);
        if (!slot || !slot.inputName) {
          results[i] = { ...results[i], error: `slot ${it.slotPosition} não achado no Abastecimento Vendtef` };
          continue;
        }
        await page.locator(`input[name="${slot.inputName}"]`).fill(String(it.qty));
        filled++;
      }
      await page.screenshot({ path: `${OUT_DIR}/03-filled.png`, fullPage: true });
      console.log(`  ✓ ${filled} input(s) preenchido(s)`);

      if (filled === 0) {
        return { ok: false, error: 'nenhum slot pôde ser preenchido', items: results };
      }

      // Submit
      await page.locator('input[name="save"], button:has-text("Salvar")').first().click();
      const conf = await confirmAndCheckSuccess(page);
      if (!conf.ok) {
        // Marca todos os items que iam ser preenchidos como falhos
        for (let i = 0; i < items.length; i++) {
          if (!results[i].error) results[i].error = conf.error;
        }
        return { ok: false, error: conf.error, items: results };
      }

      // Sucesso → marca items preenchidos como ok
      for (let i = 0; i < items.length; i++) {
        if (!results[i].error) {
          results[i].ok = true;
        }
      }
    } finally {
      await page.close();
    }

    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    return {
      ok: okCount > 0 && failCount === 0,
      error: failCount > 0 ? `${failCount}/${results.length} item(ns) falharam` : undefined,
      items: results,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, items: results };
  } finally {
    await ctx.close();
    await browser.close();
  }
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
