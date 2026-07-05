-- Content platform schema for chinese-poetry.
-- This migration is additive: the existing poems/authors tables remain usable
-- while the new API and import pipeline move toward the unified model.

CREATE TABLE IF NOT EXISTS content_collections (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title_traditional TEXT NOT NULL,
  title_simplified TEXT NOT NULL,
  type TEXT NOT NULL,
  dynasty TEXT,
  description_traditional TEXT,
  description_simplified TEXT,
  source_path TEXT,
  sort_order INTEGER DEFAULT 0,
  item_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_authors (
  id TEXT PRIMARY KEY,
  name_traditional TEXT NOT NULL,
  name_simplified TEXT NOT NULL,
  dynasty TEXT,
  description_traditional TEXT,
  description_simplified TEXT,
  source TEXT,
  source_id TEXT,
  work_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(name_traditional, dynasty)
);

CREATE TABLE IF NOT EXISTS works (
  id TEXT PRIMARY KEY,
  title_traditional TEXT NOT NULL,
  title_simplified TEXT NOT NULL,
  author_id TEXT REFERENCES content_authors(id),
  author_name_traditional TEXT,
  author_name_simplified TEXT,
  dynasty TEXT,
  genre TEXT NOT NULL,
  form_type TEXT,
  rhythmic TEXT,
  collection_id TEXT REFERENCES content_collections(id),
  source_path TEXT,
  source_id TEXT,
  source_ref TEXT,
  content_traditional TEXT NOT NULL,
  content_simplified TEXT NOT NULL,
  plain_text_traditional TEXT NOT NULL,
  plain_text_simplified TEXT NOT NULL,
  notes TEXT,
  translation TEXT,
  annotation TEXT,
  tags TEXT,
  metadata TEXT,
  popularity_score INTEGER DEFAULT 0,
  word_count INTEGER DEFAULT 0,
  line_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS book_nodes (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES content_collections(id),
  parent_id TEXT REFERENCES book_nodes(id),
  node_type TEXT NOT NULL,
  title_traditional TEXT NOT NULL,
  title_simplified TEXT NOT NULL,
  author_id TEXT REFERENCES content_authors(id),
  author_name_traditional TEXT,
  author_name_simplified TEXT,
  source_path TEXT,
  source_ref TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  paragraph_count INTEGER DEFAULT 0,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS paragraphs (
  id TEXT PRIMARY KEY,
  work_id TEXT REFERENCES works(id),
  node_id TEXT REFERENCES book_nodes(id),
  order_index INTEGER NOT NULL,
  text_traditional TEXT NOT NULL,
  text_simplified TEXT NOT NULL,
  annotation TEXT,
  translation TEXT,
  notes TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  CHECK (work_id IS NOT NULL OR node_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS work_strains (
  work_id TEXT NOT NULL REFERENCES works(id),
  line_index INTEGER NOT NULL,
  pattern TEXT NOT NULL,
  PRIMARY KEY (work_id, line_index)
);

CREATE TABLE IF NOT EXISTS work_metadata (
  work_id TEXT NOT NULL REFERENCES works(id),
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (work_id, key)
);

CREATE VIRTUAL TABLE IF NOT EXISTS content_search
USING fts5(
  entity_type,
  entity_id UNINDEXED,
  title,
  author,
  body,
  dynasty,
  genre,
  collection,
  tokenize = 'unicode61'
);

CREATE INDEX IF NOT EXISTS idx_works_author ON works(author_id);
CREATE INDEX IF NOT EXISTS idx_works_collection ON works(collection_id);
CREATE INDEX IF NOT EXISTS idx_works_genre_dynasty ON works(genre, dynasty);
CREATE INDEX IF NOT EXISTS idx_works_rhythmic ON works(rhythmic);
CREATE INDEX IF NOT EXISTS idx_works_popularity ON works(popularity_score DESC);
CREATE INDEX IF NOT EXISTS idx_book_nodes_collection ON book_nodes(collection_id, parent_id, order_index);
CREATE INDEX IF NOT EXISTS idx_paragraphs_work ON paragraphs(work_id, order_index);
CREATE INDEX IF NOT EXISTS idx_paragraphs_node ON paragraphs(node_id, order_index);
CREATE INDEX IF NOT EXISTS idx_content_authors_name ON content_authors(name_simplified, name_traditional);
