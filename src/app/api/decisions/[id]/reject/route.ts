/**
 * POST /api/decisions/[id]/reject — rejeita Decision via REST.
 * Body: { reasonCategory, reasonText? }
 */

import { NextResponse } from 'next/server';
import { rejectDecision } from '@/app/decisions/actions';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { reasonCategory?: string; reasonText?: string };
  if (!body.reasonCategory) {
    return NextResponse.json({ ok: false, error: 'reasonCategory obrigatório' }, { status: 400 });
  }

  // rejectDecision usa FormData — montamos uma
  const fd = new FormData();
  fd.set('id', id);
  fd.set('reasonCategory', body.reasonCategory);
  if (body.reasonText) fd.set('reasonText', body.reasonText);

  try {
    await rejectDecision(fd);
    return NextResponse.json({ ok: true, decisionId: id });
  } catch (err) {
    const isRedirect = err instanceof Error && err.message.includes('NEXT_REDIRECT');
    if (isRedirect) return NextResponse.json({ ok: true, decisionId: id });
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
