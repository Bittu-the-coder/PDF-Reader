# PLAN.md — "Shelf" : a minimal, memory-first PDF reader (Rust + Tauri)

> This file is the single source of truth for the coding agent. Read it fully before writing any code.
> Working name: **Shelf** (can be renamed later; keep the name in one constant).

---

## 0. Rules for the agent (read first)

1. **Work phase by phase** (Section 9). Finish a phase, make it compile, run it, tick its checklist, then move on. Do not start the next phase early.
2. **Ask before big deviations.** Small decisions are yours to make; log them in `DECISIONS.md` (one line each: date, decision, reason).
3. **Keep the UI minimal.** If a feature adds visible clutter, hide it behind hover, a shortcut, or the command palette.
4. **Never log or commit the user's Gemini API key.** Store it only in the OS keychain (Section 7).
5. **Local-first.** Everything except Gemini calls must work offline.
6. Every phase must end with: `cargo fmt`, `cargo clippy -- -D warnings`, `cargo test`, and the frontend type-check passing.

---

## 1. The reference repo in the project root (IMPORTANT)

The folder `./BookReader/` in the project root is a clone of a friend's project: https://github.com/Gaurav6174/BookReader

**We are copying the IDEA only, not the code or the stack.**

- It is a MERN web app (React, Express, MongoDB). **Ignore all of that.** Do not use Node, Express, MongoDB, Mongoose, Zod, Tailwind, or its hand-drawn "SketchUI" styling. Do not copy files from it into our source tree.
- The idea to take: organize reading memory as **Book → Chapter → Words & Notes**.
  - A *word* has: the word, its meaning, and an optional example sentence.
  - A *note* has: content and an optional page number.
  - Deleting a book or chapter cascades to its children.
  - Duplicate words inside the same chapter are rejected (their repo returns 409 on this).
- **What to do with it:** skim `BookReader/PROJECT_SPEC.md`, `BookReader/designs.md`, `BookReader/README.md`, and the models/routes under `BookReader/server/` to understand the data relationships and the UX intent. Then re-design everything natively for our stack (SQLite tables in Section 5, Tauri commands in Section 6).
- Do **not** modify anything inside `./BookReader/`. Treat it as read-only reference. Add it to our `.gitignore` (or leave it as a separate untracked folder) so it does not end up in our repo.

**Where we go far beyond it:** their app is a tracker only. Ours is a full PDF reader with the memory system built in, so the user never has to switch windows.

---

## 2. Product vision

A very clean, minimalistic desktop PDF reader where **reading never gets interrupted**. Looking up a word, saving it, taking a note, asking an AI follow-up question, timing a session, and playing lofi music all happen *inside* the reader.

Design pillars:

1. **Zero window-switching.** Select a word → meaning appears next to it → one click saves it to the book's vocabulary.
2. **Memory, not just reading.** Every book lives on a shelf and remembers its vocabulary, notes and highlights, organized chapter-wise.
3. **Quiet UI.** Chrome appears only when the cursor asks for it (Zen-browser style).
4. **User owns everything.** Local SQLite database, own Gemini API key, easy export.

---

## 3. Tech stack (decided; change only via DECISIONS.md)

| Concern | Choice | Notes |
|---|---|---|
| App shell / backend | **Rust + Tauri 2** | All logic lives in Rust commands |
| PDF rendering + text layer | **pdf.js** in the webview | Gives text selection, search, outline for free |
| Frontend | **Svelte 5 + TypeScript + Vite** | Small, fast, easy to keep minimal |
| Styling | Plain CSS with CSS variables (no Tailwind) | Themes = variable sets |
| Database | **SQLite** via `rusqlite` (+ `rusqlite_migration`) | One file in the app data dir |
| HTTP / AI | `reqwest` + `tokio` + `serde` | Gemini REST, SSE streaming |
| Secret storage | `keyring` crate | Gemini API key in OS keychain |
| Audio (lofi) | `rodio` | Play from bundled assets or a user folder |
| Full-text search across shelf | `tantivy` (Phase 6) | Optional until then |
| Errors | `thiserror` + `anyhow` | Typed errors returned to frontend as strings/enums |
| Logging | `tracing` | Never log secrets or full book text |

