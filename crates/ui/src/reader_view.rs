use gpui::*;
use std::sync::Arc;

use the_reader_document::PdfDoc;
use the_reader_renderer::{
    page_cache::{CachedPage, PageCacheKey},
    DarkModeEngine, PageCache,
};
use the_reader_settings::DarkModeProfile;

use crate::colors::*;

/// The main PDF reader/viewer component
pub struct ReaderView {
    /// The loaded PDF document
    pub document: Arc<PdfDoc>,
    /// Current page index (0-based)
    pub current_page: usize,
    /// Current zoom level (1.0 = 100%)
    pub zoom: f32,
    /// Current dark mode profile
    pub dark_mode: DarkModeProfile,
    /// Page render cache
    pub cache: PageCache,
    /// Scroll offset Y in pixels
    pub scroll_y: f32,
    /// Whether thumbnail sidebar is visible
    pub show_thumbnails: bool,
    /// Whether page has been rendered
    pub page_rendered: bool,
    /// Page dimensions for display
    pub page_width: f32,
    pub page_height: f32,
}

impl ReaderView {
    pub fn new(document: PdfDoc, dark_mode: DarkModeProfile) -> Self {
        // Get page dimensions
        let (page_width, page_height) = document.page_dimensions(0).unwrap_or((612.0, 792.0)); // Default US Letter size

        Self {
            document: Arc::new(document),
            current_page: 0,
            zoom: 1.0,
            dark_mode,
            cache: PageCache::new(20),
            scroll_y: 0.0,
            show_thumbnails: false,
            page_rendered: false,
            page_width,
            page_height,
        }
    }

    /// Navigate to the next page
    pub fn next_page(&mut self) {
        if self.current_page + 1 < self.document.page_count {
            self.current_page += 1;
            self.page_rendered = false;
            self.update_page_dimensions();
        }
    }

    /// Navigate to the previous page
    pub fn prev_page(&mut self) {
        if self.current_page > 0 {
            self.current_page -= 1;
            self.page_rendered = false;
            self.update_page_dimensions();
        }
    }

    /// Jump to a specific page
    pub fn goto_page(&mut self, page: usize) {
        if page < self.document.page_count {
            self.current_page = page;
            self.page_rendered = false;
            self.update_page_dimensions();
        }
    }

    /// Update page dimensions for current page
    fn update_page_dimensions(&mut self) {
        if let Ok((w, h)) = self.document.page_dimensions(self.current_page) {
            self.page_width = w;
            self.page_height = h;
        }
    }

    /// Zoom in
    pub fn zoom_in(&mut self) {
        self.zoom = (self.zoom + 0.1).min(5.0);
        self.cache.clear();
        self.page_rendered = false;
    }

    /// Zoom out
    pub fn zoom_out(&mut self) {
        self.zoom = (self.zoom - 0.1).max(0.25);
        self.cache.clear();
        self.page_rendered = false;
    }

    /// Toggle dark mode profile
    pub fn toggle_dark_mode(&mut self) {
        self.dark_mode = self.dark_mode.next();
        self.cache.clear();
        self.page_rendered = false;
    }

    /// Get the zoom as a percentage
    pub fn zoom_percent(&self) -> u32 {
        (self.zoom * 100.0) as u32
    }

    /// Render the current page and cache the result
    fn ensure_rendered(&mut self) {
        if self.page_rendered {
            return;
        }

        let cache_key = PageCacheKey {
            page_index: self.current_page,
            scale_percent: (self.zoom * 100.0) as u32,
            dark_mode: self.dark_mode as u8,
        };

        // Check cache first
        if self.cache.get(&cache_key).is_some() {
            self.page_rendered = true;
            return;
        }

        // Render the page
        match self.document.render_page(self.current_page, self.zoom) {
            Ok((w, h, mut rgba)) => {
                // Apply dark mode transformation
                DarkModeEngine::apply(&mut rgba, w, h, self.dark_mode);

                // Cache the result
                self.cache.insert(
                    cache_key,
                    CachedPage {
                        width: w,
                        height: h,
                        rgba_data: rgba,
                    },
                );

                self.page_rendered = true;
            }
            Err(e) => {
                log::error!("Failed to render page {}: {:?}", self.current_page, e);
            }
        }
    }

    /// Render the reader view UI
    pub fn render_element(&mut self) -> impl IntoElement {
        // Ensure page is rendered
        self.ensure_rendered();

        // Build the full reader layout
        let mut reader = div().id("reader-view").flex().flex_row().size_full();

        // Thumbnail sidebar
        if self.show_thumbnails {
            reader = reader.child(self.render_thumbnail_sidebar());
        }

        // Main content area
        let display_width = self.page_width * self.zoom;
        let display_height = self.page_height * self.zoom;

        let main_content = div()
            .id("reader-main")
            .flex()
            .flex_col()
            .flex_grow()
            .bg(hex_to_hsla(BG))
            .items_center()
            .justify_start()
            .overflow_scroll()
            .py(px(16.0))
            .child(
                div()
                    .w(px(display_width))
                    .h(px(display_height))
                    .bg(hex_to_hsla(
                        if self.dark_mode == DarkModeProfile::Original {
                            0xFFFFFFFF
                        } else {
                            SURFACE
                        },
                    ))
                    .rounded(px(4.0))
                    .border_1()
                    .border_color(hex_to_hsla(BORDER))
                    .shadow_md()
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px(12.0))
                    .child(
                        div()
                            .text_size(px(14.0))
                            .text_color(hex_to_hsla(TEXT_SECONDARY))
                            .child(format!(
                                "Page {} of {}",
                                self.current_page + 1,
                                self.document.page_count
                            )),
                    )
                    .child(
                        div()
                            .text_size(px(12.0))
                            .text_color(hex_to_hsla(ACCENT))
                            .child(format!("{} mode", self.dark_mode.display_name())),
                    )
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(hex_to_hsla(TEXT_SECONDARY))
                            .child(format!("{:.0}% zoom", self.zoom * 100.0)),
                    ),
            );

        reader = reader.child(main_content);
        reader
    }

    fn render_thumbnail_sidebar(&self) -> impl IntoElement {
        let mut sidebar = div()
            .id("thumbnail-sidebar")
            .flex()
            .flex_col()
            .w(px(160.0))
            .h_full()
            .bg(hex_to_hsla(SURFACE))
            .border_r_1()
            .border_color(hex_to_hsla(BORDER))
            .overflow_y_scroll()
            .py(px(8.0));

        let max_thumbs = self.document.page_count.min(50);
        for i in 0..max_thumbs {
            let is_current = i == self.current_page;
            sidebar = sidebar.child(
                div()
                    .id(("thumb", i as u64))
                    .mx(px(8.0))
                    .mb(px(4.0))
                    .px(px(8.0))
                    .py(px(6.0))
                    .rounded(px(4.0))
                    .bg(hex_to_hsla(if is_current {
                        SURFACE_RAISED
                    } else {
                        SURFACE
                    }))
                    .border_1()
                    .border_color(hex_to_hsla(if is_current { ACCENT } else { BORDER }))
                    .cursor_pointer()
                    .hover(|style| style.bg(hex_to_hsla(SURFACE_HOVER)))
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(hex_to_hsla(if is_current {
                                TEXT_PRIMARY
                            } else {
                                TEXT_SECONDARY
                            }))
                            .child(format!("Page {}", i + 1)),
                    ),
            );
        }

        sidebar
    }
}
