/**
 * GET /api/inquiries · API pública (Bearer token) das inquiries do shopping.
 *
 * Pensada pro Portal Bluemall (outro projeto) consumir. Auth via
 * `Authorization: Bearer <INQUIRIES_API_KEY>`.
 *
 * Querystring:
 *   - category=LEAD_LOCACAO,ESTACIONAMENTO,GERAL  (default: todas exceto SAC_VENDING)
 *   - status=NEW,ESCALATED,...                    (default: todas abertas)
 *   - leadStage=PRE_QUALIFICACAO,...
 *   - since=ISO_date
 *   - limit=N (default 100, max 500)
 */

import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSecret } from '@/lib/secrets';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const apiKey = await getSecret('INQUIRIES_API_KEY');
  if (!apiKey) {
    return NextResponse.json(
      { error: 'INQUIRIES_API_KEY não configurada' },
      { status: 503 },
    );
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${apiKey}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const categories = url.searchParams.get('category')?.split(',').filter(Boolean);
  const statuses = url.searchParams.get('status')?.split(',').filter(Boolean);
  const leadStages = url.searchParams.get('leadStage')?.split(',').filter(Boolean);
  const since = url.searchParams.get('since');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);

  const where: Prisma.InquiryWhereInput = {};
  if (categories?.length) where.category = { in: categories };
  else where.category = { not: 'SAC_VENDING' };
  if (statuses?.length) where.status = { in: statuses } as Prisma.InquiryWhereInput['status'];
  if (leadStages?.length) where.leadStage = { in: leadStages } as Prisma.InquiryWhereInput['leadStage'];
  if (since) {
    const d = new Date(since);
    if (!Number.isNaN(d.getTime())) where.receivedAt = { gte: d };
  }

  const items = await prisma.inquiry.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    take: limit,
  });

  return NextResponse.json({
    ok: true,
    count: items.length,
    items,
  });
}

/**
 * POST /api/inquiries/:id · ações sobre uma inquiry
 * Body: { action: 'respond'|'assume'|'dismiss'|'resolve'|'set-stage', text?, reason?, stage? }
 *
 * Pra MVP mantém só GET. Actions ficam pra quando o Portal precisar.
 */
