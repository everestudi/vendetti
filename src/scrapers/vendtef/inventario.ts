/**
 * CLI driver — aplica Operação de Inventário no Vendtef pra uma Decision
 * inventário aprovada.
 *
 * Caminho oficial (confirmado pelo Luís):
 *   portalvendtef > Operações de estoque > Nova operação > tipoOperacao=
 *   Inventário > funcionário=Weverton > preenche Qtde por slot > Salvar.
 *
 * Regra crítica: TODOS os slots devem ter Qtde preenchida. Se Weverton não
 * mandou pra um slot, repete o "Disponível" atual.
 *
 * Ao terminar:
 *   - data.inventarioVendtefBefore: snapshot do "Disponível" antes do save
 *   - data.inventarioVendtefApplied: qty efetivamente lançada + source
 *   - data.inventarioVendtefCompletedAt: timestamp do término
 *   - Atualiza Slot.currentQty no banco pra refletir o que foi salvo
 *
 * Uso: DECISION_ID=abc... npm run vendtef:inventario
 */

import { prisma } from '../../lib/db';
import { runWithWorkerLog } from '../../lib/infra/health';
import { runInventarioMaquina } from './abastecimento-core';

interface DecisionItem {
  slotPosition: string;
  qty: number;
  skip?: boolean;
}

async function main() {
  const decisionId = process.env.DECISION_ID;
  if (!decisionId) {
    console.error('❌ DECISION_ID env obrigatório');
    process.exit(1);
  }

  await runWithWorkerLog('vendtef_inventario', async () => {
    const dec = await prisma.decision.findUnique({ where: { id: decisionId } });
    if (!dec) throw new Error(`Decision ${decisionId} não encontrada`);

    const data = (dec.data ?? {}) as Record<string, unknown>;
    const items = (data.items as DecisionItem[] | undefined) ?? [];
    if (items.length === 0) {
      console.log('Nada a fazer — items vazio');
      return { skipped: true };
    }

    console.log(`📋 Aplicando Inventário no Vendtef · Decision ${decisionId.slice(-6)} · ${items.length} slot(s) reportados`);

    // Mapeia items → { slotPosition, qty } (sem skipped)
    const inputItems = items.map((it) => ({
      slotPosition: it.slotPosition,
      qty: it.skip ? null : it.qty,
      skip: it.skip,
    }));

    const r = await runInventarioMaquina(inputItems);

    if (r.ok) {
      console.log(`\n✅ Inventário lançado · ${r.applied.length} slot(s)`);
      const fromWeverton = r.applied.filter((a) => a.source === 'weverton').length;
      const repeated = r.applied.filter((a) => a.source === 'repeat-disponivel').length;
      const skipped = r.applied.filter((a) => a.source === 'skip').length;
      console.log(`  ${fromWeverton} do Weverton · ${repeated} repetidos do "Disponível" · ${skipped} pulados`);
    } else {
      console.error(`\n⚠️ Falhou: ${r.generalError ?? '—'}`);
    }

    // === Atualiza Slot.currentQty no banco ===
    // Espelha o que foi lançado no Vendtef pra banco refletir
    if (r.ok || r.applied.length > 0) {
      const machine = await prisma.machine.findFirst({ where: { name: 'Maquina BlueMall Rondon' } });
      if (machine) {
        const allSlots = await prisma.slot.findMany({
          where: { machineId: machine.id },
          select: { id: true, position: true },
        });
        const slotMap = new Map(allSlots.map((s) => [s.position.replace(/\D/g, ''), s.id]));
        const updates = [];
        for (const a of r.applied) {
          const norm = a.slotPosition.replace(/\D/g, '');
          const slotId = slotMap.get(norm);
          if (slotId) {
            updates.push(prisma.slot.update({ where: { id: slotId }, data: { currentQty: a.qtyApplied } }));
          }
        }
        await Promise.all(updates);
        console.log(`✓ ${updates.length} Slot.currentQty atualizados no banco`);
      }
    }

    await prisma.decision.update({
      where: { id: decisionId },
      data: {
        data: {
          ...data,
          inventarioVendtefBefore: r.beforeSnapshot,
          inventarioVendtefApplied: r.applied,
          inventarioVendtefCompletedAt: new Date().toISOString(),
          inventarioVendtefGeneralError: r.generalError ?? null,
        } as unknown as object,
      },
    });

    return {
      decisionId,
      total: items.length,
      ok: r.ok,
      generalError: r.generalError ?? null,
    };
  });

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
