/**
 * Follow-up curto: pede pra Gabi formalizar as 3 PROPOSALs que ela
 * já analisou (no run anterior). Sem nova análise — só converter prosa em
 * tool calls agent_send_message.
 */

import { prisma } from '../src/lib/db';
import { runAgent } from '../src/lib/agents/runtime';

async function main() {
  const [claudeCode, gabi] = await Promise.all([
    prisma.agent.findUnique({ where: { slug: 'claude-code' } }),
    prisma.agent.findUnique({ where: { slug: 'gabi' } }),
  ]);
  if (!claudeCode || !gabi) {
    console.error('agentes não estão no DB');
    process.exit(1);
  }

  // Pega a última análise dela (outputMd)
  const lastRun = await prisma.agentRun.findFirst({
    where: { agentId: gabi.id, status: 'COMPLETED' },
    orderBy: { startedAt: 'desc' },
  });
  const previousAnalysisExcerpt = lastRun?.outputMd?.slice(-2000) ?? '(sem análise anterior)';

  const followupBody = `Gabi, sua análise anterior foi ótima — você identificou 3 problemas reais:

1. PROMPT CACHING AUSENTE → custo escala linear
2. 6 AGENTES MORTOS, AUGUSTO SOBRECARREGADO
3. INBOX SEM EXPIRAÇÃO + RECALL SEM EMBEDDING

Mas você não formalizou as PROPOSALs no mailbox. Faz isso agora — **3 chamadas curtas de \`agent_send_message\`**, uma por problema, formato:

\`\`\`
agent_send_message({
  to: "luis",
  kind: "PROPOSAL",
  body: "**Problema**: [1 frase]\\n\\n**Impacto**: [KPI afetada]\\n\\n**Esboço**: [bullets curtos]\\n\\n**Esforço**: ~Xh\\n\\n**Refs**: [arquivos/linhas]"
})
\`\`\`

Sem nova análise. Sem reler arquivos. Sem chamar gabi_recent_runs de novo. Apenas converte a análise que você JÁ FEZ em 3 PROPOSALs estruturadas.

Pra referência, último trecho da sua análise:

---
${previousAnalysisExcerpt}
---

Vai. 3 PROPOSALs, NADA além disso.`;

  const msg = await prisma.agentMessage.create({
    data: {
      fromAgentId: claudeCode.id,
      toAgentId: gabi.id,
      threadId: 'claude-code-gabi',
      kind: 'REQUEST',
      body: followupBody,
      status: 'DELIVERED',
    },
  });
  console.log(`📩 Follow-up criado (id=${msg.id.slice(0, 12)})`);

  const t0 = Date.now();
  const { runId, result } = await runAgent({
    agentSlug: 'gabi',
    trigger: 'MAILBOX',
    triggerRef: msg.id,
    payload: { messageId: msg.id, threadId: 'claude-code-gabi' },
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n✓ Run completa em ${elapsed}s (runId=${runId.slice(0, 12)})`);
  console.log(`  tokens: ${result.tokensIn} in / ${result.tokensOut} out`);
  console.log(`  custo: $${result.costUsd.toFixed(4)}`);
  console.log(`  tool calls: ${result.toolCalls.length}`);
  for (const tc of result.toolCalls) {
    console.log(`    🔧 ${tc.name} (${tc.ms}ms)${tc.error ? ' ✗ ERRO' : ' ✓'}`);
  }
  console.log(`  msgs novas: ${result.newMessages.length}`);
  for (const m of result.newMessages) {
    console.log(`    → to=${m.toSlug ?? 'broadcast'} kind=${m.kind}`);
    console.log(`      ${m.body.slice(0, 200)}...`);
  }

  console.log(`\n📝 OUTPUT:\n${'─'.repeat(60)}\n${result.outputMd.slice(0, 500)}\n${'─'.repeat(60)}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
