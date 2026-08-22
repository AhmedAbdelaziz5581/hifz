// Cloudflare Pages Function — GET /api/auth/verify?token=...
// Consumes a single-use magic-link token, finds-or-creates the user, opens a
// 30-day session, and redirects back to the app with the session cookie set.
import { randomToken, sessionCookieHeader } from '../../_utils.js';

const SESSION_TTL_DAYS = 30;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  const origin = url.origin;

  if (!token) return Response.redirect(origin + '/?auth=invalid', 302);

  try {
    const row = await env.DB.prepare('SELECT * FROM magic_tokens WHERE token = ?').bind(token).first();
    if (!row || row.used || new Date(row.expires_at + 'Z').getTime() < Date.now()) {
      return Response.redirect(origin + '/?auth=expired', 302);
    }
    await env.DB.prepare('UPDATE magic_tokens SET used = 1 WHERE token = ?').bind(token).run();

    let user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(row.email).first();
    if (!user) {
      const ins = await env.DB.prepare('INSERT INTO users (email) VALUES (?)').bind(row.email).run();
      user = { id: ins.meta.last_row_id, email: row.email };
    }

    const sessionToken = randomToken(32);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(sessionToken, user.id, expiresAt).run();

    return new Response(null, {
      status: 302,
      headers: {
        'Location': origin + '/?auth=ok',
        'Set-Cookie': sessionCookieHeader(sessionToken, SESSION_TTL_DAYS * 86400)
      }
    });
  } catch (err) {
    return Response.redirect(origin + '/?auth=error', 302);
  }
}
