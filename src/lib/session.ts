/**
 * Auth bootstrap: cookie HMAC assinado com AUTH_SECRET.
 *
 * Pra MVP. Quando NextAuth + magic link estiverem em pé, esse módulo sai.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'vendetti_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function sign(payload: string): string {
  return createHmac('sha256', process.env.AUTH_SECRET ?? '').update(payload).digest('base64url');
}

export function makeSessionCookie(role: 'admin' | 'operador') {
  const exp = Date.now() + TTL_MS;
  const payload = `${role}:${exp}`;
  const sig = sign(payload);
  return {
    name: COOKIE_NAME,
    value: `${payload}.${sig}`,
    maxAge: TTL_MS / 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function verifySessionCookie(raw: string | undefined): { role: string } | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf('.');
  if (idx < 0) return null;
  const payload = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const [role, expStr] = payload.split(':');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return { role };
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
