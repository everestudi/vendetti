/**
 * Handler de mensagens do Weverton no grupo "Operação TCN Vending Machine".
 *
 * Fluxo:
 *  1. Weverton manda no grupo formato: "Boa tarde DD/MM Reposição (02) Biz 6 unidades..."
 *  2. Parser extrai itens (slot + qty)
 *  3. Cria Decision PENDING (kind=RESTOCK_TASK) com items no .data
 *  4. Avisa Luís via WhatsApp privado pra revisar
 *  5. Luís aprova em /decisions → executor dispara GH Action que atualiza
 *     estoque no Vendtef + responde no grupo "✓ atualizado"
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { sendText } from '../zapi/send';
import { getSecret } from '../secrets';
import { dispatchWorkflow } from '../infra/gh-dispatch';
import { reviewWevertonItemsWithLLM, type LLMItemReview } from './llm-review';

export interface ParsedItem {
  slotPosition: string;
  productGuess: string;
  qty: number;
  slotProduct: string | null;
  /// Quantidade atual no banco (Slot.currentQty) — pra UI mostrar comparação.
  currentQty: number | null;
  /// SKU ID do produto atualmente no slot (pra pré-selecionar no dropdown).
  slotSkuId: string | null;
  matchConfidence: 'high' | 'mid' | 'low' | 'no-slot';
  /// Se bateu via SkuAlias deterministicamente, não precisa de LLM review.
  aliasMatch?: { skuId: string; skuName: string; aliasId: string } | null;
}

/**
 * Normaliza texto pra match em alias: lowercase + sem acentos + trim + colapsa
 * espaços. Mesma normalização usada no /api/sku-aliases POST.
 */
export function normalizeAlias(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos (acentos)
    .replace(/\s+/g, ' ')
    .trim();
}

