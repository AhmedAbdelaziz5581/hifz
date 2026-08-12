// Cloudflare Pages Function — POST /api/feedback
// Stores { email, message, rating } into the D1 database bound as `DB` (see wrangler.toml).
const RATE_LIMIT_MAX = 5;          // max submissions...
const RATE_LIMIT_WINDOW_MIN = 10;  // ...per IP, per this many minutes

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
  const ratingRaw = body && body.rating;

  if (!email || !message) return json({ error: 'missing_fields' }, 400);
  if (email.length > 200 || message.length > 4000) return json({ error: 'too_long' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400);

  let rating = null;
  if (ratingRaw !== null && ratingRaw !== undefined && ratingRaw !== '') {
    rating = Number(ratingRaw);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return json({ error: 'invalid_rating' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  try {
    const recent = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM feedback WHERE ip = ? AND created_at > datetime('now', '-${RATE_LIMIT_WINDOW_MIN} minutes')`
    ).bind(ip).first();
    if (recent && recent.c >= RATE_LIMIT_MAX) return json({ error: 'rate_limited' }, 429);

    await env.DB.prepare('INSERT INTO feedback (email, message, rating, ip) VALUES (?, ?, ?, ?)')
      .bind(email, message, rating, ip)
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
