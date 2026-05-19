'use server';

import { revalidatePath } from 'next/cache';
import { dispatchWorkflow } from '@/lib/infra/gh-dispatch';

/**
 * Re-dispara o scraper vendtef-sync pra uma Purchase específica.
 * Útil quando: scraper falhou parcialmente (ex: matcher antigo deixou
 * items sem match), ou Luís quer forçar reprocessamento.
 *
 * Não reseta `vendtefSyncedAt`/`vendtefSyncError` — o scraper rodando
 * com PURCHASE_ID env vai processar a Purchase de qualquer jeito e
 * sobrescrever os campos no final.
 */
export async function resyncPurchase(purchaseId: string) {
  const r = await dispatchWorkflow('vendtef-sync', { purchase_id: purchaseId });
  if (!r.ok) {
    console.error('[resyncPurchase]', r.error);
  }
  revalidatePath('/bruno');
}
