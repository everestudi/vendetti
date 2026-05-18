/**
 * CLI driver do Abastecimento Vendtef.
 *
 * Lê uma Decision aprovada (DECISION_ID env ou argv) com items reportados pelo
 * Weverton, executa o scraper (abastecimento-core), atualiza DB e notifica grupo.
 *
 * Estados Decision:
 *   - APPROVED (entrada): Luís aprovou em /decisions, scraper roda
 *   - EXECUTED: scraper terminou com sucesso, Vendtef + DB sincronizados
 *   - FAILED: scraper falhou, Luís precisa intervir
 *
 * Uso local:
 *   DECISION_ID=abc... npm run vendtef:abastecimento
 *
 * Em CI: GH Actions vendtef-abastecimento.yml passa DECISION_ID via client_payload.
 */

import { prisma } from '../../lib/db';
import { runWithWorkerLog } from '../../lib/infra/health';
import { runAbastecimento, type AbastecimentoItemInput, type AbastecimentoItemResult } from './abastecimento-core';
import { sendToOperacaoGroup, sendText } from '../../lib/zapi/send';
import { getSecret } from '../../lib/secrets';
import type { Prisma } from '@prisma/client';

interface DecisionItem {
  slotPosition: string;
  productGuess: string;
  qty: number;
  slotProduct: string | null;
  matchConfidence: 'high' | 'mid' | 'low' | 'no-slot';
  /** Override manual: nome do produto que deve ficar na seleção. Setado quando
   *  Luís corrige a Decision com `targetProduct` antes de aprovar. */
  targetProduct?: string;
  /** Marcar pra pular esse item específico (Luís marca em /decisions). */
  skip?: boolean;
  /** Dados pra cadastrar produto NOVO no Vendtef (custo, categoria, fornecedor).
   *  Preenchido pelo Luís na UI quando o targetProduct não tá no catálogo. */
  newProductData?: {
    cost?: number;
    category?: string;
    supplier?: 'ATACADAO' | 'VITTAL' | 'OUTRO';
  };
}

async function loadDecision(decisionId: string) {
  const dec = await prisma.decision.findUnique({ where: { id: decisionId } });
  if (!dec) throw new Error(`Decision ${decisionId} não existe`);
  if (dec.kind !== 'SYSTEM_INVENTORY_SYNC') throw new Error(`Decision ${decisionId} não é SYSTEM_INVENTORY_SYNC (${dec.kind})`);
  const data = (dec.data ?? {}) as Record<string, unknown>;
  if (data.source !== 'weverton-group') throw new Error(`Decision ${decisionId} não é de weverton-group (source=${data.source})`);
  if (!Array.isArray(data.items) || data.items.length === 0) throw new Error('Decision sem items');
  return { decision: dec, items: data.items as DecisionItem[] };
}

async function buildInputs(items: DecisionItem[]): Promise<AbastecimentoItemInput[]> {
  const machine = await prisma.machine.findFirst({ where: { name: 'Maquina BlueMall Rondon' } });
  if (!machine) throw new Error('Maquina BlueMall Rondon não cadastrada no DB');

  const out: AbastecimentoItemInput[] = [];
  for (const it of items) {
    if (it.skip) continue; // Luís marcou como skip em /decisions
    const slot = await prisma.slot.findFirst({
      where: { machineId: machine.id, position: it.slotPosition },
      include: { sku: true },
    });
    const currentSlotProduct = slot?.sku?.name ?? null;

    // Decisão de swap:
    //  - Se Luís preencheu targetProduct manualmente, usa isso
    //  - Senão, se matchConfidence='low' OU productGuess diferente do slotProduct,
    //    assume que Weverton trocou e usa productGuess como alvo
    let targetProductName: string | undefined;
    if (it.targetProduct) {
      targetProductName = it.targetProduct;
    } else if (it.matchConfidence === 'low' && currentSlotProduct) {
      // baixa confiança = provável troca. Vendtef vai precisar saber.
      // Se productGuess parece um produto real (3+ tokens), tenta usar
      targetProductName = it.productGuess;
    }

    out.push({
      slotPosition: it.slotPosition,
      qty: it.qty,
      targetProductName,
      currentSlotProduct,
      newProductData: it.newProductData,
    });
  }
  return out;
}

/**
 * Aplica os resultados no banco: cria Reposicao + ReposicaoItem (audit do
 * evento físico do Weverton), atualiza Slot.currentQty otimisticamente, marca
 * Decision como EXECUTED/FAILED.
 */
