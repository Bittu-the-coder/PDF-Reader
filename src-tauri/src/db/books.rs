use crate::db::Database;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Book {
    pub id: i64,
    pub shelf_id: Option<i64>,
    pub title: String,
    pub author: Option<String>,
    pub file_path: String,
    pub file_hash: String,
    pub page_count: Option<i64>,
    pub last_page: i64,
    pub last_zoom: Option<f64>,
    pub added_at: String,
    pub last_opened_at: Option<String>,
}

/// A lighter version for the shelf grid (no cover blob in JSON).
#[derive(Debug, Serialize, Clone)]
pub struct BookSummary {
    pub id: i64,
    pub shelf_id: Option<i64>,
    pub title: String,
    pub author: Option<String>,
    pub file_path: String,
    pub page_count: Option<i64>,
    pub last_page: i64,
    pub added_at: String,
    pub last_opened_at: Option<String>,
    pub word_count: i64,
    pub note_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct AddBook {
    pub title: String,
    pub author: Option<String>,
    pub file_path: String,
    pub file_hash: String,
    pub page_count: Option<i64>,
    pub cover_png: Option<Vec<u8>>,
}

impl Database {
    pub fn add_book(&self, book: &AddBook, shelf_id: Option<i64>) -> Result<Book, AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO books (shelf_id, title, author, file_path, file_hash, page_count, cover_png)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                shelf_id,
                book.title,
                book.author,
                book.file_path,
                book.file_hash,
                book.page_count,
                book.cover_png,
            ],
        )?;
        let id = conn.last_insert_rowid();
        self.get_book_from_conn(&conn, id)
    }

    pub fn get_book(&self, id: i64) -> Result<Book, AppError> {
        let conn = self.conn.lock().unwrap();
        self.get_book_from_conn(&conn, id)
    }

    fn get_book_from_conn(&self, conn: &rusqlite::Connection, id: i64) -> Result<Book, AppError> {
        conn.prepare(
            "SELECT id, shelf_id, title, author, file_path, file_hash,
                    page_count, last_page, last_zoom, added_at, last_opened_at
             FROM books WHERE id = ?1",
        )?
        .query_row([id], |row| {
            Ok(Book {
                id: row.get(0)?,
                shelf_id: row.get(1)?,
                title: row.get(2)?,
                author: row.get(3)?,
                file_path: row.get(4)?,
                file_hash: row.get(5)?,
                page_count: row.get(6)?,
                last_page: row.get(7)?,
                last_zoom: row.get(8)?,
                added_at: row.get(9)?,
                last_opened_at: row.get(10)?,
            })
        })
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Book {id} not found"))
            }
            other => AppError::Database(other),
        })
    }

    pub fn list_books(&self, shelf_id: Option<i64>) -> Result<Vec<BookSummary>, AppError> {
        let conn = self.conn.lock().unwrap();
        let sql = if shelf_id.is_some() {
            "SELECT b.id, b.shelf_id, b.title, b.author, b.file_path,
                    b.page_count, b.last_page, b.added_at, b.last_opened_at,
                    (SELECT COUNT(*) FROM words w WHERE w.book_id = b.id) AS word_count,
                    (SELECT COUNT(*) FROM notes n WHERE n.book_id = b.id) AS note_count
             FROM books b WHERE b.shelf_id = ?1
             ORDER BY b.last_opened_at DESC NULLS LAST, b.added_at DESC"
        } else {
            "SELECT b.id, b.shelf_id, b.title, b.author, b.file_path,
                    b.page_count, b.last_page, b.added_at, b.last_opened_at,
                    (SELECT COUNT(*) FROM words w WHERE w.book_id = b.id) AS word_count,
                    (SELECT COUNT(*) FROM notes n WHERE n.book_id = b.id) AS note_count
             FROM books b
             ORDER BY b.last_opened_at DESC NULLS LAST, b.added_at DESC"
        };

        let mut stmt = conn.prepare(sql)?;
        let rows = if let Some(sid) = shelf_id {
            stmt.query_map([sid], Self::map_book_summary)?
                .collect::<Result<Vec<_>, _>>()?
        } else {
            stmt.query_map([], Self::map_book_summary)?
                .collect::<Result<Vec<_>, _>>()?
        };
        Ok(rows)
    }

    fn map_book_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<BookSummary> {
        Ok(BookSummary {
            id: row.get(0)?,
            shelf_id: row.get(1)?,
            title: row.get(2)?,
            author: row.get(3)?,
            file_path: row.get(4)?,
            page_count: row.get(5)?,
            last_page: row.get(6)?,
            added_at: row.get(7)?,
            last_opened_at: row.get(8)?,
            word_count: row.get(9)?,
            note_count: row.get(10)?,
        })
    }

    pub fn save_progress(
        &self,
        book_id: i64,
        page: i64,
        zoom: Option<f64>,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE books SET last_page = ?1, last_zoom = ?2, last_opened_at = datetime('now') WHERE id = ?3",
            rusqlite::params![page, zoom, book_id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Book {book_id} not found")));
        }
        Ok(())
    }

    pub fn delete_book(&self, id: i64) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute("DELETE FROM books WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Book {id} not found")));
        }
        Ok(())
    }

    pub fn move_book(&self, book_id: i64, shelf_id: Option<i64>) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE books SET shelf_id = ?1 WHERE id = ?2",
            rusqlite::params![shelf_id, book_id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Book {book_id} not found")));
        }
        Ok(())
    }

    pub fn get_book_cover(&self, book_id: i64) -> Result<Option<Vec<u8>>, AppError> {
        let conn = self.conn.lock().unwrap();
        conn.prepare("SELECT cover_png FROM books WHERE id = ?1")?
            .query_row([book_id], |row| row.get(0))
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("Book {book_id} not found"))
                }
                other => AppError::Database(other),
            })
    }
}
