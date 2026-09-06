// Cloudflare Pages Function — POST /api/transcribe
// Body: multipart/form-data with an "audio" file field (whatever MediaRecorder
// produced — webm/opus, mp4, etc.). Proxies to Groq's Whisper API for
// transcription and returns { text }. The API key stays server-side; the
// client never sees it. Rate-limited per IP since this is a metered/paid
// call, unlike the rest of the app's free static-content endpoints.
import { json } from '../_utils.js';

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MIN = 10;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // one ayah's recitation is seconds long, not this big

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GROQ_API_KEY) return json({ error: 'not_configured' }, 501);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    const recent = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM transcribe_log WHERE ip = ? AND created_at > datetime('now', '-${RATE_LIMIT_WINDOW_MIN} minutes')`
    ).bind(ip).first();
    if (recent && recent.c >= RATE_LIMIT_MAX) return json({ error: 'rate_limited' }, 429);
  } catch {
    return json({ error: 'server_error' }, 500);
  }

  let incoming;
  try {
    incoming = await request.formData();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const audio = incoming.get('audio');
  if (!audio || typeof audio === 'string') return json({ error: 'missing_audio' }, 400);
  if (audio.size > MAX_AUDIO_BYTES) return json({ error: 'audio_too_large' }, 413);

  try {
    await env.DB.prepare('INSERT INTO transcribe_log (ip) VALUES (?)').bind(ip).run();
  } catch {}

  try {
    const forward = new FormData();
    forward.append('file', audio, 'audio.webm');
    forward.append('model', 'whisper-large-v3-turbo');
    forward.append('language', 'ar');
    forward.append('response_format', 'json');
    forward.append('temperature', '0');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
      body: forward
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return json({ error: 'asr_failed', detail: errText.slice(0, 300) }, 502);
    }
    const data = await res.json();
    return json({ text: data.text || '' });
  } catch {
    return json({ error: 'server_error' }, 500);
  }
}
