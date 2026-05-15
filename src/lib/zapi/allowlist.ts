/**
 * Z-API · allowlist de contatos que podem disparar resposta do agente.
 *
 * Tiers:
 *  1. Luís (LUIS_PHONE) — free chat com Vendetti
 *  2. SAC reconhecido — Lúcia responde com templates scripted
 *  3. Qualquer outro número — silenciado (apenas loga o evento)
 */

import { getSecret } from '../secrets';

export type InboundClassification =
  | { tier: 'admin'; phone: string }
  | { tier: 'sac'; phone: string }
  | { tier: 'silence'; phone: string; reason: string };

function normalize(phone: string): string {
  return phone.replace(/\D/g, '');
}

export async function classifyInbound(phone: string, message: string): Promise<InboundClassification> {
  const luisRaw = await getSecret('LUIS_PHONE');
  const luis = luisRaw ? normalize(luisRaw) : '';
  const from = normalize(phone);

  if (luis && from === luis) {
    return { tier: 'admin', phone: from };
  }

  // Heurística leve de SAC: presence de palavra-chave.
  // O classifier final (LLM) virá depois — isso é só filtro inicial.
  const sacKeywords = [
    'máquina',
    'maquina',
    'não saiu',
    'nao saiu',
    'perdi dinheiro',
    'paguei',
    'não recebi',
    'nao recebi',
    'comprei e',
    'vending',
    'bluemall',
  ];
  const lower = message.toLowerCase();
  if (sacKeywords.some((k) => lower.includes(k))) {
    return { tier: 'sac', phone: from };
  }

  return { tier: 'silence', phone: from, reason: 'sem allowlist, sem palavras-chave SAC' };
}
