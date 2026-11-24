use crate::filter::FileFilter;
use crate::scanner::{scan, ScanResult};
use crate::source_text::TrimOptions;
use crate::trim::{trim_files, TrimResult};
use std::path::{Path, PathBuf};

#[tauri::command]
pub fn get_files(
    path: &str,
    includes: &str,
    excludes: &str,
    exclude_empty_dirs: bool,
) -> Result<ScanResult, String> {
    let filter = FileFilter::new(includes, excludes)?;
    scan(Path::new(path), &filter, exclude_empty_dirs)
}

#[tauri::command]
pub fn trim_source_codes(
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
    trim_files(&files, &options)
}

#[tauri::command]
pub fn open_directory_in_fs(path: &Path) -> bool {
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .expect("Failed to open directory in file system")
        .wait()
        .expect("Failed to wait for opening directory in file system")
        .success()
}
