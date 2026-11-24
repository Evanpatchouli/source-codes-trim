use crate::filter::FileFilter;
use crate::scanner::{scan, ScanResult};
use crate::source_text::TrimOptions;
use crate::trim::{trim_files, TrimResult};
use std::{fs, path::PathBuf};

async fn run_blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("后台任务未能完成：{error}"))?
}

#[tauri::command]
pub async fn get_files(
    path: PathBuf,
    includes: String,
    excludes: String,
    exclude_empty_dirs: bool,
) -> Result<ScanResult, String> {
    run_blocking(move || {
        let filter = FileFilter::new(&includes, &excludes)?;
        scan(&path, &filter, exclude_empty_dirs)
    })
    .await
}

#[tauri::command]
pub async fn trim_source_codes(
    files: Vec<PathBuf>,
    trim_whitespace: bool,
    trim_newlines: bool,
    trim_comments: bool,
) -> Result<TrimResult, String> {
    let options = TrimOptions {
        comments: trim_comments,
        trailing_whitespace: trim_whitespace,
        blank_lines: trim_newlines,
    };
    run_blocking(move || trim_files(&files, &options)).await
}

#[tauri::command]
pub async fn open_directory_in_fs(path: PathBuf) -> Result<(), String> {
    run_blocking(move || {
        let path = std::path::absolute(&path).map_err(|e| format!("目录路径无效：{e}"))?;
        let metadata =
            fs::metadata(&path).map_err(|e| format!("无法读取目录「{}」：{e}", path.display()))?;
        if !metadata.is_dir() {
            return Err(format!("「{}」不是目录", path.display()));
        }
        open::that_detached(&path).map_err(|e| format!("无法打开目录「{}」：{e}", path.display()))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocking_tasks_run_off_caller_thread_and_return_errors() {
        let caller = std::thread::current().id();
        tauri::async_runtime::block_on(async {
            let worker = run_blocking(|| Ok(std::thread::current().id()))
                .await
                .unwrap();
            assert_ne!(worker, caller);
            assert_eq!(
                run_blocking::<()>(|| Err("读取失败".into()))
                    .await
                    .unwrap_err(),
                "读取失败"
            );
        });
    }
}
