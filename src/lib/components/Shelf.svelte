<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { appState } from "../stores/appState.svelte";
  import { api, type BookSummary } from "../api";
  import { open as openFileDialog, ask } from "@tauri-apps/plugin-dialog";
  import Icon from "./Icon.svelte";

  let isDraggingOver = $state(false);
  let searchQuery = $state("");
  let newShelfModal = $state(false);
  let newShelfName = $state("");
  let fileInputEl: HTMLInputElement;
  const bookCoverUrls = new SvelteMap<number, string>();
  let unlistenDragDrop: (() => void) | null = null;
  let viewportWidth = $state(1200);

  onMount(() => {
    appState.refreshLibrary();
    appState.refreshDueCount();

    // Native drag & drop gives real file paths (works on Windows, Linux and macOS)
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (appState.currentView !== "shelf") return;
          if (event.payload.type === "over" || event.payload.type === "enter") {
            isDraggingOver = true;
          } else if (event.payload.type === "drop") {
            isDraggingOver = false;
            const pdf = event.payload.paths?.find((p) => p.toLowerCase().endsWith(".pdf"));
            if (pdf) appState.openPdfFilePath(pdf);
            else if (event.payload.paths?.length) appState.showToast("Only PDF files can be added.", "error");
          } else {
            isDraggingOver = false;
          }
        })
      )
      .then((unlisten) => {
        unlistenDragDrop = unlisten;
      })
      .catch((e) => console.warn("Drag & drop unavailable:", e));
  });

  onDestroy(() => {
    unlistenDragDrop?.();
    for (const url of bookCoverUrls.values()) URL.revokeObjectURL(url);
  });

  // Load stored covers for books we haven't seen yet
  $effect(() => {
    for (const b of appState.books) {
      if (bookCoverUrls.has(b.id)) continue;
      bookCoverUrls.set(b.id, "");
      api
        .getBookCover(b.id)
        .then((bytes) => {
          if (bytes) bookCoverUrls.set(b.id, URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" })));
        })
        .catch(() => {});
    }
  });

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

  function progressOf(book: BookSummary) {
    if (!book.page_count || book.page_count <= 1) return 0;
    return Math.min(1, Math.max(0, (book.last_page - 1) / (book.page_count - 1)));
  }

  async function handleOpenPdfClick() {
    try {
      const selected = await openFileDialog({
        multiple: false,
        filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
      });
      if (selected && typeof selected === "string") await appState.openPdfFilePath(selected);
      return;
    } catch (err) {
      console.warn("Native file dialog unavailable, using browser picker:", err);
    }
    fileInputEl?.click();
  }

  // Browser fallback: we only get the bytes, so keep a copy in the app data folder
  async function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      appState.importStatus = "Reading PDF…";
      const bytes = new Uint8Array(await file.arrayBuffer());
      const path = await api.saveImportedPdf(file.name, Array.from(bytes));
      await appState.importPdfBytes(bytes, path, file.name.replace(/\.pdf$/i, ""));
    } catch (err: any) {
      appState.showToast(`Could not open PDF: ${err?.message || err}`, "error");
    } finally {
      appState.importStatus = null;
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
      appState.showToast("Could not create the shelf.", "error");
      console.error("Failed to create shelf:", err);
    }
  }

  async function confirmAction(message: string, title: string) {
    try {
      return await ask(message, { title, kind: "warning", okLabel: "Remove", cancelLabel: "Cancel" });
    } catch {
      return confirm(message);
    }
  }

  async function handleDeleteBook(e: MouseEvent, book: BookSummary) {
    e.stopPropagation();
    const ok = await confirmAction(
      `Remove “${book.title}” from your library? Its saved words, notes and highlights will be deleted. The PDF file itself is not touched.`,
      "Remove book"
    );
    if (!ok) return;
    await api.deleteBook(book.id);
    appState.closeTab(book.id);
    await appState.refreshLibrary();
  }

  let filteredBooks = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return appState.books;
    return appState.books.filter(
      (b) => b.title.toLowerCase().includes(q) || (b.author && b.author.toLowerCase().includes(q))
    );
  });

  // Books per shelf row follow the window width (must match the CSS sizes below)
  let perRow = $derived.by(() => {
    const narrow = viewportWidth < 900;
    const viewportPad = narrow ? 16 : 56;
    const trackPad = narrow ? 12 : 40;
    const gap = narrow ? 32 : 48;
    const bookWidth = 190 + 34; // cover + 3D spine/pages depth
    const available = viewportWidth - viewportPad * 2 - trackPad * 2;
    return Math.max(1, Math.min(6, Math.floor((available + gap) / (bookWidth + gap))));
  });

  let shelfRows = $derived.by(() => {
    const rows: BookSummary[][] = [];
    for (let i = 0; i < filteredBooks.length; i += perRow) {
      rows.push(filteredBooks.slice(i, i + perRow));
    }
    return rows;
  });

  // The book to resume: most recently opened one that isn't finished
  let continueBook = $derived.by(() => {
    if (searchQuery.trim()) return null;
    const opened = appState.books
      .filter((b) => b.last_opened_at && (!b.page_count || b.last_page < b.page_count))
      .sort((a, b) => (b.last_opened_at ?? "").localeCompare(a.last_opened_at ?? ""));
    return opened[0] ?? null;
  });

  const shelfRomanNumerals = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
