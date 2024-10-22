mod handlers;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            handlers::get_files,
            handlers::trim_source_codes,
            handlers::open_directory_in_fs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
