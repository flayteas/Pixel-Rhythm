// Pixel Rhythm - Pages Functions API (catch-all)
// Handles: /api/auth/register, /api/auth/verify, /api/auth/recover, /api/sync, /api/leaderboard/*

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errResp(msg, status = 400) {
  return jsonResp({ ok: false, error: msg }, status);
}

async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getUser(request, db) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  if (!token || token.length < 32) return null;
  const hash = await hashToken(token);
  const row = await db.prepare('SELECT id, display_name, auth_type FROM users WHERE token_hash = ?').bind(hash).first();
  return row;
}

function generateRecoveryCode() {
  // 8-char uppercase alphanumeric (no ambiguous chars: 0/O, 1/I/L)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => chars[b % chars.length]).join('');
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const db = env.DB;

  try {
    // POST /api/auth/register
    if (path === '/api/auth/register' && request.method === 'POST') {
      const userId = crypto.randomUUID();
      const token = crypto.randomUUID() + crypto.randomUUID();
      const hash = await hashToken(token);
      const recoveryCode = generateRecoveryCode();
      const recoveryHash = await hashToken(recoveryCode);
      const now = Date.now();
      await db.prepare(
        'INSERT INTO users (id, token_hash, recovery_hash, auth_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(userId, hash, recoveryHash, 'anonymous', now, now).run();
      return jsonResp({ ok: true, userId, token, recoveryCode });
    }

    // GET /api/auth/verify
    if (path === '/api/auth/verify' && request.method === 'GET') {
      const user = await getUser(request, db);
      if (!user) return errResp('Unauthorized', 401);
      return jsonResp({ ok: true, userId: user.id, displayName: user.display_name, authType: user.auth_type });
    }

    // POST /api/auth/recover
    if (path === '/api/auth/recover' && request.method === 'POST') {
      const body = await request.json();
      const code = (body.recoveryCode || '').trim().toUpperCase();
      if (!code || code.length < 6) return errResp('恢复码无效', 400);
      const codeHash = await hashToken(code);
      const user = await db.prepare('SELECT id FROM users WHERE recovery_hash = ?').bind(codeHash).first();
      if (!user) return errResp('恢复码不存在', 404);
      // Issue new token, keep recovery code unchanged
      const newToken = crypto.randomUUID() + crypto.randomUUID();
      const newHash = await hashToken(newToken);
      const now = Date.now();
      await db.prepare(
        'UPDATE users SET token_hash=?, updated_at=? WHERE id=?'
      ).bind(newHash, now, user.id).run();
      return jsonResp({ ok: true, userId: user.id, token: newToken });
    }

    // POST /api/auth/reset-recovery (generate new recovery code for logged-in user)
    if (path === '/api/auth/reset-recovery' && request.method === 'POST') {
      const user = await getUser(request, db);
      if (!user) return errResp('Unauthorized', 401);
      const newRecoveryCode = generateRecoveryCode();
      const newRecoveryHash = await hashToken(newRecoveryCode);
      await db.prepare('UPDATE users SET recovery_hash=?, updated_at=? WHERE id=?').bind(newRecoveryHash, Date.now(), user.id).run();
      return jsonResp({ ok: true, recoveryCode: newRecoveryCode });
    }

    // GET /api/sync
    if (path === '/api/sync' && request.method === 'GET') {
      const user = await getUser(request, db);
      if (!user) return errResp('Unauthorized', 401);

      const recordRows = await db.prepare(
        'SELECT song_key, high_score, max_combo, perfects, goods, hits, misses, is_fc, play_count, last_played, replay_hash FROM records WHERE user_id = ?'
      ).bind(user.id).all();

      const records = {};
      for (const r of recordRows.results) {
        records[r.song_key] = {
          highScore: r.high_score, maxCombo: r.max_combo,
          perfects: r.perfects, goods: r.goods, hits: r.hits, misses: r.misses,
          isFC: !!r.is_fc, playCount: r.play_count, lastPlayed: r.last_played,
          replayHash: r.replay_hash
        };
      }

      const settingsRow = await db.prepare(
        'SELECT data_json FROM settings WHERE user_id = ?'
      ).bind(user.id).first();
      const settings = settingsRow ? JSON.parse(settingsRow.data_json) : null;

      return jsonResp({ ok: true, records, settings });
    }

    // PUT /api/sync
    if (path === '/api/sync' && request.method === 'PUT') {
      const user = await getUser(request, db);
      if (!user) return errResp('Unauthorized', 401);

      const body = await request.json();
      const { records, settings } = body;

      if (records && typeof records === 'object') {
        const entries = Object.entries(records);
        if (entries.length > 500) return errResp('Too many records (max 500)');

        for (const [key, rec] of entries) {
          if (!key || typeof rec !== 'object') continue;
          const existing = await db.prepare(
            'SELECT high_score, is_fc, play_count FROM records WHERE user_id = ? AND song_key = ?'
          ).bind(user.id, key).first();

          if (!existing) {
            await db.prepare(
              'INSERT INTO records (user_id, song_key, high_score, max_combo, perfects, goods, hits, misses, is_fc, play_count, last_played, replay_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(user.id, key, rec.highScore||0, rec.maxCombo||0, rec.perfects||0, rec.goods||0, rec.hits||0, rec.misses||0, rec.isFC?1:0, rec.playCount||0, rec.lastPlayed||0, rec.replayHash||null).run();
          } else {
            if ((rec.highScore||0) > existing.high_score) {
              await db.prepare(
                'UPDATE records SET high_score=?, max_combo=?, perfects=?, goods=?, hits=?, misses=?, is_fc=?, play_count=?, last_played=?, replay_hash=? WHERE user_id=? AND song_key=?'
              ).bind(rec.highScore||0, rec.maxCombo||0, rec.perfects||0, rec.goods||0, rec.hits||0, rec.misses||0, (rec.isFC||existing.is_fc)?1:0, Math.max(rec.playCount||0, existing.play_count||0), rec.lastPlayed||0, rec.replayHash||null, user.id, key).run();
            } else {
              const newFC = (rec.isFC||existing.is_fc)?1:0;
              const newCount = Math.max(rec.playCount||0, existing.play_count||0);
              if (newFC !== existing.is_fc || newCount !== existing.play_count) {
                await db.prepare('UPDATE records SET is_fc=?, play_count=? WHERE user_id=? AND song_key=?').bind(newFC, newCount, user.id, key).run();
              }
            }
          }
        }
      }

      if (settings && typeof settings === 'object') {
        const sj = JSON.stringify(settings);
        const now = Date.now();
        await db.prepare(
          'INSERT INTO settings (user_id, data_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data_json=?, updated_at=?'
        ).bind(user.id, sj, now, sj, now).run();
      }

      await db.prepare('UPDATE users SET updated_at=? WHERE id=?').bind(Date.now(), user.id).run();
      return jsonResp({ ok: true });
    }

    // PUT /api/auth/display-name
    if (path === '/api/auth/display-name' && request.method === 'PUT') {
      const user = await getUser(request, db);
      if (!user) return errResp('Unauthorized', 401);
      const body = await request.json();
      let name = (body.displayName || '').trim();
      if (!name) return errResp('昵称不能为空');
      if (name.length > 20) name = name.slice(0, 20);
      // Basic sanitization
      name = name.replace(/[<>"'&]/g, '');
      if (!name) return errResp('昵称包含无效字符');
      await db.prepare('UPDATE users SET display_name=?, updated_at=? WHERE id=?').bind(name, Date.now(), user.id).run();
      return jsonResp({ ok: true, displayName: name });
    }

    // GET /api/leaderboard/*
    if (path.startsWith('/api/leaderboard/') && request.method === 'GET') {
      const songKey = decodeURIComponent(path.replace('/api/leaderboard/', ''));
      if (!songKey) return errResp('Missing song key');
      const rows = await db.prepare(
        'SELECT r.high_score, r.max_combo, r.is_fc, r.replay_hash, u.display_name FROM records r JOIN users u ON r.user_id = u.id WHERE r.song_key = ? AND r.high_score > 0 ORDER BY r.high_score DESC LIMIT 100'
      ).bind(songKey).all();
      const leaderboard = rows.results.map((r, i) => ({
        rank: i+1, name: r.display_name||'匿名玩家', score: r.high_score,
        maxCombo: r.max_combo, isFC: !!r.is_fc, verified: !!r.replay_hash
      }));
      return jsonResp({ ok: true, leaderboard });
    }

    return errResp('Not found', 404);
  } catch (e) {
    return jsonResp({ ok: false, error: 'Internal error: ' + e.message }, 500);
  }
}
