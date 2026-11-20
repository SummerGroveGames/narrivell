//! Cloud connections (Google Drive now; Dropbox, OneDrive and WebDAV next).
//!
//! - Sign-in uses the provider's own page in the author's browser (OAuth with
//!   PKCE and a one-time loopback address on 127.0.0.1). Narrivell never sees
//!   the password.
//! - Google access is limited to the `drive.file` scope: Narrivell can only see
//!   files and folders it created itself, never the rest of the author's Drive.
//! - The long-lived sign-in token is kept in the OS keychain; nothing is
//!   written to a file and nothing is handed back to the web view.
//! - Every address is fixed here; the web view cannot choose where data goes.

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const KEYCHAIN_SERVICE: &str = "com.summergrovesoftware.narrivell.cloud";
const GOOGLE_AUTH: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN: &str = "https://oauth2.googleapis.com/token";
const DRIVE: &str = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3";
const SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
const FOLDER: &str = "application/vnd.google-apps.folder";
const MAX_FILE_BYTES: usize = 50 * 1024 * 1024;

// Registered once by the publisher in Google Cloud ("Desktop app" client).
// Supplied at build time from the git-ignored cloud-keys.json (see build.rs).
const GOOGLE_CLIENT_ID: Option<&str> = option_env!("NARRIVELL_GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET: Option<&str> = option_env!("NARRIVELL_GOOGLE_CLIENT_SECRET");

fn tokens() -> &'static Mutex<HashMap<&'static str, (String, Instant)>> {
    static CACHE: OnceLock<Mutex<HashMap<&'static str, (String, Instant)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn keychain() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, "google").map_err(|e| format!("Couldn’t reach the system keychain: {e}"))
}

fn client_id() -> Result<(&'static str, &'static str), String> {
    match (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) {
        (Some(id), Some(secret)) if !id.is_empty() => Ok((id, secret)),
        _ => Err("This copy of Narrivell isn’t registered with Google yet (see the setup steps).".into()),
    }
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("Narrivell/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).expect("system random number generator");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

#[derive(Serialize)]
pub struct CloudStatus {
    registered: bool,
    connected: bool,
}

#[tauri::command]
pub fn cloud_status() -> Result<CloudStatus, String> {
    let registered = client_id().is_ok();
    let connected = match keychain()?.get_password() {
        Ok(_) => true,
        Err(keyring::Error::NoEntry) => false,
        Err(e) => return Err(format!("Couldn’t check the system keychain: {e}")),
    };
    Ok(CloudStatus { registered, connected })
}

/// Opens Google's sign-in page and waits (up to five minutes) for the author to approve.
#[tauri::command]
pub async fn cloud_connect(app: tauri::AppHandle) -> Result<String, String> {
    let (id, secret) = client_id()?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let verifier = random_token(48);
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_token(24);
    let url = reqwest::Url::parse_with_params(
        GOOGLE_AUTH,
        &[
            ("client_id", id),
            ("redirect_uri", redirect.as_str()),
            ("response_type", "code"),
            ("scope", SCOPE),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", state.as_str()),
            ("access_type", "offline"),
            ("prompt", "consent"),
        ],
    )
    .map_err(|e| e.to_string())?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| format!("Couldn’t open your browser: {e}"))?;

    let code = tokio::time::timeout(Duration::from_secs(300), wait_for_code(listener, &state))
        .await
        .map_err(|_| "Sign-in timed out. Try again.".to_string())??;

    let resp: Value = http()?
        .post(GOOGLE_TOKEN)
        .form(&[
            ("code", code.as_str()),
            ("client_id", id),
            ("client_secret", secret),
            ("redirect_uri", redirect.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|_| "Couldn’t reach Google. Check your internet connection.".to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let refresh = resp
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .ok_or("Google didn’t complete the sign-in. Try again.")?;
    keychain()?
        .set_password(refresh)
        .map_err(|e| format!("Couldn’t save the sign-in in the system keychain: {e}"))?;
    if let Some(access) = resp.get("access_token").and_then(|v| v.as_str()) {
        let life = resp.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(3000);
        tokens().lock().unwrap().insert("google", (access.to_string(), Instant::now() + Duration::from_secs(life.saturating_sub(120))));
    }
    // Who is connected, so the author can see it.
    let about = drive_json(reqwest::Method::GET, &format!("{DRIVE}/about?fields=user(emailAddress)"), None).await?;
    Ok(about.pointer("/user/emailAddress").and_then(|v| v.as_str()).unwrap_or("your Google account").to_string())
}

async fn wait_for_code(listener: tokio::net::TcpListener, state: &str) -> Result<String, String> {
    loop {
        let (mut socket, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        let n = socket.read(&mut buf).await.map_err(|e| e.to_string())?;
        let request = String::from_utf8_lossy(&buf[..n]);
        let target = request.split_whitespace().nth(1).unwrap_or("/");
        let url = reqwest::Url::parse(&format!("http://127.0.0.1{target}")).map_err(|e| e.to_string())?;
        let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
        if params.get("state").map(String::as_str) != Some(state) {
            // Not our redirect (e.g. a favicon request); ignore it.
            let _ = socket.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
            continue;
        }
        let ok = params.contains_key("code");
        let page = if ok {
            "<!doctype html><meta charset=utf-8><title>Narrivell</title><body style=\"font:16px system-ui;padding:3rem;background:#f7f3ea;color:#1f3d2b\"><h1>Connected</h1><p>You can close this tab and go back to Narrivell.</p>"
        } else {
            "<!doctype html><meta charset=utf-8><title>Narrivell</title><body style=\"font:16px system-ui;padding:3rem\"><h1>Not connected</h1><p>You can close this tab and try again in Narrivell.</p>"
        };
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            page.len(),
            page
        );
        let _ = socket.write_all(response.as_bytes()).await;
        return params.get("code").cloned().ok_or_else(|| "Sign-in was cancelled.".to_string());
    }
}

#[tauri::command]
pub fn cloud_disconnect() -> Result<(), String> {
    tokens().lock().unwrap().remove("google");
    match keychain()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Couldn’t remove the sign-in: {e}")),
    }
}

async fn access_token() -> Result<String, String> {
    if let Some((t, until)) = tokens().lock().unwrap().get("google") {
        if Instant::now() < *until {
            return Ok(t.clone());
        }
    }
    let (id, secret) = client_id()?;
    let refresh = match keychain()?.get_password() {
        Ok(r) => r,
        Err(keyring::Error::NoEntry) => return Err("Connect Google Drive first.".into()),
        Err(e) => return Err(format!("Couldn’t read the sign-in from the system keychain: {e}")),
    };
    let resp = http()?
        .post(GOOGLE_TOKEN)
        .form(&[("client_id", id), ("client_secret", secret), ("refresh_token", refresh.as_str()), ("grant_type", "refresh_token")])
        .send()
        .await
        .map_err(|_| "Couldn’t reach Google. Check your internet connection.".to_string())?;
    if resp.status().as_u16() == 400 || resp.status().as_u16() == 401 {
        return Err("Google needs you to connect again (the sign-in expired or was removed).".into());
    }
    let value: Value = resp.json().await.map_err(|e| e.to_string())?;
    let access = value.get("access_token").and_then(|v| v.as_str()).ok_or("Google didn’t renew the sign-in.")?.to_string();
    let life = value.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(3000);
    tokens().lock().unwrap().insert("google", (access.clone(), Instant::now() + Duration::from_secs(life.saturating_sub(120))));
    Ok(access)
}

async fn drive_send(req: reqwest::RequestBuilder) -> Result<Vec<u8>, String> {
    let mut resp = req
        .bearer_auth(access_token().await?)
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "Google Drive took too long to answer.".to_string() } else { "Couldn’t reach Google Drive. Check your internet connection.".to_string() })?;
    let status = resp.status();
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > MAX_FILE_BYTES {
            return Err("A file on Google Drive is far larger than expected.".into());
        }
        body.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 => {
                tokens().lock().unwrap().remove("google");
                "Google Drive needs you to connect again.".into()
            }
            403 => "Google Drive refused (storage full, or too many requests). Try again later.".into(),
            404 => "That file is no longer on Google Drive.".into(),
            code => format!("Google Drive answered with an error ({code})."),
        });
    }
    Ok(body)
}

