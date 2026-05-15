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

const OUT_DIR = './tmp/vendtef-entrada';
const ERP_HOME = 'https://www.erpvending.com.br/';
const LOGIN_URL = 'https://www.erpvending.com.br/auth/login/index';
const OPERACOES_URL = 'https://www.erpvending.com.br/erp/operacoes-estoque';
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

interface ItemSnap {
  productName: string;
  productCode: string | null;
  qty: number;
  unitCost: number;
}

interface PurchaseSnap {
  id: string;
  supplierName: string | null;
  invoiceRef: string | null;
  occurredAt: Date;
  totalAmount: number;
  items: { code: string; productName: string; qty: number; unitCost: number; needsCadastro: boolean }[];
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
        productName: it.productName,
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

// Tokens que distinguem variantes de produto. Se aparecem só de um lado, é falso match.
const DISCRIMINATING = [
  'zero',
  'diet',
  'light',
  'frutas vermelhas',
  'frutas vermelha',
  'mountain blast',
  'tropical',
  'morango',
  'baunilha',
];

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  // Anti-correlação carbonatação: "sem gas" / "s g" / "sg" vs "c gas" / "c g"
  const aSemGas = /\b(sem gas|s g|sg)\b/.test(na);
  const bSemGas = /\b(sem gas|s g|sg)\b/.test(nb);
  const aComGas = /\b(c gas|c g|com gas)\b/.test(na);
  const bComGas = /\b(c gas|c g|com gas)\b/.test(nb);
  if ((aSemGas && bComGas) || (aComGas && bSemGas)) return 0;

  // Discriminating tokens: presença unilateral derruba score
  for (const tok of DISCRIMINATING) {
    const inA = na.includes(tok);
    const inB = nb.includes(tok);
    if (inA !== inB) return 0;
  }

