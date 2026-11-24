use std::{fs, io::Write, path::Path};

const SUFFIX: &str = ".sctplan";

pub(crate) fn is_plan_path(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("sctplan"))
        || path
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case(SUFFIX))
}

fn check_extension(path: &Path) -> Result<(), String> {
    if is_plan_path(path) {
        Ok(())
    } else {
        Err(format!(
            "方案文件必须使用 {SUFFIX} 后缀：{}",
            path.display()
        ))
    }
}

pub(crate) fn read(path: &Path) -> Result<String, String> {
    check_extension(path)?;
    fs::read_to_string(path)
        .map_err(|error| format!("无法读取方案文件「{}」：{error}", path.display()))
}

pub(crate) fn write(path: &Path, content: &str) -> Result<(), String> {
    check_extension(path)?;
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    // 暂存文件也使用方案后缀，保存期间不会被正在运行的源码扫描收录。
    let mut staging = tempfile::Builder::new()
        .suffix(SUFFIX)
        .tempfile_in(parent)
        .map_err(|error| format!("无法在「{}」暂存方案：{error}", parent.display()))?;
    staging
        .write_all(content.as_bytes())
        .and_then(|()| staging.as_file().sync_all())
        .map_err(|error| format!("无法写入方案文件「{}」：{error}", path.display()))?;
    staging
        .persist(path)
        .map_err(|error| format!("无法保存方案文件「{}」：{}", path.display(), error.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_utf8_and_failed_replacement_report_the_path_and_leave_no_staging_files() {
        let dir = tempfile::tempdir().unwrap();
        let invalid = dir.path().join("invalid.sctplan");
        fs::write(&invalid, [0xff]).unwrap();
        assert!(read(&invalid).unwrap_err().contains("invalid.sctplan"));

        let occupied = dir.path().join("occupied.sctplan");
        fs::create_dir(&occupied).unwrap();
        fs::write(occupied.join("original.txt"), "original").unwrap();
        assert!(write(&occupied, "replacement")
            .unwrap_err()
            .contains("occupied.sctplan"));
        assert_eq!(
            fs::read_to_string(occupied.join("original.txt")).unwrap(),
            "original"
        );
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }

    #[cfg(windows)]
    #[test]
    fn failed_overwrite_of_locked_plan_keeps_original_and_allows_retry() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("locked.SCTPLAN");
        write(&path, "original").unwrap();
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        assert!(write(&path, "new").is_err());
        drop(lock);
        assert_eq!(read(&path).unwrap(), "original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        write(&path, "new").unwrap();
        assert_eq!(read(&path).unwrap(), "new");
    }
}
