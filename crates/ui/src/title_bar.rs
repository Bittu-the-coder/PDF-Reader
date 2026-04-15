use gpui::*;

use crate::colors::*;

/// Custom title bar with minimal controls
pub struct TitleBar {
    pub title: String,
}

impl TitleBar {
    pub fn new(title: impl Into<String>) -> Self {
        Self {
            title: title.into(),
        }
    }

    pub fn render_element(&self) -> impl IntoElement {
        div()
            .id("title-bar")
            .flex()
            .flex_row()
            .w_full()
            .h(px(40.0))
            .bg(hex_to_hsla(SURFACE))
            .border_b_1()
            .border_color(hex_to_hsla(BORDER))
            .items_center()
            .px(px(16.0))
            .child(
                // App logo / name
                div()
                    .flex()
                    .flex_row()
                    .gap(px(8.0))
                    .items_center()
                    .child(
                        div()
                            .text_size(px(14.0))
                            .text_color(hex_to_hsla(ACCENT))
                            .child("◆"),
                    )
                    .child(
                        div()
                            .text_size(px(13.0))
                            .text_color(hex_to_hsla(TEXT_SECONDARY))
                            .child("THE READER"),
                    ),
            )
            .child(
                // Spacer
                div().flex_grow(),
            )
            .child(
                // Document title
                div()
                    .text_size(px(13.0))
                    .text_color(hex_to_hsla(TEXT_PRIMARY))
                    .child(self.title.clone()),
            )
            .child(div().flex_grow())
    }
}
