//! API key storage.
//!
//! Keys live in the OS credential store (Windows Credential Manager, macOS
//! Keychain, Secret Service on Linux). Some systems have no usable store, e.g. a
//! Linux desktop without GNOME Keyring/KWallet, so if the keyring fails we fall
//! back to a user-only file in the app data directory instead of losing the key.

use crate::error::AppError;
use keyring::Entry;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;

const SERVICE_NAME: &str = "com.shelf.reader";
const GEMINI_USER_KEY: &str = "gemini_api_key";
const OPENROUTER_USER_KEY: &str = "openrouter_api_key";
const FALLBACK_FILE: &str = "credentials.json";

static FALLBACK_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Set the directory used for the fallback credentials file. Called once at startup.
pub fn init_fallback_dir(dir: PathBuf) {
    let _ = FALLBACK_DIR.set(dir);
}

fn get_user_key(provider: &str) -> &'static str {
    match provider {
        "openrouter" => OPENROUTER_USER_KEY,
        _ => GEMINI_USER_KEY,
    }
}

fn entry(user_key: &str) -> Result<Entry, keyring::Error> {
    Entry::new(SERVICE_NAME, user_key)
}

// ---------------------------------------------------------------------------
// Fallback file store
// ---------------------------------------------------------------------------

fn fallback_path() -> Option<PathBuf> {
    FALLBACK_DIR.get().map(|d| d.join(FALLBACK_FILE))
}

fn read_fallback() -> HashMap<String, String> {
    fallback_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_fallback(map: &HashMap<String, String>) -> Result<(), AppError> {
    let path = fallback_path()
        .ok_or_else(|| AppError::Internal("No credential storage available".into()))?;
    if map.is_empty() {
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string(map)
        .map_err(|e| AppError::Internal(format!("Could not encode credentials: {e}")))?;
    std::fs::write(&path, json)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn remove_fallback(user_key: &str) {
    let mut map = read_fallback();
    if map.remove(user_key).is_some() {
        let _ = write_fallback(&map);
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

pub fn set_api_key_for_provider(provider: &str, key: &str) -> Result<(), AppError> {
    let user_key = get_user_key(provider);
    let keyring_result = entry(user_key).and_then(|e| e.set_password(key));
    match keyring_result {
        Ok(()) => {
            remove_fallback(user_key);
            Ok(())
        }
        Err(e) => {
            tracing::warn!("OS keyring unavailable ({e}); storing API key in app data file");
            let mut map = read_fallback();
            map.insert(user_key.to_string(), key.to_string());
            write_fallback(&map)
        }
    }
}

pub fn get_api_key_for_provider(provider: &str) -> Result<Option<String>, AppError> {
    let user_key = get_user_key(provider);
    match entry(user_key).and_then(|e| e.get_password()) {
        Ok(key) => return Ok(Some(key)),
        Err(keyring::Error::NoEntry) => {}
        Err(e) => tracing::debug!("Keyring read failed ({e}); checking fallback store"),
    }
    Ok(read_fallback().get(user_key).cloned())
}

pub fn delete_api_key_for_provider(provider: &str) -> Result<(), AppError> {
    let user_key = get_user_key(provider);
    if let Ok(e) = entry(user_key) {
        match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(err) => tracing::warn!("Keyring delete failed: {err}"),
        }
    }
    remove_fallback(user_key);
    Ok(())
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