> If pdf.js cannot meet a requirement, the fallback is `pdfium-render` in Rust, but only after logging the reason in DECISIONS.md.

---

## 4. Project layout

```
/ (project root)
├─ BookReader/              # friend's repo, READ-ONLY reference (ignore in git)
├─ PLAN.md                  # this file
├─ DECISIONS.md             # agent decision log
├─ src-tauri/
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  ├─ migrations/           # SQL migrations, numbered
│  └─ src/
│     ├─ main.rs
│     ├─ lib.rs
│     ├─ db/                # connection, migrations, repositories (books, chapters, words, notes, ...)
│     ├─ commands/          # #[tauri::command] fns, one file per domain
│     ├─ ai/                # gemini client, prompts, streaming
│     ├─ audio/             # lofi player
│     ├─ timer/             # session timer state
│     ├─ secrets.rs         # keyring wrapper
│     └─ error.rs
├─ src/                     # Svelte frontend
│  ├─ lib/
│  │  ├─ pdf/               # pdf.js wrapper, text-layer selection, thumbnails
│  │  ├─ components/        # Tabs, Sidebar, TopBar, LookupCard, ChatPanel, Shelf, ...
│  │  ├─ stores/            # app state
│  │  └─ api.ts             # typed wrappers around Tauri invoke()
│  ├─ routes or App.svelte
│  └─ styles/
├─ assets/lofi/             # royalty-free / CC0 tracks only (document source + license in assets/lofi/LICENSES.md)
└─ docs/
```

---

## 5. Data model (SQLite)

All ids are `INTEGER PRIMARY KEY`. Timestamps are ISO-8601 UTC text. Enable `PRAGMA foreign_keys = ON`.

