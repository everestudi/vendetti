'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { makeSessionCookie } from '@/lib/session';

export async function login(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/');
  const expected = process.env.BOOTSTRAP_PASSWORD;

  if (!expected) {
    redirect('/login?error=BOOTSTRAP_PASSWORD não configurado no .env.local');
  }
  if (password !== expected) {
    redirect('/login?error=Senha inválida');
  }

  const cookie = await makeSessionCookie('admin');
  (await cookies()).set(cookie);
  redirect(next);
}

export async function logout() {
  (await cookies()).delete('vendetti_session');
  redirect('/login');
}
