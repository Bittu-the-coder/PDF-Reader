pub mod prompts;

use std::time::Duration;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AppError;
use crate::secrets;

pub const DEFAULT_GEMINI_MODEL: &str = "gemini-3.5-flash-lite";
pub const DEFAULT_OPENROUTER_MODEL: &str = "google/gemini-2.0-flash-exp:free";
const API_TIMEOUT_SECS: u64 = 45;
const MAX_RETRIES: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordLookupResult {
    pub word: String,
    #[serde(default)]
    pub part_of_speech: Option<String>,
    pub meaning: String,
    #[serde(default)]
    pub meaning_hindi: Option<String>,
    #[serde(default)]
    pub meaning_in_context: Option<String>,
    #[serde(default)]
    pub example: Option<String>,
    #[serde(default)]
    pub synonyms: Option<Vec<String>>,
    #[serde(default)]
    pub pronunciation: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AiClient {
    client: Client,
}

impl Default for AiClient {
    fn default() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(API_TIMEOUT_SECS))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();
        Self { client }
    }
}

// Backwards-compatible type alias
pub type GeminiClient = AiClient;

impl AiClient {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn lookup_word(
        &self,
        word: &str,
        sentence: Option<&str>,
        provider: &str,
        custom_model: Option<&str>,
        target_lang: Option<&str>,
    ) -> Result<WordLookupResult, AppError> {
        let prompt_text = prompts::build_word_lookup_prompt(word, sentence);
        let system_instruction = prompts::build_word_lookup_system_prompt(target_lang);

        let text_content = if provider == "openrouter" {
            let api_key = match secrets::get_api_key_for_provider("openrouter")? {
                Some(k) if !k.trim().is_empty() => k,
                _ => return Err(AppError::NoApiKey),
            };
            let model = custom_model.unwrap_or(DEFAULT_OPENROUTER_MODEL);
            self.call_openrouter(&api_key, model, &system_instruction, &prompt_text, true, 0.2).await?
        } else {
            let api_key = match secrets::get_api_key_for_provider("gemini")? {
                Some(k) if !k.trim().is_empty() => k,
                _ => return Err(AppError::NoApiKey),
            };
            let model = custom_model.unwrap_or(DEFAULT_GEMINI_MODEL);
            self.call_gemini(&api_key, model, &system_instruction, &prompt_text).await?
        };

        let clean_json = clean_markdown_fences(&text_content);
        match serde_json::from_str::<WordLookupResult>(&clean_json) {
            Ok(result) => Ok(result),
            Err(_) => Ok(WordLookupResult {
                word: word.to_string(),
                part_of_speech: None,
                meaning: clean_json.trim().to_string(),
                meaning_hindi: None,
                meaning_in_context: None,
                example: None,
                synonyms: None,
                pronunciation: None,
            }),
        }
    }

    pub async fn explain_passage(
        &self,
        passage: &str,
        mode: &str,
        provider: &str,
        custom_model: Option<&str>,
        target_lang: Option<&str>,
        context: Option<&str>,
    ) -> Result<String, AppError> {
        let system_instruction = prompts::build_passage_system_prompt(mode, target_lang);
        let prompt_text = prompts::build_passage_user_prompt(passage, context);

        if provider == "openrouter" {
            let api_key = match secrets::get_api_key_for_provider("openrouter")? {
                Some(k) if !k.trim().is_empty() => k,
                _ => return Err(AppError::NoApiKey),
            };
            let model = custom_model.unwrap_or(DEFAULT_OPENROUTER_MODEL);
            self.call_openrouter(&api_key, model, &system_instruction, &prompt_text, false, 0.3).await
        } else {
            let api_key = match secrets::get_api_key_for_provider("gemini")? {
                Some(k) if !k.trim().is_empty() => k,
                _ => return Err(AppError::NoApiKey),
            };
            let model = custom_model.unwrap_or(DEFAULT_GEMINI_MODEL);
            self.call_gemini(&api_key, model, &system_instruction, &prompt_text).await
        }
    }

