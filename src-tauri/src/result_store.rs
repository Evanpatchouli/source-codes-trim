use std::{
    collections::HashMap,
    fs::File,
    io::{self, Cursor, Read, Seek},
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};
use tempfile::NamedTempFile;

trait ReadSeek: Read + Seek {}
impl<T: Read + Seek> ReadSeek for T {}

enum Snapshot {
    Memory(Box<[u8]>),
    Disk(Mutex<File>),
}

impl Snapshot {
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

    fn insert(&self, snapshot: Snapshot) -> Result<String, String> {
        let mut results = self.lock()?;
        results.next_id = results.next_id.checked_add(1).ok_or("整理结果编号已用尽")?;
        let id = results.next_id.to_string();
        results.snapshots.insert(id.clone(), Arc::new(snapshot));
        Ok(id)
    }

    pub(crate) fn insert_file(&self, file: File) -> Result<String, String> {
        self.insert(Snapshot::Disk(Mutex::new(file)))
    }

    pub(crate) fn insert_text(&self, text: &str) -> Result<String, String> {
        self.insert(Snapshot::Memory(text.as_bytes().into()))
    }

    pub(crate) fn release(&self, id: &str) -> Result<(), String> {
        let snapshot = self.lock()?.snapshots.remove(id);
        drop(snapshot);
        Ok(())
    }

    pub(crate) fn export(&self, id: &str, destination: &Path) -> Result<(), String> {
        // 导出持有自己的引用，界面释放或替换结果时仍能完成写入。
        let snapshot = self
            .lock()?
            .snapshots
            .get(id)
            .cloned()
            .ok_or("整理结果已释放")?;
        let parent = destination.parent().ok_or("请选择导出文件")?;
        let parent = if parent.as_os_str().is_empty() {
            Path::new(".")
        } else {
            parent
        };
        let mut staging = NamedTempFile::new_in(parent)
            .map_err(|error| format!("无法在导出目录创建临时文件：{error}"))?;
        snapshot
            .with_reader(|reader| io::copy(reader, staging.as_file_mut()))
            .map_err(|error| format!("复制整理结果失败：{error}"))?;
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
        store.insert_file(file).unwrap()
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
        let id = store.insert_text("full result").unwrap();
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
        let id = store.insert_text(&text).unwrap();
        text.clear();
        let snapshot = store.lock().unwrap().snapshots[&id].clone();
        assert!(matches!(*snapshot, Snapshot::Memory(_)));
        store.release(&id).unwrap();
        for _ in 0..2 {
            let value = snapshot
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
        let id = store.insert_file(write_only).unwrap();
        let destination = dir.path().join("existing.txt");
        fs::write(&destination, "previous").unwrap();
        assert!(store.export(&id, &destination).is_err());
        assert_eq!(fs::read(destination).unwrap(), b"previous");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
