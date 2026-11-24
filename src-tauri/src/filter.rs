use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::{collections::HashMap, path::Path};

pub(crate) struct FileFilter {
    includes: Gitignore,
    excludes: Gitignore,
    include_order: HashMap<String, usize>,
}

#[derive(Clone, Copy)]
pub(crate) struct Inclusion {
    order: usize,
    pub selected: bool,
}

impl FileFilter {
    pub fn new(includes: &str, excludes: &str) -> Result<Self, String> {
        let mut include_order = HashMap::new();
        let includes = compile("包含", includes, |rule, order| {
            include_order.insert(rule.to_owned(), order);
        })?;
        let excludes = compile("排除", excludes, |_, _| {})?;
        Ok(Self {
            includes,
            excludes,
            include_order,
        })
    }

    pub fn default_inclusion(&self) -> Inclusion {
        Inclusion {
            order: 0,
            selected: self.includes.num_ignores() == 0,
        }
    }

    /// Called top-down. Pruning an excluded directory enforces Git's parent rule.
    pub fn excluded(&self, relative: &Path, is_dir: bool) -> bool {
        self.excludes.matched(relative, is_dir).is_ignore()
    }

    /// Directory selections apply to descendants. The later applicable rule wins
    /// regardless of whether it matched the file directly or its parent.
    pub fn inclusion(&self, relative: &Path, is_dir: bool, inherited: Inclusion) -> Inclusion {
        let matched = self.includes.matched(relative, is_dir);
        if let Some(glob) = matched.inner() {
            let order = self.include_order[glob.original()];
            if order > inherited.order {
                return Inclusion {
                    order,
                    selected: matched.is_ignore(),
                };
            }
        }
        inherited
    }
}

fn compile(
    field: &str,
    raw: &str,
    mut on_rule: impl FnMut(&str, usize),
) -> Result<Gitignore, String> {
    // Callers always pass paths relative to the selected root.
    let mut builder = GitignoreBuilder::new("");
    builder.allow_unclosed_class(false);
    let mut order = 0;
    for (row, line) in raw.lines().enumerate() {
        if line.trim_start().starts_with('#') {
            continue;
        }
        for (column, rule) in line.split('|').enumerate() {
            let rule = rule.trim();
            if rule.is_empty() || rule.starts_with('#') {
                continue;
            }
            builder.add_line(None, rule).map_err(|error| {
                format!(
                    "{field}第 {} 行第 {} 项「{rule}」无效：{error}",
                    row + 1,
                    column + 1
                )
            })?;
            order += 1;
            on_rule(rule, order);
        }
    }
    builder
        .build()
        .map_err(|error| format!("{field}规则编译失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn selected(filter: &FileFilter, file: &str) -> bool {
        let mut relative = std::path::PathBuf::new();
        let mut state = filter.default_inclusion();
        let mut components = Path::new(file).components().peekable();
        while let Some(part) = components.next() {
            relative.push(part);
            let dir = components.peek().is_some();
            if filter.excluded(&relative, dir) {
                return false;
            }
            state = filter.inclusion(&relative, dir, state);
        }
        state.selected
    }

    #[test]
    fn directory_only_and_rooted_exclusions_use_relative_paths() {
        let filter = FileFilter::new("", " build/ | /target ").unwrap();
        assert!(!selected(&filter, "nested/build/a.ts"));
        assert!(selected(&filter, "nested/build"));
        assert!(!selected(&filter, "target/a.rs"));
        assert!(selected(&filter, "nested/target/a.rs"));
    }

    #[test]
    fn ordered_exclusions_can_restore_files_under_visible_parents() {
        let filter = FileFilter::new("*.ts", "*.ts\n!only.ts").unwrap();
        assert!(selected(&filter, "nested/only.ts"));
        assert!(!selected(&filter, "nested/other.ts"));
        assert!(!selected(&filter, "only.js"));
        let pruned = FileFilter::new("", "build/ | !build/only.ts").unwrap();
        assert!(!selected(&pruned, "build/only.ts"));
        let restored = FileFilter::new("", "build/ | !build/ | *.ts | !build/only.ts").unwrap();
        assert!(selected(&restored, "build/only.ts"));
        assert!(!selected(&restored, "build/other.ts"));
    }

    #[test]
    fn include_defaults_and_overrides_follow_order_across_ancestors() {
        assert!(selected(
            &FileFilter::new(" \n# skip | *.ts\n", "").unwrap(),
            "a.py"
        ));
        let negatives = FileFilter::new("!*.ts | !/src/private/", "").unwrap();
        assert!(selected(&negatives, "nested/a.js"));
        assert!(!selected(&negatives, "nested/a.ts"));
        assert!(!selected(&negatives, "src/private/t.py"));
        let rules = FileFilter::new("src/ | !*.ts | only.ts", "").unwrap();
        assert!(selected(&rules, "src/a.js"));
        assert!(selected(&rules, "src/only.ts"));
        assert!(!selected(&rules, "src/b.ts"));
        assert!(!selected(&rules, "nested/a.js"));
        assert!(selected(
            &FileFilter::new("!*.ts | src/", "").unwrap(),
            "src/b.ts"
        ));
    }

    #[test]
    fn rule_errors_locate_the_field_physical_line_and_pipe_item() {
        let error = FileFilter::new("*.ts", "\n# comment\n*.js | [abc")
            .err()
            .unwrap();
        assert!(error.contains("排除第 3 行第 2 项「[abc」"), "{error}");
    }
}
