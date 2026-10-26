use tauri::State;

use crate::db::Database;
use crate::error::AppError;
use crate::secrets;

#[tauri::command]
pub async fn set_api_key(key: String) -> Result<(), AppError> {
    secrets::set_gemini_api_key(&key)
}

#[tauri::command]
pub async fn has_api_key() -> Result<bool, AppError> {
    Ok(secrets::has_gemini_api_key())
}

#[tauri::command]
pub async fn clear_api_key() -> Result<(), AppError> {
    secrets::delete_gemini_api_key()
}

#[tauri::command]
pub async fn get_setting(db: State<'_, Database>, key: String) -> Result<Option<String>, AppError> {
    db.get_setting(&key)
}

#[tauri::command]
pub async fn set_setting(
    db: State<'_, Database>,
    key: String,
    value: String,
) -> Result<(), AppError> {
    db.set_setting(&key, &value)
}
