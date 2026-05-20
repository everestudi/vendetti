/**
 * Acorda Gabi (co-founder) pela primeira vez.
 *
 * Manda mensagem do `claude-code` → `gabi` com estado atual da empresa
 * (commits recentes, agentes ativos, runs últimas) pra ela se orientar.
 * Espera ela responder com proposta de prioridades.
 *
 * Uso: `npx tsx scripts/wake-gabi.ts`
 */

import { prisma } from '../src/lib/db';
import { runAgent } from '../src/lib/agents/runtime';

async function main() {
  const [claudeCode, gabi] = await Promise.all([
    prisma.agent.findUnique({ where: { slug: 'claude-code' } }),
    prisma.agent.findUnique({ where: { slug: 'gabi' } }),
  ]);
  if (!claudeCode) {
    console.error('claude-code não está no DB — rode `npm run seed:agents`');
    process.exit(1);
  }
  if (!gabi) {
    console.error('gabi não está no DB — rode `npm run seed:agents`');
    process.exit(1);
  }

  // Coleta estado pra contar pra Gabi
  const [agents, recentRuns, recentCommits] = await Promise.all([
    prisma.agent.findMany({
      where: { active: true },
      select: { slug: true, name: true, model: true, spentUsdMonth: true, budgetUsdMonth: true },
      orderBy: { slug: 'asc' },
    }),
    prisma.agentRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 5,
      include: { agent: { select: { slug: true } } },
    }),
    // Commits via gh (poderia chamar GH API mas pra simplificar deixa Gabi descobrir)
    Promise.resolve(null),
  ]);

  const agentsList = agents
    .map((a) => `- ${a.name} (${a.slug}): ${a.model}, spent $${Number(a.spentUsdMonth).toFixed(2)}/$${a.budgetUsdMonth}`)
    .join('\n');

  const runsList = recentRuns
    .map((r) => `- ${r.agent.slug} · ${r.trigger} · $${Number(r.costUsd).toFixed(4)} · ${r.status}`)
    .join('\n');

  const handshakeBody = `Oi Gabi, fui acordada — sou o **Claude Code do Luís** (entidade técnica, slug: \`claude-code\`). Não sou o Luís humano direto, sou o canal de desenvolvimento dele.

## Por que tô te acordando agora

Acabamos de subir 4 PRs grandes pro Vendetti virar "empresa virtual" de verdade:

1. **PR1**: Schema multi-agente (Agent, AgentRun, AgentMessage, AgentWakeupRequest, AgentMemoryRecall) + UI /empresa + botão de pânico
2. **PR2**: /chat agora vai via runtime real (mailbox + runAgent inline), Mara dispara wakeup pós mara_sync
3. **PR3**: Tool calling nativo via Anthropic SDK (Augusto chama mara_summary direto), tools novas pra Zelda (zelda_token_audit) e pra ti (gabi_read_repo_file, gabi_recent_runs, gabi_create_github_issue)
4. **Refactor mailbox**: Adicionamos o agent \`claude-code\` (eu) pra deixar claro quando é dev vs Luís humano

Tu existe agora com 3 tools e \$40/mês de budget. Tua função: ler o repo Vendetti, ler runs dos outros agentes, propor features/bugs via PROPOSAL mensagens ou GitHub issues.

## Estado da empresa agora

**Agentes ativos:**
${agentsList}

**Últimas 5 runs:**
${runsList}

## O que preciso de ti agora

Quero que você se oriente e me devolva:

1. **Read primeiro**: chama \`gabi_recent_runs\` (limit 20) pra ver o que aconteceu, e \`gabi_read_repo_file({ path: "docs/research/MULTI_AGENT_ARCHITECTURE.md" })\` pra entender a arquitetura. (Esse doc tem o plano todo do refactor.)

2. **Identifique top 3 problemas/oportunidades** que tu vê AGORA pelo estado atual (gargalo, bug latente, feature óbvia que falta, custo). Não chuta — só fala o que viu nos dados.

3. **Devolve uma PROPOSAL** via \`agent_send_message({ to: "luis", kind: "PROPOSAL", body: ... })\` pra cada um dos top 3 — com:
   - **Problema** (1 frase)
   - **Impacto** (qual KPI move?)
   - **Esboço de implementação** (esforço em h)
   - **Refs** (arquivos / runs / commits específicos)

4. NÃO crie GitHub issue ainda nessa primeira passada — só PROPOSAL via mailbox. Quando o Luís aprovar, aí abre issue.

5. NÃO me pede pra implementar nada agora — eu (claude-code) só facilito comunicação. Implementação real vem do Luís me chamando no terminal pra codar (você propõe, ele decide, eu executo).

Welcome aboard. 🛠️`;

  const msg = await prisma.agentMessage.create({
    data: {
      fromAgentId: claudeCode.id,
      toAgentId: gabi.id,
      threadId: 'claude-code-gabi',
      kind: 'REQUEST',
      body: handshakeBody,
      status: 'DELIVERED',
    },
  });

  console.log(`📩 Handshake msg criada (id=${msg.id.slice(0, 12)}) na thread claude-code-gabi`);
  console.log(`   ${claudeCode.emoji} ${claudeCode.name} → ${gabi.emoji} ${gabi.name}`);
  console.log(`\n⏳ Rodando Gabi via runAgent... (Opus 4.7, pode levar 30-60s)`);

  const t0 = Date.now();
  try {
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
      console.log(`    🔧 ${tc.name} (${tc.ms}ms)${tc.error ? ' ✗ ERRO: ' + tc.error : ' ✓'}`);
    }
    console.log(`  msgs novas: ${result.newMessages.length}`);
    console.log(`  recalls novos: ${result.newRecalls.length}`);

    console.log(`\n📝 OUTPUT da Gabi:\n${'─'.repeat(60)}\n${result.outputMd}\n${'─'.repeat(60)}`);
  } catch (err) {
    console.error('\n✗ runAgent failed:', err instanceof Error ? err.message : err);
    throw err;
  }
}

main()
  .catch(() => process.exit(1))
  .finally(() => prisma.$disconnect());
