use tauri::State;

use crate::db::Database;
use crate::error::AppError;
use crate::secrets;

#[tauri::command]
pub async fn set_api_key(key: String, provider: Option<String>) -> Result<(), AppError> {
    let prov = provider.unwrap_or_else(|| "gemini".to_string());
    secrets::set_api_key_for_provider(&prov, &key)
}

#[tauri::command]
pub async fn has_api_key(provider: Option<String>) -> Result<bool, AppError> {
    let prov = provider.unwrap_or_else(|| "gemini".to_string());
    Ok(secrets::has_api_key_for_provider(&prov))
}

#[tauri::command]
pub async fn clear_api_key(provider: Option<String>) -> Result<(), AppError> {
    let prov = provider.unwrap_or_else(|| "gemini".to_string());
    secrets::delete_api_key_for_provider(&prov)
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
