use crate::db::Database;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Word {
    pub id: i64,
    pub book_id: i64,
    pub chapter_id: Option<i64>,
    pub word: String,
    pub meaning: String,
    pub example_sentence: Option<String>,
    pub page: Option<i64>,
    pub ai_generated: bool,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct AddWord {
    pub book_id: i64,
    pub chapter_id: Option<i64>,
    pub word: String,
    pub meaning: String,
    pub example_sentence: Option<String>,
    pub page: Option<i64>,
    pub ai_generated: Option<bool>,
}

impl Database {
    pub fn add_word(&self, w: &AddWord) -> Result<Word, AppError> {
        // Auto-assign chapter if page is given and chapter_id is not
        let chapter_id = match (w.chapter_id, w.page) {
            (Some(cid), _) => Some(cid),
            (None, Some(page)) => {
                // Don't hold the lock across self call — use a separate scope
                self.find_chapter_for_page(w.book_id, page)?
            }
            (None, None) => None,
        };

        let conn = self.conn.lock().unwrap();
        let ai = if w.ai_generated.unwrap_or(false) {
            1
        } else {
            0
        };

        let result = conn.execute(
            "INSERT INTO words (book_id, chapter_id, word, meaning, example_sentence, page, ai_generated)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                w.book_id,
                chapter_id,
                w.word,
                w.meaning,
                w.example_sentence,
                w.page,
                ai,
            ],
        );

        match result {
            Ok(_) => {
                let id = conn.last_insert_rowid();
                conn.prepare(
                    "SELECT id, book_id, chapter_id, word, meaning, example_sentence, page, ai_generated, created_at
                     FROM words WHERE id = ?1",
                )?
                .query_row([id], Self::map_word)
                .map_err(AppError::from)
            }
            Err(rusqlite::Error::SqliteFailure(err, _))
                if err.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                Err(AppError::DuplicateWord {
                    word: w.word.clone(),
                })
            }
            Err(e) => Err(AppError::Database(e)),
        }
    }

    pub fn list_words(&self, book_id: i64, chapter_id: Option<i64>) -> Result<Vec<Word>, AppError> {
        let conn = self.conn.lock().unwrap();
        let words = if let Some(cid) = chapter_id {
            let mut stmt = conn.prepare(
                "SELECT id, book_id, chapter_id, word, meaning, example_sentence, page, ai_generated, created_at
                 FROM words WHERE book_id = ?1 AND chapter_id = ?2 ORDER BY word COLLATE NOCASE",
            )?;
            stmt.query_map(rusqlite::params![book_id, cid], Self::map_word)?
                .collect::<Result<Vec<_>, _>>()?
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, book_id, chapter_id, word, meaning, example_sentence, page, ai_generated, created_at
                 FROM words WHERE book_id = ?1 ORDER BY word COLLATE NOCASE",
            )?;
            stmt.query_map([book_id], Self::map_word)?
                .collect::<Result<Vec<_>, _>>()?
        };
        Ok(words)
    }

    pub fn find_word(&self, book_id: i64, word: &str) -> Result<Option<Word>, AppError> {
        let conn = self.conn.lock().unwrap();
        let result = conn
            .prepare(
                "SELECT id, book_id, chapter_id, word, meaning, example_sentence, page, ai_generated, created_at
                 FROM words WHERE book_id = ?1 AND word = ?2 COLLATE NOCASE LIMIT 1",
            )?
            .query_row(rusqlite::params![book_id, word], Self::map_word)
            .ok();
        Ok(result)
    }

    pub fn update_word(
        &self,
        id: i64,
        meaning: &str,
        example_sentence: Option<&str>,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE words SET meaning = ?1, example_sentence = ?2 WHERE id = ?3",
            rusqlite::params![meaning, example_sentence, id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Word {id} not found")));
        }
        Ok(())
    }

    pub fn delete_word(&self, id: i64) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute("DELETE FROM words WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Word {id} not found")));
        }
        Ok(())
    }

    fn map_word(row: &rusqlite::Row<'_>) -> rusqlite::Result<Word> {
        Ok(Word {
            id: row.get(0)?,
            book_id: row.get(1)?,
            chapter_id: row.get(2)?,
            word: row.get(3)?,
            meaning: row.get(4)?,
            example_sentence: row.get(5)?,
            page: row.get(6)?,
            ai_generated: row.get::<_, i64>(7)? != 0,
            created_at: row.get(8)?,
        })
    }
}