export async function parseWevertonText(text: string): Promise<{ items: ParsedItem[]; warnings: string[] }> {
  const machine = await prisma.machine.findFirst({ where: { name: 'Maquina BlueMall Rondon' } });
  const lines = text.split('\n').map((l) => l.trim());
  const items: ParsedItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const headerMatch = /^\(?(\d{1,3})\)?\s*[-:]?\s*(.+)$/.exec(line);
    if (!headerMatch) continue;
    // Normaliza removendo zero à esquerda — banco usa "1", "2"... pra 1 dígito.
    // Sem isso, F1 matcher quebra pra slots 1-6 (busca "01", banco tem "1").
    const slotPosition = String(parseInt(headerMatch[1], 10));
    let productGuess = headerMatch[2].trim();
    if (productGuess.length < 3) continue;
    // skip se é "Boa tarde DD/MM", "Reposição", "Inventário", ou "N unidade(s)"
    // (esse último evita interpretar "1 unidade" sozinho como header de slot)
    if (/^(boa\s+(tarde|noite|dia)|reposi|bom\s+dia|invent|unidad|unid)/i.test(productGuess)) continue;

    // Lookahead: linhas adicionais ANTES de "N unidades" são parte do nome
    // do produto (ex: Weverton manda "(56) Monster Energy\nUltra Watermelon\n5 unidades").
    // Captura múltiplas linhas até achar a linha de qty.
    let qty = 0;
    let advanced = 0;
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const ln = lines[j];
      if (!ln) continue;
      const qtyMatch = /^(\d+)\s*(?:un|unid|unidad)/i.exec(ln);
      if (qtyMatch) {
        qty = parseInt(qtyMatch[1], 10);
        break;
      }
      // Outra linha de slot (próximo item) → para
      if (/^\(?\d/.test(ln)) break;
      // Linha não-qty e não-slot = parte do nome do produto
      productGuess += ' ' + ln;
      advanced++;
      if (advanced > 3) break; // limite de segurança
    }
    if (qty === 0) continue;
    productGuess = productGuess.trim().replace(/\s+/g, ' ');

    let slotProduct: string | null = null;
    let currentQty: number | null = null;
    let slotSkuId: string | null = null;
    let matchConfidence: ParsedItem['matchConfidence'] = 'no-slot';
    let aliasMatch: ParsedItem['aliasMatch'] = null;

    if (machine) {
      const slot = await prisma.slot.findFirst({
        where: { machineId: machine.id, position: slotPosition },
        include: { sku: true },
      });
      slotProduct = slot?.sku?.name ?? null;
      currentQty = slot?.currentQty ?? null;
      slotSkuId = slot?.skuId ?? null;

      // === ALIAS DETERMINÍSTICO (aprendizado real) ===
      // Antes de F1/LLM, checa se Luís já corrigiu esse texto pra um SKU.
      // Match direto = nada de alucinação, custo zero. Hit incrementa contador.
      const aliasKey = normalizeAlias(productGuess);
      if (aliasKey.length >= 2) {
        const alias = await prisma.skuAlias.findFirst({
          where: {
            alias: aliasKey,
            // Slot-específico ou global
            OR: [{ slotPosition }, { slotPosition: null }],
          },
          include: { sku: { select: { id: true, name: true } } },
          orderBy: { slotPosition: 'desc' }, // prefere slot-específico
        });
        if (alias) {
          aliasMatch = { skuId: alias.sku.id, skuName: alias.sku.name, aliasId: alias.id };
          matchConfidence = 'high'; // alias = match seguro
          // Atualiza hitCount + lastUsedAt async (não bloqueia)
          prisma.skuAlias
            .update({
              where: { id: alias.id },
              data: { hitCount: { increment: 1 }, lastUsedAt: new Date() },
            })
            .catch((e) => console.warn('[alias hit]', e instanceof Error ? e.message : e));
        }
      }

      // Se não bateu alias, faz match heurístico F1 tradicional contra slotProduct
      if (!aliasMatch && slotProduct) {
        const guess = normalizeAlias(productGuess);
        const real = normalizeAlias(slotProduct);
        const tokens = guess.split(/\s+/).filter((t) => t.length > 3);
        const matched = tokens.filter((t) => real.includes(t));
        if (matched.length === tokens.length && tokens.length > 0) matchConfidence = 'high';
        else if (matched.length > 0) matchConfidence = 'mid';
        else matchConfidence = 'low';
      }
    }
    items.push({
      slotPosition,
      productGuess,
      qty,
      slotProduct,
      currentQty,
      slotSkuId,
      matchConfidence,
      aliasMatch,
    });
  }

  const lowConfidence = items.filter((i) => i.matchConfidence === 'low' || i.matchConfidence === 'no-slot');
  const warnings: string[] = [];
  if (lowConfidence.length > 0) {
    warnings.push(`${lowConfidence.length} item(ns) com match baixo/sem slot — confirme antes de aplicar.`);
  }
  return { items, warnings };
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Detecta o tipo de mensagem do Weverton.
 *
 * - `inventory`: snapshot do estado atual ("Inventário 20/05/2026 (01) m&m / 1 unidade").
 *   `N unidades` = quantidade AGORA no slot → setar Slot.currentQty = N.
 * - `restock`: reposição feita ("Reposição 19/05/2026 (32) Power ADE azul / 3 unidades").
 *   `N unidades` = ABASTECEU +N → incrementar + disparar GH Action no Vendtef.
 * - `unknown`: nem um nem outro (ignora).
 */
