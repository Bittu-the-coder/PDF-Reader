<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { appState } from "../stores/appState.svelte";
  import { api, type BookSummary } from "../api";
  import { PDFViewer } from "../pdf/pdfViewer";
  import { open as openFileDialog } from "@tauri-apps/plugin-dialog";

  let isDraggingOver = $state(false);
  let isAddingBook = $state(false);
  let addingStatus = $state("Opening PDF...");
  let searchQuery = $state("");
  let newShelfModal = $state(false);
  let newShelfName = $state("");
  let fileInputEl: HTMLInputElement;
  let bookCoverUrls = $state<Map<number, string>>(new Map());
  let unlistenDragDrop: (() => void) | null = null;

  onMount(() => {
    appState.refreshLibrary();

    // Hook native Tauri window drag-and-drop for true absolute paths
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) => {
        getCurrentWebview()
          .onDragDropEvent((event) => {
            if (event.payload.type === "over") {
              isDraggingOver = true;
            } else if (event.payload.type === "drop") {
              isDraggingOver = false;
              const paths = event.payload.paths;
              if (paths && paths.length > 0) {
                for (const p of paths) {
                  if (p.toLowerCase().endsWith(".pdf")) {
                    processPdfFromPath(p);
                    break;
                  }
                }
              }
            } else {
              isDraggingOver = false;
            }
          })
          .then((unlisten) => {
            unlistenDragDrop = unlisten;
          })
          .catch((e) => {
            console.warn("Tauri drag-drop listener error:", e);
          });
      })
      .catch((e) => {
        console.warn("Could not import Tauri webview module:", e);
      });
  });

  onDestroy(() => {
    unlistenDragDrop?.();
    // Revoke object URLs to avoid memory leaks
    for (const url of bookCoverUrls.values()) {
      URL.revokeObjectURL(url);
    }
  });

  // Fetch covers from SQLite for books that have them
  $effect(() => {
    const books = appState.books;
    for (const b of books) {
      if (!bookCoverUrls.has(b.id)) {
        api.getBookCover(b.id).then((coverBytes) => {
          if (coverBytes && coverBytes.length > 0) {
            const blob = new Blob([new Uint8Array(coverBytes)], { type: "image/png" });
            const url = URL.createObjectURL(blob);
            bookCoverUrls.set(b.id, url);
          }
        }).catch(() => {});
      }
    }
  });

  // Color generator for 3D book covers
  const coverStyles = [
    { bg: "linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%)", accent: "#fbbf24", spine: "#581c1c", ribbon: "#ef4444" },
    { bg: "linear-gradient(135deg, #064e3b 0%, #022c22 100%)", accent: "#34d399", spine: "#06382a", ribbon: "#10b981" },
    { bg: "linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)", accent: "#93c5fd", spine: "#161638", ribbon: "#3b82f6" },
    { bg: "linear-gradient(135deg, #4c1d95 0%, #2e1065 100%)", accent: "#f472b6", spine: "#3b1577", ribbon: "#d946ef" },
    { bg: "linear-gradient(135deg, #78350f 0%, #451a03 100%)", accent: "#fcd34d", spine: "#5a2609", ribbon: "#f59e0b" },
    { bg: "linear-gradient(135deg, #1f2937 0%, #111827 100%)", accent: "#e2e8f0", spine: "#171f2c", ribbon: "#94a3b8" },
  ];

  function getCoverStyle(title: string) {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = title.charCodeAt(i) + ((hash << 5) - hash);
    }
    return coverStyles[Math.abs(hash) % coverStyles.length];
  }

  // Primary action: Native File Picker
  async function handleOpenPdfClick() {
    try {
      const selected = await openFileDialog({
        multiple: false,
        filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
      });
      if (selected && typeof selected === "string") {
        await processPdfFromPath(selected);
        return;
      }
    } catch (err) {
      console.warn("Tauri openFileDialog fallback:", err);
    }
    // Fallback to web input
    fileInputEl?.click();
  }

  async function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    await processPdfFile(file);
    input.value = "";
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDraggingOver = false;
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
    const file = e.dataTransfer.files[0];
    if (file.name.toLowerCase().endsWith(".pdf")) {
      await processPdfFile(file);
    }
  }

  // Unified PDF processing logic ensuring pristine master bytes
  async function processPdfFromBytesAndPath(masterBytes: Uint8Array, filePath: string, defaultTitle: string) {
    addingStatus = "Parsing PDF chapters & thumbnail...";
    const viewer = new PDFViewer();

    // ALWAYS pass a clone (.slice()) so masterBytes is never neutered by PDF.js worker transfer!
    const pageCount = await viewer.load(masterBytes.slice());
    const coverPng = await viewer.generateCoverPng();
    const outline = await viewer.extractOutline();

    addingStatus = "Saving to library...";
    const book = await api.addBook({
      path: filePath,
      shelfId: appState.activeShelfId,
      title: defaultTitle,
      pageCount,
      coverPng,
    });

    if (outline.length > 0) {
      await api.importOutline(book.id, outline);
    }

    // Cache pristine master bytes
    appState.docBufferCache.set(book.id, masterBytes);
    await appState.refreshLibrary();
    await appState.openBook(book.id);
  }

  async function processPdfFromPath(filePath: string) {
    isAddingBook = true;
    addingStatus = "Reading PDF file...";
    try {
      const bytes = await api.readPdfBytes(filePath);
      const masterBytes = new Uint8Array(bytes);
      const fileName = filePath.split(/[/\\]/).pop()?.replace(/\.pdf$/i, "") || "Untitled Book";
      await processPdfFromBytesAndPath(masterBytes, filePath, fileName);
    } catch (err: any) {
      console.error("Failed to open PDF from path:", err);
      alert(`Could not load PDF: ${err?.message || err}`);
    } finally {
      isAddingBook = false;
    }
  }

  async function processPdfFile(file: File) {
    isAddingBook = true;
    addingStatus = "Reading PDF data...";
    try {
      const buffer = await file.arrayBuffer();
      const masterBytes = new Uint8Array(buffer);

      let filePath = (file as any).path;
      if (!filePath) {
        addingStatus = "Saving imported PDF...";
        filePath = await api.saveImportedPdf(file.name, Array.from(masterBytes));
      }

      const title = file.name.replace(/\.pdf$/i, "");
      await processPdfFromBytesAndPath(masterBytes, filePath, title);
    } catch (err: any) {
      console.error("Failed to process dropped PDF:", err);
      alert(`Could not load PDF: ${err?.message || err}`);
    } finally {
      isAddingBook = false;
    }
  }

  async function handleCreateShelf() {
    if (!newShelfName.trim()) return;
    try {
      await api.createShelf(newShelfName.trim());
      await appState.refreshLibrary();
      newShelfModal = false;
      newShelfName = "";
    } catch (err) {
      console.error("Failed to create shelf:", err);
    }
  }

  async function handleDeleteBook(e: MouseEvent, bookId: number) {
    e.stopPropagation();
    if (confirm("Delete this book and its saved vocabulary & notes?")) {
      await api.deleteBook(bookId);
      await appState.refreshLibrary();
    }
  }

  // Filter books by search query
  let filteredBooks = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return appState.books;
    return appState.books.filter((b) =>
      b.title.toLowerCase().includes(q) || (b.author && b.author.toLowerCase().includes(q))
    );
  });

  // Chunk books into groups of 4 for 3D wooden shelf rows
  let shelfRows = $derived.by(() => {
    const rows: BookSummary[][] = [];
    const books = filteredBooks;
    const chunkSize = 4;
    for (let i = 0; i < books.length; i += chunkSize) {
      rows.push(books.slice(i, i + chunkSize));
    }
    return rows;
  });

  const shelfRomanNumerals = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
