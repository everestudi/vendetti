/**
 * Auth bootstrap: cookie HMAC-SHA256 via Web Crypto API.
 *
 * Web Crypto pra rodar no Edge runtime do middleware (Next 16).
 * As funções viraram async — chame com await.
 */

const COOKIE_NAME = 'vendetti_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const ALGO = { name: 'HMAC', hash: 'SHA-256' } as const;

const encoder = new TextEncoder();

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET ausente.');
  return crypto.subtle.importKey('raw', encoder.encode(secret), ALGO, false, ['sign', 'verify']);
}

function toBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): ArrayBuffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function sign(payload: string): Promise<string> {
  const key = await getKey();
  const sig = await crypto.subtle.sign(ALGO, key, encoder.encode(payload));
  return toBase64Url(sig);
}

export async function makeSessionCookie(role: 'admin' | 'operador') {
  const exp = Date.now() + TTL_MS;
  const payload = `${role}:${exp}`;
  const sig = await sign(payload);
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

export async function verifySessionCookie(raw: string | undefined): Promise<{ role: string } | null> {
  if (!raw) return null;
  const idx = raw.lastIndexOf('.');
  if (idx < 0) return null;
  const payload = raw.slice(0, idx);
  const sigStr = raw.slice(idx + 1);

  try {
    const key = await getKey();
    const ok = await crypto.subtle.verify(ALGO, key, fromBase64Url(sigStr), encoder.encode(payload));
    if (!ok) return null;
  } catch {
    return null;
  }

  const [role, expStr] = payload.split(':');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return { role };
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
