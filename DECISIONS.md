# DECISIONS.md — Shelf

Agent decision log. One line each: date, decision, reason.

| Date | Decision | Reason |
|---|---|---|
| 2026-10-26 | Borrow Book → Chapter → Words & Notes hierarchy from BookReader | Core organizational metaphor is excellent; words with meaning + example, notes with page numbers, chapter-based grouping |
| 2026-10-26 | Borrow duplicate-word rejection per chapter (409 concept) from BookReader | Prevents clutter; show "already saved" instead of duplicating entries |
| 2026-10-26 | Borrow cascade-delete semantics (book → chapters → words/notes) from BookReader | Clean data lifecycle; no orphans |
| 2026-10-26 | Borrow "word + meaning + example" triplet structure from BookReader | Simple yet sufficient for vocabulary building |
| 2026-10-26 | Borrow shelf/collection grouping concept from BookReader | Natural organization for multi-book readers |
| 2026-10-26 | Diverge: use Tauri 2 + Svelte 5 + SQLite instead of MERN stack | Desktop-native app, no server needed, local-first, better performance |
| 2026-10-26 | Diverge: integrate full PDF reader (pdf.js) instead of being a standalone tracker | Core value prop — never leave the window |
| 2026-10-26 | Diverge: Gemini AI for word lookup instead of manual Google search | Instant inline meanings without window switching |
| 2026-10-26 | Use Tauri 2 stable with Svelte 5 + TypeScript template | Latest stable versions of all tools |
| 2026-10-26 | Default Gemini model: will be set after checking current API docs | Per plan Section 7 — don't assume model names |
| 2026-10-26 | Gate Tauri GUI behind `desktop` feature | Enables testing DB, AI, and backend logic in headless environments without requiring webkit2gtk dev headers |

