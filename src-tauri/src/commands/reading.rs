use tauri::State;

use crate::db::{Bookmark, Database, Grade, ReadingStats, ReviewCard};
use crate::error::AppError;

#[tauri::command]
pub async fn list_bookmarks(db: State<'_, Database>, book_id: i64) -> Result<Vec<Bookmark>, AppError> {
    db.list_bookmarks(book_id)
}

#[tauri::command]
pub async fn add_bookmark(
    db: State<'_, Database>,
    book_id: i64,
    page: i64,
    label: Option<String>,
) -> Result<(), AppError> {
    db.add_bookmark(book_id, page, label.as_deref())
}

#[tauri::command]
pub async fn delete_bookmark(db: State<'_, Database>, book_id: i64, page: i64) -> Result<(), AppError> {
    db.delete_bookmark(book_id, page)
}

#[tauri::command]
pub async fn list_due_cards(
    db: State<'_, Database>,
    book_id: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<ReviewCard>, AppError> {
    db.list_due_cards(book_id, limit.unwrap_or(50))
}

#[tauri::command]
pub async fn count_due_cards(db: State<'_, Database>, book_id: Option<i64>) -> Result<i64, AppError> {
    db.count_due_cards(book_id)
}

/// `grade`: 1 = again, 2 = hard, 3 = good, 4 = easy
#[tauri::command]
pub async fn review_card(db: State<'_, Database>, word_id: i64, grade: i64) -> Result<(), AppError> {
    db.review_card(word_id, Grade::from_i64(grade))
}

#[tauri::command]
pub async fn log_reading(
    db: State<'_, Database>,
    book_id: i64,
    seconds: i64,
    pages: i64,
) -> Result<(), AppError> {
    db.log_reading(book_id, seconds, pages)
}

#[tauri::command]
pub async fn reading_stats(db: State<'_, Database>, book_id: i64) -> Result<ReadingStats, AppError> {
    db.reading_stats(book_id)
}
