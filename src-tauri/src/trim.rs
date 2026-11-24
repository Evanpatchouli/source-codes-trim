use crate::file_issue::FileIssue;
use crate::result_store::{ResultStore, SnapshotIndex};
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
pub(crate) struct FileRange {
    pub path: String,
    pub start_line: Option<u64>,
    pub end_line: Option<u64>,
    pub byte_count: u64,
    #[serde(skip)]
    byte_start: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrimResult {
    pub result: String,
    pub processed: usize,
    pub skipped: Vec<FileIssue>,
    pub byte_count: u64,
    pub line_count: u64,
    pub truncated: bool,
    pub export_id: Option<String>,
    pub file_ranges: Vec<FileRange>,
}

#[derive(Clone, Copy, Default)]
struct Counts {
    bytes: u64,
    newlines: u64,
    last_byte: Option<u8>,
}

impl Counts {
    fn lines(&self) -> u64 {
        self.newlines + u64::from(self.has_unterminated_line())
    }

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
        file_ranges: Vec<FileRange>,
        skipped: Vec<FileIssue>,
        store: &ResultStore,
    ) -> Result<TrimResult, String> {
        let truncated = self.full.is_some();
        let processed = file_ranges.len();
        let index = SnapshotIndex {
            files: file_ranges
                .iter()
                .map(|r| r.byte_start..r.byte_start + r.byte_count)
                .collect(),
            line_count: self.counts.lines(),
        };
        let line_count = index.line_count;
        let export_id = if let Some(writer) = self.full {
            let file = writer
                .into_inner()
                .map_err(|e| format!("写入完整结果失败：{e}"))?;
            Some(store.insert_file(file, index)?)
        } else if processed != 0 || skipped.is_empty() {
            Some(store.insert_text(&self.preview, index)?)
        } else {
            None
        };
        Ok(TrimResult {
            result: self.preview,
            processed,
            skipped,
            byte_count: self.counts.bytes,
            line_count,
            truncated,
            export_id,
            file_ranges,
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
    let mut file_ranges = Vec::new();
    let mut source = String::new();
    let mut buffer = vec![0; 64 * 1024];
    for path in files {
        let previous = output.counts;
        let mut byte_start = previous.bytes;
        let mut needs_separator = previous.has_unterminated_line();
        let mut emit = |part: &str| {
            if !part.is_empty() && needs_separator {
                output.push("\n")?;
                byte_start = output.counts.bytes;
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
            Ok(()) => {
                let before = previous.lines();
                let after = output.counts.lines();
                file_ranges.push(FileRange {
                    path: path.display().to_string(),
                    start_line: (after > before).then(|| before + 1),
                    end_line: (after > before).then_some(after),
                    byte_count: output.counts.bytes - byte_start,
                    byte_start,
                });
            }
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
    output.finish(file_ranges, skipped, store)
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
        assert!(!report.truncated);
        assert!(report.export_id.is_some());
        let empty_selection = trim_files(&[], &options(), &store).unwrap();
        assert_eq!(empty_selection.processed, 0);
        let exported = dir.path().join("empty-selection.txt");
        fs::write(&exported, b"old").unwrap();
        store
            .export(empty_selection.export_id.as_ref().unwrap(), &exported)
            .unwrap();
        assert_eq!(fs::read(exported).unwrap(), b"");
        let failed = trim_files(&[dir.path().join("missing")], &options(), &store).unwrap();
        assert!(!failed.truncated);
        assert!(failed.export_id.is_none());
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
    fn small_results_export_the_exact_bytes_and_report_full_counts() {
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
            assert!(!report.truncated);
            let exported = dir.path().join("export.txt");
            store
                .export(report.export_id.as_ref().unwrap(), &exported)
                .unwrap();
            assert_eq!(fs::read(exported).unwrap(), text.as_bytes());
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
    fn file_ranges_preserve_cross_file_crlf_separators_and_successful_empty_files() {
        let dir = tempfile::tempdir().unwrap();
        let inputs = [
            ("first.txt", "x\r"),
            ("continuation.txt", "\n"),
            ("comment.ts", "// comment\n"),
            ("next.txt", "牛"),
            ("last.txt", "b\nc"),
        ];
        let files = inputs
            .iter()
            .map(|(name, content)| {
                let path = dir.path().join(name);
                fs::write(&path, content).unwrap();
                path
            })
            .collect::<Vec<_>>();
        let store = ResultStore::default();
        let report = trim_files(&files, &options(), &store).unwrap();
        assert_eq!(report.result, "x\r\n牛\nb\nc");
        let ranges: Vec<_> = report
            .file_ranges
            .iter()
            .map(|r| (r.start_line, r.end_line, r.byte_count))
            .collect();
        assert_eq!(
            ranges,
            [
                (Some(1), Some(1), 2),
                (None, None, 1),
                (None, None, 0),
                (Some(2), Some(2), 3),
                (Some(3), Some(4), 3)
            ]
        );
        let id = report.export_id.unwrap();
        for (i, text) in ["x\r", "\n", "", "牛", "b\nc"].into_iter().enumerate() {
            assert_eq!(report.file_ranges[i].path, files[i].to_str().unwrap());
            let page = store.file_preview(&id, i, 0).unwrap();
            assert_eq!(page.text, text);
            assert_eq!(page.next_offset, None);
        }
    }

    #[test]
    fn a_huge_line_beyond_the_main_preview_can_be_paged_after_sources_change() {
        let dir = tempfile::tempdir().unwrap();
        let head = dir.path().join("earlier.txt");
        let late = dir.path().join("late.txt");
        fs::write(&head, "x".repeat(PREVIEW_BYTES + 1)).unwrap();
        let text = format!("{}{}尾", "x".repeat(65535), "😀".repeat(PREVIEW_BYTES / 4));
        fs::write(&late, &text).unwrap();
        let store = ResultStore::default();
        let report = trim_files(&[head, late.clone()], &options(), &store).unwrap();
        fs::write(&late, "changed").unwrap();
        assert_eq!(report.file_ranges[1].start_line, Some(2));
        assert_eq!(report.file_ranges[1].end_line, Some(2));
        assert!(!report.result.contains("😀"));
        let id = report.export_id.unwrap();
        let first = store.file_preview(&id, 1, 0).unwrap();
        assert_eq!(first.next_offset, Some(65535));
        let mut assembled = first.text;
        let mut next = first.next_offset;
        while let Some(offset) = next {
            let page = store.file_preview(&id, 1, offset).unwrap();
            assert!(!page.text.is_empty() && page.text.len() <= 65536);
            assembled.push_str(&page.text);
            next = page.next_offset;
        }
        assert_eq!(assembled, text);
        assert_eq!(
            store.file_preview(&id, 1, text.len() as u64).unwrap().text,
            ""
        );
        assert!(store.file_preview(&id, 1, 65536).is_err());
        assert!(store.file_preview(&id, 1, u64::MAX).is_err());
        assert!(store.file_preview(&id, 2, 0).is_err());
        store.release(&id).unwrap();
        assert!(store.file_preview(&id, 1, 0).is_err());
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
        assert!(!report.truncated);
        let exact_id = report.export_id.unwrap();
        let text = format!("{}😀\nend", &exact[1..]);
        fs::write(&path, &text).unwrap();
        let report = trim_files(&[path], &options(), &store).unwrap();
        assert_eq!(report.result, &exact[1..]);
        assert_eq!(report.byte_count, text.len() as u64);
        assert_eq!(report.line_count, 2);
        assert!(report.truncated);
        let exported = dir.path().join("out.txt");
        store.export(&exact_id, &exported).unwrap();
        assert_eq!(fs::read(&exported).unwrap(), exact.as_bytes());
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
                assert_eq!(report.file_ranges.len(), 2);
                assert_eq!(report.file_ranges[1].path, end.to_str().unwrap());
                assert_eq!(report.file_ranges[1].start_line, Some(2));
                assert_eq!(report.file_ranges[1].byte_count, 3);
                assert_eq!(
                    store
                        .file_preview(report.export_id.as_ref().unwrap(), 1, 0)
                        .unwrap()
                        .text,
                    "后"
                );
                if initial.len() <= PREVIEW_BYTES {
                    assert!(!report.truncated);
                    assert_eq!(report.result, expected);
                } else {
                    assert!(report.truncated);
                }
                let exported = dir.path().join("rollback.txt");
                store
                    .export(report.export_id.as_ref().unwrap(), &exported)
                    .unwrap();
                assert_eq!(fs::read_to_string(exported).unwrap(), expected);
            }
        }
    }
}
