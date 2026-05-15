/**
 * Z-API · cliente HTTP mínimo para enviar mensagens.
 *
 * Modo de uso:
 *   import { sendText } from '@/lib/zapi/send';
 *   await sendText('+5511998716386', 'Oi!');
 *
 * Documentação Z-API: https://developer.z-api.io/message/send-message-text
 */

import { getSecret } from '../secrets';

export type SendResult =
  | { ok: true; messageId?: string; raw: unknown }
  | { ok: false; error: string; raw?: unknown };

/** Tira tudo que não for dígito (Z-API exige só números). */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export async function sendText(phone: string, message: string): Promise<SendResult> {
  const [instance, token, clientToken] = await Promise.all([
    getSecret('ZAPI_INSTANCE'),
    getSecret('ZAPI_TOKEN'),
    getSecret('ZAPI_CLIENT_TOKEN'),
  ]);
  if (!instance || !token || !clientToken) {
    return { ok: false, error: 'Z-API secrets ausentes (ZAPI_INSTANCE/TOKEN/CLIENT_TOKEN)' };
  }

  const normalized = normalizePhone(phone);
  const url = `https://api.z-api.io/instances/${instance}/token/${token}/send-text`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': clientToken },
    body: JSON.stringify({ phone: normalized, message }),
  });
  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}`, raw: data };
  }
  const messageId =
    typeof data === 'object' && data !== null && 'messageId' in data ? String((data as Record<string, unknown>).messageId) : undefined;
  return { ok: true, messageId, raw: data };
}