  const ta = new Set(na.split(' ').filter((t) => t.length >= 2));
  const tb = new Set(nb.split(' ').filter((t) => t.length >= 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = new Set([...ta, ...tb]).size;
  return Math.round((shared / union) * 100);
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

async function syncOne(ctx: BrowserContext, purchase: PurchaseSnap): Promise<{ ok: boolean; error?: string }> {
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  try {
    // Garante home autenticada
    await page.goto(ERP_HOME, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('/auth/login')) {
      throw new Error('Sessão perdeu durante navegação');
    }
    await dismissModals(page);

    // === FLUXO: Operações de Estoque ===
    await page.goto(OPERACOES_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await dismissModals(page);
    await page.screenshot({ path: `${OUT_DIR}/01-operacoes-form.png`, fullPage: true });
    await dumpFormFields(page, '01-operacoes');

    // Estoque: select#estoque — escolhe "Estoque Everest"
    const estoqueSelect = page.locator('#estoque');
    if (await estoqueSelect.count() === 0) throw new Error('select #estoque não encontrado');
    const estoqueOpts = await estoqueSelect.locator('option').allTextContents();
    const everestIdx = estoqueOpts.findIndex((o) => /everest/i.test(o));
    if (everestIdx < 0) throw new Error('"Estoque Everest" não está na lista');
    await estoqueSelect.selectOption({ index: everestIdx });
    await page.waitForTimeout(500);

    // Tipo: select#tipoOperacao — escolhe "Entrada de Estoque"
    const tipoSelect = page.locator('#tipoOperacao');
    if (await tipoSelect.count() === 0) throw new Error('select #tipoOperacao não encontrado');
    await tipoSelect.selectOption({ label: 'Entrada de Estoque' });

    // User: "tem que selecionar e esperar um pouco" — a tabela expande via JS após both selects
    await page.waitForTimeout(2_500);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await page.waitForSelector('input.qtdes-lancar', { timeout: 15_000 });
    await page.screenshot({ path: `${OUT_DIR}/02-after-tipo.png`, fullPage: true });

    // Captura mapping nome do produto → pid_<vendtefId>
    interface ProductRow { pid: string; name: string }
    const products: ProductRow[] = await page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLInputElement>('input.qtdes-lancar')).map((inp) => {
        const tr = inp.closest('tr');
        const nameCell = tr?.querySelector('td');
        return {
          pid: inp.name,
          name: (nameCell?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        };
      });
    });
    writeFileSync(`${OUT_DIR}/products-map.json`, JSON.stringify(products, null, 2));
    console.log(`  ${products.length} produtos disponíveis na tabela`);

    if (purchase.items.length === 0) {
      return { ok: false, error: 'nenhum item válido (todos sem skuId)' };
    }

    // Match cada Purchase item contra products. Threshold 70.
    // Se 2 source items reclamam o mesmo pid (ex: C/G vs S/G mappeando pro único Água C Gás),
    // ambos viram unmatched — Luís resolve manual depois.
    const candidates: { ourName: string; qty: number; bestPid: string; bestVendtefName: string; bestScore: number }[] = [];
    for (const it of purchase.items) {
      const best = bestMatch(it.productName, products);
      candidates.push({
        ourName: it.productName,
        qty: it.qty,
        bestPid: best?.row.pid ?? '',
        bestVendtefName: best?.row.name ?? '—',
        bestScore: best?.score ?? 0,
      });
    }

    // Conta quantos sources mappearam pra cada pid (acima do threshold)
    const MIN_SCORE = 60;
    const claimCount = new Map<string, number>();
    for (const c of candidates) {
      if (c.bestScore >= MIN_SCORE && c.bestPid) {
        claimCount.set(c.bestPid, (claimCount.get(c.bestPid) ?? 0) + 1);
      }
    }

    const matched: { pid: string; vendtefName: string; ourName: string; qty: number; score: number }[] = [];
    const unmatched: { ourName: string; qty: number; bestScore: number; bestVendtefName: string; reason: string }[] = [];
    for (const c of candidates) {
      if (c.bestScore < MIN_SCORE || !c.bestPid) {
        unmatched.push({ ourName: c.ourName, qty: c.qty, bestScore: c.bestScore, bestVendtefName: c.bestVendtefName, reason: c.bestScore < MIN_SCORE ? 'score baixo' : 'sem candidato' });
      } else if ((claimCount.get(c.bestPid) ?? 0) > 1) {
        unmatched.push({ ourName: c.ourName, qty: c.qty, bestScore: c.bestScore, bestVendtefName: c.bestVendtefName, reason: `colisão com outro item no ${c.bestPid}` });
      } else {
        matched.push({ pid: c.bestPid, vendtefName: c.bestVendtefName, ourName: c.ourName, qty: c.qty, score: c.bestScore });
      }
    }

    writeFileSync(`${OUT_DIR}/match-result.json`, JSON.stringify({ matched, unmatched }, null, 2));
    console.log(`  matched: ${matched.length}, unmatched: ${unmatched.length}`);
    for (const m of matched) console.log(`    ✓ ${m.qty}× "${m.ourName}" → ${m.pid} "${m.vendtefName}" (${m.score}%)`);
    for (const u of unmatched) console.log(`    ✗ "${u.ourName}" — ${u.reason} (best: ${u.bestScore}% "${u.bestVendtefName}")`);

    if (matched.length === 0) {
      return { ok: false, error: `nenhum item bate com Vendtef (${unmatched.length} unmatched)` };
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
    if (await confirmBtn.count() > 0) {
      await confirmBtn.click({ force: true });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
      await page.waitForTimeout(2_500);
    } else {
      console.log('  ⚠️ modal de confirmação não apareceu — verificar 04-modal-confirm.png');
    }
    await page.screenshot({ path: `${OUT_DIR}/05-after-confirm.png`, fullPage: true });

    // Sucesso: redirect ou mensagem de sucesso
    const finalUrl = page.url();
    const successMsg = await page.locator('.alert-success, .toast-success, [class*="success"]').first().textContent({ timeout: 1_000 }).catch(() => null);
    const errMsg = await page.locator('.alert-danger, .toast-error, [class*="error"]').first().textContent({ timeout: 1_000 }).catch(() => null);

    if (errMsg && errMsg.trim()) {
      return { ok: false, error: `Vendtef: ${errMsg.slice(0, 200)}` };
    }

    if (unmatched.length > 0) {
      return { ok: false, error: `parcial: ${matched.length} OK no Vendtef, ${unmatched.length} sem match (revisar manual)` };
    }
    console.log(`  ✓ finalUrl=${finalUrl} ${successMsg ? `msg="${successMsg.slice(0, 80)}"` : ''}`);
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
          vendtefSyncError: result.ok ? null : result.error,
          vendtefSyncAttempts: { increment: 1 },
        },
      });
      if (result.ok) console.log(`  ✓ ${id}`);
      else console.log(`  ✗ ${id}: ${result.error}`);
    }
  } finally {
    await ctx.close();
    await browser.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
