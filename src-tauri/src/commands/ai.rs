use tauri::State;

use crate::ai::{AiClient, WordLookupResult};
use crate::db::Database;
use crate::error::AppError;

#[tauri::command]
pub async fn lookup_word(
    db: State<'_, Database>,
    word: String,
    context_sentence: Option<String>,
    target_language: Option<String>,
    provider: Option<String>,
) -> Result<WordLookupResult, AppError> {
    let active_provider = provider
        .or_else(|| db.get_setting("ai_provider").ok().flatten())
        .unwrap_or_else(|| "gemini".to_string());

    let custom_model = if active_provider == "openrouter" {
        db.get_setting("openrouter_model").ok().flatten()
    } else {
        db.get_setting("gemini_model").ok().flatten()
    };

    let lang = target_language.or_else(|| db.get_setting("target_language").ok().flatten());
    let client = AiClient::default();
    client
        .lookup_word(
            &word,
            context_sentence.as_deref(),
            &active_provider,
            custom_model.as_deref(),
            lang.as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn explain_passage(
    db: State<'_, Database>,
    passage: String,
    mode: Option<String>,
    target_language: Option<String>,
    context: Option<String>,
    provider: Option<String>,
) -> Result<String, AppError> {
    let active_provider = provider
        .or_else(|| db.get_setting("ai_provider").ok().flatten())
        .unwrap_or_else(|| "gemini".to_string());

    let custom_model = if active_provider == "openrouter" {
        db.get_setting("openrouter_model").ok().flatten()
    } else {
        db.get_setting("gemini_model").ok().flatten()
    };

    let lang = target_language.or_else(|| db.get_setting("target_language").ok().flatten());
    let active_mode = mode.unwrap_or_else(|| "explain".to_string());
    let client = AiClient::default();
    client
        .explain_passage(
            &passage,
            &active_mode,
            &active_provider,
            custom_model.as_deref(),
            lang.as_deref(),
            context.as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn chat_word_inquiry(
    db: State<'_, Database>,
    word: String,
    context: Option<String>,
    query: String,
    history: Option<Vec<serde_json::Value>>,
    target_language: Option<String>,
    provider: Option<String>,
) -> Result<String, AppError> {
    let active_provider = provider
        .or_else(|| db.get_setting("ai_provider").ok().flatten())
        .unwrap_or_else(|| "gemini".to_string());

    let custom_model = if active_provider == "openrouter" {
        db.get_setting("openrouter_model").ok().flatten()
    } else {
        db.get_setting("gemini_model").ok().flatten()
    };

    let lang = target_language.or_else(|| db.get_setting("target_language").ok().flatten());
    let client = AiClient::default();
    client
        .chat_word_inquiry(
            &word,
            context.as_deref(),
            &query,
            history.unwrap_or_default(),
            &active_provider,
            custom_model.as_deref(),
            lang.as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn toggle_fullscreen(window: tauri::Window) -> Result<bool, AppError> {
    let is_fullscreen = window.is_fullscreen().map_err(|e| AppError::Internal(e.to_string()))?;
    window.set_fullscreen(!is_fullscreen).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(!is_fullscreen)
}

#[tauri::command]
pub async fn set_fullscreen(window: tauri::Window, fullscreen: bool) -> Result<bool, AppError> {
    window.set_fullscreen(fullscreen).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(fullscreen)
}

#[tauri::command]
pub async fn test_api_key(key: String, provider: Option<String>) -> Result<bool, AppError> {
    let prov = provider.unwrap_or_else(|| "gemini".to_string());
    AiClient::test_key(&prov, &key).await
}
