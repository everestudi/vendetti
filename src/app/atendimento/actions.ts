'use server';

import { revalidatePath } from 'next/cache';
import {
  markInquiryAssumed,
  markInquiryDismissed,
  markInquiryResolved,
  sendLuisResponse,
  setLeadStage,
} from '@/lib/vendetti/lucia-inquiry';

export async function inquiryResolveAction(id: string) {
  await markInquiryResolved(id);
  revalidatePath('/atendimento');
  revalidatePath('/leads');
  revalidatePath('/vendetti');
}

export async function inquiryDismissAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!id) return;
  await markInquiryDismissed(id, reason || undefined);
  revalidatePath('/atendimento');
  revalidatePath('/leads');
  revalidatePath('/vendetti');
}

export async function inquiryAssumeAction(id: string) {
  await markInquiryAssumed(id);
  revalidatePath('/atendimento');
  revalidatePath('/leads');
  revalidatePath('/vendetti');
}

export async function inquiryRespondAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const text = String(formData.get('text') ?? '').trim();
  if (!id || !text) return;
  await sendLuisResponse(id, text);
  revalidatePath('/atendimento');
  revalidatePath('/leads');
  revalidatePath('/vendetti');
}

export async function inquirySetStageAction(
  formData: FormData,
) {
  const id = String(formData.get('id') ?? '');
  const stage = String(formData.get('stage') ?? '') as
    | 'PRE_QUALIFICACAO'
    | 'QUALIFICADO'
    | 'EM_NEGOCIACAO'
    | 'PROPOSTA_ENVIADA'
    | 'CONVERTIDO'
    | 'PERDIDO';
  if (!id || !stage) return;
  await setLeadStage(id, stage);
  revalidatePath('/leads');
  revalidatePath('/vendetti');
}
