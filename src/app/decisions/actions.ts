'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { executeDecision as runExecutor } from '@/lib/vendetti/executor';

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
