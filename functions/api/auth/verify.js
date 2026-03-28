import { json, err, getUser } from '../_utils.js';

// GET /api/auth/verify
export async function onRequestGet(context) {
  const user = await getUser(context.request, context.env.DB);
  if (!user) return err('Unauthorized', 401);
  return json({ ok: true, userId: user.id, displayName: user.display_name, authType: user.auth_type });
}
