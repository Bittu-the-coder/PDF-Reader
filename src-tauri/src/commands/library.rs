use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use tauri::State;

use crate::db::{AddBook, Book, BookSummary, Database, Shelf};
use crate::error::AppError;

fn compute_file_hash(path: &str) -> Result<String, AppError> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[tauri::command]
pub async fn add_book(
    db: State<'_, Database>,
    path: String,
    shelf_id: Option<i64>,
    title: Option<String>,
    author: Option<String>,
    page_count: Option<i64>,
    cover_png: Option<Vec<u8>>,
) -> Result<Book, AppError> {
    let file_hash = compute_file_hash(&path)?;

    // Check if book with hash already exists
    let existing_id: Option<i64> = {
        let conn = db.conn.lock().unwrap();
        conn.prepare("SELECT id FROM books WHERE file_hash = ?1")?
            .query_row([&file_hash], |row| row.get(0))
            .ok()
    };

    if let Some(id) = existing_id {
        // If it moved, update the path
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "UPDATE books SET file_path = ?1, last_opened_at = datetime('now') WHERE id = ?2",
                rusqlite::params![path, id],
            )?;
        }
        return db.get_book(id);
    }

    let default_title = Path::new(&path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string();

    let book_input = AddBook {
        title: title.unwrap_or(default_title),
        author,
        file_path: path,
        file_hash,
        page_count,
        cover_png,
    };

    db.add_book(&book_input, shelf_id)
}

#[tauri::command]
pub async fn list_books(
    db: State<'_, Database>,
    shelf_id: Option<i64>,
) -> Result<Vec<BookSummary>, AppError> {
    db.list_books(shelf_id)
}

#[tauri::command]
pub async fn get_book(db: State<'_, Database>, id: i64) -> Result<Book, AppError> {
    db.get_book(id)
}

#[tauri::command]
pub async fn delete_book(db: State<'_, Database>, id: i64) -> Result<(), AppError> {
    db.delete_book(id)
}

#[tauri::command]
pub async fn save_progress(
    db: State<'_, Database>,
    book_id: i64,
    page: i64,
    zoom: Option<f64>,
) -> Result<(), AppError> {
    db.save_progress(book_id, page, zoom)
}

#[tauri::command]
pub async fn update_book_details(
    db: State<'_, Database>,
    id: i64,
    title: Option<String>,
    author: Option<String>,
    page_count: Option<i64>,
    cover_png: Option<Vec<u8>>,
) -> Result<(), AppError> {
    let conn = db.conn.lock().unwrap();
    if let Some(t) = title {
        conn.execute(
            "UPDATE books SET title = ?1 WHERE id = ?2",
            rusqlite::params![t, id],
        )?;
    }
    if let Some(a) = author {
        conn.execute(
            "UPDATE books SET author = ?1 WHERE id = ?2",
            rusqlite::params![a, id],
        )?;
    }
    if let Some(p) = page_count {
        conn.execute(
            "UPDATE books SET page_count = ?1 WHERE id = ?2",
            rusqlite::params![p, id],
        )?;
    }
    if let Some(c) = cover_png {
        conn.execute(
            "UPDATE books SET cover_png = ?1 WHERE id = ?2",
            rusqlite::params![c, id],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub async fn move_book(
    db: State<'_, Database>,
    book_id: i64,
    shelf_id: Option<i64>,
) -> Result<(), AppError> {
    db.move_book(book_id, shelf_id)
}

#[tauri::command]
pub async fn get_book_cover(
    db: State<'_, Database>,
    book_id: i64,
) -> Result<Option<Vec<u8>>, AppError> {
    db.get_book_cover(book_id)
}

#[tauri::command]
pub async fn read_pdf_bytes(path: String) -> Result<Vec<u8>, AppError> {
    std::fs::read(&path).map_err(AppError::from)
}

#[tauri::command]
pub async fn save_imported_pdf(
    app: tauri::AppHandle,
    name: String,
    bytes: Vec<u8>,
) -> Result<String, AppError> {
    use tauri::Manager;
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;
    let imports_dir = app_dir.join("imports");
    std::fs::create_dir_all(&imports_dir)?;

    let clean_name = Path::new(&name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("document.pdf");
    let target_path = imports_dir.join(clean_name);
    std::fs::write(&target_path, &bytes)?;
    Ok(target_path.to_string_lossy().to_string())
}

// Shelves
#[tauri::command]
pub async fn create_shelf(db: State<'_, Database>, name: String) -> Result<Shelf, AppError> {
    db.create_shelf(&name)
}

#[tauri::command]
pub async fn list_shelves(db: State<'_, Database>) -> Result<Vec<Shelf>, AppError> {
    db.list_shelves()
}

#[tauri::command]
pub async fn rename_shelf(
    db: State<'_, Database>,
    id: i64,
    new_name: String,
) -> Result<(), AppError> {
    db.rename_shelf(id, &new_name)
}

#[tauri::command]
pub async fn delete_shelf(db: State<'_, Database>, id: i64) -> Result<(), AppError> {
    db.delete_shelf(id)
}
