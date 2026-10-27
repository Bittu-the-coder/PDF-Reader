# GitHub Release Information

## Tag
```text
v0.1.0
```

## Release Title
```text
Shelf v0.1.0 — Initial Release with AI Inquire & Book Memory
```

---

## Release Description (Copy & Paste into GitHub Release body)

```markdown
# Shelf v0.1.0 📚✨

Welcome to the initial release of **Shelf**, an offline-first, distraction-free desktop PDF reader built with **Tauri v2**, **Svelte 5**, and **Rust**. 

Designed for deep reading, studying, and technical research with real-time AI contextual lookup, vocabulary memory, and non-destructive PDF annotations.

---

### 🌟 Key Features

- 🧠 **Contextual AI Inquire & Word Lookup**: Select any word or phrase to get instant definitions, contextual grammar analysis, synonyms, or full paragraph explanations in your chosen language.
- 💬 **Multi-Turn Inquire Chat**: Ask follow-up questions directly within the floating, draggable card with formatted markdown bullets and structured lists.
- 🖍️ **Resilient Text Annotations**: Discrete text-node highlighting and underlining with multi-color palette support (Yellow, Green, Coral, Cyan) that won't corrupt or misalign page text layers.
- 🎯 **Interactive Book Memory**: Browse all saved vocabulary, highlights, and custom notes in the slide-out drawer. Clicking any note instantly jumps to the page and spotlight-pulses the target passage.
- 🌐 **Model-Agnostic**: Compatible with Google Gemini (`gemini-2.5-flash`, `gemini-3.5-flash-lite`, custom models) and OpenRouter (`deepseek-r1`, `mistral`, free tier models).
- ⚡ **Lightweight & Native**: Sub-15MB native Linux desktop app with local, private SQLite storage for all books, reading progress, and notes.

---

### 📦 Installation

#### Debian / Ubuntu / Linux Mint / Pop!_OS
```bash
sudo dpkg -i shelf_0.1.0_amd64.deb
```

#### Fedora / RHEL
```bash
sudo rpm -i shelf-0.1.0-1.x86_64.rpm
```

#### Standalone Linux Binary
```bash
tar -xzf shelf-v0.1.0-linux-x86_64.tar.gz
./shelf
```

---

### 💻 System Requirements
- Linux (x86_64)
- WebKitGTK 4.1 (`libwebkit2gtk-4.1-0`)
```

---

## Files to Upload as Release Assets

Upload the following 3 files located in your project directory:

1. **Debian Package (.deb)**:
   - **Path**: `src-tauri/target/release/bundle/deb/shelf_0.1.0_amd64.deb`
   - **Size**: ~5.3 MB

2. **RPM Package (.rpm)**:
   - **Path**: `src-tauri/target/release/bundle/rpm/shelf-0.1.0-1.x86_64.rpm`
   - **Size**: ~4.6 MB

3. **Standalone Compressed Binary (.tar.gz)**:
   - **Path**: `src-tauri/target/release/shelf-v0.1.0-linux-x86_64.tar.gz`
   - **Size**: ~4.8 MB
