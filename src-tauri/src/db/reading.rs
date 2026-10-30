use crate::db::Database;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Bookmark {
    pub id: i64,
    pub book_id: i64,
    pub page: i64,
    pub label: Option<String>,
    pub created_at: String,
}

/// A saved word together with its spaced-repetition state.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewCard {
    pub word_id: i64,
    pub book_id: i64,
    pub word: String,
    pub meaning: String,
    pub meaning_hindi: Option<String>,
    pub example_sentence: Option<String>,
    pub page: Option<i64>,
    pub reps: i64,
    pub due_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ReadingStats {
    /// Total seconds of active reading recorded for the book
    pub seconds: i64,
    /// Page turns recorded during those seconds
    pub pages: i64,
}

/// Review grades, as shown on the flashcard buttons.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Grade {
    Again,
    Hard,
    Good,
    Easy,
}

impl Grade {
    pub fn from_i64(v: i64) -> Self {
        match v {
            1 => Grade::Again,
            2 => Grade::Hard,
            4 => Grade::Easy,
            _ => Grade::Good,
        }
    }
}

/// Next stability (interval in days) for a card. `Again` returns 0, meaning
/// "show again in a few minutes".
pub fn next_stability(stability: f64, grade: Grade) -> f64 {
    let s = stability.max(0.0);
    match grade {
        Grade::Again => 0.0,
        Grade::Hard => (s * 1.2).max(1.0),
        Grade::Good => {
            if s < 1.0 {
                1.0
            } else {
                s * 2.5
            }
        }
        Grade::Easy => {
            if s < 1.0 {
                4.0
            } else {
                s * 3.5
            }
        }
    }
}

const TIME_FMT: &str = "%Y-%m-%d %H:%M:%S";

impl Database {
    // ---------------------------------------------------------------- bookmarks

    pub fn list_bookmarks(&self, book_id: i64) -> Result<Vec<Bookmark>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, book_id, page, label, created_at FROM bookmarks WHERE book_id = ?1 ORDER BY page",
        )?;
        let rows = stmt
            .query_map([book_id], |row| {
                Ok(Bookmark {
                    id: row.get(0)?,
                    book_id: row.get(1)?,
                    page: row.get(2)?,
                    label: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn add_bookmark(&self, book_id: i64, page: i64, label: Option<&str>) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO bookmarks (book_id, page, label) VALUES (?1, ?2, ?3)
             ON CONFLICT(book_id, page) DO UPDATE SET label = excluded.label",
            rusqlite::params![book_id, page, label],
        )?;
        Ok(())
    }

    pub fn delete_bookmark(&self, book_id: i64, page: i64) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM bookmarks WHERE book_id = ?1 AND page = ?2",
            rusqlite::params![book_id, page],
        )?;
        Ok(())
    }

    // ---------------------------------------------------------------- review

    /// Words that are due for review (never-reviewed words count as due),
    /// for one book or the whole library when `book_id` is None.
    pub fn list_due_cards(&self, book_id: Option<i64>, limit: i64) -> Result<Vec<ReviewCard>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT w.id, w.book_id, w.word, w.meaning, w.meaning_hindi, w.example_sentence, w.page,
                    COALESCE(f.reps, 0), f.due_at
             FROM words w
             LEFT JOIN flashcards f ON f.word_id = w.id
             WHERE (?1 IS NULL OR w.book_id = ?1)
               AND (f.due_at IS NULL OR f.due_at <= datetime('now'))
             ORDER BY f.due_at IS NOT NULL, f.due_at, w.created_at
             LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![book_id, limit], |row| {
                Ok(ReviewCard {
                    word_id: row.get(0)?,
                    book_id: row.get(1)?,
                    word: row.get(2)?,
                    meaning: row.get(3)?,
                    meaning_hindi: row.get(4)?,
                    example_sentence: row.get(5)?,
                    page: row.get(6)?,
                    reps: row.get(7)?,
                    due_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn count_due_cards(&self, book_id: Option<i64>) -> Result<i64, AppError> {
        let conn = self.conn.lock().unwrap();
        let n = conn.query_row(
            "SELECT COUNT(*) FROM words w LEFT JOIN flashcards f ON f.word_id = w.id
             WHERE (?1 IS NULL OR w.book_id = ?1)
               AND (f.due_at IS NULL OR f.due_at <= datetime('now'))",
            rusqlite::params![book_id],
            |row| row.get(0),
        )?;
        Ok(n)
    }

    /// Record a review and schedule the next one.
    pub fn review_card(&self, word_id: i64, grade: Grade) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let (stability, reps, lapses): (f64, i64, i64) = conn
            .query_row(
                "SELECT COALESCE(stability, 0), reps, lapses FROM flashcards WHERE word_id = ?1",
                [word_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap_or((0.0, 0, 0));

        let next = next_stability(stability, grade);
        let now = chrono::Utc::now();
        let due = if next == 0.0 {
            now + chrono::Duration::minutes(10)
        } else {
            now + chrono::Duration::seconds((next * 86_400.0) as i64)
        };
        let lapses = lapses + i64::from(grade == Grade::Again);

        conn.execute(
            "INSERT INTO flashcards (word_id, due_at, stability, reps, lapses, last_review_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(word_id) DO UPDATE SET
               due_at = excluded.due_at, stability = excluded.stability, reps = excluded.reps,
               lapses = excluded.lapses, last_review_at = excluded.last_review_at",
            rusqlite::params![
                word_id,
                due.format(TIME_FMT).to_string(),
                next,
                reps + 1,
                lapses,
                now.format(TIME_FMT).to_string()
            ],
        )?;
        Ok(())
    }

    // ---------------------------------------------------------------- reading time

    pub fn log_reading(&self, book_id: i64, seconds: i64, pages: i64) -> Result<(), AppError> {
        if seconds <= 0 {
            return Ok(());
        }
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO reading_sessions (book_id, started_at, ended_at, seconds, pages_read)
             VALUES (?1, datetime('now', ?2), datetime('now'), ?3, ?4)",
            rusqlite::params![book_id, format!("-{seconds} seconds"), seconds, pages],
        )?;
        Ok(())
    }

    pub fn reading_stats(&self, book_id: i64) -> Result<ReadingStats, AppError> {
        let conn = self.conn.lock().unwrap();
        let stats = conn.query_row(
            "SELECT COALESCE(SUM(seconds), 0), COALESCE(SUM(pages_read), 0)
             FROM reading_sessions WHERE book_id = ?1",
            [book_id],
            |row| {
                Ok(ReadingStats {
                    seconds: row.get(0)?,
                    pages: row.get(1)?,
                })
            },
        )?;
        Ok(stats)
    }
}
