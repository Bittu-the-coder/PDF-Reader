use tauri::State;

use crate::db::{AddWord, Database, Word};
use crate::error::AppError;

#[tauri::command]
pub async fn add_word(db: State<'_, Database>, input: AddWord) -> Result<Word, AppError> {
    db.add_word(&input)
}

#[tauri::command]
pub async fn list_words(
    db: State<'_, Database>,
    book_id: i64,
    chapter_id: Option<i64>,
) -> Result<Vec<Word>, AppError> {
    db.list_words(book_id, chapter_id)
}

#[tauri::command]
pub async fn find_word(
    db: State<'_, Database>,
    book_id: i64,
    word: String,
) -> Result<Option<Word>, AppError> {
    db.find_word(book_id, &word)
}

#[tauri::command]
pub async fn update_word(
    db: State<'_, Database>,
    id: i64,
    meaning: String,
    example_sentence: Option<String>,
) -> Result<(), AppError> {
    db.update_word(id, &meaning, example_sentence.as_deref())
}

#[tauri::command]
pub async fn delete_word(db: State<'_, Database>, id: i64) -> Result<(), AppError> {
    db.delete_word(id)
}
