-- Pixel Rhythm Cloud - D1 Schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  recovery_hash TEXT,
  display_name TEXT DEFAULT '',
  auth_type TEXT DEFAULT 'anonymous',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  user_id TEXT NOT NULL,
  song_key TEXT NOT NULL,
  high_score INTEGER DEFAULT 0,
  max_combo INTEGER DEFAULT 0,
  perfects INTEGER DEFAULT 0,
  goods INTEGER DEFAULT 0,
  hits INTEGER DEFAULT 0,
  misses INTEGER DEFAULT 0,
  is_fc INTEGER DEFAULT 0,
  play_count INTEGER DEFAULT 0,
  last_played INTEGER DEFAULT 0,
  replay_hash TEXT,
  PRIMARY KEY (user_id, song_key),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Index for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_records_score ON records(song_key, high_score DESC);
