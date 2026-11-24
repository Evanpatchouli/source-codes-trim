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
    let missing = dir.path().join("missing");
    let error = invoke("get_files", options(&missing)).unwrap_err();
    assert!(error.as_str().unwrap().contains("missing"), "{error}");
    let error = invoke("open_directory_in_fs", json!({ "path": &file })).unwrap_err();
    assert!(error.as_str().unwrap().contains("不是目录"), "{error}");
}
