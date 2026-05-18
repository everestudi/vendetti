/**
 * Transcrição de áudio do WhatsApp via OpenAI Whisper.
 *
 * Z-API entrega áudio como URL (audio.audioUrl em OGG/Opus normalmente).
 * Whisper-1 da OpenAI custa ~$0.006/min. Pt-BR funciona bem.
 *
 * Fallback: se OPENAI_API_KEY não estiver setada, retorna null e a Lúcia
 * responde pedindo pro cliente digitar.
 */

import { getSecret } from '../secrets';

export async function transcribeAudio(audioUrl: string): Promise<string | null> {
  const apiKey = await getSecret('OPENAI_API_KEY');
  if (!apiKey) {
    console.warn('[audio-transcribe] OPENAI_API_KEY ausente — fallback');
    return null;
  }

  let buf: Buffer;
  try {
    const r = await fetch(audioUrl);
    if (!r.ok) {
      console.warn(`[audio-transcribe] download falhou: HTTP ${r.status}`);
      return null;
    }
    buf = Buffer.from(await r.arrayBuffer());
  } catch (err) {
    console.warn(`[audio-transcribe] download err:`, err);
    return null;
  }

  if (buf.byteLength > 25 * 1024 * 1024) {
    console.warn('[audio-transcribe] arquivo > 25MB, skip');
    return null;
  }

  const form = new FormData();
  // Z-API envia OGG/Opus. Whisper aceita.
  form.append('file', new Blob([new Uint8Array(buf)], { type: 'audio/ogg' }), 'audio.ogg');
  form.append('model', 'whisper-1');
  form.append('language', 'pt');
  form.append('response_format', 'text');

  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.warn(`[audio-transcribe] whisper HTTP ${r.status}: ${t.slice(0, 200)}`);
      return null;
    }
    const text = (await r.text()).trim();
    return text || null;
  } catch (err) {
    console.warn('[audio-transcribe] request err:', err);
    return null;
  }
}
