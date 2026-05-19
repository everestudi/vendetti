/**
 * LLM review pra items da mensagem do Weverton.
 *
 * Roda DEPOIS do matcher F1 heurístico (parseWevertonText). Considera contexto
 * que o F1 não enxerga:
 *   - Mapa COMPLETO da máquina (não só o slot mencionado)
 *   - Catálogo de SKUs (variantes, similares)
 *   - Correções recentes do Luís (sinal de pattern)
 *
 * Permite detectar casos como:
 *   - SLOT SWAP: Weverton diz slot 14=X mas Vendtef tem X no slot 15.
 *     LLM detecta inversão sistema vs físico, propõe swap_with_slot.
 *   - PRODUTO RENOMEADO: Weverton "Red Bull Amora" = catálogo
 *     "Red Bull Frutas Vermelhas". LLM achaem match via alias.
 *   - VARIANTE NOVA: produto não tá no catálogo mas é uma variante
 *     conhecida → cadastrar como tal.
 *
 * Modelo: Claude Haiku 4.5 (rápido + barato). Single call pra todos os items
 * em lote.
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db';
import { getSecret } from '../secrets';

interface ParsedItem {
  slotPosition: string;
  productGuess: string;
  qty: number;
  slotProduct: string | null;
  matchConfidence: 'high' | 'mid' | 'low' | 'no-slot';
}

export interface LLMItemReview {
  slotPosition: string;
  /**
   * Ação recomendada pela LLM:
   *  - abastecer_only: Weverton e Vendtef batem, só precisa abastecer (high
   *    confidence cases)
   *  - product_swap: slot precisa virar produto X (existe no catálogo)
   *  - slot_swap_with: Vendtef inverteu este slot com outro — corrigir
   *  - create_new: produto não existe no catálogo, cadastrar
   *  - human_review: LLM não conseguiu decidir, Luís precisa olhar
   */
  recommendedAction: 'abastecer_only' | 'product_swap' | 'slot_swap_with' | 'create_new' | 'human_review';
  confidence: number; // 0-100
  reasoning: string; // explicação curta da LLM
  /** Se product_swap ou slot_swap_with: SKU alvo do catálogo */
  targetSkuId?: string;
  targetSkuName?: string;
  /** Se slot_swap_with: qual slot está invertido com este */
  swapWithSlot?: string;
  /** Se create_new: nome sugerido (limpo) */
  newProductName?: string;
}

const SYSTEM_PROMPT = `Você é uma camada de revisão pra reposições do Weverton (zelador) na vending machine TCN 6G do BlueMall Rondon. Roda depois de um matcher heurístico (F1+noise filter+discriminators) que faz match por similaridade de tokens entre nomes — mas o F1 só compara DOIS nomes (do slot vs do Weverton), não enxerga o resto da máquina.

Sua tarefa: pra cada item da reposição que o matcher F1 marcou com confidence != 'high', analise se realmente precisa intervenção e qual ação correta. Considere TODO o mapa de slots (não só o slot mencionado), o catálogo, e correções recentes.

Casos que você precisa detectar (em ordem de prioridade):

1. **SLOT SWAP DETECTADO**: Weverton diz "slot 14 = Protein Crisp" mas Vendtef tem "FTW Delicious" no slot 14. Procure "Protein Crisp" no resto da máquina — se achar no slot 15, é provável inversão sistema vs físico. Ação: \`slot_swap_with\` com swapWithSlot=15.

2. **PRODUTO RENOMEADO/ALIAS**: Weverton "Red Bull Amora" pode ser catálogo "Red Bull Frutas Vermelhas" (nome diferente, produto igual). Ação: \`product_swap\` com targetSkuId.

3. **VARIANTE DE FAMÍLIA EXISTENTE**: Weverton "Monster Ultra Sunrise" — catálogo tem outros Monster Ultra. Pode ser variante nova. Se houver variante MUITO próxima (mesmo formato 473ml, marca Monster), action=\`product_swap\`. Senão action=\`create_new\`.

4. **MID CONFIDENCE QUE É SÓ SINÔNIMO**: Weverton "Coca normal 310ml" + Vendtef "Coca Cola 310ml" = mesmo produto, sem swap. Action: \`abastecer_only\`.

5. **REALMENTE PRODUTO NOVO**: nenhuma variante próxima no catálogo. Action: \`create_new\` com newProductName limpo.

6. **AMBÍGUO**: não tem certeza. Action: \`human_review\` com reasoning explicando a dúvida.

REGRAS:
- Você NÃO decide se cadastra/configura/abastece — só recomenda ação. Scraper depois executa.
- Sempre dê confidence 0-100 (sua certeza, não a do F1).
- Reasoning curto (1-2 frases), DIRETO.
- Output APENAS JSON array, sem markdown.

Formato output (1 entry por item input):
\`\`\`
[
  {
    "slotPosition": "14",
    "recommendedAction": "slot_swap_with",
    "confidence": 95,
    "reasoning": "Vendtef tem 'Barra Protein Crisp Ovomaltine' no slot 15. Provável inversão sistema vs físico.",
    "swapWithSlot": "15",
    "targetSkuId": "cmp6d2ucx0008hk6d8iway7h7",
    "targetSkuName": "Barra Protein Crisp Ovomaltine"
  },
  ...
]
\`\`\``;

