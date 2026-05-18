'use server';

import { revalidatePath } from 'next/cache';
import { markAssumedByLuis, markDismissed, markRefunded } from '@/lib/vendetti/lucia';

export async function resolveSacComplaint(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const refund = parseFloat(String(formData.get('refund') ?? '0'));
  if (!id) return;
  await markRefunded(id, Number.isFinite(refund) ? refund : undefined);
  revalidatePath('/sac');
  revalidatePath('/vendetti');
}

export async function dismissSacComplaint(id: string) {
  await markDismissed(id);
  revalidatePath('/sac');
  revalidatePath('/vendetti');
}

export async function dismissSacWithReason(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!id) return;
  await markDismissed(id, reason || undefined);
  revalidatePath('/sac');
  revalidatePath('/vendetti');
}

export async function assumeSacComplaint(id: string) {
  await markAssumedByLuis(id);
  revalidatePath('/sac');
  revalidatePath('/vendetti');
}
