/**
 * Zelda — agente de auditoria/oversight.
 *
 * Função principal: analisar correções de match (Luís corrigiu o que o
 * matcher sugeriu) e propor melhorias concretas no algoritmo via Claude
 * (Haiku 4.5 — análise rápida, sem custo alto).
 *
 * Output: Ideas no DB (modelo já existente). Cada Idea tem:
 *  - content: descrição do padrão detectado
 *  - note: prompt PRONTO pra Luís colar no chat do Augusto pra ele aplicar
 *  - status: NEW (Luís revisa depois)
 *
 * NÃO faz mudança automática no código. Sempre passa por Luís.
 */

import { prisma } from '../db';
import Anthropic from '@anthropic-ai/sdk';
import { getSecret } from '../secrets';
import { sendText } from '../zapi/send';

interface MatchCorrectionEvent {
  capturedAt: string;
  context: string;
  inputText: string;
  suggestedSkuName: string | null;
  suggestedScore: number | null;
  actualSkuId: string | null;
  finalAction: 'match' | 'new';
  correctionType: string;
}

interface ZeldaFinding {
  pattern: string; // descrição do padrão
  severity: 'sugestão' | 'importante' | 'crítico';
  hypothesis: string; // por que matcher errou
  suggestedFix: string; // mudança concreta (NOISE token, discriminator, threshold)
  augustoPrompt: string; // prompt pronto pra colar no chat
}

const ZELDA_SYSTEM_PROMPT = `Você é a Zelda, agente de oversight do sistema Vendetti (CEO automation de uma vending machine TCN 6G no Bluemall Rondon).

CONTEXTO TÉCNICO DO MATCHER QUE VOCÊ AUDITA:

Arquivo: \`src/lib/vendetti/nfe-parse.ts\` (matcher do Bruno na importação de NF-e) e \`src/lib/sku-match.ts\` (matcher na UI /decisions do Weverton).

Algoritmo atual:
- Normalize: lowercase, remove acentos, só [a-z0-9 ]
- Filter noise tokens: ${'`NOISE_TOKENS`'} set (ref, lata, sleek, und, un, unid, emb, gar, pet, cxa, cx, fardo, br, nacional, naci, nfe, etc)
- Discriminators (presença unilateral → score 0): ${'`DISCRIMINATORS`'} array (zero, diet, light, sem, watermelon, amora, morango, baunilha, limao, tropical, pipeline, mango, maracuja, ultra)
- F1 score: shared / (precision + recall) onde precision = shared/target_tokens, recall = shared/catalog_tokens
- Threshold mínimo: 60% (abaixo disso, sem sugestão)

SUA TAREFA:

Analisar a lista de correções (cada uma é uma vez que o Luís discordou do matcher) e identificar PADRÕES. Pra cada padrão, propor 1 fix CONCRETO no código.

Tipos de correção:
- "matcher_missed_should_match": matcher não sugeriu nada, Luís achou manual → matcher tá restritivo demais (faltou NOISE token, threshold alto demais, etc)
- "matcher_suggested_should_create_new": matcher sugeriu X mas era pra criar produto NOVO → falta um DISCRIMINATOR pra distinguir variantes (ex: novo sabor)
- "matcher_suggested_wrong_match": matcher sugeriu X mas era Y → discriminator faltando ou ruído atrapalhou

Saída: JSON array de findings. Cada finding:
{
  "pattern": "1-2 linhas descrevendo o padrão observado",
  "severity": "sugestão" | "importante" | "crítico",
  "hypothesis": "por que matcher errou (especulação técnica)",
  "suggestedFix": "mudança concreta e específica (ex: 'adiciona \"sgl\" ao NOISE_TOKENS' OU 'novo discriminator \"frutas vermelhas\"' OU 'baixar threshold de 60→55%')",
  "augustoPrompt": "prompt pronto pra Luís colar no chat do Augusto, formato imperativo, tipo: 'Adiciona \"X\" ao NOISE_TOKENS em src/lib/sku-match.ts e src/lib/vendetti/nfe-parse.ts. Justificativa: <breve>. Não mexe em nada mais.'"
}

REGRAS:
- Máximo 5 findings por chamada (priorize os mais impactantes)
- Severidade "crítico" só se >3 ocorrências do mesmo padrão
- Não invente padrões — base em dados reais. Se houver só 1 correção, severidade=sugestão e seja conservador
- augustoPrompt curto (max 200 chars) e auto-suficiente
- Output APENAS o JSON array, sem markdown, sem texto explicativo`;

