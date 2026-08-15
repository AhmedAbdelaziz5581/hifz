// Cloudflare Pages Function — DELETE /api/admin/feedback/:id
// Deletes a single feedback row, gated by the same ADMIN_KEY as GET /api/admin/feedback.
export async function onRequestDelete(context) {
  const { request, env, params } = context;

  const provided = request.headers.get('X-Admin-Key') || '';
  if (!env.ADMIN_KEY || !timingSafeEqual(provided, env.ADMIN_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ error: 'invalid_id' }, 400);
  }

  try {
    const result = await env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(id).run();
    if (!result.meta || result.meta.changes === 0) return json({ error: 'not_found' }, 404);
    return json({ ok: true });
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
