use regex::Regex;
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

// 所有空行或者以 ＃ 开头的行都会被忽略。
// 可以使用标准的 glob 模式匹配。
// 匹配模式可以以（/）开头防止递归。
// 匹配模式可以以（/）结尾指定目录。
// 要忽略指定模式以外的文件或目录，可以在模式前加上惊叹号（!）取反。
fn glob_pattern_to_regex(pattern: &str) -> String {
    // 将所有的 / 替换为 \\，以便在正则表达式中正确匹配路径分隔符
    let pattern = pattern.replace("/", "\\");

    if pattern.trim().is_empty() || pattern.starts_with('#') {
        return String::new();
    }

    let mut regex = String::from("^");
    let mut chars = pattern.chars().peekable();

    if pattern.starts_with('!') {
        regex.push_str("(?!");
        chars.next();
    }

    if pattern.starts_with('\\') {
        chars.next();
    } else {
        regex.push_str("(.*/)?");
    }

    while let Some(ch) = chars.next() {
        match ch {
            '*' => {
                if chars.peek() == Some(&'*') {
                    chars.next();
                    regex.push_str(".*");
                } else {
                    regex.push_str("[^\\\\/]*");
                }
            }
            '?' => regex.push('.'),
            '.' => regex.push_str("\\."),
            '\\' => regex.push_str("[\\\\/]"),
            _ => regex.push_str(&regex::escape(&ch.to_string())),
        }
    }

    if pattern.ends_with('\\') {
        regex.push_str("[\\\\/]");
    } else {
        regex.push('$');
    }

    if pattern.starts_with('!') {
        regex.push(')');
    }

    regex
}

fn compile_patterns(patterns: Vec<&str>) -> Vec<Regex> {
    patterns
        .into_iter()
        .filter_map(|pattern| {
            let regex_pattern = glob_pattern_to_regex(pattern);
            if regex_pattern.is_empty() {
                None
            } else {
                Regex::new(&regex_pattern).ok()
            }
        })
        .collect()
}

#[tauri::command]
pub fn get_files(
    path: &str,
    includes: Vec<&str>,
    excludes: Vec<&str>,
    exclude_empty_dirs: bool,
) -> Result<Vec<FileItem>, String> {
    let mut files = Vec::new();
    let root_path_str = path.to_string();

    if !Path::new(path).exists() {
        return Err(format!("路径不存在: {}", path));
    }

    let include_patterns = compile_patterns(includes);
    let exclude_patterns = compile_patterns(excludes);

    fn read_dir_recursive(
        root_path_str: &str,
        path: &Path,
        include_patterns: &Vec<Regex>,
        exclude_patterns: &Vec<Regex>,
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
            let file_relative_path_str = file_relative_path.display().to_string();
            let is_dir = file_path.is_dir();

            if exclude_patterns.iter().any(|pattern| {
                pattern.is_match(file_name_str) || pattern.is_match(&file_relative_path_str)
            }) {
                continue;
            }

            if !is_dir
                && (include_patterns.is_empty()
                    || include_patterns.iter().any(|pattern| {
                        pattern.is_match(file_name_str) || pattern.is_match(&file_relative_path_str)
                    }))
            {
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
                    include_patterns,
                    exclude_patterns,
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
        &include_patterns,
        &exclude_patterns,
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
    let mut result = String::new();
    let mut skipped = Vec::new();
    for file in files {
        let content = match fs::read_to_string(&file) {
            Ok(content) => content,
            Err(e) => {
                skipped.push(file.display().to_string());
                eprintln!("读取文件失败: {}", e);
                continue;
            }
        };

        let mut lines = content.lines();
        while let Some(line) = lines.next() {
            let mut line = line.to_string();

            // 去除注释
            if trim_comments {
                if let Some(pos) = line.find("//") {
                    line = line[..pos].to_string();
                }
                if let Some(pos) = line.find("/*") {
                    if let Some(end_pos) = line.find("*/") {
                        line = line[..pos].to_string() + &line[end_pos + 2..];
                    } else {
                        line = line[..pos].to_string();
                    }
                }
            }

            // 去除行尾空白字符
            if trim_whitespace {
                line = line.trim_end().to_string();
            }

            // 跳过空行
            if line.is_empty() {
                continue;
            }

            result.push_str(&line);

            // 添加换行符
            if trim_newlines {
                result.push('\n');
            }
        }
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
