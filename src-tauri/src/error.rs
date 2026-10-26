use thiserror::Error;

/// Application-level errors returned to the frontend via Tauri commands.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Duplicate word: '{word}' already exists in this chapter")]
    DuplicateWord { word: String },

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("API error: {0}")]
    ApiError(String),

    #[error("No API key configured")]
    NoApiKey,

    #[error("Network error: {0}")]
    Network(String),

    #[error("Rate limited. Please wait {retry_after_secs} seconds.")]
    RateLimited { retry_after_secs: u64 },

    #[error("{0}")]
    Internal(String),
}

// Serialize AppError for Tauri command returns
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 2)?;
        let kind = match self {
            AppError::Database(_) => "database",
            AppError::Io(_) => "io",
            AppError::NotFound(_) => "not_found",
            AppError::DuplicateWord { .. } => "duplicate_word",
            AppError::InvalidInput(_) => "invalid_input",
            AppError::ApiError(_) => "api_error",
            AppError::NoApiKey => "no_api_key",
            AppError::Network(_) => "network",
            AppError::RateLimited { .. } => "rate_limited",
            AppError::Internal(_) => "internal",
        };
        state.serialize_field("kind", kind)?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}
