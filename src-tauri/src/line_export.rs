use serde::Deserialize;
use std::io::{self, Read, Write};

#[derive(Debug, Default, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum LineSelection {
    #[default]
    All,
    Range {
        start: u64,
        end: u64,
    },
    HeadTail {
        head: u64,
        tail: u64,
    },
}

pub(crate) fn write_selected(
    reader: &mut (impl Read + ?Sized),
    writer: &mut (impl Write + ?Sized),
    selection: &LineSelection,
    total: u64,
) -> io::Result<()> {
    let invalid = |message| io::Error::new(io::ErrorKind::InvalidInput, message);
    let mut ranges = Vec::with_capacity(2);
    match *selection {
        LineSelection::All => return io::copy(reader, writer).map(|_| ()),
        LineSelection::Range { start, end } => {
            if start == 0 || start > end || end > total {
                return Err(invalid("请输入有效的起止行，行号须在全文范围内"));
            }
            ranges.push((start, end));
        }
        LineSelection::HeadTail { head, tail } => {
            if total == 0 || (head == 0 && tail == 0) {
                return Err(invalid("非空结果至少需要选择一行"));
            }
            let head = head.min(total);
            let tail = tail.min(total);
            if head >= total - tail {
                ranges.push((1, total));
            } else {
                if head > 0 {
                    ranges.push((1, head));
                }
                if tail > 0 {
                    ranges.push((total - tail + 1, total));
                }
            }
        }
    }
    if ranges.as_slice() == [(1, total)] {
        return io::copy(reader, writer).map(|_| ());
    }

    let mut ranges = ranges.into_iter();
    let mut current = ranges.next().expect("nonempty selection");
    let mut line = 1u64;
    let mut previous_cr = false;
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = match reader.read(&mut buffer) {
            Ok(0) => return Ok(()),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            result => result?,
        };
        let chunk = &buffer[..count];
        let mut copy_from = 0;
        for (index, &byte) in chunk.iter().enumerate() {
            // A preceding CR ends its line before this byte unless this is the LF
            // of a CRLF pair. In the latter case both bytes belong to that line.
            let boundary = if byte == b'\n' {
                Some(index + 1)
            } else if previous_cr {
                Some(index)
            } else {
                None
            };
            previous_cr = byte == b'\r';
            let Some(boundary) = boundary else { continue };
            if line == current.1 {
                writer.write_all(&chunk[copy_from..boundary])?;
                let Some(next) = ranges.next() else {
                    return Ok(());
                };
                current = next;
            }
            line += 1;
            if line == current.0 {
                copy_from = boundary;
            }
        }
        if line >= current.0 {
            writer.write_all(&chunk[copy_from..])?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Chunks<'a> {
        bytes: &'a [u8],
        size: usize,
    }

    impl Read for Chunks<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let count = self.size.min(buffer.len()).min(self.bytes.len());
            self.bytes.read(&mut buffer[..count])
        }
    }

    // Independent reference: split the finished byte string first and preserve its delimiters.
    fn reference_lines(mut text: &[u8]) -> Vec<&[u8]> {
        let mut lines = Vec::new();
        while !text.is_empty() {
            let Some(pos) = text.iter().position(|c| matches!(c, b'\r' | b'\n')) else {
                lines.push(text);
                break;
            };
            let end = pos
                + if text[pos..].starts_with(b"\r\n") {
                    2
                } else {
                    1
                };
            lines.push(&text[..end]);
            text = &text[end..];
        }
        lines
    }

    fn check(
        text: &[u8],
        chunk_size: usize,
        selection: LineSelection,
        total: usize,
        expected: &[u8],
    ) {
        let mut output = Vec::new();
        let mut reader = Chunks {
            bytes: text,
            size: chunk_size,
        };
        write_selected(&mut reader, &mut output, &selection, total as u64).unwrap();
        assert_eq!(
            output, expected,
            "{selection:?}, input {text:?}, chunk size {chunk_size}"
        );
    }

    #[test]
    fn small_chunk_outputs_match_all_short_combinations_of_cr_lf_and_data() {
        for len in 0..=5 {
            for mut pattern in 0..3usize.pow(len) {
                let input = (0..len)
                    .map(|_| {
                        let byte = [b'\r', b'\n', b'x'][pattern % 3];
                        pattern /= 3;
                        byte
                    })
                    .collect::<Vec<_>>();
                let lines = reference_lines(&input);
                let total = lines.len();
                for size in [1, 3] {
                    check(&input, size, LineSelection::All, total, &input);
                    for start in 1..=total {
                        for end in start..=total {
                            check(
                                &input,
                                size,
                                LineSelection::Range {
                                    start: start as u64,
                                    end: end as u64,
                                },
                                total,
                                &lines[start - 1..end].concat(),
                            );
                        }
                    }
                    if total != 0 {
                        for (head, tail) in [
                            (1usize, 0usize),
                            (0, 1),
                            (1, 1),
                            (1, 2),
                            (2, 2),
                            (0, usize::MAX),
                        ] {
                            let expected = lines
                                .iter()
                                .enumerate()
                                .filter(|(i, _)| *i < head || *i >= total.saturating_sub(tail))
                                .map(|(_, line)| *line)
                                .collect::<Vec<_>>()
                                .concat();
                            check(
                                &input,
                                size,
                                LineSelection::HeadTail {
                                    head: head as u64,
                                    tail: tail as u64,
                                },
                                total,
                                &expected,
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn giant_unterminated_unicode_line_and_a_crlf_across_64_kib() {
        let first = "a".repeat(65535) + "\r\n";
        let last = "汉字😀".repeat(100_000);
        let text = format!("{first}略过\r{last}");
        check(
            text.as_bytes(),
            65536,
            LineSelection::Range { start: 1, end: 1 },
            3,
            first.as_bytes(),
        );
        check(
            text.as_bytes(),
            16385,
            LineSelection::Range { start: 3, end: 3 },
            3,
            last.as_bytes(),
        );
        check(
            text.as_bytes(),
            65536,
            LineSelection::HeadTail { head: 1, tail: 1 },
            3,
            format!("{first}{last}").as_bytes(),
        );
    }

    #[test]
    fn invalid_selections_are_rejected_before_writing() {
        for (total, selection) in [
            (0, LineSelection::Range { start: 1, end: 1 }),
            (0, LineSelection::HeadTail { head: 1, tail: 0 }),
            (3, LineSelection::Range { start: 0, end: 2 }),
            (3, LineSelection::Range { start: 3, end: 2 }),
            (3, LineSelection::Range { start: 2, end: 4 }),
            (3, LineSelection::HeadTail { head: 0, tail: 0 }),
        ] {
            let mut bytes = Vec::new();
            assert_eq!(
                write_selected(&mut &b""[..], &mut bytes, &selection, total)
                    .unwrap_err()
                    .kind(),
                io::ErrorKind::InvalidInput
            );
            assert!(bytes.is_empty());
        }
        check(b"raw", 1, LineSelection::default(), 0, b"raw");
    }
}
