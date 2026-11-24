use std::{io, ops::Range, path::Path};
use tree_sitter::{Language, Parser};

pub(crate) struct TrimOptions {
    pub comments: bool,
    pub trailing_whitespace: bool,
    pub blank_lines: bool,
}

impl TrimOptions {
    pub fn needs_parser(&self, path: &Path) -> bool {
        (self.comments || self.trailing_whitespace || self.blank_lines)
            && Syntax::for_path(path).is_some()
    }
}

#[derive(Clone, Copy)]
enum Syntax {
    JavaScript,
    TypeScript,
    Tsx,
    Rust,
    Python,
    C,
    Cpp,
}

impl Syntax {
    fn for_path(path: &Path) -> Option<Self> {
        let extension = path.extension()?.to_str()?;
        if extension == "C" {
            return Some(Self::Cpp);
        }
        match extension.to_ascii_lowercase().as_str() {
            "js" | "jsx" | "mjs" | "cjs" => Some(Self::JavaScript),
            "ts" | "mts" | "cts" => Some(Self::TypeScript),
            "tsx" => Some(Self::Tsx),
            "rs" => Some(Self::Rust),
            "py" | "pyi" | "pyw" => Some(Self::Python),
            "c" => Some(Self::C),
            "cc" | "cpp" | "cxx" | "h" | "hpp" | "hh" | "hxx" => Some(Self::Cpp),
            _ => None,
        }
    }

    fn language(self) -> Language {
        match self {
            Self::JavaScript => tree_sitter_javascript::LANGUAGE,
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT,
            Self::Tsx => tree_sitter_typescript::LANGUAGE_TSX,
            Self::Rust => tree_sitter_rust::LANGUAGE,
            Self::Python => tree_sitter_python::LANGUAGE,
            Self::C => tree_sitter_c::LANGUAGE,
            Self::Cpp => tree_sitter_cpp::LANGUAGE,
        }
        .into()
    }

    fn keep_comment(self, text: &str, row: usize) -> bool {
        match self {
            Self::Python => {
                text.starts_with("#!")
                    || (row < 2 && (text.contains("coding:") || text.contains("coding=")))
                    || text[1..].trim_start().starts_with("type:")
            }
            Self::Rust => {
                text.starts_with("//!")
                    || text.starts_with("/*!")
                    || (text.starts_with("///") && !text.starts_with("////"))
                    || (text.starts_with("/**") && !text.starts_with("/***") && text != "/**/")
            }
            Self::JavaScript | Self::TypeScript | Self::Tsx => {
                // Includes TypeScript directives, triple-slash references and bundler annotations.
                let body = text.trim_start_matches(['/', '*', ' ', '\t']);
                body.starts_with(['@', '#', '<', '!'])
                    || (text.starts_with("/**") && text.contains('@'))
            }
            _ => false,
        }
    }
}

struct SyntaxRanges {
    protected_rows: Vec<bool>,
    comments: Vec<Range<usize>>,
}

fn syntax_ranges(
    syntax: Syntax,
    source: &str,
    strip_comments: bool,
) -> io::Result<Option<SyntaxRanges>> {
    let mut parser = Parser::new();
    parser
        .set_language(&syntax.language())
        .map_err(io::Error::other)?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(None);
    };
    let root = tree.root_node();
    if root.has_error() {
        return Ok(None);
    }

    let mut protected_rows = vec![false; root.end_position().row + 1];
    let mut protected_until = 0;
    let mut comments: Vec<Range<usize>> = Vec::new();
    let mut cursor = tree.walk();
    'walk: loop {
        let node = cursor.node();
        let kind = node.kind();
        let comment = matches!(kind, "comment" | "line_comment" | "block_comment");
        let literal = matches!(
            kind,
            "template_string"
                | "jsx_text"
                | "string"
                | "string_literal"
                | "raw_string_literal"
                | "char_literal"
                | "regex"
                | "preproc_arg"
        );
        if comment
            && strip_comments
            && !syntax.keep_comment(&source[node.byte_range()], node.start_position().row)
        {
            comments.push(node.byte_range());
        } else if (literal || comment || kind == "jsx_element")
            && node.start_position().row != node.end_position().row
        {
            // A JSX element can contain many nested elements covering the same rows.
            let end = node.end_position().row;
            if end > protected_until {
                protected_rows[node.start_position().row.max(protected_until)..end].fill(true);
                protected_until = end;
            }
        }
        // A template or macro argument can embed another language. Keep its contents intact.
        if !comment && !literal && cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                break 'walk;
            }
        }
    }
    Ok(Some(SyntaxRanges {
        comments,
        protected_rows,
    }))
}

