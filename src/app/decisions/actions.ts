'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';

// Importação lazy: executor → update-slot-core → playwright.
// Playwright não roda em Vercel serverless. Importar estaticamente faz a
// página /vendetti (e /decisions) crashar no module load. Lazy garante que
// só carrega quando "Executar" for clicado (vai falhar nesse caso, mas as
// outras actions e a renderização das páginas continuam funcionando).
async function loadExecutor() {
  const mod = await import('@/lib/vendetti/executor');
  return mod.executeDecision;
}

export async function approveDecision(id: string) {
  await prisma.decision.update({
    where: { id },
    data: { status: 'APPROVED', approvedBy: 'admin' },
  });
  revalidatePath('/decisions');
}

export async function rejectDecision(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const reason = String(formData.get('reason') ?? '');
  await prisma.decision.update({
    where: { id },
    data: { status: 'REJECTED', rejectedBy: 'admin', rejectReason: reason || null },
  });
  revalidatePath('/decisions');
}

export async function executeDecisionAction(id: string) {
  const runExecutor = await loadExecutor();
  const r = await runExecutor(id, 'admin');
  if (!r.ok) {
    console.error(`[/decisions executeAction] ${r.message}`);
  }
  revalidatePath('/decisions');
}

export async function confirmPhysical(id: string) {
  await prisma.decision.update({
    where: { id },
    data: { status: 'EXECUTED' },
  });
  revalidatePath('/decisions');
}

/**
 * Atualiza os items de uma Decision Weverton antes de aprovar.
 * Recebe formData com chaves `qty[i]`, `targetProduct[i]`, `skip[i]` indexed.
 * O scraper depois lê `data.items` (com os novos valores) ao executar.
 */
export async function updateDecisionItems(id: string, formData: FormData) {
  const dec = await prisma.decision.findUnique({ where: { id } });
  if (!dec) return;
  const data = (dec.data ?? {}) as Record<string, unknown>;
  const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : [];

  const updated = items.map((it, i) => {
    const qty = formData.get(`qty_${i}`);
    const targetProductRaw = formData.get(`target_${i}`);
    const targetProduct = targetProductRaw ? String(targetProductRaw).trim() : '';
    const skip = formData.get(`skip_${i}`) === 'on';
    // newProductData só faz sentido quando há targetProduct
    const newCostRaw = formData.get(`new_cost_${i}`);
    const newCategoryRaw = formData.get(`new_category_${i}`);
    const newSupplierRaw = formData.get(`new_supplier_${i}`);
    const newEntradaQtyRaw = formData.get(`new_entrada_qty_${i}`);
    let newProductData: Record<string, unknown> | undefined;
    if (targetProduct && (newCostRaw || newCategoryRaw || newEntradaQtyRaw)) {
      newProductData = {
        cost: newCostRaw ? parseFloat(String(newCostRaw).replace(',', '.')) || 0 : undefined,
        category: newCategoryRaw ? String(newCategoryRaw).trim() : undefined,
        supplier: newSupplierRaw ? String(newSupplierRaw) : 'ATACADAO',
        entradaEstoqueQty: newEntradaQtyRaw ? parseInt(String(newEntradaQtyRaw), 10) || undefined : undefined,
      };
    }
    return {
      ...it,
      qty: qty ? parseInt(String(qty), 10) || (it.qty as number) : it.qty,
      targetProduct: targetProduct || undefined,
      skip,
      newProductData,
    };
  });

  // Recalcula totalUnits ignorando skipped
  const totalUnits = updated.filter((i) => !i.skip).reduce((s, i) => s + (i.qty as number), 0);
  const activeCount = updated.filter((i) => !i.skip).length;

  await prisma.decision.update({
    where: { id },
    data: {
      data: {
        ...data,
        items: updated,
        totalUnits,
      } as never,
      summary: `Reposição Weverton: ${activeCount} slot(s) · ${totalUnits} unidades`,
    },
  });
  revalidatePath('/decisions');
}
