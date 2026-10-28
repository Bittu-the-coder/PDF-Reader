use tauri::State;

use crate::db::{AddHighlight, Database, Highlight};
use crate::error::AppError;

#[tauri::command]
pub async fn add_highlight(
    db: State<'_, Database>,
    input: AddHighlight,
) -> Result<Highlight, AppError> {
    db.add_highlight(&input)
}

#[tauri::command]
pub async fn list_highlights(
    db: State<'_, Database>,
    book_id: i64,
    page: Option<i64>,
) -> Result<Vec<Highlight>, AppError> {
    db.list_highlights(book_id, page)
}

#[tauri::command]
pub async fn delete_highlight(db: State<'_, Database>, id: i64) -> Result<(), AppError> {
    db.delete_highlight(id)
}

#[tauri::command]
pub async fn update_highlight_color(
    db: State<'_, Database>,
    id: i64,
    color: String,
) -> Result<(), AppError> {
    db.update_highlight_color(id, &color)
}
