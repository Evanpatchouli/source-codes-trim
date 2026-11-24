use serde_json::{json, Value};
use std::{fs, path::Path};
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY},
    webview::InvokeRequest,
};

#[test]
fn registered_ipc_accepts_frontend_arguments_and_rejects_failures() {
    let app = source_codes_trim_lib::register_commands(mock_builder())
        .build(mock_context(noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |cmd: &str, args: Value| {
        get_ipc_response(
            &window,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.into(),
            },
        )
        .map(|body| body.deserialize::<Value>().unwrap())
    };
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("code.ts");
    fs::write(&file, "let n = 3; // note\n").unwrap();
    let moved_first = dir.path().join("z-first.ts");
    fs::write(&moved_first, "init(); // moved to top").unwrap();
    let options = |path: &Path| {
        json!({
            "path": path, "includes": "*.ts", "excludes": "", "excludeEmptyDirs": true
        })
    };
    let scan = invoke("get_files", options(dir.path())).unwrap();
    assert_eq!(scan["files"][0]["name"], "code.ts");
    let trim_files = |files: &[&Path]| {
        let args = json!({
            "files": files, "trimWhitespace": true, "trimNewlines": true, "trimComments": true
        });
        invoke("trim_source_codes", args).unwrap()
    };
    let preview = |report: &Value, index: usize, offset: u64| {
        invoke(
            "read_trim_file",
            json!({ "id": report["exportId"], "index": index, "offset": offset }),
        )
    };
    let target = dir.path().join("export.txt");
    let check_export = |report: &Value, expected: &[u8]| {
        let id = report["exportId"].as_str().expect("成功整理后应有导出 ID");
        assert!(!id.is_empty());
        fs::write(&target, "此前的导出").unwrap();
        let args = json!({ "id": id, "path": target });
        invoke("export_trim_result", args.clone()).unwrap();
        assert_eq!(fs::read(&target).unwrap(), expected);
        invoke("release_trim_result", json!({ "id": id })).unwrap();
        invoke("release_trim_result", json!({ "id": id })).unwrap();
        assert!(invoke("export_trim_result", args).is_err());
        assert!(preview(report, 0, 0).is_err());
        assert_eq!(fs::read(&target).unwrap(), expected);
    };
    let trim = trim_files(&[&moved_first, &file]);
    let ordered = "init();\nlet n = 3;\n";
    assert_eq!(trim["result"], ordered);
    assert_eq!(trim["processed"], 2);
    assert_eq!(trim["lineCount"], 2);
    assert_eq!(trim["byteCount"], ordered.len());
    assert_eq!(trim["truncated"], false);
    assert_eq!(
        trim["fileRanges"],
        json!([
            { "path": &moved_first, "startLine": 1, "endLine": 1, "byteCount": "init();".len() },
            { "path": &file, "startLine": 2, "endLine": 2, "byteCount": "let n = 3;\n".len() }
        ])
    );
    fs::write(&moved_first, "changed after trimming").unwrap();
    assert_eq!(
        preview(&trim, 0, 0).unwrap(),
        json!({ "text": "init();", "nextOffset": null })
    );
    assert_eq!(
        preview(&trim, 1, 0).unwrap(),
        json!({ "text": "let n = 3;\n", "nextOffset": null })
    );
    assert!(preview(&trim, 2, 0).is_err());
    check_export(&trim, ordered.as_bytes());

    let empty_file = dir.path().join("empty.txt");
    fs::write(&empty_file, []).unwrap();
    let absent = dir.path().join("absent.txt");
    let empty = trim_files(&[&absent, &empty_file]);
    assert_eq!(empty["result"], "");
    assert_eq!(empty["processed"], 1);
    assert_eq!(empty["lineCount"], 0);
    assert_eq!(empty["byteCount"], 0);
    assert_eq!(empty["truncated"], false);
    assert_eq!(empty["skipped"][0]["path"], json!(&absent));
    assert_eq!(
        empty["fileRanges"],
        json!([{
            "path": &empty_file, "startLine": null, "endLine": null, "byteCount": 0
        }])
    );
    assert_eq!(
        preview(&empty, 0, 0).unwrap(),
        json!({ "text": "", "nextOffset": null })
    );
    assert!(preview(&empty, 0, 1).is_err());
    check_export(&empty, b"");

    let large_file = dir.path().join("large.txt");
    let prefix = "a".repeat(256 * 1024 - 2);
    let complete = format!("{prefix}🌈\r\n结束");
    fs::write(&large_file, &complete).unwrap();
    let late_file = dir.path().join("tail.txt");
    let tail = "预览之外\r\n";
    fs::write(&late_file, tail).unwrap();
    let large = trim_files(&[&large_file, &late_file]);
    let combined = format!("{complete}\n{tail}");
    assert_eq!(large["result"].as_str(), Some(prefix.as_str()));
    assert_eq!(large["lineCount"], 3);
    assert_eq!(large["byteCount"], combined.len());
    assert_eq!(large["truncated"], true);
    assert_eq!(
        large["fileRanges"],
        json!([
            { "path": &large_file, "startLine": 1, "endLine": 2, "byteCount": complete.len() },
            { "path": &late_file, "startLine": 3, "endLine": 3, "byteCount": tail.len() }
        ])
    );
    let first_page = preview(&large, 0, 0).unwrap();
    let next_offset = first_page["nextOffset"].as_u64().unwrap();
    assert_eq!(next_offset, 64 * 1024);
    assert_eq!(
        first_page["text"].as_str().unwrap(),
        &complete[..next_offset as usize]
    );
    assert_eq!(
        preview(&large, 0, prefix.len() as u64).unwrap(),
        json!({ "text": "🌈\r\n结束", "nextOffset": null })
    );
    assert!(preview(&large, 0, prefix.len() as u64 + 1).is_err());
    fs::remove_file(&late_file).unwrap();
    assert_eq!(
        preview(&large, 1, 0).unwrap(),
        json!({ "text": tail, "nextOffset": null })
    );
    assert_eq!(
        preview(&large, 1, tail.len() as u64).unwrap(),
        json!({ "text": "", "nextOffset": null })
    );
    assert!(preview(&large, 1, tail.len() as u64 + 1).is_err());
    check_export(&large, combined.as_bytes());
    let missing = dir.path().join("missing");
    let error = invoke("get_files", options(&missing)).unwrap_err();
    assert!(error.as_str().unwrap().contains("missing"), "{error}");
    let error = invoke("open_directory_in_fs", json!({ "path": &file })).unwrap_err();
    assert!(error.as_str().unwrap().contains("不是目录"), "{error}");

    let plan = dir.path().join("工作方案.SCTPLAN");
    let text = "{\n  \"title\": \"项目🌳\"\n}\n";
    fs::write(&plan, "previous").unwrap();
    let saved = invoke(
        "write_source_plan",
        json!({ "path": &plan, "content": text }),
    )
    .unwrap();
    assert!(saved.is_null());
    assert_eq!(
        invoke("read_source_plan", json!({ "path": &plan })).unwrap(),
        json!(text)
    );
    assert!(invoke("write_source_plan", json!({ "path": null, "content": "" })).is_err());
    assert_eq!(fs::read_to_string(&plan).unwrap(), text);
    for cmd in ["read_source_plan", "write_source_plan"] {
        let error = invoke(cmd, json!({ "path": &file, "content": "overwrite" })).unwrap_err();
        assert!(error.as_str().unwrap().contains(".sctplan"), "{error}");
    }
    assert_eq!(fs::read_to_string(&file).unwrap(), "let n = 3; // note\n");
}
