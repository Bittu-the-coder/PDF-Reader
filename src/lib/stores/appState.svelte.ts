import { api, type Book, type BookSummary, type Chapter, type Highlight, type Note, type Shelf, type Word } from "../api";

export type Theme = "dark" | "light" | "sepia";
export type FitMode = "width" | "page" | "free";
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
  topBarPinned = $state<boolean>(false);
  sidebarVisible = $state<boolean>(false);
  topBarVisible = $state<boolean>(false);
  focusMode = $state<boolean>(false);
  
  // Memory drawer
  memoryDrawerOpen = $state<boolean>(false);
  activeMemoryTab = $state<MemoryTab>("words");
  
  // Selection & Lookup Card
  selectedText = $state<string>("");
  selectedSentence = $state<string>("");
  selectionRect = $state<{ top: number; left: number; width: number; height: number } | null>(null);
  lookupCardVisible = $state<boolean>(false);
  
  // In-document Search
  searchQuery = $state<string>("");
  searchOpen = $state<boolean>(false);
  
  // Timers for auto-hide delays
  private topBarHideTimer: any = null;
  private sidebarHideTimer: any = null;
  private topBarShowTimer: any = null;
  private sidebarShowTimer: any = null;

  constructor() {
    // Load theme from localStorage if available
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("shelf_theme") as Theme;
      if (savedTheme) {
        this.setTheme(savedTheme);
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
      this.currentPage = book.last_page || 1;
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

  async saveCurrentProgress(page: number, zoom?: number) {
    this.currentPage = page;
    if (zoom) this.zoom = zoom;
    if (this.activeBook) {
      api.saveProgress(this.activeBook.id, page, zoom ?? this.zoom).catch(console.error);
    }
  }

  // Hot edge hover handlers
  onTopEdgeEnter() {
    if (this.focusMode) return;
    clearTimeout(this.topBarHideTimer);
    this.topBarShowTimer = setTimeout(() => {
      this.topBarVisible = true;
    }, 100);
  }

  onTopEdgeLeave() {
    if (this.topBarPinned || this.searchOpen) return;
    clearTimeout(this.topBarShowTimer);
    this.topBarHideTimer = setTimeout(() => {
      this.topBarVisible = false;
    }, 300);
  }

  onLeftEdgeEnter() {
    if (this.focusMode) return;
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
    }, 300);
  }

  toggleFocusMode() {
    this.focusMode = !this.focusMode;
    if (this.focusMode) {
      this.topBarVisible = false;
      this.sidebarVisible = false;
      this.memoryDrawerOpen = false;
    }
  }
}

export const appState = new AppState();
