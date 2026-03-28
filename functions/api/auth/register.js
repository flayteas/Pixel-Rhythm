import { json, hashToken } from '../_utils.js';

// POST /api/auth/register
export async function onRequestPost(context) {
  const db = context.env.DB;
  const userId = crypto.randomUUID();
  const token = crypto.randomUUID() + crypto.randomUUID();
  const hash = await hashToken(token);
  const now = Date.now();

  await db.prepare(
    'INSERT INTO users (id, token_hash, auth_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(userId, hash, 'anonymous', now, now).run();

  return json({ ok: true, userId, token });
}
