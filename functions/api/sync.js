import { json, err, getUser } from './_utils.js';

// GET /api/sync — Pull from cloud
export async function onRequestGet(context) {
  const db = context.env.DB;
  const user = await getUser(context.request, db);
  if (!user) return err('Unauthorized', 401);

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

  const settingsRow = await db.prepare(
    'SELECT data_json FROM settings WHERE user_id = ?'
  ).bind(user.id).first();

  const settings = settingsRow ? JSON.parse(settingsRow.data_json) : null;

  return json({ ok: true, records, settings });
}

// PUT /api/sync — Push to cloud
export async function onRequestPut(context) {
  const db = context.env.DB;
  const user = await getUser(context.request, db);
  if (!user) return err('Unauthorized', 401);

  const body = await context.request.json();
  const { records, settings } = body;

  if (records && typeof records === 'object') {
    const entries = Object.entries(records);
    if (entries.length > 500) return err('Too many records (max 500)');

    for (const [key, rec] of entries) {
      if (!key || typeof rec !== 'object') continue;

      const existing = await db.prepare(
        'SELECT high_score, is_fc, play_count FROM records WHERE user_id = ? AND song_key = ?'
      ).bind(user.id, key).first();

      if (!existing) {
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

  if (settings && typeof settings === 'object') {
    const settingsJson = JSON.stringify(settings);
    const now = Date.now();
    await db.prepare(
      `INSERT INTO settings (user_id, data_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data_json=?, updated_at=?`
    ).bind(user.id, settingsJson, now, settingsJson, now).run();
  }

  await db.prepare('UPDATE users SET updated_at=? WHERE id=?').bind(Date.now(), user.id).run();

  return json({ ok: true });
}
