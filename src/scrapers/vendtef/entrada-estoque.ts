/**
 * Sincroniza uma Purchase do Neon → Vendtef.
 *
 * Para cada item da compra:
 *   1. Garante que o Sku tem código que existe no Vendtef. Se code começa com
 *      "NFE-" (criado pelo confirm sem match), TODO: cadastrar produto.
 *   2. Lança uma "Operação de Estoque > Entrada" no Estoque Everest com todos
 *      os itens (qty + custo unit).
 *
 * Uso:
 *   PURCHASE_ID=cmp... npm run vendtef:entrada
 *   ou: npx tsx src/scrapers/vendtef/entrada-estoque.ts <purchaseId>
 *   ou: ALL_PENDING=1 npm run vendtef:entrada  (varre todas não sincronizadas)
 *
 * Em GH Actions: setado via env do workflow.
 */

import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { prisma } from '../../lib/db';
import { getSecret } from '../../lib/secrets';
import { dismissModals } from '../_shared/playwright';
import { runWithWorkerLog } from '../../lib/infra/health';
import { configurarProdutoNoEstoque } from './configurar-estoque';

const OUT_DIR = './tmp/vendtef-entrada';
const ERP_HOME = 'https://www.erpvending.com.br/';
const LOGIN_URL = 'https://www.erpvending.com.br/auth/login/index';
const OPERACOES_URL = 'https://www.erpvending.com.br/erp/operacoes-estoque';
const PRODUTOS_URL = 'https://www.erpvending.com.br/produtos';
const HEADLESS = process.env.HEADLESS !== 'false';

async function freshLogin(ctx: BrowserContext) {
  const user = await getSecret('ERPVENDING_USER');
  const pass = await getSecret('ERPVENDING_PASS');
  if (!user || !pass) throw new Error('ERPVENDING_USER/PASS ausentes no DB');

  const page = await ctx.newPage();
  page.setDefaultTimeout(45_000);
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.screenshot({ path: `${OUT_DIR}/00-login-page.png`, fullPage: true }).catch(() => undefined);

  await page
    .locator('input[name="login"], input[name="usuario"], input[name="username"], input[name="user"], input[type="text"]:visible')
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
  await page.screenshot({ path: `${OUT_DIR}/00-post-login.png`, fullPage: true }).catch(() => undefined);
  if (page.url().includes('/auth/login')) {
    throw new Error(`Login falhou — ainda em ${page.url()}`);
  }
  await page.close();
}

interface SyncResult {
  ok: boolean;
  error?: string;
  warning?: string;
}

interface PurchaseSnap {
  id: string;
  supplierName: string | null;
  invoiceRef: string | null;
  occurredAt: Date;
  totalAmount: number;
  /**
   * productName aqui é o NOME LIMPO do nosso catálogo SKU — aquele que Luís
   * confirmou (ou criou) na UI /bruno/nova. NÃO é o nome cru da NF-e.
   * Pra audit/log também guardamos rawNfeName.
   *
   * Bug histórico (Coca Cola REF.LATA.SLEEK...): scraper usava productName=
   * nome cru NF-e que confunde matcher mesmo com noise filter. Agora usa
   * o nome do catálogo (Coca Cola 310ml) que bate idêntico ou quase com
   * o que tá no Vendtef.
   */
  items: {
    code: string;
    productName: string; // nome limpo do nosso SKU (catálogo)
    rawNfeName: string; // string crua da NF-e — só pra debug/auditoria
    qty: number;
    unitCost: number;
    needsCadastro: boolean;
  }[];
}