    pub async fn chat_word_inquiry(
        &self,
        word: &str,
        context: Option<&str>,
        query: &str,
        history: Vec<Value>,
        provider: &str,
        custom_model: Option<&str>,
        target_lang: Option<&str>,
    ) -> Result<String, AppError> {
        let system_instruction = prompts::build_word_chat_system_prompt(word, context, target_lang);

        if provider == "openrouter" {
            let api_key = match secrets::get_api_key_for_provider("openrouter")? {
                Some(k) if !k.trim().is_empty() => k,
                _ => return Err(AppError::NoApiKey),
            };
            let model = custom_model.unwrap_or(DEFAULT_OPENROUTER_MODEL);

            let mut messages = vec![
                serde_json::json!({
                    "role": "system",
                    "content": system_instruction
                })
            ];

            let mut last_content = String::new();
            for h in history {
                let role = if h["role"] == "model" || h["role"] == "assistant" { "assistant" } else { "user" };
                let text = if let Some(t) = h["parts"][0]["text"].as_str() {
                    t
                } else if let Some(t) = h["text"].as_str() {
                    t
                } else {
                    ""
                };
                if !text.is_empty() {
                    last_content = text.to_string();
                    messages.push(serde_json::json!({
                        "role": role,
                        "content": text
                    }));
                }
            }

            if last_content.trim() != query.trim() {
                messages.push(serde_json::json!({
                    "role": "user",
                    "content": query
                }));
            }

            let request_body = serde_json::json!({
                "model": model,
                "messages": messages,
                "temperature": 0.4
            });

            let res_body = self.post_openrouter_with_retry(&api_key, &request_body).await?;
            let text = res_body["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("No response generated.")
                .trim()
                .to_string();

            Ok(text)
        } else {
            let api_key = match secrets::get_api_key_for_provider("gemini")? {
                Some(k) if !k.trim().is_empty() => k,
                _ => return Err(AppError::NoApiKey),
            };
            let model = custom_model.unwrap_or(DEFAULT_GEMINI_MODEL);

            let mut contents: Vec<Value> = Vec::new();
            let mut last_content = String::new();

            for h in history {
                let role = if h["role"] == "model" || h["role"] == "assistant" { "model" } else { "user" };
                let text = if let Some(t) = h["parts"][0]["text"].as_str() {
                    t
                } else if let Some(t) = h["text"].as_str() {
                    t
                } else {
                    ""
                };
                if !text.is_empty() {
                    last_content = text.to_string();
                    contents.push(serde_json::json!({
                        "role": role,
                        "parts": [{ "text": text }]
                    }));
                }
            }

            if last_content.trim() != query.trim() {
                contents.push(serde_json::json!({
                    "role": "user",
                    "parts": [{ "text": query }]
                }));
            }

            let request_body = serde_json::json!({
                "system_instruction": {
                    "parts": [{ "text": system_instruction }]
                },
                "contents": contents,
                "generationConfig": {
                    "temperature": 0.4
                }
            });

            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
                model
            );

            let res_body = self.post_gemini_with_retry(&url, &api_key, &request_body).await?;
            let text = res_body["candidates"][0]["content"]["parts"][0]["text"]
                .as_str()
                .unwrap_or("No response generated.")
                .trim()
                .to_string();

            Ok(text)
        }
    }

    async fn post_gemini_with_retry(
        &self,
        url: &str,
        api_key: &str,
        request_body: &Value,
    ) -> Result<Value, AppError> {
        let mut attempts = 0;
        let mut last_err = String::new();

        while attempts <= MAX_RETRIES {
            if attempts > 0 {
                tokio::time::sleep(Duration::from_millis(1200 * (attempts as u64))).await;
            }
            attempts += 1;

            let res = self
                .client
                .post(url)
                .header("x-goog-api-key", api_key)
                .header("content-type", "application/json")
                .json(request_body)
                .send()
                .await;

            let response = match res {
                Ok(r) => r,
                Err(e) => {
                    if e.is_timeout() {
                        last_err = "Gemini request timed out. Please check your network connection or try again.".to_string();
                    } else {
                        last_err = format!("Network error contacting Gemini: {e}");
                    }
                    continue;
                }
            };

            let status = response.status();
            if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                return Err(AppError::ApiError(
                    "Invalid Gemini API key. Please check your key in Settings.".to_string(),
                ));
            }

            if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                let err_text = response.text().await.unwrap_or_default();
                last_err = format!("Rate limit reached (429: Too Many Requests). The model quota was temporarily reached. Please switch to 'gemini-3.5-flash-lite' (500 RPD) or OpenRouter in Settings: {err_text}");
                continue;
            }

            if status.is_server_error() {
                let err_text = response.text().await.unwrap_or_default();
                last_err = format!("Gemini server error ({status}): {err_text}");
                continue;
            }

            if !status.is_success() {
                let err_text = response.text().await.unwrap_or_default();
                return Err(AppError::ApiError(format!("Gemini API returned status {status}: {err_text}")));
            }

            let resp_json: Value = response
                .json()
                .await
                .map_err(|e| AppError::Internal(format!("Failed to parse Gemini response: {e}")))?;

