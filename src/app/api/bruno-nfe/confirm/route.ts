/**
 * POST /api/bruno-nfe/confirm · persiste compra (Purchase + PurchaseItem) + atualiza SKUs.
 *
 * Body:
 *   {
 *     supplier: "ATACADAO"|"VITTAL"|"OUTRO",
 *     supplierName, invoiceRef, occurredAt (ISO), totalAmount, notes?, source?,
 *     items: [{ skuId?, productName, productCode?, qty, unitCost, totalCost }]
 *   }
 *
 * Pra cada item:
 *   - se skuId: atualiza cost (média ponderada com custo anterior) e supplierSkuCode
 *   - se skuId vazio: cria Sku novo com cost=unitCost, price=0
 *   - cria PurchaseItem vinculado
 */

import { NextResponse, after } from 'next/server';
import { prisma } from '@/lib/db';
import { getSecret } from '@/lib/secrets';
import type { Supplier } from '@prisma/client';
import { auditMatchCorrections } from '@/lib/vendetti/zelda';

async function triggerVendtefSync(purchaseId: string): Promise<{ ok: boolean; error?: string }> {
  const pat = await getSecret('GITHUB_PAT');
  if (!pat) return { ok: false, error: 'GITHUB_PAT ausente — sync manual via Actions' };
  const repo = (await getSecret('GITHUB_REPO')) || 'everestudi/vendetti';
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        event_type: 'vendtef-sync',
        client_payload: { purchase_id: purchaseId },
      }),
    });
    if (!r.ok) return { ok: false, error: `dispatch HTTP ${r.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export const runtime = 'nodejs';

interface ConfirmItem {
  skuId?: string | null;
  productName: string;
  productCode?: string | null;
  qty: number;
  unitCost: number;
  totalCost: number;
  /** Pra Zelda auditar: o que o matcher sugeriu automático */
  suggestedSkuId?: string | null;
  suggestedScore?: number | null;
  suggestedName?: string | null;
  /** O que Luís escolheu na UI ('match' = vinculou, 'new' = criou novo) */
  finalAction?: 'match' | 'new';
}

interface ConfirmBody {
  supplier: Supplier;
  supplierName?: string | null;
  invoiceRef?: string | null;
  occurredAt: string;
  totalAmount: number;
  notes?: string | null;
  source?: string;
  invoiceUrl?: string | null;
  items: ConfirmItem[];
  rawParsed?: unknown;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as ConfirmBody | null;
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: 'body inválido (items vazio)' }, { status: 400 });
  }

  const occurredAt = new Date(body.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    return NextResponse.json({ error: 'occurredAt inválido' }, { status: 400 });
  }

  const purchase = await prisma.$transaction(async (tx) => {
    const p = await tx.purchase.create({
      data: {
        occurredAt,
        supplier: body.supplier,
        supplierName: body.supplierName ?? null,
        invoiceRef: body.invoiceRef ?? null,
        invoiceUrl: body.invoiceUrl ?? null,
        totalAmount: body.totalAmount,
        notes: body.notes ?? null,
        source: body.source ?? 'ui-upload',
        rawParsed: (body.rawParsed ?? null) as never,
      },
    });

    for (const it of body.items) {
      let skuId = it.skuId ?? null;
      if (skuId) {
        // Atualiza custo médio ponderado
        const existing = await tx.sku.findUnique({ where: { id: skuId } });
        if (existing) {
          const oldCost = Number(existing.cost);
          const newCost = oldCost === 0 ? it.unitCost : (oldCost + it.unitCost) / 2;
          await tx.sku.update({
            where: { id: skuId },
            data: {
              cost: newCost,
              supplier: body.supplier,
              supplierSkuCode: it.productCode ?? existing.supplierSkuCode,
            },
          });
        } else {
          skuId = null;
        }
      }
      if (!skuId) {
        // Cria SKU novo provisório (categoria: a-classificar, price=0 — Luís define depois)
        const code = it.productCode || `NFE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const created = await tx.sku.create({
          data: {
            code,
            name: it.productName,
            category: 'a-classificar',
            supplier: body.supplier,
            supplierSkuCode: it.productCode ?? null,
            cost: it.unitCost,
            price: 0,
          },
        });
        skuId = created.id;
      }
      await tx.purchaseItem.create({
        data: {
          purchaseId: p.id,
          skuId,
          productName: it.productName,
          productCode: it.productCode ?? null,
          qty: it.qty,
          unitCost: it.unitCost,
          totalCost: it.totalCost,
        },
      });
    }

    return p;
  });

  // Captura correções de match pra auditoria da Zelda.
  // Pra cada item, compara o que matcher sugeriu vs o que Luís escolheu.
  // Casos relevantes:
  //   - matcher sugeriu A, Luís escolheu B (correção)
  //   - matcher sugeriu A, Luís marcou como NOVO (correção)
  //   - matcher não sugeriu nada, Luís vinculou manual a B (descoberta)
  //   - matcher acertou: skip log (não é correção)
  for (const it of body.items) {
    const suggested = it.suggestedSkuId ?? null;
    const final = it.skuId ?? null;
    const finalAction = it.finalAction ?? 'match';
    const isCorrection =
      // matcher sugeriu mas Luís discordou
      (suggested && finalAction === 'new') ||
      (suggested && final && suggested !== final) ||
      // matcher não achou mas Luís achou manual
      (!suggested && finalAction === 'match' && final);
    if (!isCorrection) continue;
    await prisma.workerRun
      .create({
        data: {
          name: 'match_correction',
          status: 'OK',
          finishedAt: new Date(),
          meta: {
            context: 'bruno-nfe',
            purchaseId: purchase.id,
            inputText: it.productName,
            inputCode: it.productCode ?? null,
            suggestedSkuId: suggested,
            suggestedSkuName: it.suggestedName ?? null,
            suggestedScore: it.suggestedScore ?? null,
            actualSkuId: final,
            finalAction,
            // Tipo de correção pra Zelda agrupar
            correctionType: !suggested
              ? 'matcher_missed_should_match'
              : finalAction === 'new'
                ? 'matcher_suggested_should_create_new'
                : 'matcher_suggested_wrong_match',
          } as never,
        },
      })
      .catch((e) => console.warn('[match_correction log]', e instanceof Error ? e.message : e));
  }

  // Dispara sync no Vendtef em background (não bloqueia resposta)
  const dispatch = await triggerVendtefSync(purchase.id);

  // 🤖 AUTO-TRIGGER: Zelda audita correções incremental e notifica Luís via
  // WhatsApp quando achar padrão importante/crítico. Fire-and-forget — não
  // bloqueia resposta. Cabe num lambda hobby porque Haiku é rápido (~3-5s) e
  // só dispara se houve correções novas.
  const correctionsCount = body.items.filter((it) => {
    const sug = it.suggestedSkuId ?? null;
    const fin = it.skuId ?? null;
    const fa = it.finalAction ?? 'match';
    return (sug && fa === 'new') || (sug && fin && sug !== fin) || (!sug && fa === 'match' && fin);
  }).length;
  if (correctionsCount > 0) {
    // Next 16 `after()` mantém o lambda vivo pra rodar trabalho pós-resposta.
    // Confirm retorna logo, Zelda roda em paralelo (Haiku ~3-5s) e notifica
    // Luís via WhatsApp se houver finding importante/crítico.
    after(async () => {
      try {
        const r = await auditMatchCorrections({ limit: 30, incrementalOnly: true, notifyLuis: true });
        if (!r.ok) {
          console.warn('[zelda auto-trigger]', r.error);
        } else if (r.findings.length > 0) {
          console.log(`[zelda] auto-trigger gerou ${r.findings.length} finding(s)`);
        }
      } catch (e) {
        console.warn('[zelda auto-trigger crash]', e instanceof Error ? e.message : e);
      }
    });
  }

  return NextResponse.json({
    ok: true,
    purchaseId: purchase.id,
    vendtefSync: dispatch.ok ? 'queued' : `not-queued: ${dispatch.error}`,
    correctionsFound: correctionsCount,
    zeldaAuditTriggered: correctionsCount > 0,
  });
}
