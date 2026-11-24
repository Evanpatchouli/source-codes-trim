mod file_issue;
mod filter;
mod handlers;
mod plan_file;
mod result_store;
mod scanner;
mod source_text;
mod trim;

pub fn register_commands<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .manage(result_store::ResultStore::default())
        .invoke_handler(tauri::generate_handler![
            handlers::get_files,
            handlers::read_source_plan,
            handlers::write_source_plan,
            handlers::trim_source_codes,
            handlers::read_trim_file,
            handlers::export_trim_result,
            handlers::release_trim_result,
            handlers::open_directory_in_fs
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    register_commands(tauri::Builder::default())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
