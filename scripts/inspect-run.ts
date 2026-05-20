/** Inspeciona última AgentRun do Augusto pra ver thinking + output completo. */

import { prisma } from '../src/lib/db';

async function main() {
  const augusto = await prisma.agent.findUnique({ where: { slug: 'augusto' } });
  if (!augusto) return;

  const run = await prisma.agentRun.findFirst({
    where: { agentId: augusto.id },
    orderBy: { startedAt: 'desc' },
    include: { generatedMessages: true },
  });
  if (!run) {
    console.log('Sem runs ainda');
    return;
  }

  console.log('=== AgentRun ===');
  console.log('id:', run.id);
  console.log('status:', run.status);
  console.log('trigger:', run.trigger);
  console.log('cost:', run.costUsd);
  console.log('tokens:', run.tokensIn, 'in /', run.tokensOut, 'out');
  console.log('nextAgentSlug:', run.nextAgentSlug);
  console.log('error:', run.errorMsg);

  console.log('\n=== thinkingMd ===');
  console.log(run.thinkingMd ?? '(empty)');

  console.log('\n=== outputMd (length=' + (run.outputMd?.length ?? 0) + ') ===');
  console.log(run.outputMd ?? '(empty)');

  console.log('\n=== generatedMessages (' + run.generatedMessages.length + ') ===');
  for (const m of run.generatedMessages) {
    console.log(`  → to=${m.toAgentId ?? 'broadcast'} thread=${m.threadId ?? '∅'} kind=${m.kind}`);
    console.log(`    body: ${m.body.slice(0, 200)}`);
  }

  console.log('\n=== toolCalls ===');
  console.log(JSON.stringify(run.toolCalls, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
