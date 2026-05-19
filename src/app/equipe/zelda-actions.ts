'use server';

import { revalidatePath } from 'next/cache';
import { auditMatchCorrections } from '@/lib/vendetti/zelda';

/**
 * Server action — dispara Zelda pra analisar correções recentes via Claude
 * e persistir findings como Ideas. Chamada pelo botão "Analisar agora" em
 * /equipe/zelda.
 */
export async function runZeldaAudit() {
  // Manual: revisa últimos 30 (não-incremental) + notifica Luís
  await auditMatchCorrections({ limit: 30, incrementalOnly: false, notifyLuis: true });
  revalidatePath('/equipe/zelda');
}
