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
    let trim_files =
        |files: &[&Path]| {
            invoke("trim_source_codes", json!({
            "files": files, "trimWhitespace": true, "trimNewlines": true, "trimComments": true
        })).unwrap()
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
        assert_eq!(fs::read(&target).unwrap(), expected);
    };
    let trim = trim_files(&[&moved_first, &file]);
    let ordered = "init();\nlet n = 3;\n";
    assert_eq!(trim["result"], ordered);
    assert_eq!(trim["processed"], 2);
    assert_eq!(trim["lineCount"], 2);
    assert_eq!(trim["byteCount"], ordered.len());
    assert_eq!(trim["truncated"], false);
    check_export(&trim, ordered.as_bytes());

    let empty_file = dir.path().join("empty.txt");
    fs::write(&empty_file, []).unwrap();
    let empty = trim_files(&[&empty_file]);
    assert_eq!(empty["result"], "");
    assert_eq!(empty["processed"], 1);
    assert_eq!(empty["lineCount"], 0);
    assert_eq!(empty["byteCount"], 0);
    assert_eq!(empty["truncated"], false);
    check_export(&empty, b"");

    let large_file = dir.path().join("large.txt");
    let prefix = "a".repeat(256 * 1024 - 2);
    let complete = format!("{prefix}🌈\r\n结束");
    fs::write(&large_file, &complete).unwrap();
    let large = trim_files(&[&large_file]);
    assert_eq!(large["result"].as_str(), Some(prefix.as_str()));
    assert_eq!(large["lineCount"], 2);
    assert_eq!(large["byteCount"], complete.len());
    assert_eq!(large["truncated"], true);
    check_export(&large, complete.as_bytes());
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
