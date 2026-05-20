/**
 * Smoke test do prompt caching:
 * - Run 1: cache_write (penalty +25%)
 * - Run 2 (mesma janela 5min, mesmo agente, mesmo system): cache_read (90% economia)
 *
 * Mede ganho real comparando custos das 2 runs.
 */

import { prisma } from '../src/lib/db';
import { runAgent } from '../src/lib/agents/runtime';

async function runOne(label: string, body: string) {
  const claudeCode = await prisma.agent.findUnique({ where: { slug: 'claude-code' } });
  const augusto = await prisma.agent.findUnique({ where: { slug: 'augusto' } });
  if (!claudeCode || !augusto) throw new Error('seed agents first');

  const msg = await prisma.agentMessage.create({
    data: {
      fromAgentId: claudeCode.id,
      toAgentId: augusto.id,
      threadId: 'claude-code-cache-test',
      kind: 'QUESTION',
      body: `[SMOKE CACHE TEST ${label}] ${body}`,
      status: 'DELIVERED',
    },
  });

  const t0 = Date.now();
  const { runId, result } = await runAgent({
    agentSlug: 'augusto',
    trigger: 'MAILBOX',
    triggerRef: msg.id,
    payload: { messageId: msg.id, threadId: 'claude-code-cache-test' },
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  return { runId, result, elapsed };
}

async function main() {
  console.log('🧪 Smoke test PROMPT CACHING\n');
  console.log('Run 1 (cache_write expected — primeira invocação):');
  const r1 = await runOne('1', 'Diz uma frase curta sobre tua função, sem tools.');
  console.log(`  runId: ${r1.runId.slice(0, 12)}`);
  console.log(`  elapsed: ${r1.elapsed}s`);
  console.log(`  custo: $${r1.result.costUsd.toFixed(6)}`);
  console.log(`  tokens: in=${r1.result.tokensIn} out=${r1.result.tokensOut}`);

  // Lê o último run pra pegar cache stats
  const augusto = await prisma.agent.findUnique({ where: { slug: 'augusto' } });
  const dbRun1 = await prisma.agentRun.findUnique({ where: { id: r1.runId } });
  console.log(`  DB cost: $${Number(dbRun1?.costUsd ?? 0).toFixed(6)}`);

  console.log('\n⏳ Aguardando 3s antes da run 2 (mesmo cache, ainda dentro do TTL 5min)...');
  await new Promise((r) => setTimeout(r, 3000));

  console.log('\nRun 2 (cache_read expected — system prompt idêntico, dentro do TTL):');
  const r2 = await runOne('2', 'Diz outra frase curta, idem.');
  console.log(`  runId: ${r2.runId.slice(0, 12)}`);
  console.log(`  elapsed: ${r2.elapsed}s`);
  console.log(`  custo: $${r2.result.costUsd.toFixed(6)}`);
  console.log(`  tokens: in=${r2.result.tokensIn} out=${r2.result.tokensOut}`);

  // Compara — economia esperada se cache hit
  const diff = r1.result.costUsd - r2.result.costUsd;
  const pct = (diff / r1.result.costUsd) * 100;
  console.log(`\n📊 Comparação:`);
  console.log(`  Run 1: $${r1.result.costUsd.toFixed(6)}`);
  console.log(`  Run 2: $${r2.result.costUsd.toFixed(6)}`);
  console.log(`  Economia: $${diff.toFixed(6)} (${pct.toFixed(1)}%)`);

  if (pct > 15) {
    console.log(`  ✅ Cache funcionando!`);
  } else if (pct > 0) {
    console.log(`  ⚠️ Diferença pequena — pode ser por inbox/payload variar`);
  } else {
    console.log(`  ❌ Sem economia — cache não bateu`);
  }

  // Mostra usage detalhado da última run via raw SQL
  console.log(`\n🔍 Inspecionando AgentRun details (raw)...`);
  const tcs1 = Array.isArray(dbRun1?.toolCalls) ? (dbRun1!.toolCalls as Array<{ name?: string }>) : [];
  console.log(`  Run 1 tools: ${tcs1.map((t) => t.name).join(', ') || '(nenhuma)'}`);
  const dbRun2 = await prisma.agentRun.findUnique({ where: { id: r2.runId } });
  const tcs2 = Array.isArray(dbRun2?.toolCalls) ? (dbRun2!.toolCalls as Array<{ name?: string }>) : [];
  console.log(`  Run 2 tools: ${tcs2.map((t) => t.name).join(', ') || '(nenhuma)'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
