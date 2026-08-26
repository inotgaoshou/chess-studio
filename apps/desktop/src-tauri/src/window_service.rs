use super::*;

#[tauri::command]
pub(crate) async fn open_compact_floating_panel(
    app: tauri::AppHandle,
    panel: String,
) -> Result<bool, String> {
    let (label, title, width, height, min_width, min_height, position) = match panel.as_str() {
        "engine" => (
            "compact-engine",
            "引擎分析",
            420.0,
            460.0,
            340.0,
            220.0,
            None,
        ),
        "manual" => ("compact-manual", "棋谱", 430.0, 580.0, 360.0, 320.0, None),
        "cloud" => (
            "compact-cloud",
            "云库 / 评估信息",
            520.0,
            640.0,
            360.0,
            320.0,
            None,
        ),
        "link" => (
            "compact-link",
            "连线控制",
            340.0,
            620.0,
            270.0,
            340.0,
            Some((16.0, 88.0)),
        ),
        _ => return Err("未知的浮动面板".into()),
    };
    if let Some(window) = app.get_webview_window(label) {
        if panel == "engine" {
            window
                .set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)))
                .map_err(|error| error.to_string())?;
        }
        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
        window
            .set_resizable(true)
            .map_err(|error| error.to_string())?;
        window
            .set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(
                min_width, min_height,
            ))))
            .map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(false);
    }

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::App(format!("index.html?floatingPanel={panel}").into()),
    )
    .title(format!("Xiangqi Studio · {title}"))
    .inner_size(width, height)
    .min_inner_size(min_width, min_height)
    .resizable(true)
    .decorations(true)
    .always_on_top(true);
    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }
    builder.build().map_err(|error| error.to_string())?;

    Ok(true)
}

#[tauri::command]
pub(crate) fn return_compact_floating_panel(
    app: tauri::AppHandle,
    panel: String,
) -> Result<bool, String> {
    let label = match panel.as_str() {
        "engine" => "compact-engine",
        "manual" => "compact-manual",
        "cloud" => "compact-cloud",
        "link" => "compact-link",
        _ => return Err("未知的浮动面板".into()),
    };

    app.emit(
        "compact-panel-return",
        serde_json::json!({ "panel": panel }),
    )
    .map_err(|error| error.to_string())?;

    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }

    if let Some(window) = app.get_webview_window(label) {
        window.destroy().map_err(|error| error.to_string())?;
        return Ok(true);
    }
    Ok(false)
}
