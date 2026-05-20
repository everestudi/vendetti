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

/**
 * Normaliza identificador Z-API:
 * - **Contato pessoal**: tira tudo que não é dígito (Z-API exige só números pra phones)
 * - **Grupo**: preserva sufixo `-group` (formato legacy) ou `@g.us` (novo).
 *   Sem o sufixo, Z-API trata como contato individual e a mensagem não chega.
 *
 * BUG ENCONTRADO 2026-05-20: replace(/\D/g, '') estava removendo `-group` dos
 * group IDs. Mensagens da Rita pro grupo Operações nunca chegavam mesmo Z-API
 * retornando ok=true (enviava pra um phone que não existia). Fix preserva sufixo.
 */
function normalizePhone(phone: string): string {
  // Detecta sufixo de grupo (Z-API aceita 2 formatos: legacy "-group" e novo "@g.us")
  if (phone.endsWith('-group')) {
    const numeric = phone.slice(0, -6).replace(/\D/g, '');
    return `${numeric}-group`;
  }
  if (phone.endsWith('@g.us')) {
    const numeric = phone.slice(0, -5).replace(/\D/g, '');
    return `${numeric}@g.us`;
  }
  // Contato pessoal — só números
  return phone.replace(/\D/g, '');
}

/**
 * Envia mensagem para o grupo "Operação TCN Vending Machine".
 * O group ID fica em `OPERACAO_GROUP_ID` (cifrado no DB). Formato: `1203...@g.us`.
 */
export async function sendToOperacaoGroup(message: string): Promise<SendResult> {
  const groupId = await getSecret('OPERACAO_GROUP_ID');
  if (!groupId) {
    return { ok: false, error: 'OPERACAO_GROUP_ID ausente — rode `npm run zapi:list-groups` e cole o ID no /settings' };
  }
  return sendText(groupId, message);
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