async function loadPurchase(purchaseId: string): Promise<PurchaseSnap> {
  const p = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    include: { itens: { include: { sku: true } } },
  });
  if (!p) throw new Error(`Purchase ${purchaseId} não existe`);
  return {
    id: p.id,
    supplierName: p.supplierName,
    invoiceRef: p.invoiceRef,
    occurredAt: p.occurredAt,
    totalAmount: Number(p.totalAmount),
    items: p.itens
      .filter((it) => it.sku)
      .map((it) => ({
        code: it.sku!.code,
        productName: it.sku!.name, // ← clean catalog name, não o raw NF-e
        rawNfeName: it.productName,
        qty: it.qty,
        unitCost: Number(it.unitCost),
        // Códigos provisórios (sem match real) começam com NFE-. Aí precisa cadastrar produto antes.
        needsCadastro: it.sku!.code.startsWith('NFE-'),
      })),
  };
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

/// Palavras-ruído da NF-e (Atacadão, Assaí) — não ajudam a discriminar.
/// Mantido em sync com src/lib/sku-match.ts e src/lib/vendetti/nfe-parse.ts.
const NOISE_TOKENS = new Set([
  'ref', 'lata', 'sleek', 'und', 'un', 'unid', 'unidade',
  'emb', 'embal', 'embalagem',
  'gar', 'garrafa', 'pet', 'pack',
  'cxa', 'cx', 'caixa', 'fardo',
  'br', 'nacional', 'naci', 'imp',
  '1x1', '6x1', '12x1', '24x1',
  'nfe', 'sa', 'sgl',
]);

// Tokens que distinguem variantes de produto. Se aparecem só de um lado, é falso match.
const DISCRIMINATING = [
  'zero', 'diet', 'light', 'sem',
  'frutas vermelhas', 'frutas vermelha',
  'mountain blast',
  'watermelon', 'amora', 'morango', 'baunilha', 'limao',
  'tropical', 'pipeline', 'mango', 'maracuja',
  'ultra',
];

function meaningfulTokens(name: string): Set<string> {
  return new Set(
    normalize(name)
      .split(' ')
      .filter((t) => t.length >= 2)
      .filter((t) => !NOISE_TOKENS.has(t)),
  );
}

/**
 * Similaridade entre nome A (NF-e, com ruído) e B (Vendtef catalog).
 * Mesmo algoritmo unificado em sku-match.ts e nfe-parse.ts:
 *   - filter NOISE_TOKENS
 *   - DISCRIMINATORS: conflito → score 0
 *   - F1 = 2*P*R / (P+R)
 */
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  // Anti-correlação carbonatação: "sem gas" vs "c gas"
  const aSemGas = /\b(sem gas|s g|sg)\b/.test(na);
  const bSemGas = /\b(sem gas|s g|sg)\b/.test(nb);
  const aComGas = /\b(c gas|c g|com gas)\b/.test(na);
  const bComGas = /\b(c gas|c g|com gas)\b/.test(nb);
  if ((aSemGas && bComGas) || (aComGas && bSemGas)) return 0;

  // Discriminating tokens: presença unilateral derruba score
  for (const tok of DISCRIMINATING) {
    if (na.includes(tok) !== nb.includes(tok)) return 0;
  }

  const ta = meaningfulTokens(a);
  const tb = meaningfulTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  if (shared === 0) return 0;

  // F1 score: penaliza catálogo genérico vs target específico (e vice-versa)
  const precision = shared / ta.size;
  const recall = shared / tb.size;
  const f1 = (2 * precision * recall) / (precision + recall);
  return Math.round(f1 * 100);
}

function bestMatch<T extends { name: string }>(target: string, rows: T[]): { row: T; score: number } | null {
  let best: { row: T; score: number } | null = null;
  for (const r of rows) {
    const score = similarity(target, r.name);
    if (!best || score > best.score) best = { row: r, score };
  }
  return best;
}

async function dumpFormFields(page: Page, label: string) {
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
  writeFileSync(`${OUT_DIR}/${label}-fields.json`, JSON.stringify(fields, null, 2));
  console.log(`  dump: ${OUT_DIR}/${label}-fields.json (${fields.length} elementos)`);
}

interface CadastroResult {
  ok: boolean;
  vendtefId?: string;
  error?: string;
}

