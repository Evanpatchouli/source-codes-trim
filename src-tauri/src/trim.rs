use crate::file_issue::FileIssue;
use crate::result_store::ResultStore;
use crate::source_text::{write_source, TrimOptions};
use serde::Serialize;
use std::{
    fs::File,
    io::{self, BufWriter, Read, Seek, SeekFrom, Write},
    path::PathBuf,
};

const PREVIEW_BYTES: usize = 256 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrimResult {
    pub result: String,
    pub processed: usize,
    pub skipped: Vec<FileIssue>,
    pub byte_count: u64,
    pub line_count: u64,
    pub export_id: Option<String>,
}

#[derive(Clone, Copy, Default)]
struct Counts {
    bytes: u64,
    newlines: u64,
    last_byte: Option<u8>,
}

impl Counts {
    fn has_unterminated_line(&self) -> bool {
        self.last_byte.is_some() && !matches!(self.last_byte, Some(b'\r' | b'\n'))
    }

    fn add(&mut self, text: &str) {
        self.bytes += text.len() as u64;
        // CRLF can also be split across two chunks.
        for &byte in text.as_bytes() {
            if byte == b'\r' || (byte == b'\n' && self.last_byte != Some(b'\r')) {
                self.newlines += 1;
            }
            self.last_byte = Some(byte);
        }
    }
}

#[derive(Default)]
struct Output {
    preview: String,
    full: Option<BufWriter<File>>,
    counts: Counts,
}

impl Output {
    fn push(&mut self, part: &str) -> io::Result<()> {
        if part.is_empty() {
            return Ok(());
        }
        let remaining = (PREVIEW_BYTES as u64).saturating_sub(self.counts.bytes) as usize;
        if self.full.is_none() && part.len() > remaining {
            let mut writer = BufWriter::new(tempfile::tempfile()?);
            writer.write_all(self.preview.as_bytes())?;
            self.full = Some(writer);
        }
        if let Some(writer) = &mut self.full {
            writer.write_all(part.as_bytes())?;
        }
        let mut end = remaining.min(part.len());
        while !part.is_char_boundary(end) {
            end -= 1;
        }
        self.preview.push_str(&part[..end]);
        self.counts.add(part);
        Ok(())
    }

    // A raw file can turn out to be binary or invalid UTF-8 after several valid chunks.
    fn rollback(&mut self, previous: Counts) -> io::Result<()> {
        if previous.bytes == self.counts.bytes {
            return Ok(());
        }
        if previous.bytes <= PREVIEW_BYTES as u64 {
            self.full = None;
            self.preview.truncate(previous.bytes as usize);
        } else if let Some(writer) = &mut self.full {
            writer.seek(SeekFrom::Start(previous.bytes))?;
            writer.get_ref().set_len(previous.bytes)?;
        }
        self.counts = previous;
        Ok(())
    }

    fn finish(
        self,
        processed: usize,
        skipped: Vec<FileIssue>,
        store: &ResultStore,
    ) -> Result<TrimResult, String> {
        let export_id = if let Some(writer) = self.full {
            let mut file = writer
                .into_inner()
                .map_err(|e| format!("写入完整结果失败：{e}"))?;
            file.rewind()
                .map_err(|e| format!("读取完整结果失败：{e}"))?;
            Some(store.insert(file)?)
        } else {
            None
        };
        Ok(TrimResult {
            result: self.preview,
            processed,
            skipped,
            byte_count: self.counts.bytes,
            line_count: self.counts.newlines + u64::from(self.counts.has_unterminated_line()),
            export_id,
        })
    }
}

enum FileError {
    Input(String),
    Output(io::Error),
}

fn read_error(e: io::Error) -> FileError {
    FileError::Input(if e.kind() == io::ErrorKind::InvalidData {
        "文件不是有效的 UTF-8 文本".into()
    } else {
        format!("读取失败：{e}")
    })
}

fn check_text(text: &str) -> Result<(), FileError> {
    if text.contains('\0') {
        return Err(FileError::Input("含有空字节，无法按 UTF-8 源码处理".into()));
    }
    Ok(())
}

fn copy_utf8(
    mut file: File,
    buffer: &mut [u8],
    mut emit: impl FnMut(&str) -> io::Result<()>,
) -> Result<(), FileError> {
    let mut pending = 0;
    loop {
        let read = match file.read(&mut buffer[pending..]) {
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            result => result.map_err(read_error)?,
        };
        let used = pending + read;
        let text = match std::str::from_utf8(&buffer[..used]) {
            Ok(text) => text,
            Err(e) if e.error_len().is_none() && read != 0 => {
                // Keep the unfinished scalar for the next read.
                std::str::from_utf8(&buffer[..e.valid_up_to()]).expect("valid UTF-8 prefix")
            }
            Err(_) => return Err(read_error(io::ErrorKind::InvalidData.into())),
        };
        check_text(text)?;
        emit(text).map_err(FileError::Output)?;
        let valid = text.len();
        if read == 0 {
            return Ok(());
        }
        buffer.copy_within(valid..used, 0);
        pending = used - valid;
    }
}

