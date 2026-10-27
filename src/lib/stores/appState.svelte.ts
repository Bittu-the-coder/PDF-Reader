import { api, type Book, type BookSummary, type Chapter, type Highlight, type Note, type Shelf, type Word } from "../api";

export type Theme = "dark" | "light" | "sepia" | "eyecare" | "invert";
export type FitMode = "width" | "page" | "custom";
export type ReadingMode = "single" | "dual" | "scroll";
export type MemoryTab = "words" | "notes" | "highlights";

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

  // Selection & Lookup Card
  selectedText = $state<string>("");
  selectedSentence = $state<string>("");
  selectedPage = $state<number>(1);
  selectionRect = $state<{ top: number; left: number; width: number; height: number } | null>(null);
  lookupCardVisible = $state<boolean>(false);
  
  // In-document Search
  searchQuery = $state<string>("");
  searchOpen = $state<boolean>(false);

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

  setFitMode(mode: FitMode) {
    this.fitMode = mode;
  }

  // Load Library & Shelves
  async refreshLibrary() {
    try {
      this.shelves = await api.listShelves();
      this.books = await api.listBooks(this.activeShelfId);
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
    try {
      const book = await api.getBook(bookId);
      this.activeBook = book;
      this.currentPage = Math.max(1, book.last_page || 1);
      this.zoom = book.last_zoom || 1.0;
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
    this.currentView = "shelf";
    this.activeBook = null;
    this.refreshLibrary();
  }

  async refreshBookMemory(bookId: number) {
    try {
      this.chapters = await api.listChapters(bookId);
      this.words = await api.listWords(bookId);
      this.notes = await api.listNotes(bookId);
      this.highlights = await api.listHighlights(bookId);
    } catch (err) {
      console.error("Failed to refresh book memory:", err);
    }
  }

  jumpEvent = $state<{ page: number; textToFlash?: string; token: number } | null>(null);

  jumpToPage(page: number, textToFlash?: string) {
    const target = Math.max(1, Math.min(this.pageCount || 1, page));
    this.currentPage = target;
    if (this.activeBook) {
      api.saveProgress(this.activeBook.id, target, this.zoom).catch(console.error);
    }
    if (textToFlash) {
      this.flashText(textToFlash);
    }
    this.jumpEvent = { page: target, textToFlash, token: Date.now() };
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