export async function auditMatchCorrections(opts: {
  limit?: number;
  /** Se true (default em chamadas automáticas), só analisa correções NOVAS
   *  desde o último audit OK. Evita re-analisar e gerar Ideas duplicadas. */
  incrementalOnly?: boolean;
  /** Se true, manda WhatsApp pro Luís com findings importantes/críticos. */
  notifyLuis?: boolean;
} = {}): Promise<{
  ok: boolean;
  findings: ZeldaFinding[];
  correctionsAnalyzed: number;
  skipped?: 'no-new-corrections' | 'no-corrections';
  error?: string;
}> {
  const limit = opts.limit ?? 30;
  const incrementalOnly = opts.incrementalOnly ?? false;
  const notifyLuis = opts.notifyLuis ?? false;

  // Cutoff: se incremental, só corrige após o último audit OK
  let cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000); // 30d default
  if (incrementalOnly) {
    const lastAudit = await prisma.workerRun.findFirst({
      where: { name: 'zelda_audit_matcher', status: 'OK' },
      orderBy: { startedAt: 'desc' },
    });
    if (lastAudit) cutoff = lastAudit.startedAt;
  }

  // 1. Busca correções recentes (após cutoff, max N)
  const corrections = await prisma.workerRun.findMany({
    where: {
      name: 'match_correction',
      startedAt: { gte: cutoff },
    },
    orderBy: { startedAt: 'desc' },
    take: limit,
  });

  if (corrections.length === 0) {
    return {
      ok: true,
      findings: [],
      correctionsAnalyzed: 0,
      skipped: incrementalOnly ? 'no-new-corrections' : 'no-corrections',
    };
  }

  // 2. Resolve nomes dos SKUs reais (actualSkuId)
  const skuIds = corrections
    .map((c) => (c.meta as Record<string, unknown>)?.actualSkuId)
    .filter((id): id is string => typeof id === 'string');
  const skuMap = new Map<string, string>();
  if (skuIds.length > 0) {
    const skus = await prisma.sku.findMany({
      where: { id: { in: skuIds } },
      select: { id: true, name: true },
    });
    for (const s of skus) skuMap.set(s.id, s.name);
  }

  // 3. Monta payload pra Claude
  const events: MatchCorrectionEvent[] = corrections.map((c) => {
    const m = (c.meta ?? {}) as Record<string, unknown>;
    return {
      capturedAt: c.startedAt.toISOString(),
      context: String(m.context ?? 'unknown'),
      inputText: String(m.inputText ?? ''),
      suggestedSkuName: (m.suggestedSkuName as string) ?? null,
      suggestedScore: (m.suggestedScore as number) ?? null,
      actualSkuId: (m.actualSkuId as string) ?? null,
      finalAction: (m.finalAction as 'match' | 'new') ?? 'match',
      correctionType: String(m.correctionType ?? 'unknown'),
    };
  });

  // Annotação pro modelo: substitui actualSkuId pelo nome real (mais útil)
  const enriched = events.map((e) => ({
    ...e,
    actualSkuName: e.actualSkuId ? skuMap.get(e.actualSkuId) ?? '(sku não achado)' : null,
  }));

  // 4. Chama Claude Haiku
  const apiKey = await getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return { ok: false, findings: [], correctionsAnalyzed: events.length, error: 'ANTHROPIC_API_KEY ausente' };
  }
  const anthropic = new Anthropic({ apiKey });

  const userPrompt = `Aqui estão ${enriched.length} correções de match. Identifique padrões e proponha fixes.

\`\`\`json
${JSON.stringify(enriched, null, 2)}
\`\`\`

Retorne APENAS o JSON array de findings (sem markdown, sem prefixo).`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: ZELDA_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = msg.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('\n')
      .trim();

    // Strip markdown se Claude colocou
    const cleaned = text
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();

    let findings: ZeldaFinding[];
    try {
      findings = JSON.parse(cleaned);
    } catch {
      return {
        ok: false,
        findings: [],
        correctionsAnalyzed: events.length,
        error: `Zelda retornou JSON inválido: ${cleaned.slice(0, 200)}`,
      };
    }

    // 5. Persiste como Ideas (status=NEW, Luís revisa em /equipe/zelda)
    // Dedup: skip se já existe Idea NEW com mesmo suggestedFix nos últimos 7d
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const recentIdeas = await prisma.idea.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, status: 'NEW', content: { startsWith: '[Zelda' } },
    });
    const existingFixes = new Set(
      recentIdeas
        .map((i) => {
          try {
            return (JSON.parse(i.note ?? '{}') as ZeldaFinding).suggestedFix.toLowerCase().trim();
          } catch {
            return null;
          }
        })
        .filter((s): s is string => Boolean(s)),
    );

    const persistedFindings: ZeldaFinding[] = [];
    for (const f of findings) {
      const key = f.suggestedFix.toLowerCase().trim();
      if (existingFixes.has(key)) {
        console.log(`[zelda] dedupe · pulando finding já existente: ${f.suggestedFix.slice(0, 60)}`);
        continue;
      }
      existingFixes.add(key);
      await prisma.idea
        .create({
          data: {
            content: `[Zelda · ${f.severity}] ${f.pattern}\n\nHipótese: ${f.hypothesis}\n\nFix sugerido: ${f.suggestedFix}\n\nPrompt pra Augusto:\n${f.augustoPrompt}`,
            note: JSON.stringify(f),
          },
        })
        .catch((e) => console.warn('[zelda idea persist]', e instanceof Error ? e.message : e));
      persistedFindings.push(f);
    }

    // 5b. Notificar Luís via WhatsApp se há finding importante/crítico.
    // Sugestões silenciam — só "importante" ou "crítico" tira ele do dia-a-dia.
    if (notifyLuis) {
      const noisy = persistedFindings.filter((f) => f.severity === 'importante' || f.severity === 'crítico');
      if (noisy.length > 0) {
        const luisPhone = await getSecret('LUIS_PHONE');
        const base = process.env.APP_URL ?? 'https://vendetti.everest.udi.br';
        if (luisPhone) {
          const lines = [
            `🔍 Zelda detectou ${noisy.length} ponto(s) de melhoria:`,
            '',
            ...noisy.slice(0, 3).map((f, i) => {
              const emoji = f.severity === 'crítico' ? '🔴' : '🟡';
              return `${emoji} ${f.pattern}\n  fix: ${f.suggestedFix.slice(0, 100)}\n  prompt: ${f.augustoPrompt.slice(0, 180)}`;
            }),
            '',
            `Detalhes: ${base}/equipe/zelda`,
          ].join('\n');
          await sendText(luisPhone, lines).catch((e) =>
            console.warn('[zelda notify]', e instanceof Error ? e.message : e),
          );
        }
      }
    }

    // 6. Log da run pra histórico
    await prisma.workerRun.create({
      data: {
        name: 'zelda_audit_matcher',
        status: 'OK',
        finishedAt: new Date(),
        meta: {
          correctionsAnalyzed: events.length,
          findingsCount: findings.length,
          severityBreakdown: {
            sugestão: findings.filter((f) => f.severity === 'sugestão').length,
            importante: findings.filter((f) => f.severity === 'importante').length,
            crítico: findings.filter((f) => f.severity === 'crítico').length,
          },
        } as never,
      },
    });

    return { ok: true, findings: persistedFindings, correctionsAnalyzed: events.length };
  } catch (err) {
    return {
      ok: false,
      findings: [],
      correctionsAnalyzed: events.length,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
