use crate::line_export::{write_selected, LineSelection};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::File,
    io::{self, Cursor, Read, Seek, SeekFrom},
    ops::Range,
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};
use tempfile::NamedTempFile;

trait ReadSeek: Read + Seek {}
impl<T: Read + Seek> ReadSeek for T {}

enum Content {
    Memory(Box<[u8]>),
    Disk(Mutex<File>),
}

impl Content {
    fn with_reader<T>(
        &self,
        read: impl FnOnce(&mut dyn ReadSeek) -> io::Result<T>,
    ) -> io::Result<T> {
        match self {
            Self::Memory(bytes) => read(&mut Cursor::new(bytes.as_ref())),
            Self::Disk(file) => {
                let mut file = file
                    .lock()
                    .map_err(|_| io::Error::other("整理结果文件不可用"))?;
                file.rewind()?;
                read(&mut *file)
            }
        }
    }
}

#[derive(Default)]
pub(crate) struct SnapshotIndex {
    pub files: Vec<Range<u64>>,
    pub line_count: u64,
}

struct Snapshot {
    content: Content,
    index: SnapshotIndex,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FilePreview {
    pub text: String,
    pub next_offset: Option<u64>,
}

#[derive(Default)]
struct Results {
    next_id: u64,
    snapshots: HashMap<String, Arc<Snapshot>>,
}

#[derive(Default, Clone)]
pub(crate) struct ResultStore {
    results: Arc<Mutex<Results>>,
}

impl ResultStore {
    fn lock(&self) -> Result<MutexGuard<'_, Results>, String> {
        self.results.lock().map_err(|_| "整理结果状态不可用".into())
    }

    fn insert(&self, content: Content, index: SnapshotIndex) -> Result<String, String> {
        let mut results = self.lock()?;
        results.next_id = results.next_id.checked_add(1).ok_or("整理结果编号已用尽")?;
        let id = results.next_id.to_string();
        results
            .snapshots
            .insert(id.clone(), Arc::new(Snapshot { content, index }));
        Ok(id)
    }

    pub(crate) fn insert_file(&self, file: File, index: SnapshotIndex) -> Result<String, String> {
        self.insert(Content::Disk(Mutex::new(file)), index)
    }

    pub(crate) fn insert_text(&self, text: &str, index: SnapshotIndex) -> Result<String, String> {
        self.insert(Content::Memory(text.as_bytes().into()), index)
    }

    fn snapshot(&self, id: &str) -> Result<Arc<Snapshot>, String> {
        self.lock()?
            .snapshots
            .get(id)
            .cloned()
            .ok_or_else(|| "整理结果已释放".into())
    }

