'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { dispatchWorkflow } from '@/lib/infra/gh-dispatch';
import { backfillProductImages } from '@/lib/products/fetch-images';

/**
 * Dispara mara-sync GH Action (scrape Vendtef + atualiza Postgres).
 * Chamada pelo botão "Sincronizar agora" da home.
 *
 * Redirect com query param `?sync=triggered` ou `?sync=failed` pra UI mostrar
 * feedback visual (banner verde/vermelho).
 */
export async function forceMaraSync() {
  const r = await dispatchWorkflow('mara-sync', { reason: 'force-from-home-dashboard' });
  revalidatePath('/');
  if (!r.ok) {
    console.error('[forceMaraSync]', r.error);
    redirect(`/?sync=failed&err=${encodeURIComponent(r.error ?? 'unknown')}`);
  }
  redirect('/?sync=triggered');
}

/**
 * Popula imageUrl em todos os SKUs ativos via Atacadão VTEX search.
 * Chamada pelo botão "Atualizar imagens" em algum lugar.
 */
export async function refreshProductImages() {
  const r = await backfillProductImages({ max: 100 });
  console.log('[refreshProductImages]', r);
  revalidatePath('/');
  redirect(`/?images=${r.matched}/${r.total}`);
}
