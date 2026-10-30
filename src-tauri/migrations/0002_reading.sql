-- migrations/0002_reading.sql
-- Page bookmarks

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (book_id, page)
);

CREATE INDEX IF NOT EXISTS idx_reading_sessions_book ON reading_sessions(book_id);
