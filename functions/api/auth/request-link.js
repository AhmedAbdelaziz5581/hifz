// Cloudflare Pages Function — POST /api/auth/request-link
// Body: { email }. Generates a single-use, 15-minute magic-link token and
// emails it via Resend. Requires the RESEND_API_KEY secret to actually send;
// without it, this returns email_failed so the failure is visible rather
// than silently pretending to have sent something.
import { json, randomToken } from '../../_utils.js';

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MIN = 15;
const TOKEN_TTL_MIN = 15;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const email = String(body && body.email || '').trim().toLowerCase();
  if (!email || email.length > 200) return json({ error: 'missing_email' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  try {
    const recent = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM magic_tokens WHERE (email = ? OR ip = ?) AND created_at > datetime('now', '-${RATE_LIMIT_WINDOW_MIN} minutes')`
    ).bind(email, ip).first();
    if (recent && recent.c >= RATE_LIMIT_MAX) return json({ error: 'rate_limited' }, 429);

    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 60000).toISOString().replace('T', ' ').slice(0, 19);
    await env.DB.prepare('INSERT INTO magic_tokens (token, email, expires_at, ip) VALUES (?, ?, ?, ?)')
      .bind(token, email, expiresAt, ip).run();

    const origin = new URL(request.url).origin;
    const link = `${origin}/api/auth/verify?token=${token}`;

    const sent = await sendMagicLinkEmail(env, email, link);
    if (!sent) return json({ error: 'email_failed' }, 502);

    return json({ ok: true });
  } catch (err) {
    return json({ error: 'server_error' }, 500);
  }
}

async function sendMagicLinkEmail(env, to, link) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.MAIL_FROM || 'Hifz <noreply@hifz-quran.com>',
        to: [to],
        subject: 'Sign in to Hifz',
        html: `<p>Tap the link below to sign in to Hifz on this device. It expires in 15 minutes.</p>
               <p><a href="${link}">${link}</a></p>
               <p>If you didn't request this, you can safely ignore this email.</p>`
      })
    });
    return res.ok;
  } catch {
    return false;
  }
}
