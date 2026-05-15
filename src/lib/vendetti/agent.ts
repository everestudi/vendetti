/**
 * Vendetti · agent setup.
 *
 * Provider Anthropic (Opus 4.7) configurado dinamicamente com a key
 * cifrada no /settings (não confia em env var direta).
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { getSecret } from '../secrets';
import { SYSTEM_PROMPT } from './prompt';
import { VENDETTI_TOOLS } from './tools';

const MODEL_ID = 'claude-opus-4-7';

export async function getVendettiModel() {
  const apiKey = await getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY ausente — configure em /settings');
  }
  // baseURL explícito — em @ai-sdk/anthropic 3.0.77 o default bate em /messages
  // (sem /v1) e retorna 404. Setando manualmente.
  const anthropic = createAnthropic({ apiKey, baseURL: 'https://api.anthropic.com/v1' });
  return anthropic(MODEL_ID);
}

export { SYSTEM_PROMPT, VENDETTI_TOOLS };
