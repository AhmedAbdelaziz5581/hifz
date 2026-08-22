// Cloudflare Pages Function — GET/PUT /api/state
// The signed-in user's synced progress/settings, stored as one JSON blob
// (memorized ayahs, bookmark, last-visited surah, language, reciter, speed,
// tafsir source — mirrors what's already kept in localStorage).
import { json, getSessionUser } from '../_utils.js';

const MAX_BYTES = 200000;

export async function onRequestGet(context) {
  const { request, env } = context;
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  try {
    const row = await env.DB.prepare('SELECT data, updated_at FROM user_state WHERE user_id = ?').bind(user.id).first();
    return json({ ok: true, data: row ? JSON.parse(row.data) : null, updatedAt: row ? row.updated_at : null });
  } catch (err) {
    return json({ error: 'server_error' }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const dataStr = JSON.stringify(body || {});
  if (dataStr.length > MAX_BYTES) return json({ error: 'too_large' }, 413);

  try {
    await env.DB.prepare(
      `INSERT INTO user_state (user_id, data, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    ).bind(user.id, dataStr).run();
    return json({ ok: true });
  } catch (err) {
    return json({ error: 'server_error' }, 500);
  }
}
