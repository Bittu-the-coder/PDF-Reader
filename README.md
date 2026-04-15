# Antigravity — PDF Reader for Windows

> "Read without the weight."

A native Windows PDF reader written in Rust using the GPUI framework (from Zed editor). Built for people who read a lot of PDFs and are tired of bloated, ugly, RAM-hungry readers.

## Features

- **True Dark Mode** — Works on text, scanned, and image-based PDFs using intelligent luminance-aware color inversion
- **Ultra-Low RAM** — Targets under 80MB for a 200-page document  
- **Premium Dark UI** — Inspired by Linear.app and Arc browser aesthetics
- **Fast Rendering** — GPU-accelerated via GPUI, with page caching
- **Keyboard-First** — Full keyboard navigation and shortcuts

## Dark Mode Profiles

| Profile | Description |
|---------|-------------|
| **Dark** | Full dark background with adjusted text — default |
| **Sepia Dark** | Warm dark tone, easy on eyes for long reading |
| **High Contrast** | Pure black bg, pure white text, max accessibility |
| **Original** | No processing, as-is rendering |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+O` | Open file |
| `Ctrl+D` | Cycle dark mode |
| `Ctrl+T` | Toggle thumbnails |
| `Ctrl+=` | Zoom in |
| `Ctrl+-` | Zoom out |
| `→` / `↓` / `Space` | Next page |
| `←` / `↑` | Previous page |
| `Home` | First page |
| `End` | Last page |

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | Rust |
| UI Framework | GPUI (Zed's framework) |
| PDF Rendering | pdfium-render |
| Dark Mode Engine | Custom luminance-aware inversion |
| Config | serde + TOML |

## Building

```bash
# Prerequisites: Rust toolchain, PDFium library on system PATH
cargo build --release

# Run with a specific PDF
cargo run -- path/to/document.pdf
```

### PDFium Setup

Antigravity uses PDFium for PDF rendering. You need to have the PDFium dynamic library available:

1. Download PDFium from [pdfium-binaries](https://github.com/nicktamura/pdfium-binaries/releases)
2. Place `pdfium.dll` in the same directory as the executable, or in your system PATH

## Project Structure

```
crates/
├── app/        — Main entry point, window management, GPUI app loop
├── document/   — PDF loading, parsing, text extraction, bookmarks
├── renderer/   — Dark mode engine, page rendering pipeline, LRU cache
├── ui/         — All GPUI UI components (views, title bar, status bar)
└── settings/   — User config persistence (TOML), theme definitions
```

## License

MIT
