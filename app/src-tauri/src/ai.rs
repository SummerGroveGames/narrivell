//! AI connections. Everything that touches an API key or the network for AI
//! happens here, in Rust:
//! - keys live in the operating system's credential store (Windows
//!   Credential Manager / the Linux Secret Service keyring), never in a file
//!   and never handed back to the app's web view;
//! - each provider has one fixed address; the web view can't choose where
//!   text is sent (its Content-Security-Policy still allows no network);
//! - requests and answers are size- and time-limited.

use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

const KEYCHAIN_SERVICE: &str = "com.summergrovesoftware.narrivell.ai";
const MAX_PROMPT_CHARS: usize = 600_000;
const MAX_ANSWER_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Copy, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    Openai,
    Gemini,
    Xai,
    Venice,
    Ollama,
}

impl Provider {
    fn name(self) -> &'static str {
        match self {
            Provider::Anthropic => "Claude",
            Provider::Openai => "ChatGPT",
            Provider::Gemini => "Gemini",
            Provider::Xai => "Grok",
            Provider::Venice => "Venice",
            Provider::Ollama => "Ollama",
        }
    }

    fn base(self) -> &'static str {
        match self {
            Provider::Anthropic => "https://api.anthropic.com/v1",
            Provider::Openai => "https://api.openai.com/v1",
            Provider::Gemini => "https://generativelanguage.googleapis.com/v1beta/openai",
            Provider::Xai => "https://api.x.ai/v1",
            Provider::Venice => "https://api.venice.ai/api/v1",
            // Only ever this computer.
            Provider::Ollama => "http://127.0.0.1:11434/v1",
        }
    }

    fn account(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::Openai => "openai",
            Provider::Gemini => "gemini",
            Provider::Xai => "xai",
            Provider::Venice => "venice",
            Provider::Ollama => "ollama",
        }
    }

    fn needs_key(self) -> bool {
        self != Provider::Ollama
    }
}

fn entry(p: Provider) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, p.account()).map_err(|e| format!("Couldn’t reach the system keychain: {e}"))
}

fn key_for(p: Provider) -> Result<Option<String>, String> {
    if !p.needs_key() {
        return Ok(None);
    }
    match entry(p)?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Err(format!("Add your {} key in Settings › AI connections first.", p.name())),
        Err(e) => Err(format!("Couldn’t read the {} key from the system keychain: {e}", p.name())),
    }
}

/// Saves a key in the system keychain. The key is never returned to the app.
#[tauri::command]
pub fn ai_save_key(provider: Provider, key: String) -> Result<(), String> {
    let key = key.trim();
    if key.len() < 8 || key.len() > 500 || key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("That doesn’t look like an API key. Copy it again from the provider’s website.".into());
    }
    entry(provider)?
        .set_password(key)
        .map_err(|e| format!("Couldn’t save the key in the system keychain: {e}"))
}

#[tauri::command]
pub fn ai_has_key(provider: Provider) -> Result<bool, String> {
    if !provider.needs_key() {
        return Ok(true);
    }
    match entry(provider)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("Couldn’t check the system keychain: {e}")),
    }
}

#[tauri::command]
pub fn ai_forget_key(provider: Provider) -> Result<(), String> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Couldn’t remove the key: {e}")),
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(240))
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("Narrivell/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

fn request(p: Provider, method: reqwest::Method, path: &str, key: &Option<String>) -> Result<reqwest::RequestBuilder, String> {
    let url = format!("{}{}", p.base(), path);
    let mut req = client()?.request(method, url);
    if let Some(k) = key {
        req = if p == Provider::Anthropic {
            req.header("x-api-key", k).header("anthropic-version", "2023-06-01")
        } else {
            req.bearer_auth(k)
        };
    }
    Ok(req)
}

async fn send(p: Provider, req: reqwest::RequestBuilder) -> Result<Value, String> {
    let mut resp = req.send().await.map_err(|e| {
        if p == Provider::Ollama && e.is_connect() {
            "Ollama isn’t running on this computer. Start Ollama and try again.".to_string()
        } else if e.is_timeout() {
            format!("{} took too long to answer. Try again, or try a faster model.", p.name())
        } else {
            format!("Couldn’t reach {}. Check your internet connection.", p.name())
        }
    })?;
    let status = resp.status();
    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > MAX_ANSWER_BYTES {
            return Err(format!("{} sent back far more than expected.", p.name()));
        }
        body.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    if !status.is_success() {
        let detail = value
            .pointer("/error/message")
            .or_else(|| value.pointer("/error"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .chars()
            .take(200)
            .collect::<String>();
        let what = match status.as_u16() {
            401 | 403 => format!("{} refused the key. Check it in Settings › AI connections.", p.name()),
            404 => format!("{} doesn’t offer that model. Pick another in Settings › AI connections.", p.name()),
            429 => format!("{} says you’ve hit a limit (too many requests, or no credit left).", p.name()),
            500..=599 => format!("{} is having trouble right now. Try again in a minute.", p.name()),
            code => format!("{} answered with an error ({code}).", p.name()),
        };
        return Err(if detail.is_empty() { what } else { format!("{what} ({detail})") });
    }
    Ok(value)
}

/// Lists the models this key can use, so the author can pick one.
#[tauri::command]
pub async fn ai_models(provider: Provider) -> Result<Vec<String>, String> {
    let key = key_for(provider)?;
    let path = if provider == Provider::Anthropic { "/models?limit=100" } else { "/models" };
    let value = send(provider, request(provider, reqwest::Method::GET, path, &key)?).await?;
    let mut ids: Vec<String> = value
        .get("data")
        .and_then(|d| d.as_array())
        .map(|list| list.iter().filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(String::from)).collect())
        .unwrap_or_default();
    ids.truncate(500);
    Ok(ids)
}

fn valid_model(model: &str) -> bool {
    !model.is_empty() && model.len() <= 150 && model.chars().all(|c| c.is_ascii_alphanumeric() || "._:/-@".contains(c))
}

/// Sends one request (instructions + text) and returns the model's answer text.
#[tauri::command]
pub async fn ai_chat(provider: Provider, model: String, system: String, prompt: String, max_tokens: u32) -> Result<String, String> {
    if !valid_model(&model) {
        return Err("Choose a model in Settings › AI connections.".into());
    }
    if prompt.len() + system.len() > MAX_PROMPT_CHARS {
        return Err("This is too much text to send at once.".into());
    }
    let max_tokens = max_tokens.clamp(256, 32_000);
    let key = key_for(provider)?;

    if provider == Provider::Anthropic {
        let body = json!({
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{ "role": "user", "content": prompt }],
        });
        let value = send(provider, request(provider, reqwest::Method::POST, "/messages", &key)?.json(&body)).await?;
        let text: String = value
            .get("content")
            .and_then(|c| c.as_array())
            .map(|parts| parts.iter().filter_map(|p| p.get("text").and_then(|t| t.as_str())).collect::<Vec<_>>().join(""))
            .unwrap_or_default();
        return if text.is_empty() { Err("Claude sent back an empty answer.".into()) } else { Ok(text) };
    }

    // Everyone else speaks the OpenAI chat-completions format.
    let body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": prompt },
        ],
    });
    let value = send(provider, request(provider, reqwest::Method::POST, "/chat/completions", &key)?.json(&body)).await?;
    let text = value
        .pointer("/choices/0/message/content")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    if text.is_empty() {
        Err(format!("{} sent back an empty answer.", provider.name()))
    } else {
        Ok(text)
    }
}
