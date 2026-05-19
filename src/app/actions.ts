'use server';

import { revalidatePath } from 'next/cache';
import { dispatchWorkflow } from '@/lib/infra/gh-dispatch';

/**
 * Dispara mara-sync GH Action (scrape Vendtef + atualiza Postgres).
 * Chamada pelo botão "Sincronizar agora" da home.
 */
export async function forceMaraSync() {
  const r = await dispatchWorkflow('mara-sync', { reason: 'force-from-home-dashboard' });
  if (!r.ok) {
    console.error('[forceMaraSync]', r.error);
  }
  revalidatePath('/');
}
