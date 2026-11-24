use crate::{
    file_issue::FileIssue,
    filter::{FileFilter, Inclusion},
};
use serde::Serialize;
use std::{fs, io, path::Path};

#[derive(Debug, Serialize)]
pub(crate) struct FileItem {
    path: String,
    name: String,
    is_dir: bool,
    children: Vec<FileItem>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ScanResult {
    pub files: Vec<FileItem>,
    pub skipped: Vec<FileIssue>,
}

pub(crate) fn scan(
    root: &Path,
    filter: &FileFilter,
    exclude_empty_dirs: bool,
) -> Result<ScanResult, String> {
    let entries =
        fs::read_dir(root).map_err(|e| format!("无法读取根目录「{}」：{e}", root.display()))?;
    let mut scanner = Scanner {
        filter,
        exclude_empty_dirs,
        skipped: Vec::new(),
    };
    let files = scanner.entries(entries, root, Path::new(""), filter.default_inclusion());
    scanner
        .skipped
        .sort_by(|a, b| a.path.cmp(&b.path).then_with(|| a.reason.cmp(&b.reason)));
    Ok(ScanResult {
        files,
        skipped: scanner.skipped,
    })
}

struct Scanner<'a> {
    filter: &'a FileFilter,
    exclude_empty_dirs: bool,
    skipped: Vec<FileIssue>,
}

