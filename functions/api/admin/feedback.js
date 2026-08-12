// Cloudflare Pages Function — GET /api/admin/feedback
// Returns all rows from the `feedback` table, gated by a shared secret
// (set via `wrangler pages secret put ADMIN_KEY`) sent as the X-Admin-Key header.
export async function onRequestGet(context) {
  const { request, env } = context;

  const provided = request.headers.get('X-Admin-Key') || '';
  if (!env.ADMIN_KEY || !timingSafeEqual(provided, env.ADMIN_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }

  try {
    const { results } = await env.DB.prepare(
      'SELECT id, email, rating, message, created_at FROM feedback ORDER BY created_at DESC LIMIT 500'
    ).all();
    return json({ ok: true, feedback: results });
  } catch (err) {
    return json({ error: 'server_error' }, 500);
  }
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
