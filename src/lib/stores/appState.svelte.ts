import { api, type Book, type Bookmark, type BookSummary, type Chapter, type Highlight, type Note, type Shelf, type Word } from "../api";
import type { OutlineNode } from "../pdf/pdfViewer";
import type { SearchMatch } from "../pdf/search";

export type Theme = "dark" | "light" | "sepia" | "eyecare" | "invert";
export type FitMode = "width" | "page" | "custom";
export type ReadingMode = "single" | "dual" | "scroll";
export type MemoryTab = "words" | "notes" | "highlights";

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

export interface OpenTab {
  book: Book;
  currentPage: number;
  zoom: number;
}

class AppState {
  // Navigation & View
  currentView = $state<"shelf" | "reader">("shelf");
  theme = $state<Theme>("dark");
  readingMode = $state<ReadingMode>("single");
  shelfViewMode = $state<"3d" | "grid">("3d");
  
  // In-memory buffer cache for loaded PDFs
  docBufferCache = new Map<number, Uint8Array>();
  
  // Library data
  shelves = $state<Shelf[]>([]);
  activeShelfId = $state<number | null>(null);
  books = $state<BookSummary[]>([]);
  
  // Reader state
  activeBook = $state<Book | null>(null);
  openTabs = $state<OpenTab[]>([]);
  currentPage = $state<number>(1);
  pageCount = $state<number>(1);
  zoom = $state<number>(1.0);
  fitMode = $state<FitMode>("width");
  
  // Book Memory
  chapters = $state<Chapter[]>([]);
  words = $state<Word[]>([]);
  notes = $state<Note[]>([]);
  highlights = $state<Highlight[]>([]);
  
  // Smart chrome auto-hide state
  sidebarPinned = $state<boolean>(false);
  topBarPinned = $state<boolean>(true);
  sidebarVisible = $state<boolean>(false);
  topBarVisible = $state<boolean>(true);
  
  // Memory drawer
  memoryDrawerOpen = $state<boolean>(false);
  memoryDrawerPinned = $state<boolean>(false);
  memoryDrawerVisible = $state<boolean>(false);
  activeMemoryTab = $state<MemoryTab>("words");
  
  // Fullscreen state
  isFullscreen = $state<boolean>(false);

  // Window & reader viewport size, used for responsive layout decisions
  windowWidth = $state<number>(typeof window !== "undefined" ? window.innerWidth : 1280);
  windowHeight = $state<number>(typeof window !== "undefined" ? window.innerHeight : 800);
  readerWidth = $state<number>(0);
  readerHeight = $state<number>(0);

  /** Two-page spreads are unreadable in narrow windows, so fall back to single pages there. */
  get layoutMode(): ReadingMode {
    if (this.readingMode === "dual" && this.readerWidth > 0 && this.readerWidth < 760) {
      return "single";
    }
    return this.readingMode;
  }

  /** Pages to advance per step in the current layout. */
  get pageStep(): number {
    return this.layoutMode === "dual" ? 2 : 1;
  }

  get isCompact(): boolean {
    return this.windowWidth < 720;
  }

  // Transient toast message (e.g. "Highlight removed", errors)
  toast = $state<{ message: string; kind: "info" | "error"; token: number } | null>(null);
  private toastTimer: any = null;

  // Selection & Lookup Card
  selectedText = $state<string>("");
  selectedSentence = $state<string>("");
  selectedPage = $state<number>(1);
  selectionRect = $state<{ top: number; left: number; width: number; height: number } | null>(null);
  selectionNormalizedRects = $state<{ x: number; y: number; width: number; height: number }[]>([]);
  lookupCardVisible = $state<boolean>(false);
  activeHighlight = $state<Highlight | null>(null);
  activeHighlightRect = $state<{ top: number; left: number; width: number; height: number } | null>(null);
  
  // In-document search
  searchQuery = $state<string>("");
  searchOpen = $state<boolean>(false);
  searchMatches = $state<SearchMatch[]>([]);
  searchIndex = $state<number>(-1);
  searchScanning = $state<boolean>(false);
  /** Bumped to ask the search bar to focus its input */
  searchFocusToken = $state<number>(0);

  // Bookmarks & table of contents
  bookmarks = $state<Bookmark[]>([]);
  outline = $state<OutlineNode[]>([]);

  /** Pages we jumped away from (links, search, contents), for "Back" */
  backStack = $state<number[]>([]);

  // Dialogs
  reviewOpen = $state<boolean>(false);
  shortcutsOpen = $state<boolean>(false);
  dueCount = $state<number>(0);

