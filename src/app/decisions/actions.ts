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
