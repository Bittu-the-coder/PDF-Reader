use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("The Reader").ok();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
