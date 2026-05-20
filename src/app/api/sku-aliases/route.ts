/**
 * REST pra gerenciar SkuAlias — texto-livre que o Weverton (e qualquer humano)
 * usa pra se referir a produtos do catálogo.
 *
 *   GET  /api/sku-aliases               → lista (filtros via querystring)
 *   POST /api/sku-aliases               → cria { alias, skuId, slotPosition? }
 *
 * O parser do Weverton consulta essa tabela ANTES de chamar LLM — match
 * determinístico sem custo de token.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { normalizeAlias } from '@/lib/vendetti/weverton-restock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const skuId = url.searchParams.get('skuId') ?? undefined;
  const slotPosition = url.searchParams.get('slotPosition') ?? undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200', 10), 500);

  const aliases = await prisma.skuAlias.findMany({
    where: {
      ...(skuId ? { skuId } : {}),
      ...(slotPosition ? { slotPosition } : {}),
    },
    include: { sku: { select: { id: true, name: true, category: true } } },
    orderBy: [{ hitCount: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  return NextResponse.json({ ok: true, count: aliases.length, aliases });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    alias?: string;
    skuId?: string;
    slotPosition?: string;
    source?: string;
  };
  if (!body.alias || !body.skuId) {
    return NextResponse.json({ ok: false, error: 'alias e skuId obrigatórios' }, { status: 400 });
  }
  const aliasOriginal = body.alias.trim().slice(0, 200);
  const aliasKey = normalizeAlias(aliasOriginal);
  if (aliasKey.length < 2) {
    return NextResponse.json({ ok: false, error: 'alias muito curto (após normalização)' }, { status: 400 });
  }

  const sku = await prisma.sku.findUnique({ where: { id: body.skuId } });
  if (!sku) {
    return NextResponse.json({ ok: false, error: 'skuId não existe' }, { status: 404 });
  }

  try {
    const a = await prisma.skuAlias.upsert({
      where: { alias_skuId: { alias: aliasKey, skuId: body.skuId } },
      update: { aliasOriginal, slotPosition: body.slotPosition ?? null },
      create: {
        alias: aliasKey,
        aliasOriginal,
        skuId: body.skuId,
        slotPosition: body.slotPosition ?? null,
        source: body.source ?? 'luis',
      },
    });
    return NextResponse.json({ ok: true, alias: a });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