</script>

<div
  class="shelf-container {isDraggingOver ? 'dragging' : ''}"
  ondragover={(e) => { e.preventDefault(); isDraggingOver = true; }}
  ondragleave={() => (isDraggingOver = false)}
  ondrop={handleDrop}
  role="region"
  aria-label="3D Library Shelf"
>
  <!-- Shelf Top Navigation -->
  <header class="shelf-header">
    <div class="brand">
      <div class="logo-mark">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
          <path d="M6 6h10"/><path d="M6 10h10"/>
        </svg>
      </div>
      <div class="brand-text">
        <span class="brand-title">Shelf</span>
        <span class="brand-subtitle">Private 3D Library</span>
      </div>
    </div>

    <!-- Shelves Tabs -->
    <div class="shelves-tabs">
      <button
        class="shelf-tab {appState.activeShelfId === null ? 'active' : ''}"
        onclick={() => appState.selectShelf(null)}
      >
        All Volumes ({appState.books.length})
      </button>
      {#each appState.shelves as s (s.id)}
        <button
          class="shelf-tab {appState.activeShelfId === s.id ? 'active' : ''}"
          onclick={() => appState.selectShelf(s.id)}
        >
          {s.name}
        </button>
      {/each}
      <button class="add-shelf-btn" onclick={() => (newShelfModal = true)} title="Create New Shelf">
        +
      </button>
    </div>

    <!-- Search in Collection -->
    <div class="search-box">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.3-4.3"/>
      </svg>
      <input
        type="text"
        placeholder="Search library..."
        bind:value={searchQuery}
        class="search-input"
      />
    </div>

    <!-- Actions & View Mode Toggle -->
    <div class="shelf-actions">
      <div class="view-toggle">
        <button
          class="toggle-btn {appState.shelfViewMode === '3d' ? 'active' : ''}"
          onclick={() => (appState.shelfViewMode = "3d")}
          title="3D Bookshelf View"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m21 16-9 5-9-5V8l9-5 9 5v8Z"/>
            <path d="m3.27 6.96 8.73 4.85 8.73-4.85"/>
            <path d="M12 22.08V12"/>
          </svg>
          <span>3D Library</span>
        </button>
        <button
          class="toggle-btn {appState.shelfViewMode === 'grid' ? 'active' : ''}"
          onclick={() => (appState.shelfViewMode = "grid")}
          title="Flat Grid View"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect width="7" height="7" x="3" y="3" rx="1"/>
            <rect width="7" height="7" x="14" y="3" rx="1"/>
            <rect width="7" height="7" x="14" y="14" rx="1"/>
            <rect width="7" height="7" x="3" y="14" rx="1"/>
          </svg>
          <span>Grid</span>
        </button>
      </div>

      <button class="btn-primary open-file-btn" onclick={handleOpenPdfClick}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14"/><path d="M5 12h14"/>
        </svg>
        <span>Open PDF</span>
      </button>

      <!-- Hidden file input for web fallback -->
      <input
        type="file"
        accept=".pdf"
        onchange={handleFileSelect}
        bind:this={fileInputEl}
        class="hidden-input"
      />
    </div>
  </header>

  <!-- Library Showcase Area -->
  <main class="library-viewport">
    {#if isAddingBook}
      <div class="loading-state">
        <div class="spinner"></div>
        <span>{addingStatus}</span>
      </div>
    {:else if filteredBooks.length === 0}
      <div class="empty-shelf">
        <div class="empty-bookcase-illustration">
          <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
            <path d="M6 6h10"/><path d="M6 10h10"/>
            <path d="M10 14h6"/>
          </svg>
        </div>
        {#if searchQuery.trim()}
          <h2>No matching books found</h2>
          <p>No titles or authors match "{searchQuery}". Clear your search to see all shelved books.</p>
          <button class="btn-ghost" onclick={() => (searchQuery = "")}>Clear Search</button>
        {:else}
          <h2>Your 3D Library is Empty</h2>
          <p>Click "Open PDF" or drag and drop any PDF file onto the library shelves to start reading with memory.</p>
          <button class="btn-primary" onclick={handleOpenPdfClick}>
            Choose a PDF from your computer
          </button>
        {/if}
      </div>
    {:else if appState.shelfViewMode === "3d"}
      <!-- 3D Realistic Wooden Bookshelf Scene -->
      <div class="bookshelf-scene">
        <div class="library-ambient-light"></div>
        {#each shelfRows as row, rIndex}
          <div class="bookshelf-row">
            <!-- Books standing on the shelf in 3D -->
            <div class="books-track">
              {#each row as book (book.id)}
                {@const style = getCoverStyle(book.title)}
                <div
                  class="book-3d-wrapper"
                  onclick={() => appState.openBook(book.id)}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => e.key === "Enter" && appState.openBook(book.id)}
                >
                  <!-- 3D Book Container -->
                  <div class="book-3d" style="--book-cover: {style.bg}; --book-accent: {style.accent}; --book-spine: {style.spine}; --book-ribbon: {style.ribbon};">
                    <!-- Front Cover -->
                    <div class="book-face book-front">
                      {#if bookCoverUrls.has(book.id)}
                        <img src={bookCoverUrls.get(book.id)} alt={book.title} class="cover-image" />
                        <div class="cover-overlay">
                          <div class="cover-header">
                            <span class="cover-tag">PDF</span>
                            {#if book.word_count > 0}
                              <span class="cover-stat">{book.word_count} words</span>
                            {/if}
                          </div>
                          <div class="cover-footer">
                            <span class="page-indicator">
                              Page {book.last_page}{#if book.page_count} / {book.page_count}{/if}
                            </span>
                          </div>
                        </div>
                      {:else}
                        <div class="cover-emboss">
                          <div class="cover-header">
                            <span class="cover-tag">PDF</span>
                            {#if book.word_count > 0}
                              <span class="cover-stat">{book.word_count} words</span>
                            {/if}
                          </div>

                          <div class="cover-center">
                            <h3 class="cover-title">{book.title}</h3>
                            {#if book.author}
                              <p class="cover-author">{book.author}</p>
                            {/if}
                          </div>

                          <div class="cover-footer">
                            <span class="page-indicator">
                              Page {book.last_page}{#if book.page_count} / {book.page_count}{/if}
                            </span>
                          </div>
                        </div>
                      {/if}

                      <!-- Bookmark Ribbon -->
                      <div class="bookmark-ribbon"></div>
                      <!-- Shimmer lighting overlay -->
                      <div class="cover-glare"></div>
                    </div>

                    <!-- 3D Spine (left) -->
                    <div class="book-face book-spine">
                      <div class="spine-emboss">
                        <span class="spine-rib"></span>
                        <span class="spine-title">{book.title}</span>
                        <div class="spine-bottom-tag">
                          <span class="spine-rib"></span>
                          <span class="spine-code">P.{book.last_page}</span>
                        </div>
                      </div>
                    </div>

                    <!-- 3D Pages (right thickness) -->
                    <div class="book-face book-pages-right"></div>
                    <!-- 3D Top Pages -->
                    <div class="book-face book-pages-top"></div>

                    <!-- Dynamic drop shadow on the wooden shelf below -->
                    <div class="book-cast-shadow"></div>
                  </div>

                  <!-- Quick Delete Action -->
                  <button
                    class="book-delete-btn"
                    onclick={(e) => handleDeleteBook(e, book.id)}
                    title="Remove from Shelf"
                  >
                    ×
                  </button>
                </div>
              {/each}
            </div>

            <!-- 3D Wood Shelf Plank with depth and brass nameplate -->
            <div class="shelf-wood-plank">
              <div class="plank-surface"></div>
              <div class="plank-front">
                <div class="brass-plaque">
                  <span class="screw left"></span>
                  <span class="plaque-text">
                    TIER {shelfRomanNumerals[rIndex] || (rIndex + 1)} • {appState.activeShelfId ? (appState.shelves.find(s => s.id === appState.activeShelfId)?.name || "COLLECTION") : "MAIN COLLECTION"}
                  </span>
                  <span class="screw right"></span>
                </div>
              </div>
              <div class="plank-shadow"></div>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <!-- Modern Grid View -->
      <div class="grid-scene">
        {#each filteredBooks as book (book.id)}
          {@const style = getCoverStyle(book.title)}
          <div
            class="flat-card"
            onclick={() => appState.openBook(book.id)}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === "Enter" && appState.openBook(book.id)}
          >
            <div class="flat-cover" style="background: {style.bg};">
              {#if bookCoverUrls.has(book.id)}
                <img src={bookCoverUrls.get(book.id)} alt={book.title} class="flat-cover-img" />
              {/if}
              <h3 class="flat-title">{book.title}</h3>
              <button
                class="book-delete-btn"
                onclick={(e) => handleDeleteBook(e, book.id)}
                title="Remove from Shelf"
              >
                ×
              </button>
            </div>
            <div class="flat-meta">
              <span class="flat-page">Page {book.last_page} of {book.page_count || "?"}</span>
              {#if book.word_count > 0}
                <span class="badge-v">{book.word_count} words</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </main>
</div>

<!-- Add Shelf Modal -->
{#if newShelfModal}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={() => (newShelfModal = false)}
    onkeydown={(e) => e.key === "Escape" && (newShelfModal = false)}
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <h3>Create New Shelf</h3>
      <input
        type="text"
        bind:value={newShelfName}
        placeholder="Shelf name (e.g. Science, Philosophy)"
        onkeydown={(e) => e.key === "Enter" && handleCreateShelf()}
      />
      <div class="modal-actions">
        <button class="btn-ghost" onclick={() => (newShelfModal = false)}>Cancel</button>
        <button class="btn-primary" onclick={handleCreateShelf}>Create Shelf</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .shelf-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: radial-gradient(circle at 50% 10%, #1a1512 0%, #0d0a08 100%);
    overflow: hidden;
    position: relative;
    user-select: none;
  }

  .shelf-container.dragging::after {
    content: "Drop PDF onto the 3D Library Shelf";
    position: absolute;
    inset: 16px;
    border: 3px dashed var(--accent);
    background: rgba(217, 119, 6, 0.15);
    border-radius: var(--radius-lg);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 600;
    color: var(--accent);
    z-index: 1000;
    backdrop-filter: blur(8px);
    pointer-events: none;
  }

  .shelf-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 28px;
    background: rgba(26, 21, 18, 0.85);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(16px);
    z-index: 10;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .logo-mark {
    width: 36px;
    height: 36px;
    background: linear-gradient(135deg, #d97706 0%, #92400e 100%);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    box-shadow: 0 4px 12px rgba(217, 119, 6, 0.3);
  }

  .brand-title {
    font-family: Georgia, serif;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: #fef3c7;
    display: block;
  }

  .brand-subtitle {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
  }

  .shelves-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(0, 0, 0, 0.35);
    padding: 3px;
    border-radius: var(--radius-sm);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .shelf-tab {
    padding: 5px 14px;
    font-size: 12px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.65);
    border-radius: var(--radius-xs);
    transition: all 150ms ease;
  }

  .shelf-tab.active {
    background: rgba(217, 119, 6, 0.2);
    color: #fbbf24;
    border: 1px solid rgba(217, 119, 6, 0.4);
    box-shadow: var(--shadow-sm);
  }

  .add-shelf-btn {
    width: 26px;
    height: 26px;
    font-size: 16px;
    color: rgba(255, 255, 255, 0.4);
    border-radius: var(--radius-xs);
  }

  .add-shelf-btn:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.1);
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-sm);
    padding: 5px 12px;
    color: rgba(255, 255, 255, 0.5);
    width: 200px;
  }

  .search-input {
    background: transparent;
    border: none;
    color: #ffffff;
    font-size: 12px;
    outline: none;
    width: 100%;
  }

  .search-input::placeholder {
    color: rgba(255, 255, 255, 0.35);
  }

  .shelf-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .view-toggle {
    display: flex;
    align-items: center;
    background: rgba(0, 0, 0, 0.35);
    padding: 2px;
    border-radius: var(--radius-sm);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .toggle-btn {
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
    display: flex;
    align-items: center;
    gap: 5px;
    border-radius: var(--radius-xs);
  }

  .toggle-btn.active {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  .open-file-btn {
    padding: 8px 18px;
    font-size: 13px;
    font-weight: 600;
    background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
    color: #ffffff;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 4px 14px rgba(217, 119, 6, 0.35);
    transition: transform 150ms ease, box-shadow 150ms ease;
  }

  .open-file-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(217, 119, 6, 0.5);
  }

  .hidden-input {
    display: none;
  }

  .library-viewport {
    flex: 1;
    overflow-y: auto;
    padding: 40px 60px 80px;
    perspective: 1400px;
    position: relative;
  }

  /* 3D Realistic Bookshelf Architecture */
  .bookshelf-scene {
    display: flex;
    flex-direction: column;
    gap: 70px;
    max-width: 1200px;
    margin: 0 auto;
    perspective: 1400px;
    position: relative;
  }

  .library-ambient-light {
    position: absolute;
    top: -50px;
    left: 20%;
    right: 20%;
    height: 150px;
    background: radial-gradient(ellipse at center, rgba(251, 191, 36, 0.15) 0%, transparent 70%);
    pointer-events: none;
  }

  .bookshelf-row {
    display: flex;
    flex-direction: column;
    position: relative;
    transform-style: preserve-3d;
  }

  .books-track {
    display: flex;
    align-items: flex-end;
    gap: 48px;
    padding: 0 40px;
    height: 290px;
    position: relative;
    z-index: 2;
    transform-style: preserve-3d;
  }

  /* 3D Book styling */
  .book-3d-wrapper {
    position: relative;
    width: 190px;
    height: 270px;
    perspective: 1000px;
    cursor: pointer;
  }

  .book-3d {
    width: 100%;
    height: 100%;
    position: relative;
    transform-style: preserve-3d;
    transform: rotateY(-18deg) translateZ(0px);
    transition: transform 320ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 320ms ease;
  }

  .book-3d-wrapper:hover .book-3d {
    /* Pull book forward in 3D when hovered! */
    transform: rotateY(-24deg) translateY(-18px) translateZ(65px);
  }

  .book-face {
    position: absolute;
    box-sizing: border-box;
  }

  /* Front Cover */
  .book-front {
    width: 100%;
    height: 100%;
    background: var(--book-cover);
    border-radius: 4px 8px 8px 4px;
    box-shadow: 2px 2px 14px rgba(0, 0, 0, 0.55);
    transform: translateZ(16px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .cover-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .cover-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.4) 0%, transparent 40%, rgba(0, 0, 0, 0.6) 100%);
    padding: 12px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    z-index: 2;
  }

  .cover-emboss {
    flex: 1;
    margin: 8px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    position: relative;
    z-index: 2;
  }

  .cover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .cover-tag {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 1px;
    background: rgba(0, 0, 0, 0.5);
    color: var(--book-accent);
    padding: 2px 6px;
    border-radius: 3px;
    backdrop-filter: blur(4px);
  }

  .cover-stat {
    font-size: 10px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    background: rgba(0, 0, 0, 0.4);
    padding: 2px 6px;
    border-radius: 3px;
  }

  .cover-center {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .cover-title {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 16px;
    font-weight: 700;
    color: #ffffff;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
  }

  .cover-author {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.8);
    font-style: italic;
  }

  .cover-footer {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.85);
    font-weight: 500;
  }

  .bookmark-ribbon {
    position: absolute;
    top: 0;
    right: 28px;
    width: 14px;
    height: 48px;
    background: var(--book-ribbon);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%);
    z-index: 3;
  }

  .cover-glare {
    position: absolute;
    inset: 0;
    background: linear-gradient(115deg, rgba(255, 255, 255, 0.25) 0%, rgba(255, 255, 255, 0.05) 30%, transparent 60%);
    pointer-events: none;
    z-index: 4;
  }

  /* 3D Spine (left) */
  .book-spine {
    width: 32px;
    height: 100%;
    left: 0;
    top: 0;
    background: var(--book-spine);
    transform-origin: left;
    transform: rotateY(-90deg);
    border-radius: 4px 0 0 4px;
    box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.6);
  }

  .spine-emboss {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    padding: 16px 0;
  }

  .spine-rib {
    width: 80%;
    height: 3px;
    background: rgba(0, 0, 0, 0.6);
    border-top: 1px solid rgba(255, 255, 255, 0.25);
  }

  .spine-title {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    transform: rotate(180deg);
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    letter-spacing: 0.5px;
    max-height: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spine-bottom-tag {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 100%;
  }

  .spine-code {
    font-size: 8px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.6);
    letter-spacing: 0.5px;
  }

  /* 3D Pages Right */
  .book-pages-right {
    width: 32px;
    height: 98%;
    top: 1%;
    right: 0;
    background: repeating-linear-gradient(
      90deg,
      #f8f6f0,
      #f8f6f0 2px,
      #ece7db 2px,
      #ece7db 4px
    );
    transform-origin: right;
    transform: rotateY(90deg);
    border-radius: 0 2px 2px 0;
    box-shadow: inset 2px 0 6px rgba(0, 0, 0, 0.25);
  }

  /* 3D Pages Top */
  .book-pages-top {
    width: 100%;
    height: 32px;
    top: 0;
    left: 0;
    background: #ece7db;
    transform-origin: top;
    transform: rotateX(90deg);
  }

  /* Realistic drop shadow cast on wooden shelf */
  .book-cast-shadow {
    position: absolute;
    bottom: -12px;
    left: 8px;
    right: 8px;
    height: 18px;
    background: rgba(0, 0, 0, 0.7);
    filter: blur(8px);
    border-radius: 50%;
    transform: rotateX(80deg) translateZ(-16px);
    transition: filter 320ms ease, opacity 320ms ease;
  }

  .book-3d-wrapper:hover .book-cast-shadow {
    filter: blur(16px);
    opacity: 0.85;
  }

  .book-delete-btn {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 24px;
    height: 24px;
    background: rgba(239, 68, 68, 0.9);
    color: #ffffff;
    border-radius: 50%;
    font-size: 16px;
    line-height: 1;
    z-index: 10;
    opacity: 0;
    transition: opacity 150ms ease, transform 150ms ease;
  }

  .book-3d-wrapper:hover .book-delete-btn,
  .flat-card:hover .book-delete-btn {
    opacity: 1;
  }

  .book-delete-btn:hover {
    transform: scale(1.15);
  }

  /* 3D Wood Shelf Plank */
  .shelf-wood-plank {
    width: 100%;
    height: 32px;
    position: relative;
    transform-style: preserve-3d;
  }

  .plank-surface {
    position: absolute;
    top: 0;
    left: -20px;
    right: -20px;
    height: 22px;
    background: linear-gradient(180deg, #5c3822 0%, #3e2415 70%, #2e1a0e 100%);
    border-top: 1px solid rgba(255, 255, 255, 0.25);
    box-shadow: inset 0 2px 4px rgba(255, 255, 255, 0.15);
    border-radius: 2px;
  }

  .plank-front {
    position: absolute;
    top: 22px;
    left: -20px;
    right: -20px;
    height: 14px;
    background: linear-gradient(180deg, #2a160b 0%, #170b05 100%);
    border-bottom: 1px solid rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .brass-plaque {
    display: flex;
    align-items: center;
    gap: 8px;
    background: linear-gradient(180deg, #d4af37 0%, #aa820a 50%, #856504 100%);
    border: 1px solid #ffe57f;
    border-radius: 2px;
    padding: 1px 12px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.4);
    transform: translateY(-2px);
  }

  .plaque-text {
    font-size: 8px;
    font-weight: 800;
    letter-spacing: 1.5px;
    color: #1a0f05;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
  }

  .screw {
    width: 3px;
    height: 3px;
    background: #5c4302;
    border-radius: 50%;
  }

  .plank-shadow {
    position: absolute;
    top: 36px;
    left: -10px;
    right: -10px;
    height: 30px;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.6) 0%, transparent 100%);
    filter: blur(6px);
    pointer-events: none;
  }

  /* Grid Scene fallback */
  .grid-scene {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 24px;
    max-width: 1200px;
    margin: 0 auto;
  }

  .flat-card {
    display: flex;
    flex-direction: column;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-md);
    overflow: hidden;
    cursor: pointer;
    transition: transform var(--transition-fast), box-shadow var(--transition-fast);
  }

  .flat-card:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-lg);
    border-color: rgba(217, 119, 6, 0.4);
  }

  .flat-cover {
    height: 240px;
    padding: 16px;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    overflow: hidden;
  }

  .flat-cover-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .flat-title {
    font-family: Georgia, serif;
    font-size: 15px;
    font-weight: 700;
    color: #ffffff;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    position: relative;
    z-index: 2;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
  }

  .flat-meta {
    padding: 10px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.6);
  }

  .badge-v {
    background: rgba(217, 119, 6, 0.2);
    color: #fbbf24;
    padding: 2px 6px;
    border-radius: var(--radius-xs);
    font-weight: 600;
  }

  .empty-shelf {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 20px;
    text-align: center;
    max-width: 500px;
    margin: 40px auto;
    background: rgba(255, 255, 255, 0.03);
    border: 1px dashed rgba(255, 255, 255, 0.12);
    border-radius: var(--radius-lg);
  }

  .empty-bookcase-illustration {
    color: rgba(217, 119, 6, 0.5);
    margin-bottom: 20px;
  }

  .empty-shelf h2 {
    font-family: Georgia, serif;
    font-size: 20px;
    color: #fef3c7;
    margin-bottom: 8px;
  }

  .empty-shelf p {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
    line-height: 1.5;
    margin-bottom: 24px;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 350px;
    gap: 16px;
    color: #fbbf24;
    font-size: 14px;
    font-weight: 500;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: #1e1b18;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: var(--radius-md);
    padding: 24px;
    width: 380px;
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .modal h3 {
    font-family: Georgia, serif;
    font-size: 16px;
    color: #fef3c7;
  }

  .modal input {
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: var(--radius-sm);
    padding: 8px 12px;
    color: #ffffff;
    font-size: 13px;
    outline: none;
  }

  .modal input:focus {
    border-color: #d97706;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }
</style>
