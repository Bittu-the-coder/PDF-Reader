use crate::db::Database;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: i64,
    pub book_id: i64,
    pub chapter_id: Option<i64>,
    pub content: String,
    pub page: Option<i64>,
    pub quote: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct AddNote {
    pub book_id: i64,
    pub chapter_id: Option<i64>,
    pub content: String,
    pub page: Option<i64>,
    pub quote: Option<String>,
}

impl Database {
    pub fn add_note(&self, n: &AddNote) -> Result<Note, AppError> {
        // Auto-assign chapter if page is given and chapter_id is not
        let chapter_id = match (n.chapter_id, n.page) {
            (Some(cid), _) => Some(cid),
            (None, Some(page)) => self.find_chapter_for_page(n.book_id, page)?,
            (None, None) => None,
        };

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO notes (book_id, chapter_id, content, page, quote)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![n.book_id, chapter_id, n.content, n.page, n.quote],
        )?;
        let id = conn.last_insert_rowid();
        conn.prepare(
            "SELECT id, book_id, chapter_id, content, page, quote, created_at, updated_at
             FROM notes WHERE id = ?1",
        )?
        .query_row([id], Self::map_note)
        .map_err(AppError::from)
    }

    pub fn list_notes(&self, book_id: i64, chapter_id: Option<i64>) -> Result<Vec<Note>, AppError> {
        let conn = self.conn.lock().unwrap();
        let notes = if let Some(cid) = chapter_id {
            let mut stmt = conn.prepare(
                "SELECT id, book_id, chapter_id, content, page, quote, created_at, updated_at
                 FROM notes WHERE book_id = ?1 AND chapter_id = ?2 ORDER BY page, created_at",
            )?;
            stmt.query_map(rusqlite::params![book_id, cid], Self::map_note)?
                .collect::<Result<Vec<_>, _>>()?
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, book_id, chapter_id, content, page, quote, created_at, updated_at
                 FROM notes WHERE book_id = ?1 ORDER BY page, created_at",
            )?;
            stmt.query_map([book_id], Self::map_note)?
                .collect::<Result<Vec<_>, _>>()?
        };
        Ok(notes)
    }

    pub fn update_note(&self, id: i64, content: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE notes SET content = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![content, id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Note {id} not found")));
        }
        Ok(())
    }

    pub fn delete_note(&self, id: i64) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute("DELETE FROM notes WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Note {id} not found")));
        }
        Ok(())
    }

    fn map_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
        Ok(Note {
            id: row.get(0)?,
            book_id: row.get(1)?,
            chapter_id: row.get(2)?,
            content: row.get(3)?,
            page: row.get(4)?,
            quote: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    }
}
