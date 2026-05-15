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

    // User: "tem que selecionar e esperar um pouco" — o form expande via JS após both selects
    await page.waitForTimeout(2_000);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await page.screenshot({ path: `${OUT_DIR}/02-after-tipo.png`, fullPage: true });
    await dumpFormFields(page, '02-after-tipo');

    // Se ainda não expandiu, tenta clicar Salvar pra ir pra próxima tela
    const itemFields = await page.locator('input[name*="produto"], input[id*="produto"], .autocomplete, [class*="produto"]').count();
    if (itemFields === 0) {
      const salvar = page.locator('button:has-text("Salvar"), input[value="Salvar"]').first();
      if (await salvar.count() > 0) {
        await salvar.click();
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
        await page.waitForTimeout(1_500);
        await page.screenshot({ path: `${OUT_DIR}/03-after-salvar.png`, fullPage: true });
        await dumpFormFields(page, '03-after-salvar');
      }
    }

    console.log(`  ⚠️ Purchase ${purchase.id}: form mapeado até segundo nível, items ainda não adicionados`);
    console.log(`  ${purchase.items.length} items pra adicionar:`);
    for (const it of purchase.items) {
      console.log(
        `    - ${it.code} | ${it.productName.slice(0, 40)} | ${it.qty}× R$${it.unitCost.toFixed(2)}${it.needsCadastro ? ' [PRECISA CADASTRAR]' : ''}`,
      );
    }
    return { ok: false, error: 'selectors-pending-stage2' };
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
