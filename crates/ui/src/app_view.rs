use gpui::*;
use std::path::PathBuf;

use the_reader_document::PdfDoc;
use the_reader_settings::AppConfig;

use crate::colors::*;
use crate::home_view::HomeView;
use crate::reader_view::ReaderView;
use crate::status_bar::StatusBar;
use crate::title_bar::TitleBar;

/// The root application view
pub struct AppView {
    /// Current state of the app
    pub state: AppState,
    /// Application configuration
    pub config: AppConfig,
}

pub enum AppState {
    /// Home screen, no document open
    Home,
    /// Viewing a PDF document
    Reading(ReaderView),
}

impl AppView {
    pub fn new(config: AppConfig) -> Self {
        Self {
            state: AppState::Home,
            config,
        }
    }

    /// Open a PDF file
    pub fn open_file(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        match PdfDoc::open(&path) {
            Ok(doc) => {
                log::info!("Opened '{}' — {} pages", doc.title, doc.page_count);
                self.config.add_recent_file(path);
                let _ = self.config.save();
                let reader = ReaderView::new(doc, self.config.dark_mode);
                self.state = AppState::Reading(reader);
                cx.notify();
            }
            Err(e) => {
                log::error!("Failed to open PDF: {:?}", e);
            }
        }
    }

    /// Trigger file open dialog
    pub fn open_file_dialog(&mut self, cx: &mut Context<Self>) {
        let paths = rfd::FileDialog::new()
            .add_filter("PDF Files", &["pdf"])
            .pick_files();

        if let Some(paths) = paths {
            if let Some(path) = paths.into_iter().next() {
                self.open_file(path, cx);
            }
        }
    }
}

impl Render for AppView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let title = match &self.state {
            AppState::Home => "The Reader".to_string(),
            AppState::Reading(reader) => reader.document.title.clone(),
        };

        let title_bar = TitleBar::new(&title);

        let mut root = div()
            .id("app-root")
            .flex()
            .flex_col()
            .size_full()
            .bg(hex_to_hsla(BG))
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _window, cx| {
                let key_str = format!("{}", event.keystroke.key);
                let ctrl = event.keystroke.modifiers.control;
                let shift = event.keystroke.modifiers.shift;

                match key_str.as_str() {
                    // Ctrl+O — Open file
                    "o" if ctrl => {
                        this.open_file_dialog(cx);
                    }
                    // Ctrl+D — Toggle dark mode
                    "d" if ctrl => {
                        if let AppState::Reading(ref mut reader) = this.state {
                            reader.toggle_dark_mode();
                            this.config.dark_mode = reader.dark_mode;
                            let _ = this.config.save();
                            cx.notify();
                        }
                    }
                    // Ctrl+= or Ctrl++ — Zoom in
                    "=" if ctrl => {
                        if let AppState::Reading(ref mut reader) = this.state {
                            reader.zoom_in();
                            cx.notify();
                        }
                    }
                    // Ctrl+- — Zoom out
                    "-" if ctrl => {
                        if let AppState::Reading(ref mut reader) = this.state {
                            reader.zoom_out();
                            cx.notify();
                        }
                    }
                    // Ctrl+T — Toggle thumbnails
                    "t" if ctrl => {
                        if let AppState::Reading(ref mut reader) = this.state {
                            reader.show_thumbnails = !reader.show_thumbnails;
                            cx.notify();
                        }
                    }
                    // Page navigation
                    "right" | "down" | "space" if !ctrl => {
                        if let AppState::Reading(ref mut reader) = this.state {
                            reader.next_page();
                            cx.notify();
                        }
                    }
                    "left" | "up" if !ctrl => {
                        if let AppState::Reading(ref mut reader) = this.state {
                            reader.prev_page();
                            cx.notify();
                        }
                    }
                    "home" if !shift => {
                        if let AppState::Reading(ref mut reader) = this.state {
                            reader.goto_page(0);
                            cx.notify();
                        }
                    }
                    "end" if !shift => {
                        if let AppState::Reading(ref mut reader) = this.state {
                            reader.goto_page(reader.document.page_count.saturating_sub(1));
                            cx.notify();
                        }
                    }
                    "pageup" => {
                        if let AppState::Reading(ref mut reader) = this.state {
                            reader.prev_page();
                            cx.notify();
                        }
                    }
                    "pagedown" => {
                        if let AppState::Reading(ref mut reader) = this.state {
                            reader.next_page();
                            cx.notify();
                        }
                    }
                    _ => {}
                }
            }));

        // Title bar
        root = root.child(title_bar.render_element());

        // Main content area
        match &self.state {
            AppState::Home => {
                root = root.child(HomeView::render_element(&self.config.recent_files));
            }
            AppState::Reading(reader) => {
                root = root.child(reader.render_element());

                // Status bar (only in reader mode)
                let status = StatusBar {
                    current_page: reader.current_page,
                    total_pages: reader.document.page_count,
                    zoom_percent: reader.zoom_percent(),
                    dark_mode_label: reader.dark_mode.display_name().to_string(),
                };
                root = root.child(status.render_element());
            }
        }

        root
    }
}
