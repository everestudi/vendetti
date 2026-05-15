/**
 * Função importável que executa um update_slot programaticamente.
 * Usada pelo /api/decisions executor e pelo CLI update-slot.ts.
 */

import type { Page } from 'playwright';
import { ensurePortalSSO, launchBrowser, newAuthedContext, SESSION_PATH, dismissModals } from '../_shared/playwright';
import { getSecret } from '../../lib/secrets';

const MASCARAS_URL = 'https://www.portalvendtef.com.br/mascaras';
const TARGET_ESTOQUE = 'Maquina BlueMall Rondon';

function brl(n: number): string {
  return n.toFixed(2).replace('.', ',');
}

export interface SlotUpdateChanges {
  capacity?: number;
  price?: number;
  qtdeAlerta?: number;
  qtdeCritico?: number;
}

export interface SlotFormState {
  pid: string | null;
  selecao: string | null;
  preco: string | null;
  capacidade: string | null;
  qtde_estoque_alerta: string | null;
  qtde_estoque_critico: string | null;
}

export interface SlotUpdateResult {
  ok: boolean;
  before?: SlotFormState;
  after?: SlotFormState;
  error?: string;
}

async function openSelectionEditor(page: Page, selecao: string) {
  await page.goto(MASCARAS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await dismissModals(page);

  const row = page.locator(`tr:has-text("${TARGET_ESTOQUE}")`).first();
  await row.locator('a.aSelecoes').click({ force: true });
  await page.waitForTimeout(1_500);

  const clicked = await page.evaluate((sel) => {
    const modal = document.querySelector('.modal.in, .modal.show');
    if (!modal) return { ok: false, reason: 'modal Seleções não está aberto' };
    const rows = Array.from(modal.querySelectorAll('tbody tr'));
    const target = rows.find((r) => (r.children[0] as HTMLElement)?.textContent?.trim() === sel);
    if (!target) return { ok: false, reason: `seleção "${sel}" não encontrada` };
    const link = target.querySelector('a.edit-selecao') as HTMLAnchorElement | null;
    if (!link) return { ok: false, reason: 'a.edit-selecao não achado' };
    link.click();
    return { ok: true };
  }, selecao);
  if (!clicked.ok) throw new Error(clicked.reason);

  await page.waitForFunction(
    () => {
      const all = Array.from(document.querySelectorAll('.modal.in, .modal.show'));
      return all.some((m) => m.querySelector('.modal-title')?.textContent?.includes('Editar Produto'));
    },
    { timeout: 10_000 },
  );
}

async function readForm(page: Page): Promise<SlotFormState | null> {
  return page.evaluate(() => {
    const modals = Array.from(document.querySelectorAll('.modal.in, .modal.show'));
    const editModal = modals.find((m) => m.querySelector('.modal-title')?.textContent?.includes('Editar Produto'));
    if (!editModal) return null;
    const get = (name: string) =>
      (editModal.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value ?? null;
    return {
      pid: get('pid'),
      selecao: get('selecao'),
      preco: get('preco'),
      capacidade: get('capacidade'),
      qtde_estoque_alerta: get('qtde_estoque_alerta'),
      qtde_estoque_critico: get('qtde_estoque_critico'),
    };
  });
}

export async function executeSlotUpdate(selecao: string, changes: SlotUpdateChanges): Promise<SlotUpdateResult> {
  // Smoke check de credenciais
  const user = await getSecret('ERPVENDING_USER');
  if (!user) return { ok: false, error: 'credenciais Vendtef ausentes' };

  const browser = await launchBrowser(true);
  const ctx = await newAuthedContext(browser);
  try {
    await ensurePortalSSO(ctx, 'vendtef');
    const page = await ctx.newPage();

    await openSelectionEditor(page, selecao);
    const before = await readForm(page);
    if (!before) throw new Error('form de edição não foi lido');

    const topModal = page.locator('.modal.in, .modal.show').last();
    async function setField(name: string, value: string) {
      const input = topModal.locator(`[name="${name}"]`);
      await input.fill(value, { timeout: 5_000 });
      await input.evaluate((el: HTMLInputElement) => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      });
    }

    if (changes.capacity !== undefined) await setField('capacidade', String(changes.capacity));
    if (changes.price !== undefined) await setField('preco', brl(changes.price));
    if (changes.qtdeAlerta !== undefined) await setField('qtde_estoque_alerta', String(changes.qtdeAlerta));
    if (changes.qtdeCritico !== undefined) await setField('qtde_estoque_critico', String(changes.qtdeCritico));

    // Submit — busca botão visível "Editar" via JS direto
    const submitInfo = await page.evaluate(() => {
      const modals = Array.from(document.querySelectorAll('.modal.in, .modal.show'));
      const top = modals[modals.length - 1] as HTMLElement | undefined;
      if (!top) return { ok: false, reason: 'sem modal top' };
      const cands = Array.from(
        top.querySelectorAll<HTMLElement>('button, input[type="submit"], input[type="button"]'),
      ).filter((b) => {
        const visible = b.offsetParent !== null && b.getBoundingClientRect().width > 0;
        if (!visible) return false;
        const text = (b.tagName === 'INPUT' ? (b as HTMLInputElement).value : (b.textContent ?? '')).trim();
        return /^Editar$/i.test(text);
      });
      if (cands.length === 0) return { ok: false, reason: 'nenhum botão "Editar" visível' };
      const primary = cands.find((c) => c.className.includes('btn-primary')) ?? cands[0];
      primary.click();
      return { ok: true };
    });

    if (!submitInfo.ok) {
      // fallback: form.requestSubmit()
      await page.evaluate(() => {
        const top = Array.from(document.querySelectorAll('.modal.in, .modal.show')).pop() as HTMLElement | undefined;
        top?.querySelector('form')?.requestSubmit();
      });
    }

    await page.waitForTimeout(4_000);

    // Verifica persistência: reabre o modal pra mesma seleção e relê
    await page.goto(MASCARAS_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await openSelectionEditor(page, selecao);
    const after = await readForm(page);
    if (!after) throw new Error('falhou ao reler o form');

    await ctx.storageState({ path: SESSION_PATH });

    // Verifica se o valor desejado de fato mudou
    if (changes.capacity !== undefined && String(after.capacidade) !== String(changes.capacity)) {
      return { ok: false, before, after, error: `capacidade não persistiu (esperado ${changes.capacity}, atual ${after.capacidade})` };
    }
    if (changes.price !== undefined) {
      const expected = brl(changes.price);
      if (after.preco !== expected) {
        return { ok: false, before, after, error: `preço não persistiu (esperado ${expected}, atual ${after.preco})` };
      }
    }
    return { ok: true, before, after };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    await ctx.close();
    await browser.close();
  }
}
