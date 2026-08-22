// Cloudflare Pages Function — POST /api/auth/logout
// Deletes the current session (if any) and clears the session cookie.
import { parseCookies, clearSessionCookieHeader, SESSION_COOKIE } from '../../_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    try { await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run(); } catch {}
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookieHeader() }
  });
}
