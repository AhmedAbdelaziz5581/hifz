// Cloudflare Pages Function — POST /api/feedback
// Stores { email, message } into the D1 database bound as `DB` (see wrangler.toml).
export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const email = String(body && body.email || '').trim();
  const message = String(body && body.message || '').trim();

  if (!email || !message) return json({ error: 'missing_fields' }, 400);
  if (email.length > 200 || message.length > 4000) return json({ error: 'too_long' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400);

  try {
    await env.DB.prepare('INSERT INTO feedback (email, message) VALUES (?, ?)')
      .bind(email, message)
      .run();
    return json({ ok: true });
  } catch (err) {
    return json({ error: 'server_error' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
