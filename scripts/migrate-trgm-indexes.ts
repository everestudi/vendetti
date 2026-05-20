/**
 * SPEC #3 Gabi: pg_trgm + indexes GIN.
 * Prisma `db push` aplica schema (enum STALE) mas não cria extensions/GIN —
 * roda esse script depois pra adicionar.
 *
 * Idempotente (CREATE IF NOT EXISTS).
 */

import { prisma } from '../src/lib/db';

const STATEMENTS = [
  // Extensão trigram (idempotente)
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,

  // GIN trigram em summary do AgentMemoryRecall
  `CREATE INDEX IF NOT EXISTS "AgentMemoryRecall_summary_trgm_idx"
    ON "AgentMemoryRecall" USING GIN ("summary" gin_trgm_ops)`,

  // GIN trigram em body do AgentMemoryRecall
  `CREATE INDEX IF NOT EXISTS "AgentMemoryRecall_body_trgm_idx"
    ON "AgentMemoryRecall" USING GIN ("body" gin_trgm_ops)`,

  // Btree composto pra cobrir filtro agentId + kind antes do trigram
  `CREATE INDEX IF NOT EXISTS "AgentMemoryRecall_agentId_kind_idx"
    ON "AgentMemoryRecall" ("agentId", "kind")`,
];

async function main() {
  console.log('🔧 Aplicando indexes trigram (SPEC #3)...\n');
  for (const sql of STATEMENTS) {
    const label = sql.match(/CREATE (?:INDEX|EXTENSION).+?"?([\w_]+)"?/)?.[1] ?? sql.slice(0, 50);
    process.stdout.write(`  · ${label.padEnd(50)} `);
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log('✓');
    } catch (e) {
      console.log(`✗ ${e instanceof Error ? e.message.slice(0, 100) : e}`);
    }
  }

  // Validação: explain analyze numa query exemplo
  console.log('\n📊 Validação via EXPLAIN:');
  try {
    const plan = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
      `EXPLAIN SELECT id FROM "AgentMemoryRecall" WHERE summary ILIKE '%test%' LIMIT 5`,
    );
    for (const row of plan.slice(0, 8)) {
      console.log(`  ${row['QUERY PLAN']}`);
    }
  } catch (e) {
    console.log(`  (sem rows ainda — EXPLAIN não rodou: ${e instanceof Error ? e.message.slice(0, 60) : e})`);
  }

  console.log('\n✓ Indexes aplicados');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
