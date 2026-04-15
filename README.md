# The Reader

A Tauri-based Windows PDF reader with a dark-first interface, one-page-at-a-time rendering, and low-RAM behavior.

## Features

- Open PDFs by button or drag-and-drop
- Next / previous page navigation
- Page jump input
- Zoom in / out and fit-width behavior
- Dark mode profiles:
  - Dark
  - Sepia Dark
  - High Contrast
  - Original
- Single-page render pipeline to keep memory use low

## How to test

### Development

```powershell
npm install
npm run tauri:dev
```

### Production build

```powershell
npm run tauri:build
```

Installer outputs are written to:

- `src-tauri/target/release/bundle/nsis/The Reader_0.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/The Reader_0.1.0_x64_en-US.msi`

## Notes

- The app uses PDF.js for rendering one page at a time.
- Dark mode is applied after rendering so scanned, image-based, and mixed PDFs are all processed consistently.
- This keeps memory use much lower than loading whole-document bitmaps.