export async function reviewWevertonItemsWithLLM(
  items: ParsedItem[],
  machineName = 'Maquina BlueMall Rondon',
): Promise<{ ok: boolean; reviews: LLMItemReview[]; error?: string }> {
  // Filtra items que precisam de revisão (não-high)
  const needsReview = items.filter((it) => it.matchConfidence !== 'high');
  if (needsReview.length === 0) {
    return { ok: true, reviews: [] };
  }

  // Carrega contexto: mapa completo de slots + catálogo + correções recentes
  const machine = await prisma.machine.findFirst({ where: { name: machineName } });
  if (!machine) return { ok: false, reviews: [], error: `máquina "${machineName}" não achada` };

  const [allSlots, catalog, recentCorrections] = await Promise.all([
    prisma.slot.findMany({
      where: { machineId: machine.id },
      include: { sku: true },
      orderBy: { position: 'asc' },
    }),
    prisma.sku.findMany({
      where: { active: true },
      select: { id: true, name: true, category: true },
    }),
    prisma.workerRun.findMany({
      where: {
        name: 'match_correction',
        startedAt: { gte: new Date(Date.now() - 14 * 24 * 3600 * 1000) },
      },
      orderBy: { startedAt: 'desc' },
      take: 20,
    }),
  ]);

  const apiKey = await getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return { ok: false, reviews: [], error: 'ANTHROPIC_API_KEY ausente — skip LLM review' };
  }

  // Monta payload
  const machineSlotMap = allSlots.map((s) => ({
    position: s.position,
    sku: s.sku ? { id: s.sku.id, name: s.sku.name } : null,
    currentQty: s.currentQty,
    capacity: s.capacity,
  }));

  const corrections = recentCorrections.map((c) => {
    const m = (c.meta ?? {}) as Record<string, unknown>;
    return {
      inputText: m.inputText,
      correctionType: m.correctionType,
      suggestedSkuName: m.suggestedSkuName ?? null,
    };
  });

  const userPrompt = `# CONTEXTO

## Items que precisam revisão (output do matcher F1):
${JSON.stringify(needsReview, null, 2)}

## Mapa completo de slots no Vendtef (estado atual):
${JSON.stringify(machineSlotMap, null, 2)}

## Catálogo SKU (produtos disponíveis pra match):
${JSON.stringify(catalog, null, 2)}

## Correções de match recentes (últimos 14d) — sinal de problemas comuns:
${JSON.stringify(corrections.slice(0, 10), null, 2)}

# TAREFA

Pra cada item em "Items que precisam revisão", analise e retorne JSON array de LLMItemReview (1 entry por item). Output APENAS o JSON array, sem markdown.`;

  const anthropic = new Anthropic({ apiKey });

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = msg.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('\n')
      .trim();

    const cleaned = text
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();

    let reviews: LLMItemReview[];
    try {
      reviews = JSON.parse(cleaned);
    } catch {
      return { ok: false, reviews: [], error: `LLM retornou JSON inválido: ${cleaned.slice(0, 200)}` };
    }

    // Log da run pra histórico
    await prisma.workerRun
      .create({
        data: {
          name: 'llm_review_weverton',
          status: 'OK',
          finishedAt: new Date(),
          meta: {
            itemsReviewed: needsReview.length,
            actionsBreakdown: reviews.reduce(
              (acc, r) => {
                acc[r.recommendedAction] = (acc[r.recommendedAction] ?? 0) + 1;
                return acc;
              },
              {} as Record<string, number>,
            ),
          } as never,
        },
      })
      .catch(() => undefined);

    return { ok: true, reviews };
  } catch (err) {
    return { ok: false, reviews: [], error: err instanceof Error ? err.message : String(err) };
  }
}
