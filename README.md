# Shelf — Minimalist AI-Powered PDF Reader 📚⚡

<p align="center">
  <img src="src/lib/assets/icon.png" alt="Shelf Logo" width="108" height="108" style="border-radius: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);" />
</p>

<p align="center">
  <strong>Distraction-free desktop PDF reading meets real-time contextual AI assistance and persistent vocabulary memory.</strong>
</p>

<p align="center">
  <a href="https://github.com/Bittu-the-coder/PDF-Reader/releases"><img src="https://img.shields.io/github/v/release/Bittu-the-coder/PDF-Reader?color=blue&label=Release" alt="GitHub Release"></a>
  <img src="https://img.shields.io/badge/Tauri-v2-blue?logo=tauri" alt="Tauri v2">
  <img src="https://img.shields.io/badge/Svelte-5-orange?logo=svelte" alt="Svelte 5">
  <img src="https://img.shields.io/badge/Rust-Backend-red?logo=rust" alt="Rust">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
</p>

---

## 🌟 Why Shelf?

Traditional PDF readers are either bloated with enterprise features or completely passive. **Shelf** is engineered from the ground up for deep reading, studying, and technical research:

- 🧠 **Instant AI Word & Passage Inquiry**: Select any word or passage to get instantaneous definitions, contextual grammar analysis, synonyms, or full paragraph explanations in your chosen language.
- 💬 **Multi-Turn Contextual Chat**: Inquire further about any word or concept with AI conversational threads that remember the book's context.
- 🖍️ **Resilient Annotations**: Highlights and underlines that don't corrupt the document text layer, supporting multi-color coding and overlapping spans.
- 🗂️ **Book Memory & Spotlight Pop**: All your annotations, saved words, and custom notes are stored locally in SQLite. Clicking any note in the drawer jumps to the page and spotlights the exact text with an animated pulse.
- 🌐 **Model Agnostic**: Bring your own keys — works with Google Gemini (`gemini-2.5-flash`, `gemini-3.5-flash-lite`, custom models) and OpenRouter (`deepseek-r1`, `mistral`, free tier models).
- ⚡ **Lightweight & Private**: Sub-15MB native binary with offline-first local SQLite storage for all books, positions, notes, and vocabulary.

---

## 🚀 Download & Installation

Visit the [Releases Page](https://github.com/Bittu-the-coder/PDF-Reader/releases/latest) or choose your format below:

### Ubuntu / Debian / Mint / Pop!_OS
```bash
# Download the .deb package from Releases
sudo dpkg -i shelf_0.1.0_amd64.deb
```

### Fedora / RHEL
```bash
# Download the .rpm package from Releases
sudo rpm -i shelf-0.1.0-1.x86_64.rpm
```

### Standalone Linux Binary
```bash
tar -xzf shelf-v0.1.0-linux-x86_64.tar.gz
./shelf
```

---

## 🛠️ Features in Depth

### 1. Contextual AI Inquire Card
- **Draggable & Non-Intrusive**: Move the lookup card anywhere on screen so it never blocks your reading flow.
- **Rich Markdown Formatting**: Generates clean bullet points, bold key terms, and organized paragraphs instead of wall-of-text responses.
- **Passage Explanations**: Select multiple sentences or entire paragraphs to get synthesized summaries or simplified explanations.

### 2. Annotation Engine
- **Highlight & Underline**: Choose from 4 curated aesthetic colors (Golden Yellow, Mint Green, Coral Pink, Cyan).
- **Text-Node Splitting**: Highlights wrap discrete DOM text nodes, allowing multiple highlights across the same sentence without rendering bugs.
- **Page Jump Spotlight**: Clicking on a note or highlight in the Book Memory drawer auto-scrolls to the exact position and pulses with an animated golden zoom.

### 3. Responsive Dual-Header Layout
- **Reading Toolbar**: Quick-toggle zoom (`Ctrl +` / `Ctrl -`), responsive fit-to-width, single/dual page view, and distraction-free fullscreen mode.
- **Smart Toggle & Pin**: Easily hide or pin navigation toolbars according to your screen size.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl` + `O` | Open new PDF document |
| `Ctrl` + `F` / `F` | Toggle Fullscreen mode |
| `Esc` | Exit Fullscreen / Close active modals |
| `Ctrl` + `+` / `Ctrl` + `=` | Zoom In |
| `Ctrl` + `-` | Zoom Out |
| `Ctrl` + `0` | Reset Zoom to 100% |
| `←` / `→` | Previous / Next Page |
| `Ctrl` + `B` | Toggle Book Memory Drawer |

---

## 🏗️ Building from Source

### Prerequisites
- [Rust](https://www.rust-lang.org/tools/install) (1.78+)
- [Node.js](https://nodejs.org/) (v20+ or v24)
- System libraries (Ubuntu/Debian):
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
  ```

### Development
```bash
# Clone the repository
git clone https://github.com/Bittu-the-coder/PDF-Reader.git
cd PDF-Reader

# Install frontend dependencies
npm install

# Start local Tauri dev server with hot-reload
npm run tauri dev
```

### Production Build
```bash
npm run tauri build
```
Binaries and distribution packages will be created in `src-tauri/target/release/bundle/`.

---

## 🧰 Tech Stack

- **Framework**: [Tauri v2](https://v2.tauri.app/) (Desktop bridge)
- **Frontend**: [Svelte 5](https://svelte.dev/) (Runes reactivity, vanilla CSS styling)
- **Backend**: [Rust](https://www.rust-lang.org/)
- **PDF Engine**: [PDF.js](https://mozilla.github.io/pdf.js/) (Custom canvas rendering and text-layer mapping)
- **Database**: [SQLite](https://www.sqlite.org/) via `rusqlite`
- **AI Integrations**: Native HTTP client with streaming JSON for Google Gemini and OpenRouter

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<p align="center">
  Crafted with care for readers, researchers, and learners everywhere.
</p>
