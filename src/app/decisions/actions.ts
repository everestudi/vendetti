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
  const dec = await prisma.decision.update({
    where: { id },
    data: { status: 'APPROVED', approvedBy: 'admin' },
  });
  revalidatePath('/decisions');

  // === Outbound message proposta pela Rita (modo human-in-the-loop) ===
  // Se data.outboundMessage existir, Luís aprovou — dispara envio Z-API real.
  // Sucesso → status EXECUTED. Falha Z-API → marca rejectReason com erro
  // (Luís pode tentar re-aprovar ou rejeitar).
  const data = (dec.data ?? {}) as Record<string, unknown>;
  const outbound = data.outboundMessage as
    | { channel?: string; body?: string; proposedBy?: string }
    | undefined;
  if (outbound?.channel === 'grupo_operacao' && outbound.body) {
    try {
      const { sendToOperacaoGroup } = await import('@/lib/zapi/send');
      const r = await sendToOperacaoGroup(outbound.body);
      if (r.ok) {
        await prisma.decision.update({
          where: { id },
          data: {
            status: 'EXECUTED',
            data: {
              ...data,
              outboundMessage: {
                ...outbound,
                sentAt: new Date().toISOString(),
                zapiMessageId: r.messageId,
              },
            } as never,
          },
        });
      } else {
        await prisma.decision.update({
          where: { id },
          data: {
            status: 'FAILED',
            rejectReason: `Z-API falhou: ${r.error}`,
          },
        });
      }
      revalidatePath('/decisions');
    } catch (e) {
      console.warn('[approveDecision outbound]', e instanceof Error ? e.message : e);
    }
  }

  // Trigger automático restock_approved (SPEC #2): se Decision foi de reposição,
  // dispara wakeup pra Rita agendar Weverton.
  if (dec.kind === 'RESTOCK_ORDER' || dec.kind === 'RESTOCK_TASK') {
    try {
      const { fireDomainEvent } = await import('@/lib/agents/triggers');
      const items = Array.isArray(data.items) ? (data.items as Array<{ slotPosition?: string; slot?: string }>) : [];
      const slots = items
        .map((it) => it.slotPosition ?? it.slot ?? '')
        .filter(Boolean) as string[];
      await fireDomainEvent({
        kind: 'restock_approved',
        decisionId: id,
        slots,
      });
    } catch (e) {
      console.warn('[approveDecision] fireDomainEvent falhou:', e instanceof Error ? e.message : e);
    }
  }
}

export async function rejectDecision(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const reasonCategory = String(formData.get('reasonCategory') ?? '').trim();
  const reasonText = String(formData.get('reasonText') ?? '').trim();

  // Motivo OBRIGATÓRIO — categoria + texto livre
  if (!reasonCategory) {
    console.warn('[rejectDecision] sem categoria — abortando');
    return;
  }

  // Concatena categoria + texto livre pra rejectReason
  const fullReason = reasonText ? `[${reasonCategory}] ${reasonText}` : `[${reasonCategory}]`;

  const dec = await prisma.decision.findUnique({ where: { id } });
  if (!dec) return;

  await prisma.decision.update({
    where: { id },
    data: { status: 'REJECTED', rejectedBy: 'admin', rejectReason: fullReason },
  });

  // 🤖 Envia evento pra Zelda auditar — entender PADRÕES de rejeição.
  // Se Luís rejeita muitas decisions do mesmo tipo (ex: RESTOCK_TASK com
  // matcher errado), Zelda detecta e propõe fix.
  await prisma.workerRun.create({
    data: {
      name: 'decision_rejected',
      status: 'OK',
      finishedAt: new Date(),
      meta: {
        decisionId: id,
        decisionKind: dec.kind,
        decisionLevel: dec.level,
        decisionSummary: dec.summary,
        reasonCategory,
        reasonText,
        rejectedBy: 'admin',
      } as never,
    },
  }).catch((e) => console.warn('[decision_rejected log]', e instanceof Error ? e.message : e));

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
  const dec = await prisma.decision.update({
    where: { id },
    data: { status: 'EXECUTED' },
  });
  revalidatePath('/decisions');

  // Trigger automático restock_executed (SPEC #2): se Decision física de
  // reposição foi confirmada, acorda Lúcia pra atualizar P&L (vendas voltam
  // após restock).
  if (dec.kind === 'RESTOCK_ORDER' || dec.kind === 'RESTOCK_TASK') {
    try {
      const { fireDomainEvent } = await import('@/lib/agents/triggers');
      const data = (dec.data ?? {}) as Record<string, unknown>;
      const totalUnits = typeof data.totalUnits === 'number' ? data.totalUnits : 0;
      await fireDomainEvent({
        kind: 'restock_executed',
        reposicaoId: id, // usa decisionId como ref já que não temos reposicaoId aqui
        totalUnits,
      });
    } catch (e) {
      console.warn('[confirmPhysical] fireDomainEvent falhou:', e instanceof Error ? e.message : e);
    }
  }
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
