/**
 * GET /api/agent-log/[scope] — retorna últimas N linhas de log do agente.
 * Consumido pelo <AgentTerminal scope="mara" /> que faz poll a cada ~5s.
 */

import { NextResponse } from 'next/server';
import { getAgentLog, type AgentScope } from '@/lib/agent-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SCOPES: AgentScope[] = ['mara', 'bruno', 'lucia', 'vendetti', 'weverton', 'rita', 'zelda', 'all'];

export async function GET(_req: Request, ctx: { params: Promise<{ scope: string }> }) {
  const { scope } = await ctx.params;
  if (!VALID_SCOPES.includes(scope as AgentScope)) {
    return NextResponse.json({ error: 'invalid scope', valid: VALID_SCOPES }, { status: 400 });
  }
  const lines = await getAgentLog(scope as AgentScope, 80);
  return NextResponse.json({ scope, lines });
}
