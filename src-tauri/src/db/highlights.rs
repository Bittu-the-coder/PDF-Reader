use crate::db::Database;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Highlight {
    pub id: i64,
    pub book_id: i64,
    pub page: i64,
    pub color: String,
    pub text: String,
    pub rects_json: String,
    pub note_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct AddHighlight {
    pub book_id: i64,
    pub page: i64,
    pub color: Option<String>,
    pub text: String,
    pub rects_json: String,
    pub note_id: Option<i64>,
}

impl Database {
    pub fn add_highlight(&self, h: &AddHighlight) -> Result<Highlight, AppError> {
        let conn = self.conn.lock().unwrap();
        let color = h.color.as_deref().unwrap_or("yellow");
        conn.execute(
            "INSERT INTO highlights (book_id, page, color, text, rects_json, note_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![h.book_id, h.page, color, h.text, h.rects_json, h.note_id],
        )?;
        let id = conn.last_insert_rowid();
        conn.prepare(
            "SELECT id, book_id, page, color, text, rects_json, note_id, created_at
             FROM highlights WHERE id = ?1",
        )?
        .query_row([id], Self::map_highlight)
        .map_err(AppError::from)
    }

    pub fn list_highlights(
        &self,
        book_id: i64,
        page: Option<i64>,
    ) -> Result<Vec<Highlight>, AppError> {
        let conn = self.conn.lock().unwrap();
        let highlights = if let Some(p) = page {
            let mut stmt = conn.prepare(
                "SELECT id, book_id, page, color, text, rects_json, note_id, created_at
                 FROM highlights WHERE book_id = ?1 AND page = ?2 ORDER BY created_at",
            )?;
            stmt.query_map(rusqlite::params![book_id, p], Self::map_highlight)?
                .collect::<Result<Vec<_>, _>>()?
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, book_id, page, color, text, rects_json, note_id, created_at
                 FROM highlights WHERE book_id = ?1 ORDER BY page, created_at",
            )?;
            stmt.query_map([book_id], Self::map_highlight)?
                .collect::<Result<Vec<_>, _>>()?
        };
        Ok(highlights)
    }

    pub fn delete_highlight(&self, id: i64) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute("DELETE FROM highlights WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Highlight {id} not found")));
        }
        Ok(())
    }

    fn map_highlight(row: &rusqlite::Row<'_>) -> rusqlite::Result<Highlight> {
        Ok(Highlight {
            id: row.get(0)?,
            book_id: row.get(1)?,
            page: row.get(2)?,
            color: row.get(3)?,
            text: row.get(4)?,
            rects_json: row.get(5)?,
            note_id: row.get(6)?,
            created_at: row.get(7)?,
        })
    }
}
