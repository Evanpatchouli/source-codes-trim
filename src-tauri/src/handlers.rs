use crate::filter::{FileFilter, Inclusion};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileItem {
    path: String,
    name: String,
    is_dir: bool,
    children: Vec<FileItem>,
}

#[tauri::command]
pub fn get_files(
    path: &str,
    includes: &str,
    excludes: &str,
    exclude_empty_dirs: bool,
) -> Result<Vec<FileItem>, String> {
    let mut files = Vec::new();
    let root_path_str = path.to_string();

    if !Path::new(path).exists() {
        return Err(format!("路径不存在: {}", path));
    }

    let filter = FileFilter::new(includes, excludes)?;

    fn read_dir_recursive(
        root_path_str: &str,
        path: &Path,
        filter: &FileFilter,
        inherited: Inclusion,
        files: &mut Vec<FileItem>,
        exclude_empty_dirs: bool,
    ) -> Result<(), String> {
        let entries = fs::read_dir(path).map_err(|e| format!("读取目录失败: {}", e))?;

        let mut children = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
            let file_name = entry.file_name();
            let file_name_str = file_name.to_str().unwrap_or_default();
            let file_path = entry.path();
            let file_path_str = file_path.display().to_string();
            let file_relative_path = file_path.strip_prefix(root_path_str).unwrap();
            let is_dir = file_path.is_dir();

            if filter.excluded(file_relative_path, is_dir) {
                continue;
            }
            let inclusion = filter.inclusion(file_relative_path, is_dir, inherited);
            if !is_dir && inclusion.selected {
                children.push(FileItem {
                    path: file_path_str.clone(),
                    name: file_name_str.to_string(),
                    is_dir,
                    children: Vec::new(),
                });
            } else if is_dir {
                let mut sub_children = Vec::new();
                read_dir_recursive(
                    &root_path_str,
                    &file_path,
                    filter,
                    inclusion,
                    &mut sub_children,
                    exclude_empty_dirs,
                )?;
                if !exclude_empty_dirs || !sub_children.is_empty() {
                    children.push(FileItem {
                        path: file_path_str.clone(),
                        name: file_name_str.to_string(),
                        is_dir,
                        children: sub_children,
                    });
                }
            }
        }

        files.extend(children);
        Ok(())
    }

    read_dir_recursive(
        &root_path_str,
        Path::new(path),
        &filter,
        filter.default_inclusion(),
        &mut files,
        exclude_empty_dirs,
    )?;

    Ok(files)
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