async function persistResults(
  decisionId: string,
  inputs: AbastecimentoItemInput[],
  itemResults: AbastecimentoItemResult[],
  overallOk: boolean,
  errorMsg: string | undefined,
): Promise<void> {
  const machine = await prisma.machine.findFirst({ where: { name: 'Maquina BlueMall Rondon' } });
  if (!machine) {
    console.warn('  ⚠ máquina sumiu do DB? Pulando persistência');
    return;
  }

  // Cria Reposicao só pros items que efetivamente foram aplicados no Vendtef
  const okItems = itemResults.filter((r) => r.ok);
  if (okItems.length > 0) {
    const reposicao = await prisma.reposicao.create({
      data: {
        reportedBy: 'weverton',
        source: 'WHATSAPP_AUGUSTO',
        notes: `Decision ${decisionId.slice(-6)} executada pelo scraper`,
      },
    });
    for (const it of okItems) {
      const slot = await prisma.slot.findFirst({
        where: { machineId: machine.id, position: it.slotPosition },
        include: { sku: true },
      });
      if (!slot?.skuId) continue;
      const newQty = Math.min(slot.currentQty + it.qty, slot.capacity);
      await prisma.reposicaoItem
        .create({
          data: {
            reposicaoId: reposicao.id,
            skuId: slot.skuId,
            slotPosition: it.slotPosition,
            qty: it.qty,
          },
        })
        .catch((e) => console.warn(`  ⚠ reposicaoItem ${it.slotPosition}:`, e instanceof Error ? e.message : e));
      await prisma.slot
        .update({ where: { id: slot.id }, data: { currentQty: newQty } })
        .catch((e) => console.warn(`  ⚠ slot.update ${it.slotPosition}:`, e instanceof Error ? e.message : e));
    }
  }

  // Atualiza Decision
  await prisma.decision.update({
    where: { id: decisionId },
    data: {
      status: overallOk ? 'EXECUTED' : 'FAILED',
      executedAt: overallOk ? new Date() : null,
      data: {
        // Anexa resultados no .data sem perder o original
        ...((await prisma.decision.findUnique({ where: { id: decisionId } }))?.data as Record<string, unknown> ?? {}),
        scraperResults: itemResults as unknown as Prisma.InputJsonValue,
        scraperRanAt: new Date().toISOString(),
        scraperError: errorMsg ?? null,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

async function notifyGroup(
  decisionId: string,
  itemResults: AbastecimentoItemResult[],
  overallOk: boolean,
  errorMsg: string | undefined,
): Promise<void> {
  const okItems = itemResults.filter((r) => r.ok);
  const failItems = itemResults.filter((r) => !r.ok);
  const totalUnits = okItems.reduce((s, i) => s + i.qty, 0);

  if (overallOk) {
    const msg = `✅ Reposição atualizada no Vendtef: ${okItems.length} slot(s), ${totalUnits} unidades. Sistema sincronizado.`;
    const sent = await sendToOperacaoGroup(msg);
    if (!sent.ok) console.warn(`  ⚠ notify grupo: ${sent.error}`);
    return;
  }

  // Falha — notifica Luís no privado com detalhes
  const luisPhone = await getSecret('LUIS_PHONE');
  if (luisPhone) {
    const lines = [
      `⚠️ Abastecimento Vendtef falhou (Decision ${decisionId.slice(-6)})`,
      ``,
      errorMsg ? `Erro: ${errorMsg.slice(0, 200)}` : '',
      ``,
      `Sucesso: ${okItems.length}/${itemResults.length}`,
      ...failItems.slice(0, 8).map((f) => `· slot ${f.slotPosition} (${f.qty}×): ${f.error?.slice(0, 80) ?? 'erro desconhecido'}`),
      ``,
      `Artifacts no GH Action pra debug.`,
    ].filter(Boolean).join('\n');
    await sendText(luisPhone, lines).catch((e) => console.warn('  ⚠ notify Luís:', e));
  }

  // Notifica grupo se parcialmente OK
  if (okItems.length > 0) {
    const msg = `⚠️ Reposição parcialmente registrada no Vendtef: ${okItems.length}/${itemResults.length} slots ok. Luís foi avisado.`;
    await sendToOperacaoGroup(msg).catch(() => undefined);
  }
}

async function main() {
  const decisionId = process.argv[2] || process.env.DECISION_ID;
  if (!decisionId) {
    console.error('Uso: DECISION_ID=<id> npm run vendtef:abastecimento');
    process.exit(1);
  }

  console.log(`=== Abastecimento Decision ${decisionId} ===`);
  const { decision, items } = await loadDecision(decisionId);
  console.log(`  ${items.length} item(ns) na Decision (status=${decision.status})`);

  if (decision.status !== 'APPROVED') {
    console.error(`  ✗ Decision não está APPROVED (status=${decision.status}). Aborting.`);
    process.exit(1);
  }

  const inputs = await buildInputs(items);
  console.log('  inputs:');
  for (const inp of inputs) {
    const swap = inp.targetProductName && inp.currentSlotProduct
      ? ` (swap: "${inp.currentSlotProduct}" → "${inp.targetProductName}")`
      : '';
    console.log(`    · slot ${inp.slotPosition.padStart(2, '0')} · ${inp.qty}×${swap}`);
  }

  const result = await runAbastecimento(inputs);
  console.log(`\n=== resultado: ok=${result.ok}${result.error ? ` · err=${result.error}` : ''} ===`);
  for (const r of result.items) {
    const flag = r.ok ? '✓' : '✗';
    const extra = [
      r.productSwapped ? 'swap-ok' : '',
      r.productCreated ? 'created' : '',
      r.error ? `err=${r.error.slice(0, 60)}` : '',
    ].filter(Boolean).join(' ');
    console.log(`  ${flag} slot ${r.slotPosition}${extra ? ` · ${extra}` : ''}`);
  }

  await persistResults(decisionId, inputs, result.items, result.ok, result.error);
  await notifyGroup(decisionId, result.items, result.ok, result.error);

  if (!result.ok) process.exit(1);
}

runWithWorkerLog('vendtef_abastecimento', main).catch((err) => {
  console.error(err);
  process.exit(1);
});
