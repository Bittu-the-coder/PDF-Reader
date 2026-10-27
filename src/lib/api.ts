import { invoke } from "@tauri-apps/api/core";

export interface Book {
  id: number;
  shelf_id: number | null;
  title: string;
  author: string | null;
  file_path: string;
  file_hash: string;
  page_count: number | null;
  last_page: number;
  last_zoom: number | null;
  added_at: string;
  last_opened_at: string | null;
}

export interface BookSummary {
  id: number;
  shelf_id: number | null;
  title: string;
  author: string | null;
  file_path: string;
  page_count: number | null;
  last_page: number;
  added_at: string;
  last_opened_at: string | null;
  word_count: number;
  note_count: number;
}

export interface Shelf {
  id: number;
  name: string;
  created_at: string;
}

export interface Chapter {
  id: number;
  book_id: number;
  title: string;
  start_page: number;
  position: number;
  source: "outline" | "manual";
}

export interface Word {
  id: number;
  book_id: number;
  chapter_id: number | null;
  word: string;
  meaning: string;
  meaning_hindi?: string | null;
  example_sentence: string | null;
  page: number | null;
  ai_generated: boolean;
  created_at: string;
}

export interface Note {
  id: number;
  book_id: number;
  chapter_id: number | null;
  content: string;
  page: number | null;
  quote: string | null;
  created_at: string;
  updated_at: string;
}

export interface Highlight {
  id: number;
  book_id: number;
  page: number;
  color: string;
  text: string;
  rects_json: string;
  note_id: number | null;
  created_at: string;
}

export interface WordLookupResult {
  word: string;
  part_of_speech?: string | null;
  meaning: string;
  meaning_hindi?: string | null;
  meaning_in_context?: string | null;
  example?: string | null;
  synonyms?: string[] | null;
  pronunciation?: string | null;
}