async fn drive_json(method: reqwest::Method, url: &str, body: Option<Value>) -> Result<Value, String> {
    let mut req = http()?.request(method, url);
    if let Some(b) = body {
        req = req.json(&b);
    }
    let bytes = drive_send(req).await?;
    serde_json::from_slice(&bytes).map_err(|_| "Google Drive sent an unreadable answer.".to_string())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 200 && !name.contains(['/', '\\', '\'']) && !name.chars().any(|c| c.is_control())
}

#[derive(Serialize)]
pub struct DriveItem {
    id: String,
    name: String,
    folder: bool,
    version: String,
}

/// Lists one folder (or, with no parent, Narrivell's top folder in Drive, created if needed).
#[tauri::command]
pub async fn drive_list(parent: Option<String>) -> Result<(String, Vec<DriveItem>), String> {
    let parent = match parent {
        Some(p) if valid_id(&p) => p,
        Some(_) => return Err("Invalid folder.".into()),
        None => top_folder().await?,
    };
    let mut items = Vec::new();
    let mut page: Option<String> = None;
    loop {
        let mut url = reqwest::Url::parse(&format!("{DRIVE}/files")).unwrap();
        url.query_pairs_mut()
            .append_pair("q", &format!("'{parent}' in parents and trashed = false"))
            .append_pair("fields", "nextPageToken, files(id, name, mimeType, version)")
            .append_pair("pageSize", "1000")
            .append_pair("spaces", "drive");
        if let Some(p) = &page {
            url.query_pairs_mut().append_pair("pageToken", p);
        }
        let value = drive_json(reqwest::Method::GET, url.as_str(), None).await?;
        for f in value.get("files").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
            items.push(DriveItem {
                id: f.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                name: f.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                folder: f.get("mimeType").and_then(|v| v.as_str()) == Some(FOLDER),
                version: f.get("version").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            });
        }
        page = value.get("nextPageToken").and_then(|v| v.as_str()).map(String::from);
        if page.is_none() || items.len() > 20_000 {
            break;
        }
    }
    Ok((parent, items))
}