impl Scanner<'_> {
    fn entries(
        &mut self,
        entries: impl IntoIterator<Item = io::Result<fs::DirEntry>>,
        directory: &Path,
        relative_dir: &Path,
        inherited: Inclusion,
    ) -> Vec<FileItem> {
        let mut files = Vec::new();
        for entry in entries {
            let result = match entry {
                Ok(entry) => self.item(entry, relative_dir, inherited),
                Err(e) => Err(FileIssue::new(directory, format!("目录项读取失败：{e}"))),
            };
            match result {
                Ok(Some(item)) => files.push(item),
                Ok(None) => {}
                Err(issue) => self.skipped.push(issue),
            }
        }
        files.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
        files
    }

    fn item(
        &mut self,
        entry: fs::DirEntry,
        relative_dir: &Path,
        inherited: Inclusion,
    ) -> Result<Option<FileItem>, FileIssue> {
        let name = entry.file_name();
        let path = entry.path();
        let relative = relative_dir.join(&name);
        let metadata = fs::symlink_metadata(&path)
            .map_err(|e| FileIssue::new(&path, format!("无法读取条目属性：{e}")))?;
        let is_dir = metadata.is_dir();
        if self.filter.excluded(&relative, is_dir) {
            return Ok(None);
        }

        if metadata.is_symlink() || is_reparse_point(&metadata) {
            return Err(FileIssue::new(&path, "已跳过符号链接或重解析点"));
        }
        if !is_dir && !metadata.is_file() {
            return Err(FileIssue::new(&path, "已跳过特殊文件"));
        }
        let name = name
            .to_str()
            .ok_or_else(|| FileIssue::new(&path, "文件名无法用 UTF-8 表示"))?;
        let path_str = path
            .to_str()
            .ok_or_else(|| FileIssue::new(&path, "路径无法用 UTF-8 表示"))?;

        let inclusion = self.filter.inclusion(&relative, is_dir, inherited);
        let children = if is_dir {
            let entries = fs::read_dir(&path)
                .map_err(|e| FileIssue::new(&path, format!("无法读取目录：{e}")))?;
            let children = self.entries(entries, &path, &relative, inclusion);
            if self.exclude_empty_dirs && children.is_empty() {
                return Ok(None);
            }
            children
        } else if inclusion.selected {
            Vec::new()
        } else {
            return Ok(None);
        };
        Ok(Some(FileItem {
            path: path_str.to_owned(),
            name: name.to_owned(),
            is_dir,
            children,
        }))
    }
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_: &fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn sorts_directories_first_at_each_level_and_can_hide_empty_ones() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        for name in ["z.txt", "a.txt"] {
            fs::write(root.join(name), b"").unwrap();
        }
        fs::create_dir(root.join("empty")).unwrap();
        fs::create_dir(root.join("src")).unwrap();
        for name in ["b.js", "a.rs", "b.rs"] {
            fs::write(root.join("src").join(name), b"").unwrap();
        }
        let filter = FileFilter::new("*.rs | *.txt", "").unwrap();
        let result = scan(root, &filter, true).unwrap();
        assert!(result.skipped.is_empty());
        let names = |items: &[FileItem]| {
            items
                .iter()
                .map(|item| item.name.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(names(&result.files), ["src", "a.txt", "z.txt"]);
        assert_eq!(names(&result.files[0].children), ["a.rs", "b.rs"]);
        assert_eq!(
            names(&scan(root, &filter, false).unwrap().files),
            ["empty", "src", "a.txt", "z.txt"]
        );
        assert!(scan(&root.join("missing"), &filter, false)
            .unwrap_err()
            .contains("missing"));
        assert!(scan(&root.join("a.txt"), &filter, false).is_err());
    }

    #[test]
    fn vanished_entry_and_enumeration_error_keep_healthy_siblings() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("keep.rs"), b"").unwrap();
        fs::write(root.join("gone.rs"), b"").unwrap();
        let mut entries: Vec<_> = fs::read_dir(root).unwrap().collect();
        fs::remove_file(root.join("gone.rs")).unwrap();
        entries.push(Err(io::ErrorKind::PermissionDenied.into()));
        let filter = FileFilter::new("", "").unwrap();
        let mut scanner = Scanner {
            filter: &filter,
            exclude_empty_dirs: true,
            skipped: Vec::new(),
        };
        let files = scanner.entries(entries, root, Path::new(""), filter.default_inclusion());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "keep.rs");
        assert_eq!(scanner.skipped.len(), 2);
        assert!(scanner
            .skipped
            .iter()
            .any(|e| e.path.ends_with("gone.rs") && !e.reason.is_empty()));
        assert!(scanner
            .skipped
            .iter()
            .any(|e| e.path == root.to_str().unwrap() && e.reason.contains("目录项")));
    }

    #[test]
    #[cfg(any(windows, unix))]
    fn skips_a_directory_link_and_retains_its_real_target_once() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let folder = root.join("source");
        let link = root.join("alias");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("file.rs"), b"").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&folder, &link).unwrap();
        #[cfg(windows)]
        {
            let status = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command",
                    "$ErrorActionPreference='Stop'; $null=New-Item -ItemType Junction -Path $env:TRIM_TEST_LINK -Target $env:TRIM_TEST_TARGET"])
                .env("TRIM_TEST_LINK", &link).env("TRIM_TEST_TARGET", &folder).status().unwrap();
            assert!(status.success());
        }
        let result = scan(root, &FileFilter::new("", "").unwrap(), true).unwrap();
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].name, "source");
        assert_eq!(result.files[0].children[0].name, "file.rs");
        assert_eq!(result.skipped.len(), 1);
        assert_eq!(Path::new(&result.skipped[0].path), link);
    }

    #[cfg(unix)]
    #[test]
    fn unusual_unix_entries_are_reported_with_a_reason() {
        use std::{
            ffi::OsStr,
            os::unix::{ffi::OsStrExt, net::UnixListener},
        };
        let dir = tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join(OsStr::from_bytes(b"bad\xff.rs")), b"").unwrap();
        let _socket = UnixListener::bind(root.join("socket")).unwrap();
        let result = scan(root, &FileFilter::new("", "").unwrap(), true).unwrap();
        assert!(result.files.is_empty());
        assert_eq!(result.skipped.len(), 2);
        assert!(result.skipped.iter().any(|i| i.reason.contains("UTF-8")));
        assert!(result.skipped.iter().any(|i| i.reason.contains("特殊文件")));
    }
}
