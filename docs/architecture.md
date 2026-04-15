# Antigravity Architecture

## Overview

Antigravity is a Cargo workspace with 5 crates, each responsible for a specific layer of the application.

## Crate Dependency Graph

```
app (binary)
├── ui
│   ├── document
│   ├── renderer
│   │   ├── document
│   │   └── settings
│   └── settings
├── document
├── renderer
└── settings
```

## Crate Descriptions

### `antigravity` (crates/app)
The main binary crate. Handles:
- Application entry point and initialization
- GPUI Application and Window creation
- Config loading and command-line argument parsing
- Logging setup

### `antigravity-ui` (crates/ui)
All GPUI UI components:
- **AppView** — Root view implementing `Render` trait, manages app state (Home vs Reading)
- **HomeView** — Landing screen with branding, drop zone, keyboard hints, recent files
- **ReaderView** — PDF page display, zoom, dark mode, thumbnail sidebar
- **TitleBar** — Minimal top bar with app logo and document title
- **StatusBar** — Bottom bar with page count, zoom level, dark mode indicator
- **colors** — Theme color constants and hex-to-HSLA conversion

### `antigravity-document` (crates/document)
PDF document handling via pdfium-render:
- PDF loading from file
- Page rendering to RGBA image buffers
- Page dimensions and metadata extraction
- Full-text search across document
- Bookmark/outline parsing

### `antigravity-renderer` (crates/renderer)
Rendering pipeline:
- **DarkModeEngine** — Luminance-aware color transformation with 4 profiles
- **PageCache** — LRU cache for rendered page images, keyed by (page, zoom, dark_mode)

### `antigravity-settings` (crates/settings)
User configuration:
- **AppConfig** — TOML-based persistent config (dark mode, zoom, window size, recent files)
- **Theme** — Color palette definitions matching design spec
- **DarkModeProfile** — Enum of available dark mode transformations

## Dark Mode Engine Details

The dark mode engine operates on RGBA pixel buffers and applies different transformations:

1. **Dark**: Luminance-aware inversion
   - Near-white pixels (lum > 0.85) → dark background (#0F0F0F)
   - Near-black pixels (lum < 0.15) → light text (#E8E8E8)
   - Mid-tones → inverted luminance with preserved hue ratio

2. **Sepia Dark**: Dark + warm amber tint (R×1.08, G×1.02, B×0.85)

3. **High Contrast**: Binary — luminance > 0.5 → black, otherwise → white

4. **Original**: Passthrough, no transformation

## Page Cache

- LRU eviction with configurable max entries (default: 20)
- Cache key: (page_index, scale_percent, dark_mode_profile)
- Thread-safe via `parking_lot::Mutex`
- Cleared on zoom change or dark mode toggle
