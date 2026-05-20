/**
 * Popula a tabela Agent com os 7 agentes da empresa Vendetti.
 * Idempotente — UPSERT por slug. Roda quantas vezes quiser.
 *
 * Uso: `npx tsx scripts/seed-agents.ts`
 *      ou `npm run seed:agents` (se adicionar no package.json)
 *
 * Quando promptCore mudar (você edita seed.ts), rode de novo. Vai sobrescrever
 * e incrementar promptRev. Audit fica em AgentPromptRevision (PR futuro).
 */

import { prisma } from '../src/lib/db';
import { AGENT_SEEDS } from '../src/lib/agents/seed';

async function main() {
  console.log(`🌱 Seeding ${AGENT_SEEDS.length} agentes...`);

  for (const seed of AGENT_SEEDS) {
    const existing = await prisma.agent.findUnique({ where: { slug: seed.slug } });
    const promptChanged = existing && existing.promptCore !== seed.promptCore;

    const agent = await prisma.agent.upsert({
      where: { slug: seed.slug },
      create: {
        slug: seed.slug,
        name: seed.name,
        emoji: seed.emoji,
        role: seed.role,
        promptCore: seed.promptCore,
        promptRev: 1,
        model: seed.model,
        toolsAllowed: seed.toolsAllowed,
        budgetUsdMonth: seed.budgetUsdMonth,
        reportsToSlug: seed.reportsToSlug,
        active: true,
      },
      update: {
        name: seed.name,
        emoji: seed.emoji,
        role: seed.role,
        promptCore: seed.promptCore,
        promptRev: promptChanged ? { increment: 1 } : undefined,
        model: seed.model,
        toolsAllowed: seed.toolsAllowed,
        budgetUsdMonth: seed.budgetUsdMonth,
        reportsToSlug: seed.reportsToSlug,
      },
    });

    const status = existing
      ? promptChanged
        ? `↻ atualizado (promptRev → ${agent.promptRev})`
        : '· sem mudança'
      : '✓ criado';
    console.log(`  ${seed.emoji} ${seed.name.padEnd(20)} ${status}`);
  }

  const total = await prisma.agent.count({ where: { active: true } });
  console.log(`\n✓ ${total} agentes ativos no DB`);
}

main()
  .catch((e) => {
    console.error('seed falhou:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