/**
 * Cadastra um produto novo no Vendtef. Tira screenshots e dump de fields em
 * cada etapa pra auditoria. Defaults: categoria primeira disponível,
 * unidade "Unidade", preço 0 (Luís define depois).
 */
async function cadastrarProduto(ctx: BrowserContext, productName: string, unitCost: number, productCode?: string | null): Promise<CadastroResult> {
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  const slug = productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  try {
    await page.goto(PRODUTOS_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await dismissModals(page);

    // Pre-check: produto já existe? Filtra pelo nome no topo, conta linhas
    // Pega primeiros 3 tokens significativos pra pesquisa (evita match falso)
    const nomeNorm = productName.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const tokens = nomeNorm.split(' ').filter((t) => t.length >= 3).slice(0, 3);
    const searchTerm = tokens.join(' ');
    if (searchTerm) {
      await page.locator('input#nome').first().fill(searchTerm);
      await page.locator('input#pesquisa, input[name="pesquisa"]').first().click();
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(800);
      // Compara só com a coluna do NOME (2ª col na tabela de produtos)
      const productNames = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('table tbody tr')).map((tr) => {
          const cells = tr.querySelectorAll('td');
          return (cells[1]?.textContent ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
        });
      });
      const exists = productNames.some((n) => tokens.every((t) => n.includes(t)));
      if (exists) {
        return { ok: true, error: 'já cadastrado' };
      }
    }

    await page.screenshot({ path: `${OUT_DIR}/cad-${slug}-01-lista.png`, fullPage: true });

    // Botão #addProd abre o form de cadastro
    const addBtn = page.locator('#addProd');
    if (await addBtn.count() === 0) {
      return { ok: false, error: '#addProd não existe — UI do Vendtef mudou?' };
    }
    await addBtn.click();
    await page.waitForTimeout(1_500);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await page.screenshot({ path: `${OUT_DIR}/cad-${slug}-02-form.png`, fullPage: true });
    await dumpFormFields(page, `cad-${slug}-02-form`);

    // Nome (id=nome) — usar .last() pra pegar o do form, não o filtro do topo
    const nomeField = page.locator('#nome').last();
    if (await nomeField.count() === 0) {
      return { ok: false, error: 'campo nome não encontrado no form de cadastro' };
    }
    await nomeField.fill(productName);

    // Custo: #preco (Vendtef nomeou assim — "preco" é CUSTO do produto)
    await page.locator('#preco').fill(unitCost.toFixed(2).replace('.', ','));

    // NÃO preencher #valor_venda — esse campo é da seção "Dados Fiscais (Opcional)"
    // que exige TODOS os 5 campos (CFOP, NCM, cProd, xProd, valor_venda) preenchidos
    // ou TODOS vazios. Como não temos esses dados fiscais, deixa vazio.

    // Categoria: escolhe primeira opção real (Bebidas Frias, p.ex.)
    const catOpts = await page.locator('#categoria option').allInnerTexts();
    const firstRealCat = catOpts.findIndex((t) => t.trim() && !/selecione|escolha/i.test(t));
    if (firstRealCat > 0) await page.locator('#categoria').selectOption({ index: firstRealCat });

    // Tipo de Estoque: Unidade (default)
    await page.locator('#tipo_estoque').selectOption({ label: 'Unidade' }).catch(() => undefined);

    await page.screenshot({ path: `${OUT_DIR}/cad-${slug}-03-filled.png`, fullPage: true });

    // Submit
    await page.locator('input#save, input[name="save"]').first().click();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: `${OUT_DIR}/cad-${slug}-04-saved.png`, fullPage: true });

    // Sucesso: botão #save sumiu (saiu do form). #addProd visível = voltou pra lista.
    const stillInForm = await page.locator('input#save:visible').count() > 0;
    const errAlert = await page.locator('.alert-danger:visible, .toast-error:visible').first().textContent({ timeout: 500 }).catch(() => null);
    if (errAlert && errAlert.trim()) {
      return { ok: false, error: `Vendtef erro: ${errAlert.slice(0, 200)}` };
    }
    if (stillInForm) {
      return { ok: false, error: 'ainda no form após salvar — verificar 04-saved.png' };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await page.screenshot({ path: `${OUT_DIR}/cad-${slug}-error.png`, fullPage: true }).catch(() => undefined);
    return { ok: false, error: msg };
  } finally {
    await page.close();
  }
}

