/**
 * POST /api/bruno-nfe/parse · recebe arquivo (multipart) e devolve JSON parseado.
 *
 * Não persiste nada. O fluxo é: parse → preview → confirm (outro endpoint).
 */

import { NextResponse } from 'next/server';
import { parseNfeFromBase64 } from '@/lib/vendetti/nfe-parse';
import { enrichLowConfidenceItems } from '@/lib/vendetti/nfe-enrich';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: 'multipart inválido' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'campo "file" ausente' }, { status: 400 });
  }

  const mediaType = file.type;
  if (
    mediaType !== 'image/jpeg' &&
    mediaType !== 'image/png' &&
    mediaType !== 'image/webp' &&
    mediaType !== 'application/pdf'
  ) {
    return NextResponse.json(
      { error: `tipo "${mediaType}" não suportado — use JPG, PNG, WebP ou PDF` },
      { status: 400 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > 8 * 1024 * 1024) {
    return NextResponse.json({ error: 'arquivo > 8MB' }, { status: 400 });
  }

  const base64 = buf.toString('base64');
  try {
    const parsed = await parseNfeFromBase64(base64, mediaType);
    // 🤖 Enriquece items low-confidence com IA + web search (LLM busca na
    // web pra desambiguar "Powerade Azul" → "Mountain Blast" etc).
    // Best-effort: se falhar, items seguem só com F1 match normal.
    if (parsed.items.length > 0) {
      const enrichResult = await enrichLowConfidenceItems(parsed.items, { max: 5 }).catch((e) => {
        console.warn('[enrich] falhou:', e instanceof Error ? e.message : e);
        return null;
      });
      if (enrichResult) {
        console.log(
          `[nfe-parse] enriched ${enrichResult.enriched} items · ${enrichResult.matched} acharam SKU via interpretação IA`,
        );
      }
    }
    return NextResponse.json({ ok: true, parsed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[nfe-parse] falhou:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