            return Ok(resp_json);
        }

        Err(AppError::ApiError(last_err))
    }

    async fn post_openrouter_with_retry(
        &self,
        api_key: &str,
        request_body: &Value,
    ) -> Result<Value, AppError> {
        let mut attempts = 0;
        let mut last_err = String::new();

        while attempts <= MAX_RETRIES {
            if attempts > 0 {
                tokio::time::sleep(Duration::from_millis(1000 * (attempts as u64))).await;
            }
            attempts += 1;

            let res = self
                .client
                .post("https://openrouter.ai/api/v1/chat/completions")
                .header("Authorization", format!("Bearer {api_key}"))
                .header("Content-Type", "application/json")
                .header("HTTP-Referer", "https://shelf.local")
                .header("X-Title", "Shelf PDF Reader")
                .json(request_body)
                .send()
                .await;

            let response = match res {
                Ok(r) => r,
                Err(e) => {
                    if e.is_timeout() {
                        last_err = "OpenRouter request timed out.".to_string();
                    } else {
                        last_err = format!("OpenRouter network error: {e}");
                    }
                    continue;
                }
            };

            let status = response.status();
            if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                return Err(AppError::ApiError("Invalid OpenRouter API key. Please check your key in Settings.".to_string()));
            }

            if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
                let err_text = response.text().await.unwrap_or_default();
                last_err = format!("OpenRouter error ({status}): {err_text}");
                continue;
            }

            if !status.is_success() {
                let err_text = response.text().await.unwrap_or_default();
                return Err(AppError::ApiError(format!("OpenRouter API returned status {status}: {err_text}")));
            }

            let resp_json: Value = response
                .json()
                .await
                .map_err(|e| AppError::Internal(format!("Failed to parse OpenRouter response: {e}")))?;

            return Ok(resp_json);
        }

        Err(AppError::ApiError(last_err))
    }

    async fn call_gemini(
        &self,
        api_key: &str,
        model: &str,
        system_instruction: &str,
        prompt_text: &str,
    ) -> Result<String, AppError> {
        let request_body = serde_json::json!({
            "system_instruction": {
                "parts": [{ "text": system_instruction }]
            },
            "contents": [
                {
                    "parts": [{ "text": prompt_text }]
                }
            ],
            "generationConfig": {
                "temperature": 0.2
            }
        });

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
            model
        );

        let resp_json = self.post_gemini_with_retry(&url, api_key, &request_body).await?;

        let text_content = resp_json
            .pointer("/candidates/0/content/parts/0/text")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Internal("Gemini response missing text candidate".to_string()))?;

        Ok(text_content.to_string())
    }

    async fn call_openrouter(
        &self,
        api_key: &str,
        model: &str,
        system_instruction: &str,
        prompt_text: &str,
        json_mode: bool,
        temperature: f32,
    ) -> Result<String, AppError> {
        let mut request_body = serde_json::json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system_instruction },
                { "role": "user", "content": prompt_text }
            ],
            "temperature": temperature
        });

        if json_mode {
            request_body["response_format"] = serde_json::json!({ "type": "json_object" });
        }

        let resp_json = self.post_openrouter_with_retry(api_key, &request_body).await?;

        let text_content = resp_json["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| AppError::Internal("OpenRouter response missing content".to_string()))?;

        Ok(text_content.to_string())
    }

    pub async fn test_key(provider: &str, key: &str) -> Result<bool, AppError> {
        if key.trim().is_empty() {
            return Err(AppError::InvalidInput("API key cannot be empty.".to_string()));
        }

        let client = Client::builder()
            .timeout(Duration::from_secs(12))
            .build()
            .unwrap_or_default();

        if provider == "openrouter" {
            let request_body = serde_json::json!({
                "model": DEFAULT_OPENROUTER_MODEL,
                "messages": [
                    { "role": "user", "content": "ping" }
                ],
                "max_tokens": 5
            });

            let response = client
                .post("https://openrouter.ai/api/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", key.trim()))
                .header("Content-Type", "application/json")
                .header("HTTP-Referer", "https://shelf.local")
                .header("X-Title", "Shelf PDF Reader")
                .json(&request_body)
                .send()
                .await
                .map_err(|e| AppError::Network(format!("OpenRouter connection test failed: {e}")))?;

            let status = response.status();
            if status.is_success() {
                Ok(true)
            } else if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                Err(AppError::ApiError("Invalid OpenRouter API key. Please check your key at openrouter.ai.".to_string()))
            } else {
                let body = response.text().await.unwrap_or_default();
                Err(AppError::ApiError(format!("Test failed with status {status}: {body}")))
            }
        } else {
            let request_body = serde_json::json!({
                "contents": [
                    { "parts": [{ "text": "ping" }] }
                ]
            });

            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
                DEFAULT_GEMINI_MODEL
            );

            let response = client
                .post(&url)
                .header("x-goog-api-key", key.trim())
                .header("content-type", "application/json")
                .json(&request_body)
                .send()
                .await
                .map_err(|e| AppError::Network(format!("Gemini connection test failed: {e}")))?;

            let status = response.status();
            if status.is_success() {
                Ok(true)
            } else if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                Err(AppError::ApiError(
                    "Invalid Gemini API key. Please double-check your key from Google AI Studio.".to_string(),
                ))
            } else {
                let body = response.text().await.unwrap_or_default();
                Err(AppError::ApiError(format!("Test failed with status {status}: {body}")))
            }
        }
    }
}

fn clean_markdown_fences(input: &str) -> String {
    let trimmed = input.trim();
    if let Some(stripped) = trimmed.strip_prefix("```json")
        && let Some(inner) = stripped.strip_suffix("```")
    {
        return inner.trim().to_string();
    }
    if let Some(stripped) = trimmed.strip_prefix("```")
        && let Some(inner) = stripped.strip_suffix("```")
    {
        return inner.trim().to_string();
    }
    trimmed.to_string()
}
