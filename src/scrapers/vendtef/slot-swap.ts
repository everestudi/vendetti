/**
 * CLI driver — aplica swaps de produto no Vendtef pra uma Decision aprovada.
 *
 * Lê data.pendingVendtefSwaps da Decision, executa runSlotSwapsOnly via
 * Playwright, e ao terminar:
 *   - Sucesso completo: remove pendingVendtefSwaps + libera manualOverrideAt
 *     dos slots (mara_sync volta a poder sincronizar)
 *   - Falha parcial/total: mantém pendentes + grava resultsLog na Decision
 *     pra Luís ver. manualOverrideAt continua setado (proteção).
 *
 * Uso local: DECISION_ID=abc... npm run vendtef:slot-swap
 * GH: workflow vendtef-slot-swap.yml passa via client_payload.
 */

import { prisma } from '../../lib/db';
import { runWithWorkerLog } from '../../lib/infra/health';
import { runSlotSwapsOnly } from './abastecimento-core';

interface PendingSwap {
  slotPosition: string;
  fromSkuName: string | null;
  toSkuName: string;
}

async function main() {
  const decisionId = process.env.DECISION_ID;
  if (!decisionId) {
    console.error('❌ DECISION_ID env obrigatório');
    process.exit(1);
  }

  await runWithWorkerLog('vendtef_slot_swap', async () => {
    const dec = await prisma.decision.findUnique({ where: { id: decisionId } });
    if (!dec) throw new Error(`Decision ${decisionId} não encontrada`);

    const data = (dec.data ?? {}) as Record<string, unknown>;
    const pending = (data.pendingVendtefSwaps as PendingSwap[] | undefined) ?? [];
    if (pending.length === 0) {
      console.log('Nada a fazer — pendingVendtefSwaps vazio');
      return { skipped: true };
    }

    const machine = await prisma.machine.findFirst({ where: { name: 'Maquina BlueMall Rondon' } });
    if (!machine) throw new Error('máquina BlueMall Rondon não cadastrada');

    console.log(`🔧 Aplicando ${pending.length} swap(s) no Vendtef pra Decision ${decisionId.slice(-6)}...`);
    pending.forEach((p) => console.log(`  · slot ${p.slotPosition}: ${p.fromSkuName ?? '—'} → ${p.toSkuName}`));

    const r = await runSlotSwapsOnly(
      pending.map((p) => ({ slotPosition: p.slotPosition, targetProductName: p.toSkuName })),
    );

    // Atualiza Decision e Slots conforme sucesso
    const succeededSlots = r.results.filter((x) => x.ok).map((x) => x.slotPosition);
    const failedResults = r.results.filter((x) => !x.ok);

    if (succeededSlots.length > 0) {
      // Libera manualOverrideAt dos slots que foram sincronizados no Vendtef —
      // agora Vendtef e banco estão alinhados, mara_sync pode voltar a operar.
      await prisma.slot.updateMany({
        where: { machineId: machine.id, position: { in: succeededSlots } },
        data: { manualOverrideAt: null },
      });
      console.log(`✓ ${succeededSlots.length} slot(s) liberados (manualOverrideAt=null)`);
    }

    // Atualiza Decision: remove os pendentes que deram sucesso, mantém os que falharam
    const remainingPending = pending.filter((p) => !succeededSlots.includes(p.slotPosition));
    const newData = {
      ...data,
      pendingVendtefSwaps: remainingPending,
      slotSwapResults: r.results,
      slotSwapCompletedAt: new Date().toISOString(),
    };
    await prisma.decision.update({
      where: { id: decisionId },
      data: { data: newData as unknown as object },
    });

    console.log(
      `\n${r.ok ? '✅' : '⚠️'} ${succeededSlots.length} sucessos, ${failedResults.length} falhas`,
    );
    if (failedResults.length > 0) {
      console.log('Falhas detalhadas:');
      failedResults.forEach((f) => console.log(`  ✗ slot ${f.slotPosition}: ${f.error}`));
    }

    return {
      decisionId,
      total: pending.length,
      succeeded: succeededSlots.length,
      failed: failedResults.length,
      ok: r.ok,
    };
  });

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
