-- Poetry Garden v3 schema.
--
-- D1 stores only dynamic application state. Static catalog metadata and full
-- content are generated as JSON and stored in R2.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  preference_charset TEXT DEFAULT 'traditional',
  preference_pinyin INTEGER DEFAULT 0,
  preference_font_size INTEGER DEFAULT 18,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  content_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, content_type, content_id)
);

CREATE TABLE IF NOT EXISTS reading_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  content_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  progress INTEGER DEFAULT 0,
  last_read_at TEXT DEFAULT (datetime('now')),
  read_count INTEGER DEFAULT 1,
  UNIQUE(user_id, content_type, content_id)
);

CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id);
CREATE INDEX IF NOT EXISTS idx_history_user ON reading_history(user_id);
