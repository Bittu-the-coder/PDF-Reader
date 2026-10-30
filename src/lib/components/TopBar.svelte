<script lang="ts">
  import { appState, type Theme, type ReadingMode } from "../stores/appState.svelte";
  import Icon from "./Icon.svelte";

  let pageInput = $state(String(appState.currentPage));
  let viewMenuOpen = $state(false);
  let viewMenuEl = $state<HTMLDivElement>();

  $effect(() => {
    pageInput = String(appState.currentPage);
  });

  function handlePageCommit() {
    const p = Math.max(1, Math.min(appState.pageCount, Math.round(Number(pageInput)) || appState.currentPage));
    pageInput = String(p);
    if (p !== appState.currentPage) appState.jumpToPage(p);
  }

  const themes: { id: Theme; name: string; icon: string; swatch: string; ink: string }[] = [
    { id: "light", name: "Paper", icon: "sun", swatch: "#ffffff", ink: "#18181b" },
    { id: "sepia", name: "Sepia", icon: "scroll", swatch: "#f4ecd8", ink: "#5b4636" },
    { id: "eyecare", name: "Warm", icon: "flame", swatch: "#f6e3b4", ink: "#3d2b14" },
    { id: "dark", name: "Night", icon: "moon", swatch: "#1d1d21", ink: "#d4d4d8" },
    { id: "invert", name: "OLED", icon: "contrast", swatch: "#000000", ink: "#ffffff" },
  ];

  const readingModes: { id: ReadingMode; label: string; icon: string }[] = [
    { id: "single", label: "Single page", icon: "page-single" },
    { id: "dual", label: "Two pages", icon: "page-dual" },
    { id: "scroll", label: "Continuous", icon: "page-scroll" },
  ];

  let progress = $derived(appState.pageCount > 1 ? (appState.currentPage - 1) / (appState.pageCount - 1) : 1);
  let memoryCount = $derived(appState.words.length + appState.notes.length + appState.highlights.length);

  // Close the view menu on outside click
  $effect(() => {
    if (!viewMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (viewMenuEl && !viewMenuEl.contains(e.target as Node)) viewMenuOpen = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        viewMenuOpen = false;
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  });
</script>

<div class="top-bar" role="toolbar" aria-label="Reader toolbar">
  <div class="top-left">
    <button
      class="icon-btn {appState.sidebarVisible ? 'active' : ''}"
      onclick={() => (appState.sidebarVisible = !appState.sidebarVisible)}
      title="Pages & chapters"
      aria-label="Toggle pages and chapters panel"
    >
      <Icon name="sidebar" size={18} />
    </button>

    <div class="book-title" title={appState.activeBook?.title}>
      {appState.activeBook?.title || "No document open"}
    </div>
  </div>

  <div class="top-center">
    <div class="page-nav">
      <button
        class="icon-btn sm"
        disabled={appState.currentPage <= 1}
        onclick={() => appState.jumpToPage(appState.currentPage - appState.pageStep)}
        title="Previous page (←)"
        aria-label="Previous page"
      >
        <Icon name="chevron-left" size={17} />
      </button>

      <label class="page-field">
        <span class="visually-hidden">Current page</span>
        <input
          type="text"
          inputmode="numeric"
          bind:value={pageInput}
          onblur={handlePageCommit}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              handlePageCommit();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
          class="page-input"
          style="width: {Math.max(2, String(appState.pageCount).length) + 1.2}ch"
        />
        <span class="page-count">/ {appState.pageCount}</span>
      </label>

      <button
        class="icon-btn sm"
        disabled={appState.currentPage >= appState.pageCount}
        onclick={() => appState.jumpToPage(appState.currentPage + appState.pageStep)}
        title="Next page (→)"
        aria-label="Next page"
      >
        <Icon name="chevron-right" size={17} />
      </button>
    </div>
  </div>

  <div class="top-right">
    <button
      class="icon-btn {appState.searchOpen ? 'active' : ''}"
      onclick={() => (appState.searchOpen ? appState.closeSearch() : appState.openSearch())}
      title="Find in book (Ctrl+F)"
      aria-label="Find in book"
    >
      <Icon name="search" size={17} />
    </button>

    <button
      class="icon-btn {appState.isBookmarked(appState.currentPage) ? 'bookmarked' : ''}"
      onclick={() => appState.toggleBookmark()}
      title={appState.isBookmarked(appState.currentPage) ? "Remove bookmark (Ctrl+D)" : "Bookmark this page (Ctrl+D)"}
      aria-label="Toggle bookmark"
      aria-pressed={appState.isBookmarked(appState.currentPage)}
    >
      <Icon name="bookmark" size={17} />
    </button>

    <div class="zoom-controls">
      <button class="icon-btn sm" onclick={() => appState.zoomOut()} title="Zoom out (Ctrl −)" aria-label="Zoom out">
        <Icon name="minus" size={15} />
      </button>
      <button class="zoom-text" onclick={() => appState.setZoom(1)} title="Reset to 100% (Ctrl 0)">
        {Math.round((appState.pinchZoom ?? appState.zoom) * 100)}%
      </button>
      <button class="icon-btn sm" onclick={() => appState.zoomIn()} title="Zoom in (Ctrl +)" aria-label="Zoom in">
        <Icon name="plus" size={15} />
      </button>
    </div>

    <div class="view-menu-wrapper" bind:this={viewMenuEl}>
      <button
        class="view-btn {viewMenuOpen ? 'active' : ''}"
        onclick={() => (viewMenuOpen = !viewMenuOpen)}
        title="Layout, fit & theme"
        aria-haspopup="true"
        aria-expanded={viewMenuOpen}
      >
        <Icon name="palette" size={16} />
        <span class="view-label">View</span>
        <Icon name="chevron-down" size={13} />
      </button>

      {#if viewMenuOpen}
        <div class="view-menu" role="menu">
          <div class="menu-section">
            <div class="menu-heading">Layout</div>
            <div class="segmented">
              {#each readingModes as m}
                <button
                  class="seg-btn {appState.readingMode === m.id ? 'active' : ''}"
                  onclick={() => appState.setReadingMode(m.id)}
                  role="menuitemradio"
                  aria-checked={appState.readingMode === m.id}
                >
                  <Icon name={m.icon} size={18} />
                  <span>{m.label}</span>
                </button>
              {/each}
            </div>
            {#if appState.readingMode === "dual" && appState.layoutMode !== "dual"}
              <p class="menu-hint">Window is too narrow for two pages, showing one.</p>
            {/if}
          </div>

          <div class="menu-section">
            <div class="menu-heading">Fit</div>
            <div class="segmented two">
              <button
                class="seg-btn {appState.fitMode === 'width' ? 'active' : ''}"
                onclick={() => appState.setFitMode("width")}
                role="menuitemradio"
                aria-checked={appState.fitMode === "width"}
              >
                <Icon name="fit-width" size={18} />
                <span>Fit width</span>
              </button>
              <button
                class="seg-btn {appState.fitMode === 'page' ? 'active' : ''}"
                onclick={() => appState.setFitMode("page")}
                role="menuitemradio"
                aria-checked={appState.fitMode === "page"}
              >
                <Icon name="fit-page" size={18} />
                <span>Whole page</span>
              </button>
            </div>
            <div class="zoom-row">
              <button class="icon-btn sm" onclick={() => appState.zoomOut()} aria-label="Zoom out"><Icon name="minus" size={15} /></button>
              <input
                type="range"
                min="0.4"
                max="3"
                step="0.05"
                value={appState.zoom}
                oninput={(e) => appState.setZoom(Number((e.currentTarget as HTMLInputElement).value))}
                aria-label="Zoom"
              />
              <button class="icon-btn sm" onclick={() => appState.zoomIn()} aria-label="Zoom in"><Icon name="plus" size={15} /></button>
              <span class="zoom-value">{Math.round((appState.pinchZoom ?? appState.zoom) * 100)}%</span>
            </div>
          </div>

          <div class="menu-section">
            <div class="menu-heading">Page color</div>
            <div class="theme-swatches">
              {#each themes as t}
                <button
                  class="theme-swatch {appState.theme === t.id ? 'active' : ''}"
                  onclick={() => appState.setTheme(t.id)}
                  title={t.name}
                  role="menuitemradio"
                  aria-checked={appState.theme === t.id}
                >
                  <span class="swatch-chip" style="background: {t.swatch}; color: {t.ink};">Aa</span>
                  <span class="swatch-name">{t.name}</span>
                </button>
              {/each}
            </div>
          </div>

          <div class="menu-section menu-toggles">
            <button class="menu-row" onclick={() => appState.toggleFullscreen()}>
              <Icon name={appState.isFullscreen ? "minimize" : "maximize"} size={16} />
              <span>{appState.isFullscreen ? "Exit full screen" : "Full screen"}</span>
              <kbd>F</kbd>
            </button>
            <button class="menu-row" onclick={() => appState.toggleTopBarPinned()}>
              <Icon name={appState.topBarPinned ? "pin-off" : "pin"} size={16} />
              <span>{appState.topBarPinned ? "Auto-hide toolbar" : "Keep toolbar visible"}</span>
              <kbd>Ctrl ⇧ B</kbd>
            </button>
            <button
              class="menu-row"
              onclick={() => {
                viewMenuOpen = false;
                appState.settingsModalOpen = true;
              }}
            >
              <Icon name="settings" size={16} />
              <span>Settings & AI provider</span>
            </button>
            <button
              class="menu-row"
              onclick={() => {
                viewMenuOpen = false;
                appState.shortcutsOpen = true;
              }}
            >
              <Icon name="key" size={16} />
              <span>Keyboard shortcuts</span>
              <kbd>?</kbd>
            </button>
          </div>
        </div>
      {/if}
    </div>

    <button
      class="icon-btn {appState.memoryDrawerOpen ? 'active' : ''}"
      onclick={() => appState.toggleMemoryDrawer()}
      title="Book memory: words, notes & highlights"
      aria-label="Book memory"
    >
      <Icon name="brain" size={18} />
      {#if memoryCount > 0}
        <span class="badge">{memoryCount > 99 ? "99+" : memoryCount}</span>
      {/if}
    </button>

    <button
      class="icon-btn hide-narrow {appState.isFullscreen ? 'active' : ''}"
      onclick={() => appState.toggleFullscreen()}
      title="Full screen (F / F11)"
      aria-label="Toggle full screen"
    >
      <Icon name={appState.isFullscreen ? "minimize" : "maximize"} size={16} />
    </button>

    <button
      class="icon-btn hide-narrow"
      onclick={() => (appState.settingsModalOpen = true)}
      title="Settings"
      aria-label="Settings"
    >
      <Icon name="settings" size={17} />
    </button>
  </div>

  <div class="progress-track" aria-hidden="true">
    <div class="progress-fill" style="transform: scaleX({progress});"></div>
  </div>
</div>

<style>
  .top-bar {
    height: var(--chrome-height);
    min-height: var(--chrome-height);
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border-subtle);
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    padding: 0 10px;
    position: relative;
    flex-shrink: 0;
    z-index: 80;
  }

  .top-left,
  .top-right {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .top-right {
    justify-content: flex-end;
  }

  .book-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    padding-left: 4px;
  }

  .icon-btn.bookmarked {
    color: var(--danger);
  }

  .icon-btn.bookmarked :global(svg) {
    fill: currentColor;
  }

  .icon-btn.sm {
    width: 28px;
    height: 28px;
  }

  .page-nav {
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: 2px;
  }

  .page-field {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 4px;
    font-size: 13px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .page-input {
    min-width: 3ch;
    height: 26px;
    padding: 0 4px;
    text-align: center;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    background: var(--bg-surface);
    border-color: transparent;
  }

  .page-input:hover {
    border-color: var(--border-subtle);
  }

  .page-count {
    white-space: nowrap;
  }

  .zoom-controls {
    display: flex;
    align-items: center;
    gap: 0;
    margin-right: 2px;
  }

  .zoom-text {
    min-width: 48px;
    height: 28px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .zoom-text:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .view-menu-wrapper {
    position: relative;
  }

  .view-btn {
    height: 32px;
    padding: 0 8px 0 10px;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
  }

  .view-btn:hover,
  .view-btn.active {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .view-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 320px;
    max-width: calc(100vw - 20px);
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: 6px;
    z-index: 200;
    animation: menuIn 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes menuIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .menu-section {
    padding: 8px;
  }

  .menu-section + .menu-section {
    border-top: 1px solid var(--border-subtle);
  }

  .menu-heading {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 8px;
  }

  .menu-hint {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .segmented {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .segmented.two {
    grid-template-columns: repeat(2, 1fr);
  }

  .seg-btn {
    flex-direction: column;
    gap: 4px;
    padding: 10px 4px 8px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
  }

  .seg-btn:hover {
    color: var(--text-primary);
    border-color: var(--border-strong);
  }

  .seg-btn.active {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-subtle);
  }

  .zoom-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 10px;
  }

  .zoom-row input[type="range"] {
    flex: 1;
    padding: 0;
    border: none;
    background: transparent;
    accent-color: var(--accent);
  }

  .zoom-value {
    width: 42px;
    text-align: right;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .theme-swatches {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  }

  .theme-swatch {
    flex-direction: column;
    gap: 5px;
    padding: 4px 0;
    color: var(--text-secondary);
    font-size: 11px;
  }

  .swatch-chip {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-reading);
    font-size: 15px;
    font-weight: 600;
    box-shadow: inset 0 0 0 1px rgba(128, 128, 128, 0.35);
    transition: box-shadow var(--transition-fast), transform var(--transition-fast);
  }

  .theme-swatch:hover .swatch-chip {
    transform: scale(1.06);
  }

  .theme-swatch.active {
    color: var(--text-primary);
    font-weight: 600;
  }

  .theme-swatch.active .swatch-chip {
    box-shadow: 0 0 0 2px var(--bg-surface-elevated), 0 0 0 4px var(--accent);
  }

  .menu-toggles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 2px;
  }

  .menu-row {
    justify-content: flex-start;
    gap: 10px;
    width: 100%;
    padding: 8px 8px;
    font-size: 13px;
    color: var(--text-primary);
  }

  .menu-row:hover {
    background: var(--bg-hover);
  }

  .menu-row span {
    flex: 1;
    text-align: left;
  }

  kbd {
    font-family: inherit;
    font-size: 11px;
    color: var(--text-muted);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-xs);
    padding: 1px 5px;
  }

  .badge {
    position: absolute;
    top: -3px;
    right: -5px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--accent-text);
    font-size: 9.5px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
    border: 2px solid var(--bg-surface);
    box-sizing: content-box;
  }

  .progress-track {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    pointer-events: none;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    transform-origin: left center;
    transition: transform var(--transition-normal);
    opacity: 0.8;
  }

  @media (max-width: 980px) {
    .zoom-controls {
      display: none;
    }
  }

  @media (max-width: 760px) {
    .view-label,
    .hide-narrow {
      display: none;
    }
    .top-bar {
      gap: 6px;
      padding: 0 6px;
    }
  }

  @media (max-width: 520px) {
    .book-title {
      display: none;
    }
    .top-bar {
      grid-template-columns: auto 1fr auto;
    }
    .top-center {
      justify-self: center;
    }
  }
</style>
