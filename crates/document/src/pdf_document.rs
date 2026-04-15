use anyhow::Result;
use pdfium_render::prelude::*;
use std::path::{Path, PathBuf};

/// Represents a loaded PDF document
pub struct PdfDoc {
    /// The file path of the document
    pub path: PathBuf,
    /// Total number of pages
    pub page_count: usize,
    /// The raw bytes of the PDF (kept in memory for pdfium operations)
    pub bytes: Vec<u8>,
    /// Document title extracted from metadata, or filename
    pub title: String,
}

impl PdfDoc {
    /// Open a PDF document from file
    pub fn open(path: &Path) -> Result<Self> {
        let bytes = std::fs::read(path)?;
        let title = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string();

        // Use pdfium to get page count and metadata
        // Scope the pdfium usage so the borrow on `bytes` is released
        let (page_count, doc_title) = {
            let pdfium = Pdfium::default();
            let document = pdfium.load_pdf_from_byte_slice(&bytes, None)?;
            let page_count = document.pages().len() as usize;

            // Try to extract real title from metadata
            let metadata_title = document.metadata().get(PdfDocumentMetadataTagType::Title);

            let doc_title = match metadata_title {
                Some(tag) => {
                    let tag_str = tag.value().to_string();
                    if tag_str.is_empty() {
                        title.clone()
                    } else {
                        tag_str
                    }
                }
                None => title.clone(),
            };

            (page_count, doc_title)
        };

        Ok(Self {
            path: path.to_path_buf(),
            page_count,
            bytes,
            title: doc_title,
        })
    }

    /// Render a specific page to an RGBA image buffer
    /// Returns (width, height, rgba_bytes)
    pub fn render_page(&self, page_index: usize, scale: f32) -> Result<(u32, u32, Vec<u8>)> {
        let pdfium = Pdfium::default();
        let document = pdfium.load_pdf_from_byte_slice(&self.bytes, None)?;
        let pages = document.pages();
        let page = pages.get(page_index as i32)?;

        let width = (page.width().value * scale) as u32;
        let height = (page.height().value * scale) as u32;

        let bitmap = page.render_with_config(
            &PdfRenderConfig::new()
                .set_target_width(width as i32)
                .set_target_height(height as i32)
                .render_form_data(true)
                .render_annotations(true),
        )?;

        let img = bitmap.as_image()?;
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();

        Ok((w, h, rgba.into_raw()))
    }

    /// Get page dimensions (width, height) in points for a given page index
    pub fn page_dimensions(&self, page_index: usize) -> Result<(f32, f32)> {
        let pdfium = Pdfium::default();
        let document = pdfium.load_pdf_from_byte_slice(&self.bytes, None)?;
        let pages = document.pages();
        let page = pages.get(page_index as i32)?;
        Ok((page.width().value, page.height().value))
    }

    /// Search for text within the document
    /// Returns a list of (page_index, occurrences_count)
    pub fn search_text(&self, query: &str) -> Result<Vec<(usize, usize)>> {
        let pdfium = Pdfium::default();
        let document = pdfium.load_pdf_from_byte_slice(&self.bytes, None)?;
        let mut results = Vec::new();

        for (idx, page) in document.pages().iter().enumerate() {
            let text = page.text()?.all();
            let count = text.to_lowercase().matches(&query.to_lowercase()).count();
            if count > 0 {
                results.push((idx, count));
            }
        }

        Ok(results)
    }

    /// Extract all text from a specific page
    pub fn page_text(&self, page_index: usize) -> Result<String> {
        let pdfium = Pdfium::default();
        let document = pdfium.load_pdf_from_byte_slice(&self.bytes, None)?;
        let pages = document.pages();
        let page = pages.get(page_index as i32)?;
        let text = page.text()?.all();
        Ok(text)
    }

    /// Get the table of contents / bookmarks
    pub fn bookmarks(&self) -> Result<Vec<BookmarkEntry>> {
        let pdfium = Pdfium::default();
        let document = pdfium.load_pdf_from_byte_slice(&self.bytes, None)?;
        let mut entries = Vec::new();

        fn collect_bookmarks(
            bookmark_iter: &PdfBookmarks,
            entries: &mut Vec<BookmarkEntry>,
            depth: usize,
        ) {
            for bookmark in bookmark_iter.iter() {
                let title = bookmark.title().unwrap_or_default();
                let destination = bookmark.destination();
                let page_index = destination
                    .and_then(|d| d.page_index().ok())
                    .map(|i| i as usize);

                entries.push(BookmarkEntry {
                    title,
                    page_index,
                    depth,
                });

                // Note: PdfBookmark doesn't have children() method directly.
                // In pdfium-render, bookmark hierarchy is already flattened in the iterator.
                // We rely on depth tracking for hierarchy.
            }
        }

        collect_bookmarks(&document.bookmarks(), &mut entries, 0);
        Ok(entries)
    }
}

/// A bookmark / table of contents entry
#[derive(Debug, Clone)]
pub struct BookmarkEntry {
    pub title: String,
    pub page_index: Option<usize>,
    pub depth: usize,
}
