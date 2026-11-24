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
    let options = |path: &Path| {
        json!({
            "path": path, "includes": "*.ts", "excludes": "", "excludeEmptyDirs": true
        })
    };
    let scan = invoke("get_files", options(dir.path())).unwrap();
    assert_eq!(scan["files"][0]["name"], "code.ts");
    let trim = invoke(
        "trim_source_codes",
        json!({
            "files": [&file], "trimWhitespace": true, "trimNewlines": true, "trimComments": true
        }),
    )
    .unwrap();
    assert_eq!(trim["result"], "let n = 3;\n");
    assert_eq!(trim["processed"], 1);
    assert_eq!(trim["lineCount"], 1);
    assert_eq!(trim["byteCount"], "let n = 3;\n".len());
    assert!(trim["exportId"].is_null());

    let large_file = dir.path().join("large.txt");
    let prefix = "a".repeat(256 * 1024 - 2);
    let complete = format!("{prefix}🌈\r\n结束");
    fs::write(&large_file, &complete).unwrap();
    let large = invoke(
        "trim_source_codes",
        json!({
            "files": [large_file], "trimWhitespace": true, "trimNewlines": true, "trimComments": true
        }),
    )
    .unwrap();
    assert_eq!(large["result"].as_str(), Some(prefix.as_str()));
    assert_eq!(large["lineCount"], 2);
    assert_eq!(large["byteCount"], complete.len());
    let id = large["exportId"].as_str().unwrap();
    let target = dir.path().join("export.txt");
    fs::write(&target, "此前的导出").unwrap();
    let export_args = json!({ "id": id, "path": target });
    invoke("export_trim_result", export_args.clone()).unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), complete);
    invoke("release_trim_result", json!({ "id": id })).unwrap();
    invoke("release_trim_result", json!({ "id": id })).unwrap();
    assert!(invoke("export_trim_result", export_args).is_err());
    assert_eq!(fs::read_to_string(&target).unwrap(), complete);
    let missing = dir.path().join("missing");
    let error = invoke("get_files", options(&missing)).unwrap_err();
    assert!(error.as_str().unwrap().contains("missing"), "{error}");
    let error = invoke("open_directory_in_fs", json!({ "path": &file })).unwrap_err();
    assert!(error.as_str().unwrap().contains("不是目录"), "{error}");
}
