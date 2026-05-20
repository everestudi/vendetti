'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { dispatchWorkflow } from '@/lib/infra/gh-dispatch';

/**
 * Dispara mara-sync GH Action (scrape Vendtef + atualiza Postgres).
 * Chamada pelo botão "Sincronizar agora" da home.
 *
 * Redirect com query param `?sync=triggered` ou `?sync=failed` pra UI mostrar
 * feedback visual (banner verde/vermelho).
 *
 * NOTA: imagens dos produtos eram disparadas via botão aqui também; foram
 * movidas pra tools do Augusto (`refresh_product_images` / `refetch_product_image`)
 * + auto-backfill no fim de cada mara_sync. UI ficou enxuta.
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
