use crate::error::AppError;
use keyring::Entry;

const SERVICE_NAME: &str = "com.shelf.reader";
const GEMINI_USER_KEY: &str = "gemini_api_key";
const OPENROUTER_USER_KEY: &str = "openrouter_api_key";

fn get_user_key(provider: &str) -> &'static str {
    match provider {
        "openrouter" => OPENROUTER_USER_KEY,
        _ => GEMINI_USER_KEY,
    }
}

pub fn set_api_key_for_provider(provider: &str, key: &str) -> Result<(), AppError> {
    let user_key = get_user_key(provider);
    let entry = Entry::new(SERVICE_NAME, user_key)
        .map_err(|e| AppError::Internal(format!("Keyring init error: {e}")))?;
    entry
        .set_password(key)
        .map_err(|e| AppError::Internal(format!("Failed to save API key to keychain: {e}")))?;
    Ok(())
}

pub fn get_api_key_for_provider(provider: &str) -> Result<Option<String>, AppError> {
    let user_key = get_user_key(provider);
    let entry = Entry::new(SERVICE_NAME, user_key)
        .map_err(|e| AppError::Internal(format!("Keyring init error: {e}")))?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Internal(format!("Keyring get error: {e}"))),
    }
}

pub fn delete_api_key_for_provider(provider: &str) -> Result<(), AppError> {
    let user_key = get_user_key(provider);
    let entry = Entry::new(SERVICE_NAME, user_key)
        .map_err(|e| AppError::Internal(format!("Keyring init error: {e}")))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Internal(format!("Keyring delete error: {e}"))),
    }
}

pub fn has_api_key_for_provider(provider: &str) -> bool {
    get_api_key_for_provider(provider).unwrap_or(None).is_some()
}

// Backwards-compatible aliases for Gemini
pub fn set_gemini_api_key(key: &str) -> Result<(), AppError> {
    set_api_key_for_provider("gemini", key)
}

pub fn get_gemini_api_key() -> Result<Option<String>, AppError> {
    get_api_key_for_provider("gemini")
}

pub fn delete_gemini_api_key() -> Result<(), AppError> {
    delete_api_key_for_provider("gemini")
}

pub fn has_gemini_api_key() -> bool {
    has_api_key_for_provider("gemini")
}
