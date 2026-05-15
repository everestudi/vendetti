'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';

export async function addIdea(formData: FormData) {
  const content = String(formData.get('content') ?? '').trim();
  if (!content) return;
  await prisma.idea.create({ data: { content } });
  revalidatePath('/');
}

export async function resolveIdea(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const note = String(formData.get('note') ?? '').trim() || null;
  if (!id) return;
  await prisma.idea.update({
    where: { id },
    data: { status: 'RESOLVED', resolvedAt: new Date(), note },
  });
  revalidatePath('/');
}

export async function reopenIdea(id: string) {
  await prisma.idea.update({
    where: { id },
    data: { status: 'NEW', resolvedAt: null },
  });
  revalidatePath('/');
}

export async function deleteIdea(id: string) {
  await prisma.idea.delete({ where: { id } });
  revalidatePath('/');
}
