use crate::filter::FileFilter;
use crate::scanner::{scan, ScanResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrimSourceCodesResult {
    result: String,
    skipped: Vec<String>,
}

#[tauri::command]
pub fn trim_source_codes(
    files: Vec<&Path>,
    trim_whitespace: bool,
    trim_newlines: bool,
    trim_comments: bool,
) -> Result<TrimSourceCodesResult, String> {
    let options = crate::source_text::TrimOptions {
        comments: trim_comments,
        trailing_whitespace: trim_whitespace,
        blank_lines: trim_newlines,
    };
    let mut result = String::new();
    let mut skipped = Vec::new();
    for file in files {
        let content = match fs::read_to_string(&file) {
            Ok(content) => content,
            Err(_e) => {
                skipped.push(file.display().to_string());
                // eprintln!("读取文件失败: {}", e);
                continue;
            }
        };

        let mut needs_separator = !result.is_empty() && !result.ends_with('\n');
        crate::source_text::write_source(file, &content, &options, |part| {
            if !part.is_empty() {
                if needs_separator {
                    result.push('\n');
                    needs_separator = false;
                }
                result.push_str(part);
            }
            Ok(())
        })
        .map_err(|e| e.to_string())?;
    }
    Ok(TrimSourceCodesResult { result, skipped })
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
