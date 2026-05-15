import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/session';

const PUBLIC_PREFIXES = ['/login', '/api/health', '/api/webhook', '/api/cron', '/_next', '/favicon'];

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
