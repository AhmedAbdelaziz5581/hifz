// Cloudflare Pages Function — GET /api/auth/me
// Returns the signed-in user's email, or 401 if there's no valid session.
import { json, getSessionUser } from '../../_utils.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context.request, context.env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  return json({ email: user.email });
}
