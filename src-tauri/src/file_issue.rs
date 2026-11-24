use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub(crate) struct FileIssue {
    pub path: String,
    pub reason: String,
}

impl FileIssue {
    pub fn new(path: &Path, reason: impl Into<String>) -> Self {
        let path = match path.to_str() {
            Some(text) => text.to_owned(),
            None => format!("{:?}", path.as_os_str()),
        };
        Self {
            path,
            reason: reason.into(),
        }
    }
}