/// Emits the original UTF-8 text unchanged when the grammar cannot classify it reliably.
pub(crate) fn write_source(
    path: &Path,
    source: &str,
    options: &TrimOptions,
    mut emit: impl FnMut(&str) -> io::Result<()>,
) -> io::Result<()> {
    let Some(syntax) = Syntax::for_path(path) else {
        return emit(source);
    };
    // C line splicing precedes tokenization. Also preserve uncommon line terminators
    // that would require a different physical-line map (notably JavaScript ASI).
    if (!options.comments && !options.trailing_whitespace && !options.blank_lines)
        || source.contains(['\u{2028}', '\u{2029}'])
        || source
            .match_indices('\r')
            .any(|(i, _)| source.as_bytes().get(i + 1) != Some(&b'\n'))
        || (matches!(syntax, Syntax::C | Syntax::Cpp)
            && (source.contains("\\\n") || source.contains("\\\r\n")))
    {
        return emit(source);
    }
    let Some(SyntaxRanges {
        comments,
        protected_rows,
    }) = syntax_ranges(syntax, source, options.comments)?
    else {
        return emit(source);
    };
    let mut start = 0;
    let mut next_comment = 0;
    let mut continued = false;
    let mut line = String::new();
    for (row, raw) in source.split_inclusive('\n').enumerate() {
        let body = raw
            .strip_suffix("\r\n")
            .or_else(|| raw.strip_suffix('\n'))
            .unwrap_or(raw);
        let end = start + body.len();
        line.clear();
        let mut pos = start;
        while let Some(comment) = comments.get(next_comment) {
            if comment.start >= end {
                break;
            }
            if comment.end > start {
                line.push_str(&source[pos..comment.start.max(pos)]);
                pos = comment.end.min(end);
                // Preserve a token boundary even for operators, e.g. x +/**/+ y.
                if pos < end
                    && !line.is_empty()
                    && !line.ends_with(char::is_whitespace)
                    && !source[pos..end].starts_with(char::is_whitespace)
                {
                    line.push(' ');
                }
            }
            if comment.end > end {
                break;
            }
            next_comment += 1;
        }
        let cleaned = if pos == start {
            body
        } else {
            line.push_str(&source[pos..end]);
            &line
        };
        let protected = protected_rows.get(row).copied().unwrap_or(false) || continued;
        continued = body.ends_with('\\');
        let text = if options.trailing_whitespace && !protected {
            cleaned.trim_end_matches([' ', '\t'])
        } else {
            cleaned
        };
        if protected || !options.blank_lines || !text.trim_matches([' ', '\t']).is_empty() {
            emit(text)?;
            emit(&raw[body.len()..])?;
        }
        start += raw.len();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clean(path: &str, input: &str) -> String {
        let options = TrimOptions {
            comments: true,
            trailing_whitespace: true,
            blank_lines: true,
        };
        let mut output = String::new();
        write_source(Path::new(path), input, &options, |text| {
            output.push_str(text);
            Ok(())
        })
        .unwrap();
        output
    }

    #[test]
    fn javascript_strings_regex_and_template_text_are_data() {
        let input = "const u = \"https://example.test/a\"; // remove\nconst r = /[/][*]/;\nconst s = `//raw  \r\n\r\n/*keep*/`; /* remove */\n";
        assert_eq!(clean("a.js", input), "const u = \"https://example.test/a\";\nconst r = /[/][*]/;\nconst s = `//raw  \r\n\r\n/*keep*/`;\n");
        assert_eq!(
            clean("a.ts", "const s: string = \"\\\"//\"; // trailing"),
            "const s: string = \"\\\"//\";"
        );
        assert_eq!(
            clean("a.tsx", "const x = <div>https://seen{/* gone */}</div>;"),
            "const x = <div>https://seen{ }</div>;"
        );
    }

    #[test]
    fn block_comments_preserve_token_and_statement_boundaries() {
        assert_eq!(clean("a.c", "int/**/x/*second*/=1;\n"), "int x =1;\n");
        assert_eq!(
            clean("a.js", "function f(x) { return /* note\n */ x; }"),
            "function f(x) { return\n x; }"
        );
        assert_eq!(clean("a.cpp", "int n = a +/**/+ b;"), "int n = a + + b;");
    }

    #[test]
    fn python_comments_leave_floor_division_hash_strings_and_docstrings() {
        let input = "#!/usr/bin/python\n# coding: utf-8\n# remove\nx = 6 // 2  # remove\ns = '''# keep  \n\n// keep'''\n";
        assert_eq!(
            clean("a.py", input),
            "#!/usr/bin/python\n# coding: utf-8\nx = 6 // 2\ns = '''# keep  \n\n// keep'''\n"
        );
    }

    #[test]
    fn rust_nested_comments_and_raw_strings() {
        let input = "/// API docs\nfn f() { /* a /* b */ c */\nlet s = r#\"// keep  \n\n/* keep */\"#;\n}\n";
        assert_eq!(
            clean("a.rs", input),
            "/// API docs\nfn f() {\nlet s = r#\"// keep  \n\n/* keep */\"#;\n}\n"
        );
    }

    #[test]
    fn uncertain_syntax_and_unknown_formats_are_byte_preserving() {
        for (path, source) in [
            ("README.md", "# header  \r\n\r\nhttps://example.com"),
            ("broken.js", "let s = 'broken; // uncertain  \n\n"),
            ("macro.c", "#define VALUE \\\n\nint v;\n"),
        ] {
            assert_eq!(clean(path, source), source);
        }
    }

    #[test]
    fn optional_blank_line_removal_leaves_line_separators_and_propagates_io_errors() {
        let options = TrimOptions {
            comments: true,
            trailing_whitespace: true,
            blank_lines: false,
        };
        let mut out = String::new();
        write_source(Path::new("a.js"), "a();  \r\n\r\nb();", &options, |s| {
            out.push_str(s);
            Ok(())
        })
        .unwrap();
        assert_eq!(out, "a();\r\n\r\nb();");
        assert!(write_source(Path::new("a.ts"), "x;", &options, |_| Err(
            io::Error::other("full")
        ))
        .is_err());
    }
}
