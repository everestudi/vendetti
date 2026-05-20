/**
 * POST /api/decisions/[id]/approve — aprova Decision via REST (chamado por
 * componentes client). Dispara approveDecision server action.
 *
 * Auth: sessão NextAuth (middleware).
 */

import { NextResponse } from 'next/server';
import { approveDecision } from '@/app/decisions/actions';

export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await approveDecision(id);
    return NextResponse.json({ ok: true, decisionId: id });
  } catch (err) {
    // approveDecision faz revalidatePath + redirect implícito.
    // Next pode lançar NEXT_REDIRECT que deve ser tratado como sucesso.
    const isRedirect = err instanceof Error && err.message.includes('NEXT_REDIRECT');
    if (isRedirect) {
      return NextResponse.json({ ok: true, decisionId: id });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
