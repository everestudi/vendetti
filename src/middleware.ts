import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/session';

const PUBLIC_PREFIXES = [
  '/login',
  '/sobre', // página pública pra compartilhar — não tem ação, só info do projeto
  '/api/health',
  '/api/webhook',
  '/api/cron',
  '/api/inquiries', // auth via Bearer INQUIRIES_API_KEY no próprio endpoint
  '/api/zelda', // auth via x-service-key (CRON_SECRET) no próprio endpoint
  '/api/agent-log', // poll de logs no AgentTerminal (já com cookie da UI)
  '/api/tick', // auth via Bearer CRON_SECRET no próprio endpoint (chamado por GH Actions)
  '/_next',
  '/favicon',
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return;

  const raw = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookie(raw);
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