pub(crate) fn trim_files(
    files: &[PathBuf],
    options: &TrimOptions,
    store: &ResultStore,
) -> Result<TrimResult, String> {
    let mut output = Output::default();
    let mut skipped = Vec::new();
    let mut processed = 0;
    let mut source = String::new();
    let mut buffer = vec![0; 64 * 1024];
    for path in files {
        let previous = output.counts;
        let mut needs_separator = previous.has_unterminated_line();
        let mut emit = |part: &str| {
            if !part.is_empty() && needs_separator {
                output.push("\n")?;
                needs_separator = false;
            }
            output.push(part)
        };
        let result = File::open(path).map_err(read_error).and_then(|mut file| {
            if options.needs_parser(path) {
                source.clear();
                file.read_to_string(&mut source).map_err(read_error)?;
                check_text(&source)?;
                write_source(path, &source, options, &mut emit).map_err(FileError::Output)
            } else {
                copy_utf8(file, &mut buffer, emit)
            }
        });
        match result {
            Ok(()) => processed += 1,
            Err(FileError::Input(reason)) => {
                output
                    .rollback(previous)
                    .map_err(|e| format!("回退不完整结果失败：{e}"))?;
                skipped.push(FileIssue::new(path, reason));
            }
            Err(FileError::Output(error)) => {
                return Err(format!("整理「{}」失败：{error}", path.display()))
            }
        }
    }
    output.finish(processed, skipped, store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
        let store = ResultStore::default();
        let report = trim_files(&[empty, missing, utf16, binary], &options(), &store).unwrap();
        assert_eq!(report.result, "");
        assert_eq!(report.processed, 1);
        assert_eq!(report.skipped.len(), 3);
        assert!(report.skipped[0].path.ends_with("missing.ts"));
        assert!(report.skipped[0].reason.contains("读取"));
        assert!(report.skipped[1].reason.contains("UTF-8"));
        assert!(report.skipped[2].reason.contains("空字节"));
        assert_eq!(trim_files(&[], &options(), &store).unwrap().processed, 0);
    }

    #[test]
    fn skipped_files_do_not_interrupt_or_join_neighbouring_source_lines() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("a.ts");
        let last = dir.path().join("b.ts");
        fs::write(&first, "first();").unwrap();
        fs::write(&last, "last();\n").unwrap();
        let report = trim_files(
            &[first, dir.path().join("gone"), last],
            &options(),
            &ResultStore::default(),
        )
        .unwrap();
        assert_eq!(report.processed, 2);
        assert_eq!(report.skipped.len(), 1);
        assert_eq!(report.result, "first();\nlast();\n");
    }

    #[test]
    fn counts_bytes_and_logical_lines_for_small_results_without_export() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("raw.txt");
        let store = ResultStore::default();
        for (text, lines) in [
            ("", 0),
            ("\n", 1),
            ("a\r\n", 1),
            ("first\rsecond\r", 2),
            ("水\r\n😀", 2),
            ("a\n\n", 2),
        ] {
            fs::write(&path, text).unwrap();
            let report = trim_files(std::slice::from_ref(&path), &options(), &store).unwrap();
            assert_eq!(report.result, text);
            assert_eq!(report.line_count, lines);
            assert_eq!(report.byte_count, text.len() as u64);
            assert!(report.export_id.is_none());
        }
    }

    #[test]
    fn counts_crlf_across_chunk_boundaries() {
        let mut counts = Counts::default();
        for part in ["a\r", "\nb\r", "c"] {
            counts.add(part);
        }
        assert_eq!(counts.newlines, 2);
        assert!(counts.has_unterminated_line());
    }

    #[test]
    fn preview_is_a_contiguous_utf8_prefix_and_export_has_all_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("large.txt");
        let store = ResultStore::default();
        let exact = "a".repeat(PREVIEW_BYTES);
        fs::write(&path, &exact).unwrap();
        let report = trim_files(std::slice::from_ref(&path), &options(), &store).unwrap();
        assert_eq!(report.result, exact);
        assert!(report.export_id.is_none());
        let text = format!("{}😀\nend", &exact[1..]);
        fs::write(&path, &text).unwrap();
        let report = trim_files(&[path], &options(), &store).unwrap();
        assert_eq!(report.result, &exact[1..]);
        assert_eq!(report.byte_count, text.len() as u64);
        assert_eq!(report.line_count, 2);
        let exported = dir.path().join("out.txt");
        store
            .export(report.export_id.as_ref().unwrap(), &exported)
            .unwrap();
        assert_eq!(fs::read_to_string(exported).unwrap(), text);
    }

    #[test]
    fn failed_raw_inputs_roll_back_spills_separators_and_counts() {
        let dir = tempfile::tempdir().unwrap();
        let good = dir.path().join("good.txt");
        let bad = dir.path().join("bad.txt");
        let end = dir.path().join("end.txt");
        fs::write(&end, "后").unwrap();
        for initial in ["ok".to_string(), "前".repeat(PREVIEW_BYTES / 3 + 1)] {
            fs::write(&good, &initial).unwrap();
            for invalid_tail in [vec![0], vec![0xf0, 0x9f]] {
                let mut data = vec![b'x'; PREVIEW_BYTES + 64 * 1024];
                data.extend(invalid_tail);
                fs::write(&bad, data).unwrap();
                let store = ResultStore::default();
                let report = trim_files(
                    &[good.clone(), bad.clone(), end.clone()],
                    &options(),
                    &store,
                )
                .unwrap();
                let expected = format!("{initial}\n后");
                assert_eq!(report.processed, 2);
                assert_eq!(report.skipped.len(), 1);
                assert_eq!(report.line_count, 2);
                assert_eq!(report.byte_count, expected.len() as u64);
                if initial.len() <= PREVIEW_BYTES {
                    assert!(report.export_id.is_none());
                    assert_eq!(report.result, expected);
                } else {
                    let exported = dir.path().join("rollback.txt");
                    store
                        .export(report.export_id.as_ref().unwrap(), &exported)
                        .unwrap();
                    assert_eq!(fs::read_to_string(exported).unwrap(), expected);
                }
            }
        }
    }
}
