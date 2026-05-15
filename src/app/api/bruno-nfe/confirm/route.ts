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

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import type { Supplier } from '@prisma/client';

export const runtime = 'nodejs';

interface ConfirmItem {
  skuId?: string | null;
  productName: string;
  productCode?: string | null;
  qty: number;
  unitCost: number;
  totalCost: number;
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

  return NextResponse.json({ ok: true, purchaseId: purchase.id });
}