  // Reading-time tracking (flushed to the database periodically)
  readingStats = $state<{ seconds: number; pages: number }>({ seconds: 0, pages: 0 });
  private pendingSeconds = 0;
  private pendingPages = 0;
  private lastPageTurnAt = 0;
  private lastTrackedPage = 0;

  // Settings & AI Providers
  settingsModalOpen = $state<boolean>(false);
  aiProvider = $state<"gemini" | "openrouter">("gemini");
  hasApiKey = $state<boolean>(false);
  hasGeminiKey = $state<boolean>(false);
  hasOpenrouterKey = $state<boolean>(false);
  geminiModel = $state<string>("gemini-3.5-flash-lite");
  openrouterModel = $state<string>("google/gemini-2.0-flash-exp:free");
  targetLanguage = $state<string>("Hindi");

  // Visual Jump & Flash target
  flashTargetText = $state<string | null>(null);
  
  private zoomSaveTimer: any = null;
  private topBarHideTimer: any = null;
  private topBarShowTimer: any = null;
  private sidebarHideTimer: any = null;
  private sidebarShowTimer: any = null;

  constructor() {
    // Load theme & reading mode from localStorage if available
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("shelf_theme") as Theme;
      if (savedTheme) {
        this.setTheme(savedTheme);
      } else {
        this.setTheme("dark");
      }

      const savedMode = localStorage.getItem("shelf_reading_mode") as ReadingMode;
      if (savedMode) {
        this.readingMode = savedMode;
      }
    }
  }

  setTheme(t: Theme) {
    this.theme = t;
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", t);
      localStorage.setItem("shelf_theme", t);
    }
  }

  setReadingMode(m: ReadingMode) {
    this.readingMode = m;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("shelf_reading_mode", m);
    }
  }

  async checkApiKey(): Promise<boolean> {
    try {
      const provider = (await api.getSetting("ai_provider")) as "gemini" | "openrouter" | null;
      if (provider) this.aiProvider = provider;

      this.hasGeminiKey = await api.hasApiKey("gemini");
      this.hasOpenrouterKey = await api.hasApiKey("openrouter");
      this.hasApiKey = this.aiProvider === "openrouter" ? this.hasOpenrouterKey : this.hasGeminiKey;

      const gModel = await api.getSetting("gemini_model");
      if (gModel) {
        if (gModel === "gemini-2.5-flash") {
          this.geminiModel = "gemini-3.5-flash-lite";
          api.setSetting("gemini_model", "gemini-3.5-flash-lite").catch(() => {});
        } else {
          this.geminiModel = gModel;
        }
      } else {
        this.geminiModel = "gemini-3.5-flash-lite";
      }

      const oModel = await api.getSetting("openrouter_model");
      if (oModel) this.openrouterModel = oModel;

      const lang = await api.getSetting("target_language");
      if (lang) this.targetLanguage = lang;

      return this.hasApiKey;
    } catch {
      this.hasApiKey = false;
      return false;
    }
  }

  async setAiProvider(provider: "gemini" | "openrouter") {
    this.aiProvider = provider;
    this.hasApiKey = provider === "openrouter" ? this.hasOpenrouterKey : this.hasGeminiKey;
    try {
      await api.setSetting("ai_provider", provider);
    } catch (err) {
      console.error("Failed to save ai provider:", err);
    }
  }

  async setAiModel(model: string) {
    if (this.aiProvider === "openrouter") {
      this.openrouterModel = model;
      await api.setSetting("openrouter_model", model);
    } else {
      this.geminiModel = model;
      await api.setSetting("gemini_model", model);
    }
  }

  async setTargetLanguage(lang: string) {
    this.targetLanguage = lang;
    try {
      await api.setSetting("target_language", lang);
    } catch (err) {
      console.error("Failed to save target language:", err);
    }
  }

  showToast(message: string, kind: "info" | "error" = "info") {
    clearTimeout(this.toastTimer);
    const token = Date.now();
    this.toast = { message, kind, token };
    this.toastTimer = setTimeout(() => {
      if (this.toast?.token === token) this.toast = null;
    }, kind === "error" ? 4200 : 2200);
  }

  flashText(text: string) {
    this.flashTargetText = text;
    setTimeout(() => {
      if (this.flashTargetText === text) {
        this.flashTargetText = null;
      }
    }, 2800);
  }

  // Zoom management
  debouncedSaveZoom() {
    clearTimeout(this.zoomSaveTimer);
    this.zoomSaveTimer = setTimeout(() => {
      this.saveCurrentProgress(this.currentPage, this.zoom);
    }, 300);
  }

  zoomIn() {
    this.fitMode = "custom";
    this.zoom = Math.min(3.0, Number((this.zoom + 0.1).toFixed(2)));
    this.debouncedSaveZoom();
  }

  zoomOut() {
    this.fitMode = "custom";
    this.zoom = Math.max(0.4, Number((this.zoom - 0.1).toFixed(2)));
    this.debouncedSaveZoom();
  }

  setZoom(z: number) {
    this.fitMode = "custom";
    this.zoom = Math.max(0.4, Math.min(3.0, Number(z.toFixed(2))));
    this.debouncedSaveZoom();
  }

  // -------------------------------------------------------------------------
  // Pinch / Ctrl+scroll zoom gestures
  //
  // While a gesture runs, `pinchZoom` holds the zoom the reader should *look*
  // like; the Reader fakes it with a cheap CSS transform of the pages it already
  // rendered. When the gesture ends, `zoom` is committed once (one re-render),
  // and the Reader clears `pinchZoom` as soon as that render is on screen, so
  // the page never snaps back to the old size in between.
  // -------------------------------------------------------------------------

  pinchZoom = $state<number | null>(null);
  pinchActive = $state<boolean>(false);
  private pinchBaseZoom = 1;
  private pinchEndTimer: any = null;

  private clampZoom(z: number) {
    return Math.max(0.4, Math.min(3.0, z));
  }

  beginPinch() {
    clearTimeout(this.pinchEndTimer);
    if (this.pinchActive) return;
    this.pinchActive = true;
    this.pinchBaseZoom = this.pinchZoom ?? this.zoom;
  }

  /** `scale` is relative to the zoom when the gesture began. */
  updatePinch(scale: number) {
    if (!this.pinchActive) this.beginPinch();
    this.pinchZoom = this.clampZoom(this.pinchBaseZoom * scale);
  }

  endPinch() {
    clearTimeout(this.pinchEndTimer);
    if (!this.pinchActive) return;
    this.pinchActive = false;
    if (this.pinchZoom == null) return;
    const target = Number(this.pinchZoom.toFixed(2));
    if (target === this.zoom) {
      this.pinchZoom = null;
      return;
    }
    this.fitMode = "custom";
    this.zoom = target;
    this.debouncedSaveZoom();
  }

  /** Ctrl+scroll, and touchpad pinch on Windows/macOS (delivered as ctrl+wheel). */
  wheelZoom(deltaY: number) {
    this.beginPinch();
    const current = this.pinchZoom ?? this.zoom;
    // Pinch sends many small deltas (smooth); mouse-wheel notches are capped per event
    const factor = Math.max(0.8, Math.min(1.25, Math.exp(-deltaY * 0.01)));
    this.pinchZoom = this.clampZoom(current * factor);
    this.pinchEndTimer = setTimeout(() => this.endPinch(), 180);
  }

  setFitMode(mode: FitMode) {
    this.fitMode = mode;
  }

  // Load Library & Shelves
  async refreshLibrary() {
    try {
      const [shelves, books] = await Promise.all([api.listShelves(), api.listBooks(this.activeShelfId)]);
      this.shelves = shelves;
      this.books = books;
    } catch (err) {
      console.error("Failed to load library:", err);
    }
  }

  async selectShelf(shelfId: number | null) {
    this.activeShelfId = shelfId;
    this.books = await api.listBooks(shelfId);
  }

  // Open Book
  async openBook(bookId: number) {
    if (this.currentView === "reader" && this.activeBook?.id === bookId) return;
    try {
      const book = await api.getBook(bookId);
      this.activeBook = book;
      this.currentPage = Math.max(1, book.last_page || 1);
      this.zoom = book.last_zoom || 1.0;
      this.lookupCardVisible = false;
      this.activeHighlight = null;
      this.activeHighlightRect = null;
      this.flushReadingTime();
      this.closeSearch();
      this.searchQuery = "";
      this.backStack = [];
      this.outline = [];
      this.bookmarks = [];
      this.loadReadingStats(book.id);
      this.currentView = "reader";

      // Add to open tabs if not present
      if (!this.openTabs.some((t) => t.book.id === book.id)) {
        this.openTabs.push({ book, currentPage: this.currentPage, zoom: this.zoom });
      }

      await this.refreshBookMemory(book.id);
    } catch (err) {
      console.error("Failed to open book:", err);
    }
  }

  /** Status text while a PDF is being imported, null when idle. */
  importStatus = $state<string | null>(null);

  /**
   * Open a PDF from disk: reuse the library entry when the file is known,
   * otherwise import it (cover, outline) and open it.
   */
  async openPdfFilePath(filePath: string) {
    if (!filePath || !filePath.trim() || this.importStatus) return;
    try {
      this.importStatus = "Reading PDF…";
      await this.refreshLibrary();
      const normalized = normalizePath(filePath);
      const existing = this.books.find((b) => normalizePath(b.file_path) === normalized);
      if (existing) {
        await this.openBook(existing.id);
        return;
      }

      const masterBytes = await api.readPdfBytes(filePath);
      const fileName = filePath.split(/[/\\]/).pop()?.replace(/\.pdf$/i, "") || "Document";
      await this.importPdfBytes(masterBytes, filePath, fileName);
    } catch (err: any) {
      console.error("Failed to open PDF from path:", err);
      this.showToast(`Could not open PDF: ${err?.message || err}`, "error");
    } finally {
      this.importStatus = null;
    }
  }

  /** Register already-loaded PDF bytes in the library and open the book. */
  async importPdfBytes(masterBytes: Uint8Array, filePath: string, title: string) {
    this.importStatus = "Reading pages & chapters…";
    const { PDFViewer } = await import("../pdf/pdfViewer");
    const viewer = new PDFViewer();
    try {
      const pageCount = await viewer.load(masterBytes);
      const coverPng = await viewer.generateCoverPng();
      const outline = await viewer.extractOutline();

      this.importStatus = "Adding to library…";
      const book = await api.addBook({
        path: filePath,
        shelfId: this.activeShelfId,
        title,
        pageCount,
        coverPng,
      });

      if (outline.length > 0) {
        await api.importOutline(book.id, outline).catch((e) => console.warn("Outline import failed:", e));
      }

      this.docBufferCache.set(book.id, masterBytes);
      await this.refreshLibrary();
      await this.openBook(book.id);
    } finally {
      viewer.destroy();
    }
  }

  closeTab(bookId: number) {
    this.openTabs = this.openTabs.filter((t) => t.book.id !== bookId);
    if (this.activeBook?.id === bookId) {
      if (this.openTabs.length > 0) {
        this.openBook(this.openTabs[this.openTabs.length - 1].book.id);
      } else {
        this.goToShelf();
      }
    }
  }

  goToShelf() {
    this.flushReadingTime();
    this.closeSearch();
    this.currentView = "shelf";
    this.activeBook = null;
    this.refreshLibrary();
  }

  async refreshBookMemory(bookId: number) {
    try {
      const [chapters, words, notes, highlights, bookmarks] = await Promise.all([
        api.listChapters(bookId),
        api.listWords(bookId),
        api.listNotes(bookId),
        api.listHighlights(bookId),
        api.listBookmarks(bookId).catch(() => [] as Bookmark[]),
      ]);
      // Ignore late results if the user switched books meanwhile
      if (this.activeBook && this.activeBook.id !== bookId) return;
      this.chapters = chapters;
      this.words = words;
      this.notes = notes;
      this.highlights = highlights;
      this.bookmarks = bookmarks;
      this.refreshDueCount();
    } catch (err) {
      console.error("Failed to refresh book memory:", err);
    }
  }

  async addHighlight(input: { page: number; text: string; rects: { x: number; y: number; width: number; height: number }[]; color: string }) {
    const book = this.activeBook;
    if (!book) return;
    const tempId = -Date.now();
    const rectsJson = JSON.stringify(input.rects);
    const optimistic: Highlight = {
      id: tempId,
      book_id: book.id,
      page: input.page,
      color: input.color,
      text: input.text,
      rects_json: rectsJson,
      note_id: null,
      created_at: new Date().toISOString(),
    };
    this.highlights = [...this.highlights, optimistic];
    try {
      const saved = await api.addHighlight({
        bookId: book.id,
        page: input.page,
        text: input.text,
        rectsJson,
        color: input.color,
      });
      this.highlights = this.highlights.map((h) => (h.id === tempId ? saved : h));
    } catch (err) {
      this.highlights = this.highlights.filter((h) => h.id !== tempId);
      this.showToast("Could not save the highlight.", "error");
      console.error("Failed to add highlight:", err);
    }
  }

  async setHighlightColor(id: number, color: string) {
    const prev = this.highlights;
    this.highlights = this.highlights.map((h) => (h.id === id ? { ...h, color } : h));
    if (this.activeHighlight?.id === id) this.activeHighlight = { ...this.activeHighlight, color };
    try {
      await api.updateHighlightColor(id, color);
    } catch (err) {
      this.highlights = prev;
      this.showToast("Could not update the highlight.", "error");
      console.error("Failed to update highlight color:", err);
    }
  }

  async removeHighlight(id: number) {
    const prev = this.highlights;
    this.highlights = this.highlights.filter((h) => h.id !== id);
    if (this.activeHighlight?.id === id) {
      this.activeHighlight = null;
      this.activeHighlightRect = null;
    }
    try {
      await api.deleteHighlight(id);
      this.showToast("Annotation removed");
    } catch (err) {
      this.highlights = prev;
      this.showToast("Could not remove the annotation.", "error");
      console.error("Failed to delete highlight:", err);
    }
  }

  jumpEvent = $state<{ page: number; textToFlash?: string; token: number } | null>(null);

  /**
   * Go to a page. `remember` records the current page so the reader can come
   * back (used for link, search and contents jumps).
   */
  jumpToPage(page: number, textToFlash?: string, remember = false) {
    const target = Math.max(1, Math.min(this.pageCount || 1, page));
    if (remember && target !== this.currentPage) {
      this.backStack = [...this.backStack.slice(-19), this.currentPage];
    }
    this.currentPage = target;
    if (this.activeBook) {
      api.saveProgress(this.activeBook.id, target, this.zoom).catch(console.error);
    }
    if (textToFlash) {
      this.flashText(textToFlash);
    }
    this.jumpEvent = { page: target, textToFlash, token: Date.now() };
  }

  goBack() {
    const prev = this.backStack[this.backStack.length - 1];
    if (prev == null) return;
    this.backStack = this.backStack.slice(0, -1);
    this.jumpToPage(prev);
  }

  // -------------------------------------------------------------------------
  // Bookmarks
  // -------------------------------------------------------------------------

  isBookmarked(page: number) {
    return this.bookmarks.some((b) => b.page === page);
  }

  async toggleBookmark(page = this.currentPage) {
    const book = this.activeBook;
    if (!book) return;
    const exists = this.isBookmarked(page);
    try {
      if (exists) {
        await api.deleteBookmark(book.id, page);
        this.bookmarks = this.bookmarks.filter((b) => b.page !== page);
        this.showToast(`Bookmark on page ${page} removed`);
      } else {
        await api.addBookmark(book.id, page, this.chapterTitleFor(page));
        this.bookmarks = await api.listBookmarks(book.id);
        this.showToast(`Page ${page} bookmarked`);
      }
    } catch (err) {
      this.showToast("Could not update the bookmark.", "error");
      console.error("Bookmark toggle failed:", err);
    }
  }

  // -------------------------------------------------------------------------
  // Table of contents
  // -------------------------------------------------------------------------

  /** All outline entries with a page, in document order. */
  get outlineFlat(): OutlineNode[] {
    const out: OutlineNode[] = [];
    const walk = (nodes: OutlineNode[]) => {
      for (const n of nodes) {
        if (n.page) out.push(n);
        walk(n.children);
      }
    };
    walk(this.outline);
    return out.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
  }

  chapterTitleFor(page: number): string | null {
    let title: string | null = null;
    for (const n of this.outlineFlat) {
      if ((n.page ?? Infinity) <= page) title = n.title;
      else break;
    }
    return title;
  }

  /** First page of the next outline entry after `page`, or the end of the book. */
  chapterEndFor(page: number): number {
    for (const n of this.outlineFlat) {
      if ((n.page ?? 0) > page) return (n.page as number) - 1;
    }
    return this.pageCount;
  }

  // -------------------------------------------------------------------------
  // Reading time
  // -------------------------------------------------------------------------

  /** Seconds per page from this reader's history; a sensible default until we know. */
  get secondsPerPage(): number {
    const seconds = this.readingStats.seconds + this.pendingSeconds;
    const pages = this.readingStats.pages + this.pendingPages;
    if (pages < 5) return 75;
    return Math.max(15, Math.min(600, seconds / pages));
  }

  /** Call whenever the visible page changes. Counts time spent on the previous page. */
  trackPageTurn(page: number) {
    const now = Date.now();
    if (this.lastTrackedPage && page !== this.lastTrackedPage) {
      const elapsed = (now - this.lastPageTurnAt) / 1000;
      // Ignore skimming (< 3 s) and idle time (> 10 min)
      if (elapsed >= 3 && elapsed <= 600) {
        this.pendingSeconds += Math.round(elapsed);
        this.pendingPages += 1;
      }
    }
    this.lastTrackedPage = page;
    this.lastPageTurnAt = now;
    if (this.pendingPages >= 10) this.flushReadingTime();
  }

  async loadReadingStats(bookId: number) {
    this.lastTrackedPage = 0;
    try {
      this.readingStats = await api.readingStats(bookId);
    } catch {
      this.readingStats = { seconds: 0, pages: 0 };
    }
  }

  flushReadingTime() {
    const book = this.activeBook;
    if (!book || this.pendingSeconds <= 0) return;
    const seconds = this.pendingSeconds;
    const pages = this.pendingPages;
    this.pendingSeconds = 0;
    this.pendingPages = 0;
    this.readingStats = { seconds: this.readingStats.seconds + seconds, pages: this.readingStats.pages + pages };
    api.logReading(book.id, seconds, pages).catch((e) => console.warn("Could not log reading time:", e));
  }

  async refreshDueCount() {
    try {
      this.dueCount = await api.countDueCards(this.activeBook?.id ?? null);
    } catch {
      this.dueCount = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  openSearch() {
    this.searchOpen = true;
    this.searchFocusToken = Date.now();
  }

  closeSearch() {
    this.searchOpen = false;
    this.searchMatches = [];
    this.searchIndex = -1;
  }

  gotoMatch(index: number) {
    const n = this.searchMatches.length;
    if (n === 0) return;
    const i = ((index % n) + n) % n;
    const first = this.searchIndex === -1;
    this.searchIndex = i;
    this.jumpToPage(this.searchMatches[i].page, undefined, first);
  }

  async saveCurrentProgress(page: number, zoom?: number) {
    this.currentPage = Math.max(1, Math.min(this.pageCount || 1, page));
    if (zoom) this.zoom = zoom;
    if (this.activeBook) {
      api.saveProgress(this.activeBook.id, this.currentPage, zoom ?? this.zoom).catch(console.error);
    }
  }

  // Hot edge hover handlers for topbar
  onTopEdgeEnter() {
    clearTimeout(this.topBarHideTimer);
    this.topBarShowTimer = setTimeout(() => {
      this.topBarVisible = true;
    }, 60);
  }

  onTopEdgeLeave() {
    if (this.topBarPinned || this.searchOpen) return;
    clearTimeout(this.topBarShowTimer);
    this.topBarHideTimer = setTimeout(() => {
      this.topBarVisible = false;
    }, 400);
  }

  // Left Sidebar smart hover handlers
  onLeftEdgeEnter() {
    if (this.sidebarPinned) return;
    clearTimeout(this.sidebarHideTimer);
    this.sidebarShowTimer = setTimeout(() => {
      this.sidebarVisible = true;
    }, 100);
  }

  onLeftEdgeLeave() {
    if (this.sidebarPinned) return;
    clearTimeout(this.sidebarShowTimer);
    this.sidebarHideTimer = setTimeout(() => {
      this.sidebarVisible = false;
    }, 350);
  }

  toggleSidebarPinned() {
    this.sidebarPinned = !this.sidebarPinned;
    if (this.sidebarPinned) {
      this.sidebarVisible = true;
    }
  }

  toggleTopBarPinned() {
    this.topBarPinned = !this.topBarPinned;
    if (this.topBarPinned) {
      this.topBarVisible = true;
    }
  }

  toggleSidebar() {
    this.sidebarVisible = !this.sidebarVisible;
  }

  toggleMemoryDrawer() {
    this.memoryDrawerOpen = !this.memoryDrawerOpen;
  }

  openMemory(tab: MemoryTab) {
    this.activeMemoryTab = tab;
    this.memoryDrawerOpen = true;
  }

  async toggleFullscreen() {
    try {
      this.isFullscreen = await api.toggleFullscreen();
    } catch {
      // Browser / web fallback
      if (typeof document !== "undefined") {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen().catch(() => {});
          this.isFullscreen = true;
        } else {
          await document.exitFullscreen().catch(() => {});
          this.isFullscreen = false;
        }
      }
    }
  }

  async exitFullscreen() {
    try {
      await api.setFullscreen(false);
      this.isFullscreen = false;
    } catch {
      if (typeof document !== "undefined" && document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
      this.isFullscreen = false;
    }
  }
}

export const appState = new AppState();
