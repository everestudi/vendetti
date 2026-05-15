'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';

export async function resolveSacComplaint(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const refund = parseFloat(String(formData.get('refund') ?? '0'));
  const resolution = String(formData.get('resolution') ?? '').trim() || null;
  if (!id) return;
  await prisma.complaint.update({
    where: { id },
    data: {
      status: 'REFUNDED',
      refundAmount: Number.isFinite(refund) ? refund : null,
      resolution,
      resolvedAt: new Date(),
    },
  });
  revalidatePath('/sac');
}

export async function dismissSacComplaint(id: string) {
  await prisma.complaint.update({
    where: { id },
    data: { status: 'DISMISSED', resolvedAt: new Date() },
  });
  revalidatePath('/sac');
}
