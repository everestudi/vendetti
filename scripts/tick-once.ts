/**
 * Roda um tick local — útil pra testar agentes sem esperar GH Actions cron.
 * Uso: `npm run agents:tick`
 */

import { tickAgents } from '../src/lib/agents/runtime';
import { prisma } from '../src/lib/db';

async function main() {
  console.log('🪝 Agents tick local...');
  const out = await tickAgents(5);
  console.log(`\n→ ${out.processed} wakeups processados`);
  for (const r of out.results) {
    const icon = r.status === 'ok' ? '✓' : '✗';
    const cost = r.costUsd != null ? ` · $${r.costUsd.toFixed(4)}` : '';
    const err = r.error ? ` · ${r.error}` : '';
    console.log(`  ${icon} ${r.agentSlug.padEnd(12)} ${cost}${err}`);
  }
  if (out.processed === 0) {
    console.log('  (fila vazia — sem wakeups pendentes)');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
