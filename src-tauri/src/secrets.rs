use crate::error::AppError;
use keyring::Entry;

const SERVICE_NAME: &str = "com.shelf.reader";
const USER_KEY: &str = "gemini_api_key";

pub fn set_gemini_api_key(key: &str) -> Result<(), AppError> {
    let entry = Entry::new(SERVICE_NAME, USER_KEY)
        .map_err(|e| AppError::Internal(format!("Keyring init error: {e}")))?;
    entry
        .set_password(key)
        .map_err(|e| AppError::Internal(format!("Failed to save API key to keychain: {e}")))?;
    Ok(())
}

pub fn get_gemini_api_key() -> Result<Option<String>, AppError> {
    let entry = Entry::new(SERVICE_NAME, USER_KEY)
        .map_err(|e| AppError::Internal(format!("Keyring init error: {e}")))?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Internal(format!("Keyring get error: {e}"))),
    }
}

pub fn delete_gemini_api_key() -> Result<(), AppError> {
    let entry = Entry::new(SERVICE_NAME, USER_KEY)
        .map_err(|e| AppError::Internal(format!("Keyring init error: {e}")))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Internal(format!("Keyring delete error: {e}"))),
    }
}

pub fn has_gemini_api_key() -> bool {
    get_gemini_api_key().unwrap_or(None).is_some()
}
