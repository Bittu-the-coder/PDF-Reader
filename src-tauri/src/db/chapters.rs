use crate::db::Database;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Chapter {
    pub id: i64,
    pub book_id: i64,
    pub title: String,
    pub start_page: i64,
    pub position: i64,
    pub source: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateChapter {
    pub book_id: i64,
    pub title: String,
    pub start_page: i64,
    pub position: i64,
    pub source: Option<String>,
}

impl Database {
    pub fn create_chapter(&self, ch: &CreateChapter) -> Result<Chapter, AppError> {
        let conn = self.conn.lock().unwrap();
        let source = ch.source.as_deref().unwrap_or("manual");
        conn.execute(
            "INSERT INTO chapters (book_id, title, start_page, position, source)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![ch.book_id, ch.title, ch.start_page, ch.position, source],
        )?;
        let id = conn.last_insert_rowid();
        conn.prepare(
            "SELECT id, book_id, title, start_page, position, source FROM chapters WHERE id = ?1",
        )?
        .query_row([id], Self::map_chapter)
        .map_err(AppError::from)
    }

    pub fn list_chapters(&self, book_id: i64) -> Result<Vec<Chapter>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, book_id, title, start_page, position, source
             FROM chapters WHERE book_id = ?1 ORDER BY position",
        )?;
        let chapters = stmt
            .query_map([book_id], Self::map_chapter)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(chapters)
    }

    pub fn import_outline(
        &self,
        book_id: i64,
        items: &[(String, i64)],
    ) -> Result<Vec<Chapter>, AppError> {
        let conn = self.conn.lock().unwrap();
        // Clear existing outline-sourced chapters
        conn.execute(
            "DELETE FROM chapters WHERE book_id = ?1 AND source = 'outline'",
            [book_id],
        )?;

        for (i, (title, page)) in items.iter().enumerate() {
            conn.execute(
                "INSERT INTO chapters (book_id, title, start_page, position, source)
                 VALUES (?1, ?2, ?3, ?4, 'outline')",
                rusqlite::params![book_id, title, page, i as i64],
            )?;
        }
        drop(conn);
        self.list_chapters(book_id)
    }

    pub fn update_chapter(&self, id: i64, title: &str, start_page: i64) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE chapters SET title = ?1, start_page = ?2 WHERE id = ?3",
            rusqlite::params![title, start_page, id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Chapter {id} not found")));
        }
        Ok(())
    }

    pub fn delete_chapter(&self, id: i64) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute("DELETE FROM chapters WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Chapter {id} not found")));
        }
        Ok(())
    }

    /// Find the chapter that a given page belongs to (greatest start_page <= page).
    pub fn find_chapter_for_page(&self, book_id: i64, page: i64) -> Result<Option<i64>, AppError> {
        let conn = self.conn.lock().unwrap();
        let result = conn
            .prepare(
                "SELECT id FROM chapters
                 WHERE book_id = ?1 AND start_page <= ?2
                 ORDER BY start_page DESC LIMIT 1",
            )?
            .query_row(rusqlite::params![book_id, page], |row| row.get(0))
            .ok();
        Ok(result)
    }

    fn map_chapter(row: &rusqlite::Row<'_>) -> rusqlite::Result<Chapter> {
        Ok(Chapter {
            id: row.get(0)?,
            book_id: row.get(1)?,
            title: row.get(2)?,
            start_page: row.get(3)?,
            position: row.get(4)?,
            source: row.get(5)?,
        })
    }
}
