//! Utopia desktop, Rust side.
//!
//! What lives here on purpose, not in the web layer:
//! - the screen-capture block (`set_content_protection`): Windows `SetWindowDisplayAffinity`
//!   (WDA_EXCLUDEFROMCAPTURE) through Tauri, which blacks the window out in OBS, Game Bar,
//!   Teams, Discord streams and any other software capture;
//! - the sealed indicator (`sealed.rs`): compiled into the .exe rather than shipped as readable JS.

mod sealed;

use tauri::Manager;

#[derive(serde::Serialize)]
struct AppInfo {
    version: &'static str,
    os: &'static str,
    content_protection_supported: bool,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        content_protection_supported: cfg!(any(target_os = "windows", target_os = "macos")),
    }
}

/// Turn the capture block on or off for the main window. Returns the state actually applied.
#[tauri::command]
fn set_content_protection(app: tauri::AppHandle, on: bool) -> Result<bool, String> {
    let win = app.get_webview_window("main").ok_or("main window missing")?;
    win.set_content_protected(on).map_err(|e| e.to_string())?;
    Ok(on)
}

/// The sealed overlay. `bars` are the chart's bars, `ctx` are 1-hour bars covering weeks back
/// (for daily/weekly opens, previous day levels and the HTF candle previews), `tf_sec` the chart timeframe.
#[tauri::command]
fn compute_sealed(
    bars: Vec<sealed::Bar>,
    ctx: Vec<sealed::Bar>,
    tf_sec: i64,
    params: std::collections::HashMap<String, f64>,
) -> sealed::Overlay {
    sealed::compute(&bars, &ctx, tf_sec, &params)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // The vault will force this on; for the chart it is the user's choice (Settings).
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_content_protected(false);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![app_info, set_content_protection, compute_sealed])
        .run(tauri::generate_context!())
        .expect("error while running Utopia");
}