async fn top_folder() -> Result<String, String> {
    let mut url = reqwest::Url::parse(&format!("{DRIVE}/files")).unwrap();
    url.query_pairs_mut()
        .append_pair("q", &format!("name = 'Narrivell' and mimeType = '{FOLDER}' and 'root' in parents and trashed = false"))
        .append_pair("fields", "files(id)")
        .append_pair("spaces", "drive");
    let value = drive_json(reqwest::Method::GET, url.as_str(), None).await?;
    if let Some(id) = value.pointer("/files/0/id").and_then(|v| v.as_str()) {
        return Ok(id.to_string());
    }
    drive_mkdir_inner("root", "Narrivell").await
}

async fn drive_mkdir_inner(parent: &str, name: &str) -> Result<String, String> {
    let value = drive_json(reqwest::Method::POST, &format!("{DRIVE}/files?fields=id"), Some(json!({ "name": name, "mimeType": FOLDER, "parents": [parent] }))).await?;
    value.get("id").and_then(|v| v.as_str()).map(String::from).ok_or("Google Drive didn’t create the folder.".into())
}

#[tauri::command]
pub async fn drive_mkdir(parent: String, name: String) -> Result<String, String> {
    if !valid_id(&parent) || !valid_name(&name) {
        return Err("Invalid folder name.".into());
    }
    drive_mkdir_inner(&parent, &name).await
}

#[tauri::command]
pub async fn drive_read(id: String) -> Result<String, String> {
    if !valid_id(&id) {
        return Err("Invalid file.".into());
    }
    let bytes = drive_send(http()?.get(format!("{DRIVE}/files/{id}?alt=media"))).await?;
    String::from_utf8(bytes).map_err(|_| "A file on Google Drive isn’t text Narrivell can read.".into())
}

/// Creates a file (no id) or replaces its contents (id). Returns (id, version).
#[tauri::command]
pub async fn drive_write(parent: String, name: String, id: Option<String>, text: String) -> Result<(String, String), String> {
    if !valid_id(&parent) || !valid_name(&name) || text.len() > MAX_FILE_BYTES {
        return Err("Invalid file.".into());
    }
    let value: Value = match id {
        Some(id) if valid_id(&id) => {
            let bytes = drive_send(
                http()?
                    .patch(format!("{DRIVE_UPLOAD}/files/{id}?uploadType=media&fields=id,version"))
                    .header("Content-Type", "text/plain; charset=utf-8")
                    .body(text),
            )
            .await?;
            serde_json::from_slice(&bytes).map_err(|e| e.to_string())?
        }
        Some(_) => return Err("Invalid file.".into()),
        None => {
            let boundary = format!("narrivell{}", random_token(12).replace(['-', '_'], "x"));
            let meta = json!({ "name": name, "parents": [parent] }).to_string();
            let body = format!(
                "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n--{boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{text}\r\n--{boundary}--"
            );
            let bytes = drive_send(
                http()?
                    .post(format!("{DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,version"))
                    .header("Content-Type", format!("multipart/related; boundary={boundary}"))
                    .body(body),
            )
            .await?;
            serde_json::from_slice(&bytes).map_err(|e| e.to_string())?
        }
    };
    Ok((
        value.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        value.get("version").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
    ))
}
