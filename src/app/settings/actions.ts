'use server';

import { revalidatePath } from 'next/cache';
import { setSecret } from '@/lib/secrets';

export async function saveSecret(formData: FormData) {
  const key = String(formData.get('key') ?? '').trim();
  const value = String(formData.get('value') ?? '').trim();
  if (!key || !value) return;
  await setSecret(key, value, 'admin');
  revalidatePath('/settings');
}
