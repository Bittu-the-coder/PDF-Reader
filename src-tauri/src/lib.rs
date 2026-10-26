#[cfg(feature = "desktop")]
pub mod commands;
pub mod db;
pub mod error;
pub mod secrets;

#[cfg(feature = "desktop")]
use tauri::Manager;
#[cfg(feature = "desktop")]
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            let db_path = app_dir.join("shelf.db");
            tracing::info!("Initializing SQLite database at: {:?}", db_path);
            let database = db::Database::open(&db_path).expect("failed to initialize database");
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            // Settings
            commands::settings::set_api_key,
            commands::settings::has_api_key,
            commands::settings::clear_api_key,
            commands::settings::get_setting,
            commands::settings::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
