use tauri::State;

use crate::db::{AddNote, Database, Note};
use crate::error::AppError;

#[tauri::command]
pub async fn add_note(db: State<'_, Database>, input: AddNote) -> Result<Note, AppError> {
    db.add_note(&input)
}

#[tauri::command]
pub async fn list_notes(
    db: State<'_, Database>,
    book_id: i64,
    chapter_id: Option<i64>,
) -> Result<Vec<Note>, AppError> {
    db.list_notes(book_id, chapter_id)
}

#[tauri::command]
pub async fn update_note(
    db: State<'_, Database>,
    id: i64,
    content: String,
) -> Result<(), AppError> {
    db.update_note(id, &content)
}

#[tauri::command]
pub async fn delete_note(db: State<'_, Database>, id: i64) -> Result<(), AppError> {
    db.delete_note(id)
}