async function syncOne(ctx: BrowserContext, purchase: PurchaseSnap): Promise<SyncResult> {
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  try {
    // Garante home autenticada
    await page.goto(ERP_HOME, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('/auth/login')) {
      throw new Error('Sessão perdeu durante navegação');
    }
    await dismissModals(page);

    interface ProductRow { pid: string; name: string }
    interface MatchedRow { pid: string; vendtefName: string; ourName: string; qty: number; score: number }
    interface UnmatchedRow { ourName: string; qty: number; bestScore: number; bestVendtefName: string; reason: string }

    const MIN_SCORE = 60;

    const doMatch = (items: typeof purchase.items, products: ProductRow[]): { matched: MatchedRow[]; unmatched: UnmatchedRow[] } => {
      const candidates = items.map((it) => {
        const best = bestMatch(it.productName, products);
        return {
          ourName: it.productName,
          qty: it.qty,
          bestPid: best?.row.pid ?? '',
          bestVendtefName: best?.row.name ?? '—',
          bestScore: best?.score ?? 0,
        };
      });
      const claimCount = new Map<string, number>();
      for (const c of candidates) {
        if (c.bestScore >= MIN_SCORE && c.bestPid) claimCount.set(c.bestPid, (claimCount.get(c.bestPid) ?? 0) + 1);
      }
      const matched: MatchedRow[] = [];
      const unmatched: UnmatchedRow[] = [];
      for (const c of candidates) {
        if (c.bestScore < MIN_SCORE || !c.bestPid) {
          unmatched.push({ ourName: c.ourName, qty: c.qty, bestScore: c.bestScore, bestVendtefName: c.bestVendtefName, reason: 'score baixo' });
        } else if ((claimCount.get(c.bestPid) ?? 0) > 1) {
          unmatched.push({ ourName: c.ourName, qty: c.qty, bestScore: c.bestScore, bestVendtefName: c.bestVendtefName, reason: `colisão pid=${c.bestPid}` });
        } else {
          matched.push({ pid: c.bestPid, vendtefName: c.bestVendtefName, ourName: c.ourName, qty: c.qty, score: c.bestScore });
        }
      }
      return { matched, unmatched };
    };

    const openEntradaAndCaptureProducts = async (label: string): Promise<ProductRow[]> => {
      await page.goto(OPERACOES_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      await dismissModals(page);
      const estoque = page.locator('#estoque');
      const estoqueOpts = await estoque.locator('option').allTextContents();
      const everestIdx = estoqueOpts.findIndex((o) => /everest/i.test(o));
      if (everestIdx < 0) throw new Error('"Estoque Everest" não está na lista');
      await estoque.selectOption({ index: everestIdx });
      await page.waitForTimeout(500);
      await page.locator('#tipoOperacao').selectOption({ label: 'Entrada de Estoque' });
      await page.waitForTimeout(2_500);
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      await page.waitForSelector('input.qtdes-lancar', { timeout: 15_000 });
      await page.screenshot({ path: `${OUT_DIR}/${label}.png`, fullPage: true });
      return await page.evaluate(() => {
        return Array.from(document.querySelectorAll<HTMLInputElement>('input.qtdes-lancar')).map((inp) => {
          const tr = inp.closest('tr');
          const nameCell = tr?.querySelector('td');
          return {
            pid: inp.name,
            name: (nameCell?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          };
        });
      });
    };

    if (purchase.items.length === 0) {
      return { ok: false, error: 'nenhum item válido (todos sem skuId)' };
    }

    // === Pass 1: tenta entrada com produtos existentes ===
    let products = await openEntradaAndCaptureProducts('02-after-tipo');
    console.log(`  pass1: ${products.length} produtos disponíveis`);

    let { matched, unmatched } = doMatch(purchase.items, products);
    console.log(`  pass1: ${matched.length} matched, ${unmatched.length} unmatched`);

    // 🤖 Audit pra Zelda: cada unmatched do pass 1 é uma falha do matcher.
    // Grava como match_correction event pra ela aprender o padrão depois.
    // Context = 'scraper-vendtef-entrada' distingue dos da UI Bruno.
    // inputText = nome do nosso catálogo (Coca Cola 310ml) que Luís confirmou,
    // não o raw NF-e — pq esse é o que o matcher REALMENTE consumiu.
    for (const u of unmatched) {
      const purchaseItem = purchase.items.find((it) => it.productName === u.ourName);
      await prisma.workerRun.create({
        data: {
          name: 'match_correction',
          status: 'OK',
          finishedAt: new Date(),
          meta: {
            context: 'scraper-vendtef-entrada',
            purchaseId: purchase.id,
            inputText: u.ourName, // nome limpo do SKU
            rawNfeName: purchaseItem?.rawNfeName ?? null, // pro Zelda saber a origem
            suggestedSkuName: u.bestVendtefName !== '—' ? u.bestVendtefName : null,
            suggestedScore: u.bestScore,
            suggestedSkuId: null, // matcher comparou só por nome no Vendtef
            actualSkuId: null,
            finalAction: 'new', // Bruno vai tentar cadastrar
            correctionType: u.bestScore > 0
              ? 'matcher_missed_in_vendtef_low_score' // tinha candidato mas score < MIN_SCORE
              : 'matcher_missed_in_vendtef_no_candidate', // nenhum candidato razoável
            qty: u.qty,
          } as never,
        },
      }).catch((e) => console.warn('[match_correction scraper]', e instanceof Error ? e.message : e));
    }

    // === Pass 2: cadastra unmatched, refaz entrada ===
    const cadastros: { ourName: string; result: CadastroResult }[] = [];
    if (unmatched.length > 0) {
      console.log(`  → tentando cadastrar ${unmatched.length} produtos faltantes…`);
      for (const u of unmatched) {
        const item = purchase.items.find((it) => it.productName === u.ourName);
        const unitCost = item?.unitCost ?? 0;
        const productCode = item?.code && !item.code.startsWith('NFE-') ? item.code : undefined;
        const r = await cadastrarProduto(ctx, u.ourName, unitCost, productCode);
        cadastros.push({ ourName: u.ourName, result: r });
        console.log(`    ${r.ok ? '✓' : '✗'} ${u.ourName}${r.error ? ` — ${r.error.slice(0, 80)}` : ''}`);
        // CRÍTICO: depois de cadastrar, precisa configurar no estoque Everest
        // pra ele aparecer na lista de Entrada de Estoque. Senão produto fica
        // órfão e a entrada vai falhar (não acha o pid).
        if (r.ok) {
          const cfg = await configurarProdutoNoEstoque(ctx, 'Estoque Everest', u.ourName, {
            estoqueMaximo: 100,
            alerta: 2,
            critico: 1,
          });
          console.log(`    ${cfg.ok ? '✓' : '✗'} config-estoque "${u.ourName}"${cfg.alreadyConfigured ? ' (já configurado)' : ''}${cfg.error ? ` — ${cfg.error.slice(0, 80)}` : ''}`);
          if (!cfg.ok) {
            cadastros[cadastros.length - 1].result = { ok: false, error: `cadastrou mas falhou config-estoque: ${cfg.error}` };
          }
        }
      }
      writeFileSync(`${OUT_DIR}/cadastros.json`, JSON.stringify(cadastros, null, 2));

      // Reabre entrada pra ver os novos
      products = await openEntradaAndCaptureProducts('06-after-cadastros');
      console.log(`  pass2: ${products.length} produtos disponíveis (era ${products.length - cadastros.filter((c) => c.result.ok).length} antes)`);
      const remat = doMatch(purchase.items, products);
      matched = remat.matched;
      unmatched = remat.unmatched;
      console.log(`  pass2: ${matched.length} matched, ${unmatched.length} unmatched`);
    }

    writeFileSync(`${OUT_DIR}/products-map.json`, JSON.stringify(products, null, 2));
    writeFileSync(`${OUT_DIR}/match-result.json`, JSON.stringify({ matched, unmatched }, null, 2));
    for (const m of matched) console.log(`    ✓ ${m.qty}× "${m.ourName}" → ${m.pid} "${m.vendtefName}" (${m.score}%)`);
    for (const u of unmatched) console.log(`    ✗ "${u.ourName}" — ${u.reason} (best: ${u.bestScore}% "${u.bestVendtefName}")`);

    if (matched.length === 0) {
      return { ok: false, error: `nenhum item bate com Vendtef (${unmatched.length} unmatched, ${cadastros.filter((c) => !c.result.ok).length} falha no cadastro)` };
    }

    // Preenche qtdes
    for (const m of matched) {
      await page.locator(`input[name="${m.pid}"]`).fill(String(m.qty));
    }
    await page.screenshot({ path: `${OUT_DIR}/03-filled.png`, fullPage: true });

    // Salva → abre modal de confirmação
    await page.locator('input[name="save"], button:has-text("Salvar")').first().click();
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: `${OUT_DIR}/04-modal-confirm.png`, fullPage: true });

    // Confirma no modal
    const confirmBtn = page.locator('.modal:visible button:has-text("Confirmar"), [role="dialog"]:visible button:has-text("Confirmar"), button.btn-primary:has-text("Confirmar")').first();
    if (await confirmBtn.count() === 0) {
      return { ok: false, error: 'modal de confirmação não apareceu — submit pode ter falhado' };
    }
    await confirmBtn.click({ force: true });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: `${OUT_DIR}/05-after-confirm.png`, fullPage: true });

    // Verifica mensagem de sucesso/erro no modal final
    const successText = await page
      .locator('.modal:visible, [role="dialog"]:visible')
      .first()
      .textContent({ timeout: 2_000 })
      .catch(() => '');
    const hasSuccess = /sucesso|configurada e iniciada|conclu[ií]da/i.test(successText ?? '');
    const hasError = /erro|falhou|invalida/i.test(successText ?? '');

    if (hasError) {
      return { ok: false, error: `Vendtef: ${(successText ?? '').slice(0, 200)}` };
    }
    if (!hasSuccess) {
      return { ok: false, error: `confirm: status ambíguo — ${(successText ?? '').slice(0, 200)}` };
    }

    // Fecha o modal de sucesso (não-blocking)
    await page
      .locator('.modal:visible button:has-text("Fechar"), [role="dialog"]:visible button:has-text("Fechar")')
      .first()
      .click({ force: true, timeout: 3_000 })
      .catch(() => undefined);

    if (unmatched.length > 0) {
      return {
        ok: true,
        warning: `${matched.length} ok, ${unmatched.length} sem match no Vendtef (cadastrar produto): ${unmatched.map((u) => u.ourName).join(', ').slice(0, 200)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await page.screenshot({ path: `${OUT_DIR}/error.png`, fullPage: true }).catch(() => undefined);
    return { ok: false, error: msg };
  } finally {
    await page.close();
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // Garante que screenshots existem mesmo se login falhar, pra subir como artifact
  writeFileSync(`${OUT_DIR}/.touch`, new Date().toISOString());

  // Coleta IDs alvo
  const fromArgv = process.argv[2];
  const fromEnv = process.env.PURCHASE_ID;
  const all = process.env.ALL_PENDING === '1';
  let purchaseIds: string[] = [];

  if (fromArgv) {
    purchaseIds = [fromArgv];
  } else if (fromEnv) {
    purchaseIds = [fromEnv];
  } else if (all) {
    const pending = await prisma.purchase.findMany({
      where: { vendtefSyncedAt: null, vendtefSyncAttempts: { lt: 5 } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    purchaseIds = pending.map((p) => p.id);
    console.log(`→ ${purchaseIds.length} purchases pendentes`);
  } else {
    console.error('Uso: PURCHASE_ID=<id> npm run vendtef:entrada  OU  ALL_PENDING=1 ...');
    process.exit(1);
  }

  if (purchaseIds.length === 0) {
    console.log('✓ nada pra sincronizar');
    return;
  }

  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: 'pt-BR',
  });
  await ctx.addInitScript(() => {
    // @ts-expect-error globals pro page.evaluate
    if (typeof window.__name === 'undefined') window.__name = (fn) => fn;
  });

  try {
    console.log('→ login Vendtef…');
    await freshLogin(ctx);
    console.log('✓ logado');

    for (const id of purchaseIds) {
      console.log(`\n=== sync ${id} ===`);
      const purchase = await loadPurchase(id).catch((e) => {
        console.error(`  ✗ load falhou: ${(e as Error).message}`);
        return null;
      });
      if (!purchase) continue;

      const result = await syncOne(ctx, purchase);
      await prisma.purchase.update({
        where: { id },
        data: {
          vendtefSyncedAt: result.ok ? new Date() : null,
          // Em sucesso com warning, mantém a nota no campo de erro (UI distingue
          // sucesso parcial via badge condicional)
          vendtefSyncError: result.ok ? result.warning ?? null : result.error ?? null,
          vendtefSyncAttempts: { increment: 1 },
        },
      });
      if (result.ok) console.log(`  ✓ ${id}${result.warning ? ` (warning: ${result.warning})` : ''}`);
      else console.log(`  ✗ ${id}: ${result.error}`);
    }
  } finally {
    await ctx.close();
    await browser.close();
  }

  // 🤖 Trigger Zelda no fim do scraper. Match_correction events foram gravados
  // ao longo da execução; agora pedimos análise incremental + notify.
  // Faz HTTP call pro endpoint pra rodar no Vercel (scraper está no GH Actions
  // sem acesso ao ANTHROPIC_API_KEY local). Auth via x-service-key (CRON_SECRET)
  // pra passar pelo middleware de session.
  const baseUrl = process.env.APP_URL ?? 'https://vendetti.everest.udi.br';
  const cronSecret = await getSecret('CRON_SECRET');
  if (!cronSecret) {
    console.warn('→ CRON_SECRET ausente · skip Zelda audit (configure em /settings)');
  } else {
    try {
      const res = await fetch(`${baseUrl}/api/zelda/audit-matcher?incremental=1`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-service-key': cronSecret,
        },
      });
      const text = await res.text();
      if (res.ok) {
        try {
          const json = JSON.parse(text) as { findings?: unknown[]; correctionsAnalyzed?: number; skipped?: string };
          console.log(
            `\n→ Zelda audit: ${json.correctionsAnalyzed ?? 0} correções analisadas, ${
              Array.isArray(json.findings) ? json.findings.length : 0
            } finding(s)${json.skipped ? ` (skipped: ${json.skipped})` : ''}`,
          );
        } catch {
          console.warn(`→ Zelda audit resp não-JSON: ${text.slice(0, 100)}`);
        }
      } else {
        console.warn(`→ Zelda audit HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      console.warn('→ Zelda audit fail:', e instanceof Error ? e.message : e);
    }
  }
  await prisma.$disconnect();
}

runWithWorkerLog('vendtef_entrada', main).catch((err) => {
  console.error(err);
  process.exit(1);
});
