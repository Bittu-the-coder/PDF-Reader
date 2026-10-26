<script lang="ts">
  import { appState, type Theme } from "../stores/appState.svelte";

  let pageInput = $state(appState.currentPage);

  $effect(() => {
    pageInput = appState.currentPage;
  });

  function handlePageCommit() {
    let p = Math.max(1, Math.min(appState.pageCount, Number(pageInput) || 1));
    pageInput = p;
    appState.saveCurrentProgress(p);
  }

  function handleZoomIn() {
    const nextZoom = Math.min(3.0, Number((appState.zoom + 0.15).toFixed(2)));
    appState.saveCurrentProgress(appState.currentPage, nextZoom);
  }

  function handleZoomOut() {
    const nextZoom = Math.max(0.4, Number((appState.zoom - 0.15).toFixed(2)));
    appState.saveCurrentProgress(appState.currentPage, nextZoom);
  }

  function cycleTheme() {
    const themes: Theme[] = ["dark", "light", "sepia"];
    const nextIdx = (themes.indexOf(appState.theme) + 1) % themes.length;
    appState.setTheme(themes[nextIdx]);
  }
</script>

<!-- Hot zone detector at the very top of the window -->
<div
  class="top-hot-zone"
  onmouseenter={() => appState.onTopEdgeEnter()}
  role="region"
  aria-label="Top navigation hot zone"
></div>

<header
  class="top-bar {appState.topBarVisible || appState.topBarPinned ? 'visible' : ''}"
  onmouseenter={() => appState.onTopEdgeEnter()}
  onmouseleave={() => appState.onTopEdgeLeave()}
>
  <div class="top-left">
    <button
      class="icon-btn"
      onclick={() => (appState.sidebarVisible = !appState.sidebarVisible)}
      title="Toggle Thumbnails / Outline (Ctrl+B)"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect width="18" height="18" x="3" y="3" rx="2"/>
        <path d="M9 3v18"/>
      </svg>
    </button>

    <div class="book-title" title={appState.activeBook?.title}>
      {appState.activeBook?.title || "No document open"}
    </div>
  </div>

  <div class="top-center">
    <!-- Page Navigation -->
    <div class="page-nav">
      <button
        class="icon-btn-sm"
        disabled={appState.currentPage <= 1}
        onclick={() => appState.saveCurrentProgress(appState.currentPage - 1)}
        title="Previous Page (Left Arrow / Page Up)"
      >
        ‹
      </button>

      <div class="page-input-wrapper">
        <input
          type="number"
          bind:value={pageInput}
          onchange={handlePageCommit}
          onkeydown={(e) => e.key === "Enter" && handlePageCommit()}
          min="1"
          max={appState.pageCount}
          class="page-input"
        />
        <span class="page-count">/ {appState.pageCount}</span>
      </div>

      <button
        class="icon-btn-sm"
        disabled={appState.currentPage >= appState.pageCount}
        onclick={() => appState.saveCurrentProgress(appState.currentPage + 1)}
        title="Next Page (Right Arrow / Page Down)"
      >
        ›
      </button>
    </div>

    <!-- Zoom Controls -->
    <div class="zoom-controls">
      <button class="icon-btn-sm" onclick={handleZoomOut} title="Zoom Out (Ctrl -)">-</button>
      <span class="zoom-text">{Math.round(appState.zoom * 100)}%</span>
      <button class="icon-btn-sm" onclick={handleZoomIn} title="Zoom In (Ctrl +)">+</button>
      <button
        class="text-btn-sm {appState.fitMode === 'width' ? 'active' : ''}"
        onclick={() => (appState.fitMode = "width")}
        title="Fit Width"
      >
        Fit Width
      </button>
    </div>
  </div>

  <div class="top-right">
    <!-- Theme Switcher -->
    <button class="icon-btn" onclick={cycleTheme} title="Theme: {appState.theme}">
      {#if appState.theme === "dark"}
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
        </svg>
      {:else if appState.theme === "light"}
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
        </svg>
      {:else}
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
      {/if}
    </button>

    <!-- Memory Drawer Toggle -->
    <button
      class="icon-btn {appState.memoryDrawerOpen ? 'active' : ''}"
      onclick={() => (appState.memoryDrawerOpen = !appState.memoryDrawerOpen)}
      title="Book Memory (Vocabulary & Notes)"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
        <path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z"/>
      </svg>
      {#if appState.words.length + appState.notes.length > 0}
        <span class="badge">{appState.words.length + appState.notes.length}</span>
      {/if}
    </button>

    <!-- Pin Top Bar -->
    <button
      class="icon-btn {appState.topBarPinned ? 'active' : ''}"
      onclick={() => (appState.topBarPinned = !appState.topBarPinned)}
      title="Pin Top Bar (Ctrl+Shift+B)"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="17" x2="12" y2="22"/>
        <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
      </svg>
    </button>
  </div>
</header>

<style>
  .top-hot-zone {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 6px;
    z-index: 100;
  }

  .top-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 48px;
    background: var(--bg-glass);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    z-index: 99;
    transform: translateY(-100%);
    opacity: 0;
    pointer-events: none;
    transition: transform var(--transition-normal), opacity var(--transition-normal);
    box-shadow: var(--shadow-sm);
  }

  .top-bar.visible {
    transform: translateY(0);
    opacity: 1;
    pointer-events: auto;
  }

  .top-left, .top-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .book-title {
    max-width: 280px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-left: 6px;
  }

  .top-center {
    display: flex;
    align-items: center;
    gap: 18px;
  }

  .page-nav {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: 2px 4px;
  }

  .page-input-wrapper {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
  }

  .page-input {
    width: 38px;
    height: 24px;
    padding: 0 4px;
    text-align: center;
    border: none;
    background: transparent;
    font-size: 12px;
    font-weight: 500;
    -moz-appearance: textfield;
  }

  .page-input::-webkit-outer-spin-button,
  .page-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .page-count {
    color: var(--text-muted);
    font-size: 11px;
    padding-right: 4px;
  }

  .zoom-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: 2px 4px;
  }

  .zoom-text {
    font-size: 12px;
    min-width: 42px;
    text-align: center;
    color: var(--text-secondary);
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    position: relative;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .icon-btn.active {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .icon-btn-sm {
    width: 24px;
    height: 24px;
    font-size: 15px;
    line-height: 1;
    color: var(--text-secondary);
  }

  .icon-btn-sm:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .icon-btn-sm:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .text-btn-sm {
    padding: 2px 8px;
    height: 24px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .text-btn-sm:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .text-btn-sm.active {
    color: var(--accent);
    background: var(--accent-subtle);
  }

  .badge {
    position: absolute;
    top: 2px;
    right: 2px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 9px;
    font-weight: bold;
    padding: 1px 4px;
    border-radius: var(--radius-full);
  }
</style>
