use serde::Deserialize;
use tauri::State;

use crate::db::{Chapter, CreateChapter, Database};
use crate::error::AppError;

#[derive(Debug, Deserialize)]
pub struct OutlineItem {
    pub title: String,
    pub page: i64,
}

#[tauri::command]
pub async fn import_outline(
    db: State<'_, Database>,
    book_id: i64,
    outline: Vec<OutlineItem>,
) -> Result<Vec<Chapter>, AppError> {
    let items: Vec<(String, i64)> = outline
        .into_iter()
        .map(|item| (item.title, item.page))
        .collect();
    db.import_outline(book_id, &items)
}

#[tauri::command]
pub async fn list_chapters(
    db: State<'_, Database>,
    book_id: i64,
) -> Result<Vec<Chapter>, AppError> {
    db.list_chapters(book_id)
}

#[tauri::command]
pub async fn create_chapter(
    db: State<'_, Database>,
    input: CreateChapter,
) -> Result<Chapter, AppError> {
    db.create_chapter(&input)
}

#[tauri::command]
pub async fn update_chapter(
    db: State<'_, Database>,
    id: i64,
    title: String,
    start_page: i64,
) -> Result<(), AppError> {
    db.update_chapter(id, &title, start_page)
}

#[tauri::command]
pub async fn delete_chapter(db: State<'_, Database>, id: i64) -> Result<(), AppError> {
    db.delete_chapter(id)
}