    pub(crate) fn file_preview(
        &self,
        id: &str,
        index: usize,
        offset: u64,
    ) -> Result<FilePreview, String> {
        const PAGE_BYTES: u64 = 64 * 1024;
        let snapshot = self.snapshot(id)?;
        let span = snapshot
            .index
            .files
            .get(index)
            .ok_or("文件索引超出结果范围")?;
        let length = span.end - span.start;
        let remaining = length.checked_sub(offset).ok_or("文件预览偏移超出范围")?;
        let mut bytes = vec![0; remaining.min(PAGE_BYTES) as usize];
        snapshot
            .content
            .with_reader(|reader| {
                reader.seek(SeekFrom::Start(span.start + offset))?;
                reader.read_exact(&mut bytes)
            })
            .map_err(|e| format!("读取文件预览失败：{e}"))?;

        let text = match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(error) if remaining > PAGE_BYTES && error.utf8_error().error_len().is_none() => {
                let valid = error.utf8_error().valid_up_to();
                let mut bytes = error.into_bytes();
                bytes.truncate(valid);
                String::from_utf8(bytes).expect("validated UTF-8 prefix")
            }
            Err(_) => return Err("文件预览的起始偏移不在 UTF-8 字符边界".into()),
        };
        let end = offset + text.len() as u64;
        Ok(FilePreview {
            text,
            next_offset: (end < length).then_some(end),
        })
    }

    pub(crate) fn release(&self, id: &str) -> Result<(), String> {
        let snapshot = self.lock()?.snapshots.remove(id);
        drop(snapshot);
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn export(&self, id: &str, destination: &Path) -> Result<(), String> {
        self.export_selected(id, destination, &LineSelection::All)
    }

    pub(crate) fn export_selected(
        &self,
        id: &str,
        destination: &Path,
        selection: &LineSelection,
    ) -> Result<(), String> {
        // 导出持有自己的引用，界面释放或替换结果时仍能完成写入。
        let snapshot = self.snapshot(id)?;
        let parent = destination.parent().ok_or("请选择导出文件")?;
        let parent = if parent.as_os_str().is_empty() {
            Path::new(".")
        } else {
            parent
        };
        let mut staging = NamedTempFile::new_in(parent)
            .map_err(|error| format!("无法在导出目录创建临时文件：{error}"))?;
        snapshot
            .content
            .with_reader(|reader| {
                write_selected(
                    reader,
                    staging.as_file_mut(),
                    selection,
                    snapshot.index.line_count,
                )
            })
            .map_err(|error| format!("导出整理结果失败：{error}"))?;
        staging
            .as_file()
            .sync_all()
            .map_err(|error| format!("写入导出文件失败：{error}"))?;
        staging
            .persist(destination)
            .map_err(|error| format!("保存「{}」失败：{}", destination.display(), error.error))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Write, thread};

    fn snapshot(store: &ResultStore, content: &[u8]) -> String {
        let mut file = tempfile::tempfile().unwrap();
        file.write_all(content).unwrap();
        store.insert_file(file, SnapshotIndex::default()).unwrap()
    }

    #[test]
    fn release_is_idempotent_and_drops_the_file_after_the_last_reader() {
        let store = ResultStore::default();
        let id = snapshot(&store, b"result");
        let reader = store.lock().unwrap().snapshots[&id].clone();
        let weak = Arc::downgrade(&reader);
        store.clone().release(&id).unwrap();
        store.release(&id).unwrap();
        assert!(store.export(&id, Path::new("unused.txt")).is_err());
        assert!(weak.upgrade().is_some());
        drop(reader);
        assert!(weak.upgrade().is_none());
    }

    #[test]
    fn repeated_and_concurrent_exports_copy_the_entire_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let store = ResultStore::default();
        let content = "头\nsource();\n尾\n".repeat(16_384);
        let id = snapshot(&store, content.as_bytes());
        let first = dir.path().join("first.txt");
        let second = dir.path().join("second.txt");
        fs::write(&first, "previous").unwrap();
        thread::scope(|scope| {
            let a = scope.spawn(|| store.export(&id, &first));
            let b = scope.spawn(|| store.export(&id, &second));
            a.join().unwrap().unwrap();
            b.join().unwrap().unwrap();
        });
        store.export(&id, &first).unwrap();
        for path in [first, second] {
            assert_eq!(fs::read(path).unwrap(), content.as_bytes());
        }
    }

    #[test]
    fn invalid_destination_preserves_the_target_and_allows_retry() {
        let dir = tempfile::tempdir().unwrap();
        let store = ResultStore::default();
        let id = store
            .insert_text("full result", SnapshotIndex::default())
            .unwrap();
        let target = dir.path().join("directory");
        fs::create_dir(&target).unwrap();
        let existing = target.join("existing.txt");
        fs::write(&existing, "previous").unwrap();
        assert!(store.export(&id, &target).is_err());
        assert_eq!(fs::read(&existing).unwrap(), b"previous");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        store.export(&id, &existing).unwrap();
        assert_eq!(fs::read(existing).unwrap(), b"full result");
    }

    #[test]
    fn memory_snapshots_own_their_bytes_and_readers_start_at_zero() {
        let store = ResultStore::default();
        let mut text = String::from("内容\r\n😀");
        let id = store.insert_text(&text, SnapshotIndex::default()).unwrap();
        text.clear();
        let snapshot = store.lock().unwrap().snapshots[&id].clone();
        assert!(matches!(snapshot.content, Content::Memory(_)));
        store.release(&id).unwrap();
        for _ in 0..2 {
            let value = snapshot
                .content
                .with_reader(|reader| {
                    assert_eq!(reader.stream_position()?, 0);
                    let mut value = String::new();
                    reader.read_to_string(&mut value)?;
                    Ok(value)
                })
                .unwrap();
            assert_eq!(value, "内容\r\n😀");
        }
    }

    #[test]
    fn failed_copy_keeps_existing_file_intact() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("write-only.txt");
        let mut write_only = File::create(source).unwrap();
        write_only.write_all(b"unreadable").unwrap();
        let store = ResultStore::default();
        let id = store
            .insert_file(write_only, SnapshotIndex::default())
            .unwrap();
        let destination = dir.path().join("existing.txt");
        fs::write(&destination, "previous").unwrap();
        assert!(store.export(&id, &destination).is_err());
        assert_eq!(fs::read(destination).unwrap(), b"previous");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
