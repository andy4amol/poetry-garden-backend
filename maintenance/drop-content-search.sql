-- One-time production maintenance.
--
-- The FTS table duplicates a large amount of content and keeps the D1 database
-- above the write threshold. Deploy the fallback search Worker before running.

DROP TABLE IF EXISTS content_search;
