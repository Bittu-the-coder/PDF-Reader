# — PDF Reader for Windows
### Built with Rust + GPUI | Dark Mode First | Ultra-Low RAM

---

## Name & Identity

**App Name:**
**Tagline:** "Read without the weight."
**Why this name:** PDFs are heavy, bloated, and slow everywhere else. defies that — it's fast, light, and floats above the usual garbage. The name also fits the premium dark aesthetic (space, void, depth).

---

## What We Are Building

A native Windows PDF reader written in Rust using the GPUI framework (from Zed editor). The primary goals are:

- True dark mode for ALL types of PDFs (text, scanned, image-based, mixed)
- Extremely low RAM usage compared to Adobe, Foxit, or browser-based readers
- A premium, aesthetic dark UI that feels like a professional creative tool
- Fast rendering and snappy interactions
- Core features a power user actually needs — nothing more, nothing bloat

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Language | Rust | Memory safety, zero-cost abstractions, low RAM |
| UI Framework | GPUI (Zed's framework) | GPU-accelerated, native, ultra-fast |
| PDF Rendering | pdfium-render (Rust bindings to PDFium) | Industry-grade rendering, handles all PDF types |
| PDF Parsing | lopdf / pdf-rs | Lightweight text extraction, metadata, outline |
| Dark Mode Engine | Custom inversion + color matrix pipeline | True dark conversion, not just CSS tricks |
| Image Handling | image crate | For scanned/image-only PDFs |
| OCR (optional v2) | tesseract-rs | For fully scanned PDFs with no text layer |
| Config/State | serde + toml | Lightweight config persistence |
| Search Index | tantivy (optional) | Fast full-text search inside PDFs |

---

## Phase Plan

### Phase 0 — Foundation (Week 1-2)

- Set up Rust project structure with Cargo workspace
- Integrate GPUI as the UI layer
- Integrate pdfium-render for PDF loading and page rendering
- Render a basic PDF page to screen (no UI polish yet)
- Confirm RAM baseline is under 50MB for a typical document

### Phase 1 — Core Reader (Week 3-4)

- Single document open and render
- Page navigation (next, previous, jump to page)
- Zoom in/out and fit-to-width / fit-to-page
- Scroll through pages continuously (infinite scroll style)
- Keyboard shortcuts for all navigation
- Window resize handled gracefully
- Page caching: pre-render adjacent pages in background thread

### Phase 2 — Dark Mode Engine (Week 5-6)

This is the core differentiator. Most readers fake dark mode. handles every case:

**Case 1: Text-based PDFs**
- Invert background to dark (#0F0F0F or #141414)
- Remap text colors: black text → near-white (#E8E8E8), colored text → adjusted for dark background contrast
- Preserve images inside the PDF without inverting them (images get smart detection)

**Case 2: Image-only / Scanned PDFs**
- Apply a luminance-aware inversion (not simple RGB invert which looks terrible)
- Use a "Smart Dark" filter: analyze average brightness, apply gamma correction, boost contrast
- Option to toggle between "Smart Dark" and "Original" per document

**Case 3: Mixed PDFs (text + images + diagrams)**
- Separate text layer from image layer
- Apply dark theme to text/background layer
- Apply smart filter to images independently
- Blend back together for final render

**Case 4: PDFs with colored backgrounds (e.g., yellow, beige, cream)**
- Detect background color automatically
- Remap it to a dark equivalent (not just invert — remap to the dark palette)

**Dark Mode Settings:**
- Dark (default) — full dark background, adjusted text
- Sepia Dark — warm dark tone, easy on eyes for long reading
- High Contrast — pure black bg, pure white text, max accessibility
- Original — no processing, as-is rendering

### Phase 3 — Navigation & UX (Week 7-8)

- Thumbnail sidebar panel (collapsible)
- Document outline / bookmarks panel (from PDF table of contents)
- Search within document (text search, highlighted results)
- "Jump to page" input in header bar
- Recent files list on home screen
- Drag-and-drop to open file
- Open with from Windows right-click context menu (installer registers this)

### Phase 4 — Annotations (Week 9-10)

- Highlight text (multiple highlight colors)
- Add sticky notes / text comments
- Underline and strikethrough text
- Free draw / pen annotation layer
- Save annotations back into the PDF file
- Export annotations as a separate summary

### Phase 5 — Power Features (Week 11-12)

- Multi-tab support (open multiple PDFs in tabs)
- Split view (two PDFs side by side)
- Presentation mode (full-screen, clean, no UI)
- Print support via Windows print API
- Copy text from PDF to clipboard
- Copy image region from PDF to clipboard
- Password-protected PDF support
- Rotate pages (and save rotation)

### Phase 6 — Performance Hardening (Week 13-14)

- Memory profiling — target under 80MB for a 200-page document
- Async page rendering pipeline (never block the UI thread)
- Render cache with LRU eviction
- Fast open time — target under 500ms for most documents
- Large file stress testing (500+ page PDFs, 100MB+ files)

### Phase 7 — Polish & Release (Week 15-16)

- Installer using NSIS or WiX (Windows-native)
- Auto-updater
- Settings panel (theme, default zoom, font rendering, shortcuts)
- Onboarding screen for first launch
- App icon, tray icon
- Error handling and crash reporting (using sentry-rust or similar)
- Documentation and README

---

## UI Design Direction (for implementation reference)

The UI should feel like a premium creative tool — think linear.app or Arc browser energy, but for reading.

**Color Palette:**
- Background: #0A0A0A (near black, not pure black)
- Surface: #141414 (cards, sidebars)
- Surface raised: #1E1E1E (dropdowns, tooltips)
- Border: #2A2A2A (subtle separation)
- Text primary: #EBEBEB
- Text secondary: #808080
- Accent: #6366F1 (indigo-violet — used for selections, highlights, active states)
- Danger: #EF4444

**Typography:**
- UI font: Inter or Geist (embedded, not system-dependent)
- Monospace elements: JetBrains Mono

**Layout:**
- Minimal top bar (no heavy toolbar clutter)
- Collapsible left sidebar for thumbnails and outline
- Right sidebar for annotations (collapsible)
- Command palette (Cmd+K style) for all actions
- Status bar at bottom (page count, zoom level, document title)

**Key UI Principles:**
- Nothing should feel like it's from 2008
- No gradients that scream "Microsoft Office"
- Hover states should be subtle, not flashy
- Transitions should be fast — under 150ms
- Every element should have clear purpose — no decorative clutter

---

## File Structure (Rust Workspace)

```
antigravity/
├── Cargo.toml                  (workspace root)
├── crates/
│   ├── app/                    (main entry, window management, GPUI app loop)
│   ├── renderer/               (PDF rendering pipeline, dark mode engine)
│   ├── document/               (PDF loading, parsing, text extraction, outline)
│   ├── annotations/            (annotation storage, rendering, export)
│   ├── ui/                     (all GPUI UI components)
│   ├── settings/               (user config, theme, persistence)
│   └── search/                 (full-text search index)
├── assets/
│   ├── fonts/
│   ├── icons/
│   └── themes/
├── installer/                  (Windows installer scripts)
└── docs/
    └── architecture.md
```

---

## RAM Target

| Scenario | Target RAM |
|---|---|
| App launched, no document | < 30 MB |
| 50-page text PDF open | < 60 MB |
| 200-page text PDF open | < 90 MB |
| 200-page scanned PDF (image-heavy) | < 150 MB |
| 3 tabs open, mixed documents | < 200 MB |

For comparison: Adobe Acrobat Reader uses 300MB+ just to open. Chrome PDF viewer uses 200MB+. should feel like a breath of fresh air.

---

## MVP Definition

The minimum viable product that can be shipped and used daily:

1. Open any PDF (drag and drop or file picker)
2. Dark mode that works on text, scanned, and mixed PDFs
3. Smooth scroll navigation
4. Zoom controls
5. Text search
6. Keyboard shortcuts
7. Recent files
8. Settings (theme selector, zoom default)
9. Windows installer

Everything in Phase 0 through Phase 3 constitutes the MVP.

---

## What We Are NOT Building (Scope Boundaries)

- No cloud sync (v1)
- No mobile version (Rust + GPUI is desktop-first)
- No browser extension
- No form filling (v1)
- No digital signature support (v1)
- No Linux/macOS builds in v1 (Windows first, cross-platform in v2)
- No AI summarization built-in (keep it focused)

---

## Summary

is a Rust-native, GPUI-powered PDF reader for Windows that takes dark mode seriously and uses a fraction of the memory of every competitor. It is built for people who read a lot of PDFs and are tired of bloated, ugly, RAM-hungry readers. The name says it all — it lifts the weight off your machine and your eyes.
