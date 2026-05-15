/**
 * GET /api/bruno-nfe/sku-search?q=mountain blast · busca SKUs por nome/code.
 * Usado quando o vision não acha match e o user precisa vincular manualmente.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 2) {
    return NextResponse.json({ ok: true, results: [] });
  }

  // Match por nome contém OU code igual
  const results = await prisma.sku.findMany({
    where: {
      active: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { equals: q, mode: 'insensitive' } },
        { supplierSkuCode: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, code: true, name: true, category: true, cost: true, price: true },
    take: 20,
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({
    ok: true,
    results: results.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      category: r.category,
      cost: Number(r.cost),
      price: Number(r.price),
    })),
  });
}
