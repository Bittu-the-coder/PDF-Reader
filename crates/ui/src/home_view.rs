use gpui::*;
use std::path::PathBuf;

use crate::colors::*;

/// Home screen shown when no document is open
/// Displays recent files and drag-and-drop area
pub struct HomeView;

impl HomeView {
    pub fn render_element(recent_files: &[PathBuf]) -> impl IntoElement {
        let mut container = div()
            .id("home-view")
            .flex()
            .flex_col()
            .size_full()
            .bg(hex_to_hsla(BG))
            .items_center()
            .justify_center()
            .gap(px(24.0))
            .child(
                // Logo
                div()
                    .text_size(px(48.0))
                    .text_color(hex_to_hsla(ACCENT))
                    .child("◆"),
            )
            .child(
                // App name
                div()
                    .text_size(px(28.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(hex_to_hsla(TEXT_PRIMARY))
                    .child("THE READER"),
            )
            .child(
                // Tagline
                div()
                    .text_size(px(14.0))
                    .text_color(hex_to_hsla(TEXT_SECONDARY))
                    .child("Read without the weight."),
            )
            .child(
                // Drop zone
                div()
                    .mt(px(32.0))
                    .w(px(400.0))
                    .h(px(160.0))
                    .rounded(px(12.0))
                    .border_1()
                    .border_color(hex_to_hsla(BORDER))
                    .bg(hex_to_hsla(SURFACE))
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px(12.0))
                    .child(
                        div()
                            .text_size(px(32.0))
                            .text_color(hex_to_hsla(TEXT_SECONDARY))
                            .child("📄"),
                    )
                    .child(
                        div()
                            .text_size(px(14.0))
                            .text_color(hex_to_hsla(TEXT_SECONDARY))
                            .child("Drop a PDF here or press Ctrl+O to open"),
                    ),
            )
            .child(
                // Keyboard shortcut hints
                div()
                    .mt(px(16.0))
                    .flex()
                    .flex_row()
                    .gap(px(24.0))
                    .child(Self::shortcut_hint("Ctrl+O", "Open file"))
                    .child(Self::shortcut_hint("Ctrl+D", "Dark mode"))
                    .child(Self::shortcut_hint("↑↓", "Navigate")),
            );

        // Recent files section
        if !recent_files.is_empty() {
            let mut recent_col = div()
                .mt(px(24.0))
                .w(px(400.0))
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(hex_to_hsla(TEXT_SECONDARY))
                        .mb(px(4.0))
                        .child("Recent Files"),
                );

            for (idx, path) in recent_files.iter().take(5).enumerate() {
                let file_name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();

                recent_col = recent_col.child(
                    div()
                        .id(("recent", idx as u64))
                        .px(px(12.0))
                        .py(px(8.0))
                        .rounded(px(6.0))
                        .bg(hex_to_hsla(SURFACE))
                        .hover(|style| style.bg(hex_to_hsla(SURFACE_HOVER)))
                        .cursor_pointer()
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap(px(8.0))
                        .child(
                            div()
                                .text_size(px(14.0))
                                .text_color(hex_to_hsla(TEXT_SECONDARY))
                                .child("📄"),
                        )
                        .child(
                            div()
                                .text_size(px(13.0))
                                .text_color(hex_to_hsla(TEXT_PRIMARY))
                                .child(file_name),
                        ),
                );
            }

            container = container.child(recent_col);
        }

        container
    }

    fn shortcut_hint(key: &str, label: &str) -> impl IntoElement {
        div()
            .flex()
            .flex_row()
            .gap(px(6.0))
            .items_center()
            .child(
                div()
                    .px(px(6.0))
                    .py(px(2.0))
                    .rounded(px(4.0))
                    .bg(hex_to_hsla(SURFACE_RAISED))
                    .text_size(px(11.0))
                    .font_family("monospace")
                    .text_color(hex_to_hsla(TEXT_PRIMARY))
                    .child(key.to_string()),
            )
            .child(
                div()
                    .text_size(px(11.0))
                    .text_color(hex_to_hsla(TEXT_SECONDARY))
                    .child(label.to_string()),
            )
    }
}
