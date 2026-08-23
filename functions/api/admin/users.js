// Cloudflare Pages Function — GET /api/admin/users
// Returns every account that has signed in (via magic link) — email,
// when they signed up, whether their synced progress/settings blob exists
// and when it last changed, and their individual sessions (creation/expiry,
// active or not). Gated by the same ADMIN_KEY as the feedback admin routes.
// Session tokens themselves are never returned — only a short, non-usable
// prefix — so this endpoint can't be used to hijack a live session even if
// the ADMIN_KEY were somehow exposed.
import { json, timingSafeEqual } from '../../_utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const provided = request.headers.get('X-Admin-Key') || '';
  if (!env.ADMIN_KEY || !timingSafeEqual(provided, env.ADMIN_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }

  try {
    const [usersRes, sessionsRes, stateRes] = await Promise.all([
      env.DB.prepare('SELECT id, email, created_at FROM users ORDER BY created_at DESC').all(),
      env.DB.prepare('SELECT user_id, token, created_at, expires_at FROM sessions ORDER BY created_at DESC').all(),
      env.DB.prepare('SELECT user_id, updated_at, length(data) AS data_size FROM user_state').all()
    ]);

    const sessionsByUser = {};
    for (const s of sessionsRes.results) {
      (sessionsByUser[s.user_id] ||= []).push({
        tokenPrefix: s.token.slice(0, 8) + '…',
        created_at: s.created_at,
        expires_at: s.expires_at,
        active: new Date(s.expires_at + 'Z').getTime() > Date.now()
      });
    }
    const stateByUser = {};
    for (const st of stateRes.results) stateByUser[st.user_id] = st;

    const users = usersRes.results.map(u => {
      const sessions = sessionsByUser[u.id] || [];
      const state = stateByUser[u.id] || null;
      return {
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        session_count: sessions.length,
        active_session_count: sessions.filter(s => s.active).length,
        last_session_at: sessions[0] ? sessions[0].created_at : null,
        synced: !!state,
        state_updated_at: state ? state.updated_at : null,
        state_size_bytes: state ? state.data_size : 0,
        sessions
      };
    });

    return json({ ok: true, users });
  } catch (err) {
    return json({ error: 'server_error' }, 500);
  }
}
