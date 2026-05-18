'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { setSecret } from '@/lib/secrets';

export async function saveSecret(formData: FormData) {
  const key = String(formData.get('key') ?? '').trim();
  const value = String(formData.get('value') ?? '').trim();
  if (!key || !value) return;
  await setSecret(key, value, 'admin');
  revalidatePath('/settings');
}

/**
 * Gera um token aleatório seguro (32 bytes base64 url-safe) e salva direto
 * no campo. Útil pra CRON_SECRET, ZAPI_WEBHOOK_SECRET, INQUIRIES_API_KEY,
 * AUTH_SECRET — qualquer secret que precisa ser aleatório (não vem de
 * provedor externo).
 */
export async function generateAndSaveSecret(key: string) {
  const value = randomBytes(32).toString('base64url');
  await setSecret(key, value, 'admin');
  revalidatePath('/settings');
}
