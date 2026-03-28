// Shared utilities for all API functions
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function err(msg, status = 400) {
  return json({ ok: false, error: msg }, status);
}

export async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function getUser(request, db) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  if (!token || token.length < 32) return null;
  const hash = await hashToken(token);
  const row = await db.prepare('SELECT id, display_name, auth_type FROM users WHERE token_hash = ?').bind(hash).first();
  return row;
}
