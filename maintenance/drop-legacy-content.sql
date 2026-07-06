-- One-time production maintenance.
--
-- The app has moved from legacy poems/authors to works/content_authors.
-- Run this before remote migrations if D1 reports "Exceeded maximum DB size".

DROP INDEX IF EXISTS idx_poems_type;
DROP INDEX IF EXISTS idx_poems_dynasty;
DROP INDEX IF EXISTS idx_poems_author;
DROP INDEX IF EXISTS idx_poems_search;
DROP INDEX IF EXISTS idx_authors_dynasty;

DROP TABLE IF EXISTS poems;
DROP TABLE IF EXISTS authors;