</script>

<div
  class="shelf-container {isDraggingOver ? 'dragging' : ''}"
  ondragover={(e) => e.preventDefault()}
  ondrop={(e) => e.preventDefault()}
  role="region"
  aria-label="3D Library Shelf"
>
  <!-- Shelf Top Navigation -->
  <header class="shelf-header">
    <div class="brand">
      <div class="logo-mark">
        <img src="/logo.png" alt="Shelf Logo" class="shelf-brand-logo" />
      </div>
      <div class="brand-text">
        <span class="brand-title">Shelf</span>
        <span class="brand-subtitle">{appState.books.length} {appState.books.length === 1 ? "book" : "books"}</span>
      </div>
    </div>

    <!-- Shelves Tabs -->
    <div class="shelves-tabs">
      <button
        class="shelf-tab {appState.activeShelfId === null ? 'active' : ''}"
        onclick={() => appState.selectShelf(null)}
      >
        All books
      </button>
      {#each appState.shelves as s (s.id)}
        <button
          class="shelf-tab {appState.activeShelfId === s.id ? 'active' : ''}"
          onclick={() => appState.selectShelf(s.id)}
        >
          {s.name}
        </button>
      {/each}
      <button class="add-shelf-btn" onclick={() => (newShelfModal = true)} title="New shelf" aria-label="New shelf">
        <Icon name="plus" size={14} />
      </button>
    </div>

    <!-- Search in Collection -->
    <div class="search-box">
      <Icon name="search" size={15} />
      <input
        type="text"
        placeholder="Search library…"
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
          <Icon name="shelf" size={16} />
          <span>Shelf</span>
        </button>
        <button
          class="toggle-btn {appState.shelfViewMode === 'grid' ? 'active' : ''}"
          onclick={() => (appState.shelfViewMode = "grid")}
          title="Flat Grid View"
        >
          <Icon name="grid" size={15} />
          <span>Grid</span>
        </button>
      </div>

      <button class="btn-primary open-file-btn" onclick={handleOpenPdfClick}>
        <Icon name="file-plus" size={16} />
        <span>Open PDF</span>
      </button>

      <button
        class="icon-btn-settings"
        onclick={() => (appState.settingsModalOpen = true)}
        title="Settings & AI provider"
        aria-label="Settings"
      >
        <Icon name="settings" size={17} />
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
  <main class="library-viewport" bind:clientWidth={viewportWidth}>
    {#if continueBook || appState.dueCount > 0}
      <div class="home-strip">
        {#if continueBook}
          {@const style = getCoverStyle(continueBook.title)}
          <button class="continue-card" onclick={() => continueBook && appState.openBook(continueBook.id)}>
            <div class="continue-cover" style="background: {style.bg};">
              {#if bookCoverUrls.get(continueBook.id)}<img src={bookCoverUrls.get(continueBook.id)} alt="" />{/if}
            </div>
            <div class="continue-info">
              <span class="eyebrow">Continue reading</span>
              <span class="continue-title">{continueBook.title}</span>
              <div class="continue-progress"><div style="width: {progressOf(continueBook) * 100}%"></div></div>
              <span class="continue-meta">
                Page {continueBook.last_page}{#if continueBook.page_count} of {continueBook.page_count} · {Math.round(progressOf(continueBook) * 100)}%{/if}
              </span>
            </div>
            <span class="resume">Resume <Icon name="chevron-right" size={15} /></span>
          </button>
        {/if}
        {#if appState.dueCount > 0}
          <button class="review-card" onclick={() => (appState.reviewOpen = true)}>
            <Icon name="sparkles" size={20} />
            <span class="eyebrow">Word review</span>
            <span class="review-count">{appState.dueCount}</span>
            <span class="continue-meta">{appState.dueCount === 1 ? "word" : "words"} due</span>
          </button>
        {/if}
      </div>
    {/if}
    {#if filteredBooks.length === 0}
      <div class="empty-shelf">
        <div class="empty-bookcase-illustration">
          <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
            <path d="M6 6h10"/><path d="M6 10h10"/>
            <path d="M10 14h6"/>
          </svg>
        </div>
        {#if searchQuery.trim()}
          <h2>No matches</h2>
          <p>Nothing in this collection matches “{searchQuery}”.</p>
          <button class="btn-ghost" onclick={() => (searchQuery = "")}>Clear search</button>
        {:else if appState.activeShelfId !== null}
          <h2>This shelf is empty</h2>
          <p>Books you open while this shelf is selected are added to it.</p>
          <button class="btn-primary" onclick={handleOpenPdfClick}>Open a PDF</button>
        {:else}
          <h2>Start your library</h2>
          <p>Open a PDF or drop one here. Select any word while reading to see what it means, right on the page.</p>
          <button class="btn-primary big" onclick={handleOpenPdfClick}>
            <Icon name="file-plus" size={17} />
            Open a PDF
          </button>
          <span class="empty-hint">or press <kbd>Ctrl</kbd> + <kbd>O</kbd></span>
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
                  aria-label="Open {book.title}"
                  title={book.title}
                  onkeydown={(e) => e.key === "Enter" && appState.openBook(book.id)}
                >
                  <!-- 3D Book Container -->
                  <div class="book-3d" style="--book-cover: {style.bg}; --book-accent: {style.accent}; --book-spine: {style.spine}; --book-ribbon: {style.ribbon};">
                    <!-- Front Cover -->
                    <div class="book-face book-front">
                      {#if bookCoverUrls.get(book.id)}
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
                    onclick={(e) => handleDeleteBook(e, book)}
                    title="Remove from library"
                    aria-label="Remove {book.title} from library"
                  >
                    <Icon name="trash" size={13} />
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
            aria-label="Open {book.title}"
          >
            <div class="flat-cover" style="background: {style.bg};">
              {#if bookCoverUrls.get(book.id)}
                <img src={bookCoverUrls.get(book.id)} alt={book.title} class="flat-cover-img" />
              {:else}
                <h3 class="flat-title">{book.title}</h3>
              {/if}
              <button
                class="book-delete-btn"
                onclick={(e) => handleDeleteBook(e, book)}
                title="Remove from library"
                aria-label="Remove {book.title} from library"
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
            <div class="flat-progress"><div style="width: {progressOf(book) * 100}%"></div></div>
            <div class="flat-meta">
              <span class="flat-title-meta" title={book.title}>{book.title}</span>
              <span class="flat-page">p. {book.last_page}{#if book.page_count} / {book.page_count}{/if}</span>
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
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
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

  .icon-btn-settings {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-sm);
    background: var(--bg-surface-elevated, rgba(255, 255, 255, 0.06));
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    color: var(--text-secondary, #999);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 150ms ease;
  }

  .icon-btn-settings:hover {
    color: var(--text-primary, #fff);
    background: var(--hover-bg, rgba(255, 255, 255, 0.12));
    border-color: var(--border-hover, rgba(255, 255, 255, 0.2));
  }

  .hidden-input {
    display: none;
  }

  .library-viewport {
    flex: 1;
    overflow-y: auto;
    padding: 40px 56px 80px;
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

  .book-3d-wrapper:focus-within .book-delete-btn,
  .flat-card:focus-within .book-delete-btn {
    opacity: 1;
  }

  @media (hover: none) {
    .book-delete-btn {
      opacity: 0.85;
    }
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
    padding: 8px 12px 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 11.5px;
    color: rgba(255, 255, 255, 0.6);
  }

  .flat-title-meta {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: rgba(255, 255, 255, 0.88);
    font-weight: 500;
    font-size: 12.5px;
  }

  .flat-page {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .flat-progress {
    height: 3px;
    background: rgba(255, 255, 255, 0.08);
  }

  .flat-progress div {
    height: 100%;
    background: #f59e0b;
  }

  .btn-primary.big {
    height: 42px;
    padding: 0 22px;
    font-size: 14px;
    gap: 8px;
  }

  .empty-hint {
    display: block;
    margin-top: 14px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.45);
  }

  kbd {
    font-family: inherit;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.7);
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

  .shelf-brand-logo {
    width: 40px;
    height: 40px;
    filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.45));
  }

  /* Home strip: continue reading + review */
  .home-strip {
    display: flex;
    gap: 16px;
    max-width: 1200px;
    margin: 0 auto 40px;
    flex-wrap: wrap;
  }

  .continue-card,
  .review-card {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 18px 14px 14px;
    text-align: left;
    color: #f5efe6;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
  }

  .continue-card {
    flex: 1 1 420px;
    min-width: 0;
  }

  .continue-card:hover,
  .review-card:hover {
    background: rgba(255, 255, 255, 0.07);
    border-color: rgba(245, 158, 11, 0.4);
    transform: translateY(-1px);
  }

  .continue-cover {
    width: 54px;
    height: 76px;
    flex-shrink: 0;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  }

  .continue-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .continue-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .eyebrow {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #f59e0b;
  }

  .continue-title {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 17px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .continue-progress {
    height: 4px;
    max-width: 320px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }

  .continue-progress div {
    height: 100%;
    background: #f59e0b;
  }

  .continue-meta {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.55);
  }

  .resume {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    font-size: 13px;
    font-weight: 600;
    color: #f59e0b;
  }

  .review-card {
    flex: 0 0 auto;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 2px;
    padding: 14px 22px;
  }

  .review-card :global(svg) {
    color: #f59e0b;
    margin-bottom: 4px;
  }

  .review-count {
    font-size: 26px;
    font-weight: 700;
    line-height: 1.1;
  }

  /* Responsive Shelf Rules (keep in sync with perRow in the script) */
  @media (max-width: 900px) {
    .library-viewport {
      padding: 24px 16px 60px;
    }
    .books-track {
      padding: 0 12px;
      gap: 32px;
    }
    .bookshelf-scene {
      gap: 56px;
    }
    .shelf-header {
      padding: 10px 16px;
      gap: 10px;
    }
    .brand-subtitle {
      display: none;
    }
    .search-box {
      max-width: 180px;
    }
  }

  @media (max-width: 720px) {
    .shelf-header {
      flex-wrap: wrap;
    }
    .brand {
      order: 1;
    }
    .shelf-actions {
      order: 2;
    }
    .shelves-tabs {
      order: 3;
      width: 100%;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .shelves-tabs::-webkit-scrollbar {
      display: none;
    }
    .search-box {
      order: 4;
      max-width: 100%;
      width: 100%;
    }
    .toggle-btn span {
      display: none;
    }
    .open-file-btn span {
      display: none;
    }
  }
</style>
