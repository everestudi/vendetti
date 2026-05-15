/**
 * Descobre os grupos WhatsApp em que o número do Vendetti está.
 *
 * Z-API endpoint: /chats?type=group (lista chats + filtra grupo)
 * ou /groups (lista exclusiva de grupos)
 *
 * Uso: `npm run zapi:list-groups`
 */

import { getSecret } from '../lib/secrets';

async function tryEndpoint(url: string, clientToken: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const res = await fetch(url, { headers: { 'Client-Token': clientToken } });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: (err as Error).message };
  }
}

interface ChatRecord {
  phone?: string;
  name?: string;
  isGroup?: boolean;
  subject?: string;
  participants?: unknown[];
}

async function main() {
  const [inst, tok, ct] = await Promise.all([
    getSecret('ZAPI_INSTANCE'),
    getSecret('ZAPI_TOKEN'),
    getSecret('ZAPI_CLIENT_TOKEN'),
  ]);
  if (!inst || !tok || !ct) {
    console.error('Z-API secrets ausentes');
    process.exit(1);
  }

  const base = `https://api.z-api.io/instances/${inst}/token/${tok}`;

  // Tenta múltiplos endpoints em ordem (Z-API muda nome às vezes)
  const endpoints = [
    `${base}/groups`,
    `${base}/chats?type=group`,
    `${base}/chats`,
  ];

  for (const url of endpoints) {
    process.stdout.write(`→ ${url.replace(base, '…')}  `);
    const r = await tryEndpoint(url, ct);
    console.log(`HTTP ${r.status}`);
    if (!r.ok) continue;

    // Achou — printa grupos
    const data = r.data;
    const items: ChatRecord[] = Array.isArray(data)
      ? data
      : Array.isArray((data as { chats?: ChatRecord[] }).chats)
        ? (data as { chats: ChatRecord[] }).chats
        : [];

    const groups = items.filter(
      (i) => i.isGroup === true || (typeof i.phone === 'string' && i.phone.includes('@g.us')),
    );

    if (groups.length === 0) {
      console.log('  (sem grupos no payload — tentando próximo endpoint)');
      continue;
    }

    console.log(`\n✓ ${groups.length} grupo(s) encontrado(s):\n`);
    for (const g of groups) {
      const id = g.phone ?? '(sem id)';
      const name = g.name ?? g.subject ?? '(sem nome)';
      const participants = Array.isArray(g.participants) ? g.participants.length : '?';
      console.log(`  ${name}`);
      console.log(`    id:           ${id}`);
      console.log(`    participantes: ${participants}\n`);
    }

    console.log('Cole o id do grupo "Operação TCN Vending Machine" em /settings → OPERACAO_GROUP_ID.');
    return;
  }

  console.error('\n✗ nenhum endpoint Z-API retornou grupos. Pode ser que a Z-API exija o número do dono pra autorizar.');
  console.error('  Alternativa: pegue o group ID manualmente (Z-API painel → mensagens enviadas)');
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