// Typed API functions wrapping Tauri invoke
export const api = {
  // Library
  addBook: (params: {
    path: string;
    shelfId?: number | null;
    title?: string | null;
    author?: string | null;
    pageCount?: number | null;
    coverPng?: number[] | null;
  }) =>
    invoke<Book>("add_book", {
      path: params.path,
      shelfId: params.shelfId ?? null,
      title: params.title ?? null,
      author: params.author ?? null,
      pageCount: params.pageCount ?? null,
      coverPng: params.coverPng ?? null,
    }),

  listBooks: (shelfId?: number | null) =>
    invoke<BookSummary[]>("list_books", { shelfId: shelfId ?? null }),

  getBook: (id: number) => invoke<Book>("get_book", { id }),

  deleteBook: (id: number) => invoke<void>("delete_book", { id }),

  saveProgress: (bookId: number, page: number, zoom?: number | null) =>
    invoke<void>("save_progress", { bookId, page, zoom: zoom ?? null }),

  updateBookDetails: (params: {
    id: number;
    title?: string | null;
    author?: string | null;
    pageCount?: number | null;
    coverPng?: number[] | null;
  }) =>
    invoke<void>("update_book_details", {
      id: params.id,
      title: params.title ?? null,
      author: params.author ?? null,
      pageCount: params.pageCount ?? null,
      coverPng: params.coverPng ?? null,
    }),

  moveBook: (bookId: number, shelfId: number | null) =>
    invoke<void>("move_book", { bookId, shelfId }),

  getBookCover: (bookId: number) =>
    invoke<number[] | null>("get_book_cover", { bookId }),

  readPdfBytes: (path: string) =>
    invoke<number[]>("read_pdf_bytes", { path }),

  saveImportedPdf: (name: string, bytes: number[]) =>
    invoke<string>("save_imported_pdf", { name, bytes }),

  // Shelves
  createShelf: (name: string) => invoke<Shelf>("create_shelf", { name }),

  listShelves: () => invoke<Shelf[]>("list_shelves"),

  renameShelf: (id: number, newName: string) =>
    invoke<void>("rename_shelf", { id, newName }),

  deleteShelf: (id: number) => invoke<void>("delete_shelf", { id }),

  // Chapters
  importOutline: (bookId: number, outline: { title: string; page: number }[]) =>
    invoke<Chapter[]>("import_outline", { bookId, outline }),

  listChapters: (bookId: number) =>
    invoke<Chapter[]>("list_chapters", { bookId }),

  createChapter: (params: {
    bookId: number;
    title: string;
    startPage: number;
    position: number;
    source?: string;
  }) => invoke<Chapter>("create_chapter", { input: params }),

  updateChapter: (id: number, title: string, startPage: number) =>
    invoke<void>("update_chapter", { id, title, startPage }),

  deleteChapter: (id: number) => invoke<void>("delete_chapter", { id }),

  // Words
  addWord: (input: {
    bookId: number;
    chapterId?: number | null;
    word: string;
    meaning: string;
    meaningHindi?: string | null;
    exampleSentence?: string | null;
    page?: number | null;
    aiGenerated?: boolean | null;
  }) => invoke<Word>("add_word", { input }),

  listWords: (bookId: number, chapterId?: number | null) =>
    invoke<Word[]>("list_words", { bookId, chapterId: chapterId ?? null }),

  findWord: (bookId: number, word: string) =>
    invoke<Word | null>("find_word", { bookId, word }),

  updateWord: (
    id: number,
    meaning: string,
    meaningHindi?: string | null,
    exampleSentence?: string | null
  ) =>
    invoke<void>("update_word", {
      id,
      meaning,
      meaningHindi: meaningHindi ?? null,
      exampleSentence: exampleSentence ?? null,
    }),

  deleteWord: (id: number) => invoke<void>("delete_word", { id }),

  // Notes
  addNote: (input: {
    bookId: number;
    chapterId?: number | null;
    content: string;
    page?: number | null;
    quote?: string | null;
  }) => invoke<Note>("add_note", { input }),

  listNotes: (bookId: number, chapterId?: number | null) =>
    invoke<Note[]>("list_notes", { bookId, chapterId: chapterId ?? null }),

  updateNote: (id: number, content: string) =>
    invoke<void>("update_note", { id, content }),

  deleteNote: (id: number) => invoke<void>("delete_note", { id }),

  // Highlights
  addHighlight: (input: {
    bookId: number;
    page: number;
    color?: string | null;
    text: string;
    rectsJson: string;
    noteId?: number | null;
  }) => invoke<Highlight>("add_highlight", { input }),

  listHighlights: (bookId: number, page?: number | null) =>
    invoke<Highlight[]>("list_highlights", { bookId, page: page ?? null }),

  deleteHighlight: (id: number) => invoke<void>("delete_highlight", { id }),

  // Settings & Secrets
  setApiKey: (key: string, provider?: string) =>
    invoke<void>("set_api_key", { key, provider: provider ?? null }),

  hasApiKey: (provider?: string) =>
    invoke<boolean>("has_api_key", { provider: provider ?? null }),

  clearApiKey: (provider?: string) =>
    invoke<void>("clear_api_key", { provider: provider ?? null }),

  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),

  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),

  // AI & Vocabulary
  lookupWord: (params: {
    word: string;
    contextSentence?: string | null;
    targetLanguage?: string | null;
    provider?: string | null;
  }) =>
    invoke<WordLookupResult>("lookup_word", {
      word: params.word,
      contextSentence: params.contextSentence ?? null,
      targetLanguage: params.targetLanguage ?? null,
      provider: params.provider ?? null,
    }),

  explainPassage: (params: {
    passage: string;
    mode?: "explain" | "translate" | "summarize";
    targetLanguage?: string | null;
    context?: string | null;
    provider?: string | null;
  }) =>
    invoke<string>("explain_passage", {
      passage: params.passage,
      mode: params.mode ?? "explain",
      targetLanguage: params.targetLanguage ?? null,
      context: params.context ?? null,
      provider: params.provider ?? null,
    }),

  chatWordInquiry: (params: {
    word: string;
    context?: string | null;
    query: string;
    history?: { role: string; parts: { text: string }[] }[];
    targetLanguage?: string | null;
    provider?: string | null;
  }) =>
    invoke<string>("chat_word_inquiry", {
      word: params.word,
      context: params.context ?? null,
      query: params.query,
      history: params.history ?? [],
      targetLanguage: params.targetLanguage ?? null,
      provider: params.provider ?? null,
    }),

  toggleFullscreen: () => invoke<boolean>("toggle_fullscreen"),
  setFullscreen: (fullscreen: boolean) =>
    invoke<boolean>("set_fullscreen", { fullscreen }),

  testApiKey: (key: string, provider?: string) =>
    invoke<boolean>("test_api_key", { key, provider: provider ?? null }),
};
