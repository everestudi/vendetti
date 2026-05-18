/**
 * GET /api/chat/history — devolve as N últimas mensagens do chat persistido.
 * Default: últimas 50. Usado pra hidratar o chat ao abrir /chat ou /vendetti.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);

  // Pega as N mais recentes em ordem desc e inverte pra mandar cronologicamente
  const rows = await prisma.chatMessage.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  const messages = rows
    .map((r) => ({
      id: r.id,
      role: r.role as 'user' | 'assistant' | 'system',
      parts: Array.isArray(r.parts) ? r.parts : [],
      createdAt: r.createdAt.toISOString(),
    }))
    .reverse();

  return NextResponse.json({ ok: true, messages });
}

export async function DELETE(req: Request) {
  // Reset do histórico (útil pra "novo chat"). Requer ?confirm=1.
  const url = new URL(req.url);
  if (url.searchParams.get('confirm') !== '1') {
    return NextResponse.json({ error: 'add ?confirm=1' }, { status: 400 });
  }
  const r = await prisma.chatMessage.deleteMany({});
  return NextResponse.json({ ok: true, deleted: r.count });
}
