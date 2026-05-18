/**
 * Acesso a secrets cifrados no banco, com fallback para env vars.
 *
 * Uso típico:
 *   const anthropicKey = await getSecret('ANTHROPIC_API_KEY');
 */

import { prisma } from './db';
import { decrypt, encrypt } from './crypto';

/** Lista de secrets que o app espera. Usado pela UI /settings. */
export const KNOWN_SECRETS = [
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', hint: 'console.anthropic.com → Settings → API Keys' },
  { key: 'RESEND_API_KEY', label: 'Resend API Key', hint: 'resend.com/api-keys' },
  { key: 'ERPVENDING_USER', label: 'ERP Vending — usuário', hint: 'login do erpvending.com.br' },
  { key: 'ERPVENDING_PASS', label: 'ERP Vending — senha', hint: '⚠️ troque depois do scraper estar no ar' },
  { key: 'ZAPI_INSTANCE', label: 'Z-API — instância', hint: 'painel Z-API → instâncias' },
  { key: 'ZAPI_TOKEN', label: 'Z-API — token', hint: 'painel Z-API' },
  { key: 'ZAPI_CLIENT_TOKEN', label: 'Z-API — client token', hint: 'painel Z-API → segurança' },
  { key: 'WEVERTON_PHONE', label: 'WhatsApp do Weverton', hint: '+5534999999999 (com código país)' },
  { key: 'LUIS_PHONE', label: 'WhatsApp do Luís (allow contact)', hint: 'Único canal Z-API que pode falar livre com o agente' },
  { key: 'OPERACAO_GROUP_ID', label: 'ID do grupo "Operação TCN Vending Machine"', hint: 'Formato: 1203...@g.us — descubra com npm run zapi:list-groups' },
  { key: 'CRON_SECRET', label: 'CRON_SECRET (Bearer token pro cron)', hint: 'Gere com: openssl rand -base64 32' },
  { key: 'ZAPI_WEBHOOK_SECRET', label: 'Z-API webhook · shared secret', hint: 'Adicione no header X-Vendetti-Secret na config webhook do Z-API' },
  { key: 'ATACADAO_USER', label: 'Atacadão — usuário (opcional)', hint: 'só se precisar logar p/ ver preço' },
  { key: 'ATACADAO_PASS', label: 'Atacadão — senha (opcional)', hint: '' },
  { key: 'GITHUB_PAT', label: 'GitHub Personal Access Token', hint: 'Pra disparar workflow Vendtef sync. Scope: repo. github.com/settings/tokens' },
  { key: 'GITHUB_REPO', label: 'GitHub repo (org/name)', hint: 'Padrão: everestudi/vendetti — só sobrescreva se mover o repo' },
  { key: 'OPENAI_API_KEY', label: 'OpenAI API Key (Whisper)', hint: 'Pra transcrever áudios do WhatsApp. ~$0.006/min. platform.openai.com/api-keys' },
] as const;

export type SecretKey = (typeof KNOWN_SECRETS)[number]['key'];

export async function getSecret(key: SecretKey | string): Promise<string | null> {
  const row = await prisma.secret.findUnique({ where: { key } });
  if (row) {
    try {
      return decrypt(row.value);
    } catch {
      return null;
    }
  }
  return process.env[key] ?? null;
}

export async function setSecret(key: string, value: string, updatedBy?: string) {
  const ciphertext = encrypt(value);
  await prisma.secret.upsert({
    where: { key },
    create: { key, value: ciphertext, updatedBy },
    update: { value: ciphertext, updatedBy },
  });
}

export async function listSecretStatus() {
  const stored = await prisma.secret.findMany({ select: { key: true, updatedAt: true, updatedBy: true } });
  const map = new Map(stored.map((s) => [s.key, s]));
  return KNOWN_SECRETS.map((s) => {
    const row = map.get(s.key);
    return {
      ...s,
      filled: !!row || !!process.env[s.key],
      source: row ? ('db' as const) : process.env[s.key] ? ('env' as const) : ('missing' as const),
      updatedAt: row?.updatedAt ?? null,
    };
  });
}
