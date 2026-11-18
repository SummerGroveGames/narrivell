use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

/// Shows the system folder picker. Only the folder the author picks (and
/// what is inside it) becomes readable and writable by the app; nothing else
/// on the computer is. The persisted-scope plugin remembers these choices so
/// recent projects reopen after a restart.
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle, title: String) -> Result<Option<String>, String> {
    let title: String = title.chars().take(120).collect();
    let Some(picked) = app.dialog().file().set_title(&title).blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Largest file the importer will read.
const MAX_IMPORT_BYTES: u64 = 60 * 1024 * 1024;

/// Shows the system file picker for a Word document and returns its bytes.
/// Only that one file is read, here in Rust; the app gets no access to the
/// folder it came from. An empty result means the author cancelled.
#[tauri::command]
async fn pick_import_file(app: tauri::AppHandle) -> Result<tauri::ipc::Response, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Import a Word document")
        .add_filter("Word document", &["docx"])
        .blocking_pick_file();
    let Some(picked) = picked else {
        return Ok(tauri::ipc::Response::new(Vec::new()));
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_IMPORT_BYTES {
        return Err("That file is too large to import.".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        // Must come after the fs plugin: it restores the folders granted in earlier sessions.
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![pick_folder, pick_import_file])
        .run(tauri::generate_context!())
        .expect("error while running Narrivell");
}
