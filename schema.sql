-- Poetry Garden D1 Database Schema

-- Authors table
CREATE TABLE IF NOT EXISTS authors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_traditional TEXT,
    dynasty TEXT NOT NULL,
    bio TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Poems table
CREATE TABLE IF NOT EXISTS poems (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    title_simplified TEXT,
    author_id TEXT REFERENCES authors(id),
    dynasty TEXT NOT NULL,
    content TEXT NOT NULL,  -- JSON string array
    content_simplified TEXT,
    form_type TEXT,
    poem_type TEXT NOT NULL,  -- shi, ci, qu, shijing, chuci, classical
    rhythmic TEXT,  -- For ci poems
    tags TEXT,  -- JSON string array
    source_file TEXT,
    source_id TEXT,
    search_content TEXT,  -- For full-text search
    created_at TEXT DEFAULT (datetime('now'))
);

-- Users table
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

-- Collections table
CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    content_type TEXT NOT NULL,  -- poem, ci, prose
    content_id TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, content_type, content_id)
);

-- Reading history table
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_poems_type ON poems(poem_type);
CREATE INDEX IF NOT EXISTS idx_poems_dynasty ON poems(dynasty);
CREATE INDEX IF NOT EXISTS idx_poems_author ON poems(author_id);
CREATE INDEX IF NOT EXISTS idx_poems_search ON poems(search_content);
CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id);
CREATE INDEX IF NOT EXISTS idx_history_user ON reading_history(user_id);
CREATE INDEX IF NOT EXISTS idx_authors_dynasty ON authors(dynasty);
