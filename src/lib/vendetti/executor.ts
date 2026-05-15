/**
 * Executor de Decisions APPROVED.
 *
 * Lê uma Decision e dispara a ação real no Vendtef (via scraper update-slot).
 * Atualiza status pra EXECUTED ou AWAITING_PHYSICAL (se mudança de preço).
 * Pra preço, também tenta notificar o grupo "Operação TCN Vending Machine".
 */

import { prisma } from '../db';
import { executeSlotUpdate } from '../../scrapers/vendtef/update-slot-core';
import { sendToOperacaoGroup, sendText } from '../zapi/send';
import { getSecret } from '../secrets';

export interface ExecuteResult {
  ok: boolean;
  newStatus: string;
  message: string;
}

export async function executeDecision(decisionId: string, executor = 'admin'): Promise<ExecuteResult> {
  const d = await prisma.decision.findUnique({ where: { id: decisionId } });
  if (!d) return { ok: false, newStatus: 'NOT_FOUND', message: 'Decision não encontrada' };
  if (d.status !== 'APPROVED') {
    return { ok: false, newStatus: d.status, message: `Status deve ser APPROVED, está ${d.status}` };
  }

  const data = (d.data as { selecao?: string; changes?: { capacity?: number; price?: number } }) ?? {};
  const selecao = data.selecao;
  const changes = data.changes ?? {};

  if (!selecao) {
    await prisma.decision.update({ where: { id: decisionId }, data: { status: 'FAILED' } });
    return { ok: false, newStatus: 'FAILED', message: 'selecao ausente em decision.data' };
  }
  if (changes.capacity === undefined && changes.price === undefined) {
    await prisma.decision.update({ where: { id: decisionId }, data: { status: 'FAILED' } });
    return { ok: false, newStatus: 'FAILED', message: 'nenhuma mudança em decision.data.changes' };
  }

  console.log(`[executor] Decision ${decisionId.slice(0, 8)} · slot ${selecao} · changes=${JSON.stringify(changes)}`);

  // Dispara o scraper
  const result = await executeSlotUpdate(selecao, {
    capacity: changes.capacity,
    price: changes.price,
  });

  if (!result.ok) {
    await prisma.decision.update({
      where: { id: decisionId },
      data: { status: 'FAILED' },
    });
    return { ok: false, newStatus: 'FAILED', message: result.error ?? 'scraper falhou' };
  }

  // Sucesso no sistema. Se foi preço, ainda precisa físico (Weverton)
  const isPriceChange = changes.price !== undefined;
  const newStatus: 'EXECUTED' | 'AWAITING_PHYSICAL' = isPriceChange ? 'AWAITING_PHYSICAL' : 'EXECUTED';

  await prisma.decision.update({
    where: { id: decisionId },
    data: {
      status: newStatus,
      executedAt: new Date(),
      approvedBy: executor,
    },
  });

  // Se preço, notifica grupo. Se falhar Z-API, ainda OK — status já mudou
  if (isPriceChange) {
    const beforePrice = result.before?.preco ?? '?';
    const afterPrice = result.after?.preco ?? '?';
    const msg = `🤖 Vendetti: Slot ${selecao} (${result.before?.pid ?? 'produto'}) — preço atualizado no sistema de R$ ${beforePrice} → R$ ${afterPrice}. Weverton, quando der pra ajustar no display físico responde "feito" aqui no grupo, por favor. 🙏`;

    const groupId = await getSecret('OPERACAO_GROUP_ID');
    if (groupId) {
      const sent = await sendToOperacaoGroup(msg);
      if (!sent.ok) console.warn(`[executor] falhou ao notificar grupo: ${sent.error}`);
    } else {
      // Fallback: notifica Luís direto se não tiver group ID
      const luisPhone = await getSecret('LUIS_PHONE');
      if (luisPhone) {
        await sendText(luisPhone, msg).catch((e) => console.warn('[executor] fallback Luís falhou:', e));
      }
    }
  }

  return {
    ok: true,
    newStatus,
    message: `slot ${selecao}: capacity ${result.before?.capacidade}→${result.after?.capacidade} · preço ${result.before?.preco}→${result.after?.preco}`,
  };
}
