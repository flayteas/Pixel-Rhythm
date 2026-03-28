// Pixel Rhythm - Cloudflare Workers API
// Handles: auth, cloud save, leaderboard

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function err(msg, status = 400) {
  return json({ ok: false, error: msg }, status);
}

// Simple hash for token storage (not crypto-grade, but sufficient for game tokens)
async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Extract & verify user from Authorization header
async function getUser(request, db) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  if (!token || token.length < 32) return null;
  const hash = await hashToken(token);
  const row = await db.prepare('SELECT id, display_name, auth_type FROM users WHERE token_hash = ?').bind(hash).first();
  return row;
}

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const db = env.DB;

    try {
      // ---- Auth Routes ----
      if (path === '/api/auth/register' && request.method === 'POST') {
        return await handleRegister(db);
      }
      if (path === '/api/auth/verify' && request.method === 'GET') {
        return await handleVerify(request, db);
      }

      // ---- Sync Routes (require auth) ----
      if (path === '/api/sync' && request.method === 'GET') {
        return await handlePull(request, db);
      }
      if (path === '/api/sync' && request.method === 'PUT') {
        return await handlePush(request, db);
      }

      // ---- Leaderboard Routes ----
      if (path.startsWith('/api/leaderboard/') && request.method === 'GET') {
        return await handleLeaderboard(path, db);
      }

      return err('Not found', 404);
    } catch (e) {
      console.error('Worker error:', e);
      return err('Internal error', 500);
    }
  }
};

// ---- Auth: Register anonymous user ----
async function handleRegister(db) {
  // Generate random user ID and token
  const userId = crypto.randomUUID();
  const token = crypto.randomUUID() + crypto.randomUUID(); // 64-char token
  const hash = await hashToken(token);
  const now = Date.now();

  await db.prepare(
    'INSERT INTO users (id, token_hash, auth_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(userId, hash, 'anonymous', now, now).run();

  return json({ ok: true, userId, token });
}

// ---- Auth: Verify token ----
async function handleVerify(request, db) {
  const user = await getUser(request, db);
  if (!user) return err('Unauthorized', 401);
  return json({ ok: true, userId: user.id, displayName: user.display_name, authType: user.auth_type });
}

// ---- Sync: Pull data from cloud ----
async function handlePull(request, db) {
  const user = await getUser(request, db);
  if (!user) return err('Unauthorized', 401);

  // Get records
  const recordRows = await db.prepare(
    'SELECT song_key, high_score, max_combo, perfects, goods, hits, misses, is_fc, play_count, last_played, replay_hash FROM records WHERE user_id = ?'
  ).bind(user.id).all();

  const records = {};
  for (const r of recordRows.results) {
    records[r.song_key] = {
      highScore: r.high_score,
      maxCombo: r.max_combo,
      perfects: r.perfects,
      goods: r.goods,
      hits: r.hits,
      misses: r.misses,
      isFC: !!r.is_fc,
      playCount: r.play_count,
      lastPlayed: r.last_played,
      replayHash: r.replay_hash
    };
  }

  // Get settings
  const settingsRow = await db.prepare(
    'SELECT data_json FROM settings WHERE user_id = ?'
  ).bind(user.id).first();

  const settings = settingsRow ? JSON.parse(settingsRow.data_json) : null;

  return json({ ok: true, records, settings });
}

// ---- Sync: Push data to cloud ----
async function handlePush(request, db) {
  const user = await getUser(request, db);
  if (!user) return err('Unauthorized', 401);

  const body = await request.json();
  const { records, settings } = body;

  // Upsert records (merge: keep higher score)
  if (records && typeof records === 'object') {
    const entries = Object.entries(records);
    if (entries.length > 500) return err('Too many records (max 500)');

    for (const [key, rec] of entries) {
      if (!key || typeof rec !== 'object') continue;

      // Check existing record
      const existing = await db.prepare(
        'SELECT high_score, is_fc, play_count FROM records WHERE user_id = ? AND song_key = ?'
      ).bind(user.id, key).first();

      if (!existing) {
        // Insert new
        await db.prepare(
          `INSERT INTO records (user_id, song_key, high_score, max_combo, perfects, goods, hits, misses, is_fc, play_count, last_played, replay_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          user.id, key,
          rec.highScore || 0, rec.maxCombo || 0,
          rec.perfects || 0, rec.goods || 0, rec.hits || 0, rec.misses || 0,
          rec.isFC ? 1 : 0, rec.playCount || 0, rec.lastPlayed || 0,
          rec.replayHash || null
        ).run();
      } else {
        // Merge: higher score wins
        if ((rec.highScore || 0) > existing.high_score) {
          await db.prepare(
            `UPDATE records SET high_score=?, max_combo=?, perfects=?, goods=?, hits=?, misses=?,
             is_fc=?, play_count=?, last_played=?, replay_hash=?
             WHERE user_id=? AND song_key=?`
          ).bind(
            rec.highScore || 0, rec.maxCombo || 0,
            rec.perfects || 0, rec.goods || 0, rec.hits || 0, rec.misses || 0,
            (rec.isFC || existing.is_fc) ? 1 : 0,
            Math.max(rec.playCount || 0, existing.play_count || 0),
            rec.lastPlayed || 0, rec.replayHash || null,
            user.id, key
          ).run();
        } else {
          // Local score not higher, but update FC and play count if needed
          const newFC = (rec.isFC || existing.is_fc) ? 1 : 0;
          const newCount = Math.max(rec.playCount || 0, existing.play_count || 0);
          if (newFC !== existing.is_fc || newCount !== existing.play_count) {
            await db.prepare(
              'UPDATE records SET is_fc=?, play_count=? WHERE user_id=? AND song_key=?'
            ).bind(newFC, newCount, user.id, key).run();
          }
        }
      }
    }
  }

  // Upsert settings
  if (settings && typeof settings === 'object') {
    const settingsJson = JSON.stringify(settings);
    const now = Date.now();
    await db.prepare(
      `INSERT INTO settings (user_id, data_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data_json=?, updated_at=?`
    ).bind(user.id, settingsJson, now, settingsJson, now).run();
  }

  // Update user timestamp
  await db.prepare('UPDATE users SET updated_at=? WHERE id=?').bind(Date.now(), user.id).run();

  return json({ ok: true });
}

// ---- Leaderboard: Get top scores ----
async function handleLeaderboard(path, db) {
  // /api/leaderboard/{songKey}
  const songKey = decodeURIComponent(path.replace('/api/leaderboard/', ''));
  if (!songKey) return err('Missing song key');

  const rows = await db.prepare(
    `SELECT r.high_score, r.max_combo, r.is_fc, r.replay_hash, u.display_name
     FROM records r JOIN users u ON r.user_id = u.id
     WHERE r.song_key = ? AND r.high_score > 0
     ORDER BY r.high_score DESC LIMIT 100`
  ).bind(songKey).all();

  const leaderboard = rows.results.map((r, i) => ({
    rank: i + 1,
    name: r.display_name || '匿名玩家',
    score: r.high_score,
    maxCombo: r.max_combo,
    isFC: !!r.is_fc,
    verified: !!r.replay_hash
  }));

  return json({ ok: true, leaderboard });
}
