use crate::file_issue::FileIssue;
use crate::source_text::{write_source, TrimOptions};
use serde::Serialize;
use std::{fs, io, path::PathBuf};

#[derive(Debug, Default, Serialize)]
pub(crate) struct TrimResult {
    pub result: String,
    pub processed: usize,
    pub skipped: Vec<FileIssue>,
}

pub(crate) fn trim_files(files: &[PathBuf], options: &TrimOptions) -> Result<TrimResult, String> {
    let mut report = TrimResult::default();
    for path in files {
        let content = match fs::read_to_string(path) {
            Ok(text) if !text.contains('\0') => text,
            Ok(_) => {
                report
                    .skipped
                    .push(FileIssue::new(path, "含有空字节，无法按 UTF-8 源码处理"));
                continue;
            }
            Err(error) => {
                let reason = if error.kind() == io::ErrorKind::InvalidData {
                    "文件不是有效的 UTF-8 文本".to_owned()
                } else {
                    format!("读取失败：{error}")
                };
                report.skipped.push(FileIssue::new(path, reason));
                continue;
            }
        };
        let mut needs_separator = !report.result.is_empty() && !report.result.ends_with('\n');
        write_source(path, &content, options, |part| {
            if !part.is_empty() {
                if needs_separator {
                    report.result.push('\n');
                    needs_separator = false;
                }
                report.result.push_str(part);
            }
            Ok(())
        })
        .map_err(|error| format!("整理「{}」失败：{error}", path.display()))?;
        report.processed += 1;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> TrimOptions {
        TrimOptions {
            comments: true,
            trailing_whitespace: true,
            blank_lines: true,
        }
    }

    #[test]
    fn distinguishes_empty_output_from_skipped_inputs() {
        let dir = tempfile::tempdir().unwrap();
        let empty = dir.path().join("blank.ts");
        let missing = dir.path().join("missing.ts");
        let utf16 = dir.path().join("utf16.c");
        let binary = dir.path().join("binary");
        fs::write(&empty, "// comment\n").unwrap();
        fs::write(&utf16, [0xff, 0xfe, b'A', 0]).unwrap();
        fs::write(&binary, b"a\0b").unwrap();
        let report = trim_files(&[empty, missing, utf16, binary], &options()).unwrap();
        assert_eq!(report.result, "");
        assert_eq!(report.processed, 1);
        assert_eq!(report.skipped.len(), 3);
        assert!(report.skipped[0].path.ends_with("missing.ts"));
        assert!(report.skipped[0].reason.contains("读取"));
        assert!(report.skipped[1].reason.contains("UTF-8"));
        assert!(report.skipped[2].reason.contains("空字节"));
        assert_eq!(trim_files(&[], &options()).unwrap().processed, 0);
    }

    #[test]
    fn skipped_files_do_not_interrupt_or_join_neighbouring_source_lines() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("a.ts");
        let last = dir.path().join("b.ts");
        fs::write(&first, "first();").unwrap();
        fs::write(&last, "last();\n").unwrap();
        let report = trim_files(&[first, dir.path().join("gone"), last], &options()).unwrap();
        assert_eq!(report.processed, 2);
        assert_eq!(report.skipped.len(), 1);
        assert_eq!(report.result, "first();\nlast();\n");
    }
}
