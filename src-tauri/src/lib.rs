pub mod ai;
#[cfg(feature = "desktop")]
pub mod commands;
pub mod db;
pub mod error;
pub mod secrets;

#[cfg(feature = "desktop")]
use tauri::{Emitter, Manager};
#[cfg(feature = "desktop")]
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[cfg(feature = "desktop")]
#[derive(Clone)]
pub struct LaunchFileState(pub std::sync::Arc<std::sync::Mutex<Option<String>>>);

#[cfg(feature = "desktop")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "shelf=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Check initial launch argument from CLI (e.g. shelf /path/to/doc.pdf or Open With)
    let initial_file = std::env::args().skip(1).find(|arg| {
        !arg.starts_with('-') && (arg.to_lowercase().ends_with(".pdf") || std::path::Path::new(arg).is_file())
    });
    let launch_state = LaunchFileState(std::sync::Arc::new(std::sync::Mutex::new(initial_file)));
    let launch_state_clone = launch_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(move |app, argv, _cwd| {
            let pdf_arg = argv.into_iter().skip(1).find(|arg| {
                !arg.starts_with('-') && (arg.to_lowercase().ends_with(".pdf") || std::path::Path::new(arg).is_file())
            });
            if let Some(path) = pdf_arg {
                if let Ok(mut lock) = launch_state_clone.0.lock() {
                    *lock = Some(path.clone());
                }
                let _ = app.emit("open-pdf-file", path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(move |app| {
            app.manage(launch_state);
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            secrets::init_fallback_dir(app_dir.clone());
            let db_path = app_dir.join("shelf.db");
            tracing::info!("Initializing SQLite database at: {:?}", db_path);
            let database = db::Database::open(&db_path).expect("failed to initialize database");
            app.manage(database);
            #[cfg(target_os = "linux")]
            route_touchpad_pinch(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library::get_launch_file,
            // Library
            commands::library::add_book,
            commands::library::list_books,
            commands::library::get_book,
            commands::library::delete_book,
            commands::library::save_progress,
            commands::library::update_book_details,
            commands::library::move_book,
            commands::library::get_book_cover,
            commands::library::read_pdf_bytes,
            commands::library::save_imported_pdf,
            commands::library::create_shelf,
            commands::library::list_shelves,
            commands::library::rename_shelf,
            commands::library::delete_shelf,
            // Chapters
            commands::chapters::import_outline,
            commands::chapters::list_chapters,
            commands::chapters::create_chapter,
            commands::chapters::update_chapter,
            commands::chapters::delete_chapter,
            // Words
            commands::words::add_word,
            commands::words::list_words,
            commands::words::find_word,
            commands::words::update_word,
            commands::words::delete_word,
            // Notes
            commands::notes::add_note,
            commands::notes::list_notes,
            commands::notes::update_note,
            commands::notes::delete_note,
            // Highlights
            commands::highlights::add_highlight,
            commands::highlights::list_highlights,
            commands::highlights::delete_highlight,
            commands::highlights::update_highlight_color,
            // Bookmarks, review & reading time
            commands::reading::list_bookmarks,
            commands::reading::add_bookmark,
            commands::reading::delete_bookmark,
            commands::reading::list_due_cards,
            commands::reading::count_due_cards,
            commands::reading::review_card,
            commands::reading::log_reading,
            commands::reading::reading_stats,
            // Settings
            commands::settings::set_api_key,
            commands::settings::has_api_key,
            commands::settings::clear_api_key,
            commands::settings::get_setting,
            commands::settings::set_setting,
            // AI & Window
            commands::ai::lookup_word,
            commands::ai::explain_passage,
            commands::ai::chat_word_inquiry,
            commands::ai::toggle_fullscreen,
            commands::ai::set_fullscreen,
            commands::ai::test_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// WebKitGTK turns a touchpad pinch into zoom of the whole web view, which
/// scales the entire app UI. Swallow the gesture before WebKit sees it and
/// forward it to the frontend, which zooms only the PDF.
/// Payload: (phase, scale) with phase 0 = begin, 1 = update, 2 = end, 3 = cancel
/// and `scale` relative to the start of the gesture.
#[cfg(target_os = "linux")]
fn route_touchpad_pinch(app: &tauri::App) {
    use gtk::gdk;
    use gtk::glib;
    use gtk::prelude::*;

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let handle = app.handle().clone();
    let result = window.with_webview(move |platform| {
        platform.inner().connect_event(move |_, event| {
            if event.event_type() != gdk::EventType::TouchpadPinch {
                return glib::Propagation::Proceed;
            }
            if let Some(pinch) = event.downcast_ref::<gdk::EventTouchpadPinch>() {
                let raw = pinch.as_ref();
                let _ = handle.emit("touchpad-pinch", (raw.phase as i32, raw.scale));
            }
            glib::Propagation::Stop
        });
    });
    if let Err(e) = result {
        tracing::warn!("Could not hook touchpad pinch: {e}");
    }
}
