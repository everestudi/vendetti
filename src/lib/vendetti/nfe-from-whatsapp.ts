/**
 * Recebe imagem/PDF que o Luís mandou no WhatsApp, parseia como NF-e e responde
 * com resumo + link pra UI confirmar.
 *
 * Não persiste Purchase — o user revisa em /bruno/nova?prefilled=<id>
 * (cache em memória por 30min). Mais seguro que confirmar inline porque vision
 * pode errar.
 */

import { parseNfeFromBase64, type NfeParsedDoc } from './nfe-parse';
import { sendText } from '../zapi/send';

const PREFILL_CACHE = new Map<string, { doc: NfeParsedDoc; expiresAt: number }>();
const TTL_MS = 30 * 60 * 1000;

export function getPrefilled(id: string): NfeParsedDoc | null {
  const entry = PREFILL_CACHE.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    PREFILL_CACHE.delete(id);
    return null;
  }
  return entry.doc;
}

function setPrefilled(id: string, doc: NfeParsedDoc) {
  PREFILL_CACHE.set(id, { doc, expiresAt: Date.now() + TTL_MS });
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export async function handleNfeFromWhatsapp(phone: string, mediaUrl: string): Promise<{ ok: boolean; reason?: string; prefillId?: string }> {
  // Z-API só manda URL — baixar
  let resp: Response;
  try {
    resp = await fetch(mediaUrl);
  } catch (err) {
    await sendText(phone, `❌ Não consegui baixar a imagem (${(err as Error).message}). Tenta de novo?`);
    return { ok: false, reason: 'download-failed' };
  }
  if (!resp.ok) {
    await sendText(phone, `❌ Não consegui baixar a imagem (HTTP ${resp.status}). Tenta de novo?`);
    return { ok: false, reason: `download-${resp.status}` };
  }
  const contentType = resp.headers.get('content-type') ?? 'image/jpeg';
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.byteLength > 8 * 1024 * 1024) {
    await sendText(phone, '❌ Arquivo > 8MB. Manda em qualidade menor.');
    return { ok: false, reason: 'too-large' };
  }

  const mediaType =
    contentType.includes('pdf')
      ? ('application/pdf' as const)
      : contentType.includes('png')
        ? ('image/png' as const)
        : contentType.includes('webp')
          ? ('image/webp' as const)
          : ('image/jpeg' as const);

  let parsed: NfeParsedDoc;
  try {
    parsed = await parseNfeFromBase64(buf.toString('base64'), mediaType);
  } catch (err) {
    await sendText(phone, `❌ Não consegui ler a NF: ${(err as Error).message.slice(0, 100)}`);
    return { ok: false, reason: 'parse-failed' };
  }

  const id = genId();
  setPrefilled(id, parsed);

  const summary = formatSummary(parsed);
  const base = process.env.APP_URL ?? 'https://vendetti.everest.udi.br';
  await sendText(phone, `${summary}\n\nRevisar e confirmar:\n${base}/bruno/nova?prefill=${id}`);
  return { ok: true, prefillId: id };
}

function formatSummary(doc: NfeParsedDoc): string {
  const lines: string[] = [];
  lines.push(`📋 NF lida — ${doc.supplier}${doc.supplierName ? ` · ${doc.supplierName}` : ''}`);
  if (doc.invoiceRef) lines.push(`NF ${doc.invoiceRef}${doc.occurredAt ? ` · ${doc.occurredAt}` : ''}`);
  lines.push(`Total: ${brl(doc.totalAmount)}`);
  lines.push(`${doc.items.length} ${doc.items.length === 1 ? 'item' : 'itens'}:`);
  for (const it of doc.items.slice(0, 8)) {
    const match = it.skuMatch && it.skuMatch.score >= 70 ? ' ✓' : ' ＋';
    lines.push(`• ${it.qty}× ${it.productName.slice(0, 40)} — ${brl(it.unitCost)}${match}`);
  }
  if (doc.items.length > 8) lines.push(`… +${doc.items.length - 8}`);
  return lines.join('\n');
}