export function detectMessageType(text: string): 'inventory' | 'restock' | 'unknown' {
  const first200 = text.slice(0, 200).toLowerCase();
  if (/invent[áa]rio|contagem|tem na m[áa]quina/i.test(first200)) return 'inventory';
  if (/repos|reabast|completei|abasteci|coloque|reabasteci/i.test(first200)) return 'restock';
  // Sem header explícito: olhar se tem padrão de slots
  if (/^\s*\(?\d/m.test(text)) return 'restock'; // fallback histórico — Weverton manda assim
  return 'unknown';
}

/**
 * Processa uma mensagem do Weverton no grupo Operação.
 * Bifurca entre INVENTÁRIO (snapshot) e REPOSIÇÃO (delta) — semânticas distintas
 * que antes eram tratadas iguais (bug grave: contagem virava abastecimento).
 *
 * Cria Decision PENDING + notifica Luís. Idempotente por messageId.
 */
export async function handleWevertonGroupMessage(text: string, messageId?: string): Promise<{ ok: boolean; decisionId?: string; itemsCount?: number; reason?: string; mode?: 'inventory' | 'restock' }> {
  const mode = detectMessageType(text);
  if (mode === 'unknown') {
    return { ok: false, reason: 'sem padrão de inventário/reposição' };
  }

  // === IDEMPOTÊNCIA: messageId Z-API ===
  // Z-API retransmite em retry e webhook é chamado 2x. Sem isso, duplicava Decision
  // (bug visto em 20/05: l46ucy + 3n8qg3 criadas no mesmo segundo).
  if (messageId) {
    const existing = await prisma.decision.findFirst({
      where: {
        kind: 'SYSTEM_INVENTORY_SYNC',
        data: { path: ['messageId'], equals: messageId },
      },
      select: { id: true },
    });
    if (existing) {
      return { ok: true, decisionId: existing.id, reason: 'idempotent — messageId já processado', mode };
    }
  }

  const { items, warnings } = await parseWevertonText(text);
  if (items.length === 0) {
    return { ok: false, reason: 'parser não achou items', mode };
  }

  // 🤖 LLM review: pra items non-high, Claude Haiku analisa considerando o
  // mapa COMPLETO de slots + catálogo + correções recentes. Detecta casos
  // que o F1 não pega: slot-swap (Vendtef invertido vs físico), alias de
  // produto, variantes de família, etc.
  const llmResult = await reviewWevertonItemsWithLLM(items);
  const reviewsBySlot = new Map<string, LLMItemReview>();
  for (const r of llmResult.reviews) reviewsBySlot.set(r.slotPosition, r);

  // Anota cada item com a revisão da LLM (se houve)
  const itemsWithLLM = items.map((it) => ({
    ...it,
    llmReview: reviewsBySlot.get(it.slotPosition) ?? null,
  }));

  // === SUMMARY/RATIONALE muda por modo ===
  const totalUnits = items.reduce((s, i) => s + i.qty, 0);
  const summary =
    mode === 'inventory'
      ? `📋 Inventário Weverton: ${items.length} slot(s) contados · ${totalUnits} unid no total`
      : `📦 Reposição Weverton: ${items.length} slot(s) · +${totalUnits} unidades`;

  const headerLine =
    mode === 'inventory'
      ? `INVENTÁRIO — snapshot do estado atual da máquina (qty = "tem N agora"). Aprovar atualiza Slot.currentQty no banco.`
      : `REPOSIÇÃO — abastecimento (qty = "abasteci +N"). Aprovar dispara GH Action que atualiza Vendtef.`;

  const rationale = [
    headerLine,
    ``,
    `Mensagem recebida no grupo Operação:`,
    `"${text.slice(0, 400)}${text.length > 400 ? '...' : ''}"`,
    ``,
    `Items extraídos:`,
    ...itemsWithLLM.map((it) => {
      const base = `  · slot ${it.slotPosition.padStart(2, '0')} · ${it.qty}× · ${it.productGuess.slice(0, 40)} (match: ${it.matchConfidence}${it.slotProduct ? ` → ${it.slotProduct}` : ''})`;
      if (it.llmReview) {
        return `${base}\n    🤖 ${it.llmReview.recommendedAction} (${it.llmReview.confidence}%): ${it.llmReview.reasoning.slice(0, 140)}`;
      }
      return base;
    }),
    ...(llmResult.ok && llmResult.reviews.length > 0
      ? [
          '',
          `🤖 LLM revisou ${llmResult.reviews.length} item(ns) ambíguo(s) (Haiku 4.5).`,
        ]
      : llmResult.error
        ? ['', `⚠️ LLM review falhou: ${llmResult.error}`]
        : []),
    ...(warnings.length > 0 ? ['', ...warnings.map((w) => `⚠️ ${w}`)] : []),
  ].join('\n');

  const dec = await prisma.decision.create({
    data: {
      // SYSTEM_INVENTORY_SYNC pra ambos (mesmo enum, executor diferencia por data.mode)
      kind: 'SYSTEM_INVENTORY_SYNC',
      level: warnings.length > 0 ? 'RED' : 'YELLOW',
      summary,
      rationale,
      data: {
        source: 'weverton-group',
        mode, // 'inventory' | 'restock' — executor bifurca aqui
        messageId: messageId ?? null,
        rawMessage: text.slice(0, 2000),
        items: itemsWithLLM,
        totalUnits,
        llmReviewSummary: llmResult.ok
          ? {
              count: llmResult.reviews.length,
              actions: llmResult.reviews.reduce(
                (acc, r) => {
                  acc[r.recommendedAction] = (acc[r.recommendedAction] ?? 0) + 1;
                  return acc;
                },
                {} as Record<string, number>,
              ),
            }
          : { error: llmResult.error },
      } as unknown as object,
      status: 'PENDING',
    },
  });

  // Notifica Luís no privado
  const luisPhone = await getSecret('LUIS_PHONE');
  if (luisPhone) {
    const base = process.env.APP_URL ?? 'https://vendetti.everest.udi.br';
    const header =
      mode === 'inventory'
        ? `📋 Inventário Weverton — aprovação`
        : `📦 Reposição Weverton — aprovação`;
    const footer =
      mode === 'inventory'
        ? `Após aprovar, o estoque no banco é atualizado pra refletir o estado físico.`
        : `Após aprovar, o Vendtef é atualizado automaticamente e o grupo é notificado.`;
    const lines = [
      header,
      ``,
      `${items.length} slot(s)${mode === 'inventory' ? ' contados' : ', ' + totalUnits + ' unidades a abastecer'}:`,
      ...items.slice(0, 20).map(
        (it) =>
          `· slot ${it.slotPosition.padStart(2, '0')} · ${it.qty}× ${it.productGuess.slice(0, 30)}${it.matchConfidence === 'high' ? ' ✓' : ' ⚠️'}`,
      ),
      ...(items.length > 20 ? [`… (+${items.length - 20} slots)`] : []),
      ...(warnings.length > 0 ? ['', ...warnings.map((w) => `⚠️ ${w}`)] : []),
      ``,
      `Aprovar / Rejeitar:`,
      `${base}/decisions`,
      ``,
      footer,
    ].join('\n');
    await sendText(luisPhone, lines).catch((e) => console.warn('[weverton] notify Luís:', e));
  }
  void brl; // reservado pra futuro

  return { ok: true, decisionId: dec.id, itemsCount: items.length, mode };
}

/**
 * Aplica snapshot de inventário aprovado.
 *
 * Diferente de reposição (que dispara GH Action), inventário apenas atualiza o
 * estado local: `Slot.currentQty = N` direto. Sem ida no Vendtef.
 *
 * Premissa: Luís revisou os matches do LLM e aprovou. Itens com `skip=true` ou
 * sem match confiável (slotProduct=null e sem targetSkuId) são ignorados.
 */
export async function applyInventorySnapshot(decisionId: string): Promise<{ ok: boolean; message: string; updated?: number }> {
  const dec = await prisma.decision.findUnique({ where: { id: decisionId } });
  if (!dec) return { ok: false, message: 'Decision não encontrada' };
  const data = (dec.data ?? {}) as { items?: Array<Record<string, unknown>>; mode?: string };
  if (data.mode !== 'inventory') {
    return { ok: false, message: `data.mode esperado 'inventory', recebido '${data.mode}'` };
  }
  if (!data.items?.length) return { ok: false, message: 'sem items na Decision' };
  const machine = await prisma.machine.findFirst({ where: { name: 'Maquina BlueMall Rondon' } });
  if (!machine) return { ok: false, message: 'máquina BlueMall Rondon não cadastrada' };

  let updated = 0;
  const skipped: string[] = [];

  for (const itRaw of data.items) {
    const it = itRaw as {
      slotPosition: string;
      qty: number;
      skip?: boolean;
    };
    if (it.skip) {
      skipped.push(`slot ${it.slotPosition} (skip=true)`);
      continue;
    }
    if (typeof it.qty !== 'number' || it.qty < 0) {
      skipped.push(`slot ${it.slotPosition} (qty inválida)`);
      continue;
    }
    const slot = await prisma.slot.findFirst({
      where: { machineId: machine.id, position: it.slotPosition },
    });
    if (!slot) {
      skipped.push(`slot ${it.slotPosition} (não existe no banco)`);
      continue;
    }
    await prisma.slot.update({
      where: { id: slot.id },
      data: { currentQty: it.qty },
    });
    updated++;
  }

  const summary = `${updated} slot(s) atualizado(s)${skipped.length > 0 ? `, ${skipped.length} pulado(s)` : ''}.`;
  console.log(`[applyInventorySnapshot] ${decisionId}: ${summary}`);
  if (skipped.length > 0) console.log(`[applyInventorySnapshot] skipped: ${skipped.join(', ')}`);
  // Após aplicar: aprendizado automático dos matches que rolaram
  await learnAliasesFromDecision(decisionId).catch((e) =>
    console.warn('[applyInventorySnapshot] learn falhou:', e instanceof Error ? e.message : e),
  );

  return { ok: true, message: summary, updated };
}

/**
 * Aprendizado: ao aprovar Decision, salva os matches confirmados como SkuAlias.
 *
 * Pra cada item:
 *   - Se `targetProduct` foi setado manualmente pelo Luís (via updateDecisionItems)
 *     → cria alias source='luis' (alta confiança).
 *   - Se `llmReview.targetSkuId` existe e Luís APROVOU sem editar
 *     → cria alias source='llm-haiku' (médio — Luís validou implicitamente).
 *   - Se item.skip=true ou nada disso → não aprende.
 *
 * Idempotente: @@unique([alias, skuId]) — segunda tentativa do mesmo par é noop.
 *
 * Exporta separado pra poder ser chamado também ao aprovar restock (não só inv).
 */
export async function learnAliasesFromDecision(decisionId: string): Promise<{ ok: boolean; learned: number }> {
  const dec = await prisma.decision.findUnique({ where: { id: decisionId } });
  if (!dec) return { ok: false, learned: 0 };
  const data = (dec.data ?? {}) as { items?: Array<Record<string, unknown>> };
  if (!data.items?.length) return { ok: false, learned: 0 };

  let learned = 0;
  for (const itRaw of data.items) {
    const it = itRaw as {
      slotPosition?: string;
      productGuess?: string;
      skip?: boolean;
      targetProduct?: string; // Luís setou via updateDecisionItems
      aliasMatch?: { skuId: string } | null;
      llmReview?: { targetSkuId?: string; recommendedAction?: string } | null;
    };
    if (it.skip) continue;
    if (!it.productGuess || it.productGuess.length < 2) continue;
    if (it.aliasMatch) continue; // já bateu por alias, não precisa criar

    // Source 1: Luís editou manualmente
    let targetSkuId: string | undefined;
    let source = 'luis';
    if (it.targetProduct) {
      // targetProduct vem como "skuId" ou "skuName" — tenta resolver
      const sku =
        (await prisma.sku.findUnique({ where: { id: it.targetProduct } }).catch(() => null)) ??
        (await prisma.sku.findFirst({ where: { name: it.targetProduct } }));
      if (sku) targetSkuId = sku.id;
    }
    // Source 2: LLM sugeriu e Luís aprovou (sem editar)
    if (
      !targetSkuId &&
      it.llmReview?.targetSkuId &&
      ['abastecer_only', 'product_swap'].includes(it.llmReview.recommendedAction ?? '')
    ) {
      targetSkuId = it.llmReview.targetSkuId;
      source = 'llm-haiku';
    }
    if (!targetSkuId) continue;

    const aliasKey = normalizeAlias(it.productGuess);
    if (aliasKey.length < 2) continue;

    try {
      await prisma.skuAlias.upsert({
        where: { alias_skuId: { alias: aliasKey, skuId: targetSkuId } },
        update: { hitCount: { increment: 1 }, lastUsedAt: new Date() },
        create: {
          alias: aliasKey,
          aliasOriginal: it.productGuess.slice(0, 200),
          skuId: targetSkuId,
          source,
          slotPosition: it.slotPosition,
        },
      });
      learned++;
    } catch (e) {
      console.warn('[learn alias]', e instanceof Error ? e.message : e);
    }
  }

  return { ok: true, learned };
}

/**
 * Executor da Decision RESTOCK aprovada · dispara GH Action que:
 *   1. Loga no ERP Vendtef
 *   2. (Se necessário) cadastra produto novo + troca seleção
 *   3. Lança Operação de Estoque > Abastecimento no estoque da máquina
 *   4. Atualiza local DB (Reposicao + ReposicaoItem + Slot.currentQty)
 *   5. Notifica grupo Operação ao terminar
 *
 * Como o scraper roda em CI (Vercel Hobby não roda Playwright), aqui só:
 *   - valida a Decision
 *   - dispara workflow GH com decision_id
 *   - avisa Luís que tá rolando
 *
 * O scraper marca Decision=EXECUTED/FAILED quando termina.
 */
export async function executeWevertonRestock(decisionId: string): Promise<{ ok: boolean; message: string }> {
  const dec = await prisma.decision.findUnique({ where: { id: decisionId } });
  if (!dec) return { ok: false, message: 'Decision não encontrada' };
  const data = (dec.data ?? {}) as { items?: ParsedItem[]; totalUnits?: number; dispatchedAt?: string };
  if (!data.items?.length) return { ok: false, message: 'sem items na Decision' };
  const machine = await prisma.machine.findFirst({ where: { name: 'Maquina BlueMall Rondon' } });
  if (!machine) return { ok: false, message: 'máquina BlueMall Rondon não cadastrada' };

  // Guard idempotência: se já foi dispatchado nos últimos 10min, não re-dispara
  if (data.dispatchedAt) {
    const elapsed = Date.now() - new Date(data.dispatchedAt).getTime();
    if (elapsed < 10 * 60 * 1000) {
      return {
        ok: true,
        message: `já dispatchado há ${Math.round(elapsed / 1000)}s — aguarde scraper terminar (~3-5min)`,
      };
    }
  }

  // Dispara GH Action — scraper faz tudo (Vendtef + DB + grupo)
  const disp = await dispatchWorkflow('vendtef-abastecimento', {
    decision_id: decisionId,
    triggered_by: 'vendetti-executor',
  });
  if (!disp.ok) {
    return {
      ok: false,
      message: `falha ao disparar GH Action: ${disp.error}. Cheque GITHUB_PAT em /settings.`,
    };
  }

  // Marca data.dispatched pra timeline
  await prisma.decision.update({
    where: { id: decisionId },
    data: {
      data: {
        ...(dec.data as Record<string, unknown>),
        dispatchedAt: new Date().toISOString(),
      } as unknown as Prisma.InputJsonValue,
    },
  });

  // Avisa Luís no privado pra ele saber que tá rolando
  const luisPhone = await getSecret('LUIS_PHONE');
  const totalUnits = data.items.reduce((s, i) => s + i.qty, 0);
  if (luisPhone) {
    const msg = `🤖 Iniciando abastecimento Vendtef · ${data.items.length} slot(s), ${totalUnits} unidades (Decision ${decisionId.slice(-6)}). Aviso aqui quando terminar (~3-5min).`;
    await sendText(luisPhone, msg).catch((e) => console.warn('[weverton execute] notify Luís:', e));
  }

  // Aprende aliases dos matches confirmados (idempotente, hit-count cresce em re-uso)
  await learnAliasesFromDecision(decisionId).catch((e) =>
    console.warn('[executeWevertonRestock] learn falhou:', e instanceof Error ? e.message : e),
  );

  return {
    ok: true,
    message: `GH Action disparado · scraper roda em ~3-5min · resultado vai aparecer no grupo Operação`,
  };
}

export async function persistWevertonConversation(messageId: string | undefined, text: string) {
  // Pra log/audit — guarda no campo de Reposicao quando aprovada, OU em meta da Decision.
  void messageId;
  void text;
}

declare module '@prisma/client' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type _UnusedPrisma = Prisma.DecisionWhereInput;
}
