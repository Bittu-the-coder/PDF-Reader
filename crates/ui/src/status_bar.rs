use gpui::*;

use crate::colors::*;

/// Status bar at the bottom of the window
pub struct StatusBar {
    pub current_page: usize,
    pub total_pages: usize,
    pub zoom_percent: u32,
    pub dark_mode_label: String,
}

impl StatusBar {
    pub fn render_element(&self) -> impl IntoElement {
        let page_info = format!("Page {} of {}", self.current_page + 1, self.total_pages);
        let zoom_info = format!("{}%", self.zoom_percent);

        div()
            .id("status-bar")
            .flex()
            .flex_row()
            .w_full()
            .h(px(28.0))
            .bg(hex_to_hsla(SURFACE))
            .border_t_1()
            .border_color(hex_to_hsla(BORDER))
            .items_center()
            .px(px(16.0))
            .child(
                div()
                    .text_size(px(11.0))
                    .text_color(hex_to_hsla(TEXT_SECONDARY))
                    .child(page_info),
            )
            .child(div().flex_grow())
            .child(
                div()
                    .flex()
                    .flex_row()
                    .gap(px(16.0))
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(hex_to_hsla(ACCENT))
                            .child(self.dark_mode_label.clone()),
                    )
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(hex_to_hsla(TEXT_SECONDARY))
                            .child(zoom_info),
                    ),
            )
    }
}