```sql
-- migrations/0001_init.sql

CREATE TABLE shelves (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  shelf_id INTEGER REFERENCES shelves(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  author TEXT,
  file_path TEXT NOT NULL,          -- original location
  file_hash TEXT NOT NULL UNIQUE,   -- sha256, so the same PDF is recognized if moved
  page_count INTEGER,
  last_page INTEGER NOT NULL DEFAULT 1,
  last_zoom REAL,
  cover_png BLOB,                   -- first page thumbnail
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_opened_at TEXT
);

CREATE TABLE chapters (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_page INTEGER NOT NULL,      -- used to auto-assign a word/note to a chapter by page
  position INTEGER NOT NULL,        -- ordering
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('outline','manual'))
);

CREATE TABLE words (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  meaning TEXT NOT NULL,
  example_sentence TEXT,            -- the sentence it was found in
  page INTEGER,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (chapter_id, word COLLATE NOCASE)   -- duplicate rule, like the reference idea
);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  page INTEGER,
  quote TEXT,                       -- optional selected text the note is attached to
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE highlights (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  color TEXT NOT NULL DEFAULT 'yellow',
  text TEXT NOT NULL,
  rects_json TEXT NOT NULL,         -- normalized rectangles on the page
  note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE reading_sessions (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  seconds INTEGER NOT NULL DEFAULT 0,
  pages_read INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE flashcards (             -- Phase 6, one per word
  word_id INTEGER PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
  due_at TEXT NOT NULL,
  stability REAL, difficulty REAL, reps INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0,
  last_review_at TEXT
);

CREATE TABLE chat_threads (
  id INTEGER PRIMARY KEY,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  anchor_text TEXT,                 -- selection that started the thread
  page INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','model')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

Rules:
- A word or note's `chapter_id` is **auto-assigned** from its page: the chapter with the greatest `start_page <= page`. The user can override it.
- Deleting a book cascades to chapters, words, notes, highlights, sessions, threads.
- Inserting a duplicate word in the same chapter must return a typed `DuplicateWord` error, and the UI should show "already saved" and offer to open the existing entry.

---

## 6. Tauri command surface (frontend ↔ Rust)

Group by domain. All return `Result<T, AppError>` serialized to the frontend. Keep payloads small; send PDF bytes via the asset protocol / file path, not through JSON.

- **library:** `add_book(path)`, `list_books(shelf_id?)`, `get_book(id)`, `update_book(id, ...)`, `delete_book(id)`, `save_progress(book_id, page, zoom)`, `create_shelf`, `rename_shelf`, `delete_shelf`, `move_book(book_id, shelf_id)`
- **chapters:** `import_outline(book_id, outline[])`, `list_chapters(book_id)`, `create_chapter`, `update_chapter`, `delete_chapter`
- **words:** `add_word`, `list_words(book_id, chapter_id?)`, `update_word`, `delete_word`, `find_word(book_id, word)`
- **notes:** `add_note`, `list_notes(book_id, chapter_id?)`, `update_note`, `delete_note`
- **highlights:** `add_highlight`, `list_highlights(book_id, page?)`, `delete_highlight`
- **ai:** `set_api_key(key)`, `has_api_key()`, `clear_api_key()`, `lookup_word(book_id, word, sentence, page)`, `chat_send(thread_id?, anchor, message)` (streams events), `summarize(book_id, page_range)`, `quiz_chapter(chapter_id)`
- **timer:** `timer_start(book_id)`, `timer_pause`, `timer_resume`, `timer_stop`, `timer_state` (+ emits `timer:tick` event once per second)
- **audio:** `lofi_list`, `lofi_play(track)`, `lofi_pause`, `lofi_set_volume(v)`, `lofi_next`
- **settings:** `get_setting`, `set_setting`
- **export:** `export_book_markdown(book_id, path)`, `export_anki(book_id, path)` (Phase 6)

Use Tauri events for streaming (`ai:chunk`, `ai:done`, `timer:tick`).

---

## 7. Gemini integration

- User supplies their **own API key** on first use (settings screen or inline prompt when they first try to look up a word). Never ship a key in the app.
- Store the key with the `keyring` crate (service name = app id, user = `gemini_api_key`). Expose only `has_api_key()` to the frontend; the frontend must never read the key back.
- Call the Gemini REST API from Rust (`reqwest`), not from the webview. Send the key in the `x-goog-api-key` header. Use `generateContent` for lookups and the streaming variant (SSE) for chat.
- **Model name is a setting** (default chosen by the agent). Before hardcoding any default, check the current official Gemini API docs for valid model names and request format, and record the choice in DECISIONS.md. Do not assume names from memory.
- Handle: missing key, invalid key (401/403), rate limit (429, show friendly message + retry-after), network offline, safety-blocked responses, timeouts (15s for lookups).
- Privacy: send only the selected text, its sentence, and (for chat) the minimum page context needed. Show a one-time note in settings explaining what is sent.

### Prompts (keep in `src-tauri/src/ai/prompts.rs`)

**Word lookup** — expects strict JSON back; parse defensively:

```
You are a concise dictionary for a reader. Given a word and the sentence it appears in,
return ONLY JSON: {"word":"", "part_of_speech":"", "meaning":"", "meaning_in_context":"",
"example":"", "synonyms":["",""], "pronunciation":""}.
Keep "meaning" under 20 words. Use simple language.
```

**Chat follow-up** — system prompt: answer briefly, stay grounded in the provided passage, say when unsure, reply in the user's chosen language.

If the JSON cannot be parsed, fall back to showing the raw text rather than failing.

### Offline fallback
When there is no key or no network, fall back to a free public dictionary API if reachable, otherwise show "Add your Gemini key to enable lookups" with a one-click link to settings. Never block reading.

---

## 8. UX specification

### 8.1 Layout (Zen-browser inspired)

- **Tab strip:** one tab per open PDF, minimal height, close button on hover, middle-click closes, drag to reorder. Can be auto-hidden too (setting).
- **Left sidebar = page thumbnails.** Hidden by default. Appears when the cursor touches the **left edge** (hot zone ≈ 6 px). Slides in over the document (does not resize the page, to avoid layout jumps). Hides when the cursor leaves, after ~300 ms delay. A pin button keeps it open.
- **Top bar** = book title, page number, zoom, search, timer, lofi, settings. Hidden by default; appears when the cursor touches the **top edge**. Same delay and pin behavior.
- **Smart toggle rules:**
  - Show delay ≈ 80–150 ms, hide delay ≈ 300 ms, to avoid flicker.
  - Never hide while the user is typing in the top bar search, or while a menu is open.
  - Respect `prefers-reduced-motion` (no slide animation, just fade).
  - Keyboard equivalents: `Ctrl+B` toggles sidebar pin, `Ctrl+Shift+B` toggles top bar pin, `F` focus mode (hide everything).
- **Right panel (on demand):** a slide-in drawer for the book's Memory (Vocabulary / Notes / Highlights tabs, grouped by chapter) and AI chat. Opens via shortcut or from a lookup card.

### 8.2 Visual language
- Very clean, lots of whitespace, one accent color, system font stack (or a single bundled font), subtle shadows, 150–200 ms transitions.
- Themes via CSS variables: light, dark, sepia. Follow OS theme by default.
- The PDF page is the hero. No permanent toolbars or borders around it.

### 8.3 The core flow: select → understand → save

1. User selects a word or short phrase in the PDF.
2. After ~250 ms a small **lookup card** appears near the selection (never covering it). It shows a loading shimmer, then: word, part of speech, meaning, meaning in this context, example, pronunciation (speaker button using system TTS).
3. Buttons on the card: **Save word** (adds to the current chapter's vocabulary), **Note** (opens a quick inline note box prefilled with the quote), **Ask more** (opens chat anchored to this selection), **Highlight**.
4. If the word is already saved in this chapter, the card shows "Saved ✓" with a link to the entry.
5. `Esc` or clicking elsewhere dismisses. Selecting a long passage (a sentence or more) shows a different card: **Explain**, **Translate**, **Summarize**, **Note**, **Highlight**.

Acceptance: from selection to saved word takes **at most 2 clicks and zero window switches**.

### 8.4 Shelf (home screen)
- A grid of book covers (first-page thumbnails) grouped by shelf, with progress ring, last opened, and words/notes counts.
- Drag a PDF anywhere on the window to add it. Drag books between shelves.
- Opening a book resumes at the last page and zoom.
- Command palette: `Ctrl+K` → jump to any book, chapter, word, or note, or run any action.

### 8.5 Timer
- Starts from the top bar (or `Ctrl+T`). Per-book sessions are saved to `reading_sessions`.
- **Three display modes** (setting + quick toggle):
  1. *Visible*: persistent small timer in a corner.
  2. *Minimal*: a tiny dot or ring that shows the time on hover.
  3. *Hidden*: runs in the background, nothing on screen; the user can peek with a shortcut.
- Optional Pomodoro mode (work/break lengths configurable) with a gentle notification at the end of each interval.
- Auto-pause after N minutes of no scroll or input (configurable).

### 8.6 Lofi music
- Small player in the top bar: play/pause, next, volume. Remembers the last volume and track.
- Plays bundled tracks or a user-selected folder. Fade in/out. Stays playing when the top bar hides.
- Bundle **only** tracks that are CC0 or otherwise licensed for redistribution; document each in `assets/lofi/LICENSES.md`. If none can be bundled, ship with the folder picker only.

### 8.7 Accessibility and polish
- Full keyboard navigation, visible focus rings, sufficient contrast in all themes.
- Smooth scrolling, remembered zoom per book, fit-width / fit-page modes, optional two-page spread.
- Handle encrypted, huge, and scanned PDFs gracefully (clear message, never a crash).

---

## 9. Phases and checklists

### Phase 0 — Scaffold
- [ ] Create Tauri 2 + Svelte + TypeScript project in the root (do not touch `BookReader/`).
- [ ] Add `.gitignore` entry for `BookReader/`.
- [ ] Set up lint/format (rustfmt, clippy, eslint/prettier or svelte-check), CI script optional.
- [ ] Skim the reference repo (Section 1) and write 5–10 lines in DECISIONS.md on what ideas were borrowed.
- [ ] App window opens with an empty shell and a working dev command.

### Phase 1 — Reader core
- [ ] Open a PDF via file dialog and drag-and-drop; render with pdf.js (virtualized pages, lazy rendering).
- [ ] Text layer works; text selection and copy work.
- [ ] Tabs for multiple PDFs.
- [ ] Auto-hide top bar and left thumbnail sidebar with the exact rules in 8.1.
- [ ] Zoom, fit modes, page jump, in-document search (`Ctrl+F`).
- [ ] Light/dark/sepia themes.
- **Done when:** a 500-page PDF scrolls smoothly and the hot-edge toggles feel flicker-free.

### Phase 2 — Shelf and memory (the idea from the reference repo, redesigned)
- [ ] SQLite setup + migrations from Section 5.
- [ ] `add_book` computes a file hash, extracts title/page count, saves a cover thumbnail.
- [ ] Shelf home screen with grid, shelves, and progress.
- [ ] Resume last page and zoom per book.
- [ ] Chapters: import from the PDF outline; manual add/rename/delete; auto-assign by page.
- [ ] Right-side Memory drawer with Vocabulary and Notes tabs grouped by chapter, with manual add, edit, delete.
- [ ] Duplicate-word rule and cascade-delete covered by Rust tests.
- **Done when:** closing and reopening the app restores books, positions, chapters, words, and notes.

### Phase 3 — Gemini lookup, save, notes
- [ ] Secure API-key storage and a settings screen (add, test, remove key).
- [ ] Selection → lookup card (Section 8.3), JSON parsing with fallback, error states.
- [ ] Save word, quick note, and highlight from the card; each stores page, sentence, and auto-chapter.
- [ ] Clicking a saved word or note jumps back to its page and flashes the text.
- **Done when:** the select → understand → save flow works in at most 2 clicks.

### Phase 4 — Chat in place
- [ ] "Ask more" opens a chat panel anchored to the selection; streamed responses.
- [ ] Threads are saved per book and reopenable.
- [ ] Buttons to convert any AI answer into a note or a word entry.
- [ ] Language preference setting (reply language).

### Phase 5 — Timer and lofi
- [ ] Timer with the three display modes, per-book sessions, auto-pause.
- [ ] Pomodoro mode and notifications.
- [ ] Lofi player with folder picker, volume, fade, persistence.

### Phase 6 — Make it extraordinary
- [ ] Spaced-repetition flashcards (FSRS or SM-2) built from saved words, showing the original sentence.
- [ ] Daily review screen ("N words due").
- [ ] Reading stats: streaks, time per book, pages per day, weekly summary.
- [ ] Command palette (`Ctrl+K`) and global full-text search across all books (`tantivy`).
- [ ] AI extras: chapter summary, "quiz me on this chapter", "ask this book" with page-cited answers, translate selection.
- [ ] Focus mode, colored highlights, bookmarks.
- [ ] Export: Markdown/Obsidian and Anki.
- [ ] Text-to-speech for selection or page.
- [ ] Optional OCR for scanned PDFs.
- [ ] Optional sync by pointing the database folder to a synced directory (document the caveats).

### Phase 7 — Ship
- [ ] App icon, name, installer builds for Windows/macOS/Linux via Tauri bundler.
- [ ] README with screenshots, setup, how to get a Gemini API key, privacy notes.
- [ ] Performance pass and crash-safety pass (DB writes are transactional, no data loss on force-quit).

---

## 10. Quality bar and testing

- **Rust unit tests** for: DB repositories, cascade deletes, duplicate-word rule, chapter auto-assignment by page, Gemini response parsing (including malformed JSON), timer state machine.
- **Mock the Gemini client** behind a trait so tests never hit the network.
- **Frontend:** type-check clean; component tests for the hot-edge toggle logic (timers/delays) and the lookup card states.
- **Manual QA script** in `docs/QA.md`: huge PDF, encrypted PDF, scanned PDF, RTL text, moving a file and reopening it (matched by hash), offline mode, invalid API key.
- **Performance targets:** cold start under 1.5 s on a typical laptop; first page of a 500-page PDF visible under 1 s; lookup card appears within 300 ms of selection (loading state) and content within a few seconds depending on network.

---

## 11. Security and privacy

- API key only in the OS keychain; never in the DB, logs, settings JSON, or frontend memory beyond the input field.
- Lock down Tauri capabilities to the minimum (file dialog, app data dir, specific commands). No arbitrary shell or filesystem access from the webview.
- Strict Content-Security-Policy; no remote scripts. Bundle pdf.js locally.
- All user data stays on disk in the app data directory. Provide "Export all data" and "Delete all data" in settings.

---

## 12. Definition of done (v1.0)

A reader can drag in a PDF, read with a fully hidden UI, select any word and instantly see its meaning, save it into the right chapter, add a note, ask a follow-up question, run a hidden timer, play lofi, and later review everything from the shelf — **without ever leaving the window**.
