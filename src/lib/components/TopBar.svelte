<script lang="ts">
  import { appState, type Theme, type ReadingMode } from "../stores/appState.svelte";

  let pageInput = $state(appState.currentPage);
  let themeMenuOpen = $state(false);

  $effect(() => {
    pageInput = appState.currentPage;
  });

  function handlePageCommit() {
    let p = Math.max(1, Math.min(appState.pageCount, Number(pageInput) || 1));
    pageInput = p;
    appState.jumpToPage(p);
  }

  const themes: { id: Theme; name: string; icon: string; desc: string }[] = [
    { id: "dark", name: "Dark Reading", icon: "🌙", desc: "Charcoal inverted PDF" },
    { id: "light", name: "Light Paper", icon: "☀️", desc: "Original daylight white" },
    { id: "eyecare", name: "Eye Protection", icon: "🕯️", desc: "Warm amber blue-light shield" },
    { id: "sepia", name: "Sepia Parchment", icon: "📜", desc: "Vintage warm paper" },
    { id: "invert", name: "OLED Invert", icon: "⬛", desc: "Pure black high contrast" },
  ];

  const readingModes: { id: ReadingMode; label: string; icon: string }[] = [
    { id: "single", label: "Single", icon: "📄" },
    { id: "dual", label: "Two Pages", icon: "📖" },
    { id: "scroll", label: "Scroll", icon: "📜" },
  ];
</script>

<header
  class="top-bar"
  role="toolbar"
  aria-label="Reader Top Bar"
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
        onclick={() => appState.jumpToPage(appState.currentPage - (appState.readingMode === 'dual' ? 2 : 1))}
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
        onclick={() => appState.jumpToPage(appState.currentPage + (appState.readingMode === 'dual' ? 2 : 1))}
        title="Next Page (Right Arrow / Page Down)"
      >
        ›
      </button>
    </div>

    <!-- Reading Mode Selector (Single / Dual / Vertical Scroll) -->
    <div class="mode-selector">
      {#each readingModes as m}
        <button
          class="mode-btn {appState.readingMode === m.id ? 'active' : ''}"
          onclick={() => appState.setReadingMode(m.id)}
          title="Reading Mode: {m.label}"
        >
          <span class="mode-icon">{m.icon}</span>
          <span class="mode-label">{m.label}</span>
        </button>
      {/each}
    </div>

    <!-- Zoom Controls -->
    <div class="zoom-controls">
      <button class="icon-btn-sm" onclick={() => appState.zoomOut()} title="Zoom Out (Ctrl -)">-</button>
      <span class="zoom-text">{Math.round(appState.zoom * 100)}%</span>
      <button class="icon-btn-sm" onclick={() => appState.zoomIn()} title="Zoom In (Ctrl +)">+</button>
      <button
        class="text-btn-sm {appState.fitMode === 'width' ? 'active' : ''}"
        onclick={() => appState.setFitMode("width")}
        title="Fit Width"
      >
        Fit Width
      </button>
      <button
        class="text-btn-sm {appState.fitMode === 'page' ? 'active' : ''}"
        onclick={() => appState.setFitMode("page")}
        title="Fit Page"
      >
        Fit Page
      </button>
    </div>
  </div>

  <div class="top-right">
    <!-- Theme & Eye Care Menu Dropdown -->
    <div class="theme-menu-wrapper">
      <button
        class="icon-btn {themeMenuOpen ? 'active' : ''}"
        onclick={() => (themeMenuOpen = !themeMenuOpen)}
        title="View Mode & PDF Color Theme"
      >
        {#if appState.theme === "dark"}
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
          </svg>
        {:else if appState.theme === "eyecare"}
          <span style="font-size: 15px;">🕯️</span>
        {:else if appState.theme === "sepia"}
          <span style="font-size: 15px;">📜</span>
        {:else if appState.theme === "invert"}
          <span style="font-size: 15px;">⬛</span>
        {:else}
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
          </svg>
        {/if}
      </button>

      {#if themeMenuOpen}
        <div
          class="theme-dropdown"
          role="menu"
          tabindex="-1"
          onmouseleave={() => (themeMenuOpen = false)}
        >
          <div class="dropdown-header">PDF Theme & Color</div>
          {#each themes as t}
            <button
              class="theme-option {appState.theme === t.id ? 'active' : ''}"
              onclick={() => { appState.setTheme(t.id); themeMenuOpen = false; }}
              role="menuitem"
            >
              <span class="theme-opt-icon">{t.icon}</span>
              <div class="theme-opt-info">
                <span class="theme-opt-name">{t.name}</span>
                <span class="theme-opt-desc">{t.desc}</span>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Memory Drawer Toggle -->
    <button
      class="icon-btn {appState.memoryDrawerOpen || appState.memoryDrawerPinned ? 'active' : ''}"
      onclick={() => appState.toggleMemoryDrawer()}
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

    <!-- Fullscreen Toggle Button -->
    <button
      class="icon-btn {appState.isFullscreen ? 'active' : ''}"
      onclick={() => appState.toggleFullscreen()}
      title="Toggle Fullscreen (F11 / F)"
    >
      {#if appState.isFullscreen}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
        </svg>
      {:else}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
        </svg>
      {/if}
    </button>

    <!-- Settings Modal Toggle -->
    <button
      class="icon-btn {appState.settingsModalOpen ? 'active' : ''}"
      onclick={() => (appState.settingsModalOpen = true)}
      title="Settings & AI Model Provider"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    </button>

    <!-- Pin Button for Top Bar (Smart Toggle) -->
    <button
      class="icon-btn {appState.topBarPinned ? 'active pinned' : ''}"
      onclick={() => appState.toggleTopBarPinned()}
      title={appState.topBarPinned ? "Unpin Top Bar (Auto-hide for immersive reading)" : "Pin Top Bar (Always visible)"}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill={appState.topBarPinned ? "currentColor" : "none"} stroke="currentColor" stroke-width="2">
        <path d="M12 17v5"/>
        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V5h1a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1z"/>
      </svg>
    </button>
  </div>
</header>

<style>
  .top-bar {
    height: 44px;
    min-height: 44px;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    box-shadow: var(--shadow-sm);
    position: relative;
    flex-shrink: 0;
    z-index: 80;
  }

  .top-left, .top-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .book-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .top-center {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .page-nav {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-surface);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
  }

  .page-input-wrapper {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 4px;
  }

  .page-input {
    width: 36px;
    padding: 2px 4px;
    font-size: 12px;
    text-align: center;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-weight: 600;
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .page-input::-webkit-outer-spin-button,
  .page-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .page-count {
    font-size: 12px;
    color: var(--text-muted);
  }

  .mode-selector {
    display: flex;
    align-items: center;
    background: var(--bg-surface);
    padding: 2px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    gap: 2px;
  }

  .mode-btn {
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    border-radius: var(--radius-xs);
    gap: 4px;
    transition: all var(--transition-fast);
  }

  .mode-btn.active {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  .mode-icon {
    font-size: 12px;
  }

  .zoom-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-surface);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
  }

  .zoom-text {
    font-size: 11px;
    font-weight: 600;
    min-width: 40px;
    text-align: center;
    color: var(--text-secondary);
  }

  .text-btn-sm {
    padding: 3px 7px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    border-radius: var(--radius-xs);
  }

  .text-btn-sm.active {
    background: var(--bg-active);
    color: var(--text-primary);
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
    color: var(--accent);
    background: var(--accent-subtle);
  }

  .icon-btn-sm {
    width: 22px;
    height: 22px;
    font-size: 14px;
    color: var(--text-secondary);
    border-radius: var(--radius-xs);
  }

  .icon-btn-sm:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .icon-btn-sm:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .badge {
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    background: var(--accent);
    color: #ffffff;
    font-size: 9px;
    font-weight: 700;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .theme-menu-wrapper {
    position: relative;
  }

  .theme-dropdown {
    position: absolute;
    top: 38px;
    right: 0;
    width: 210px;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    padding: 6px;
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .dropdown-header {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    padding: 6px 8px 4px;
  }

  .theme-option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    text-align: left;
    width: 100%;
    transition: background var(--transition-fast);
  }

  .theme-option:hover {
    background: var(--bg-hover);
  }

  .theme-option.active {
    background: var(--bg-active);
    border: 1px solid var(--accent);
  }

  .theme-opt-icon {
    font-size: 16px;
  }

  .theme-opt-info {
    display: flex;
    flex-direction: column;
  }

  .theme-opt-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .theme-opt-desc {
    font-size: 10px;
    color: var(--text-muted);
  }

  @media (max-width: 960px) {
    .book-title {
      max-width: 120px;
    }
    .top-center {
      gap: 8px;
    }
  }

  @media (max-width: 820px) {
    .book-title {
      display: none;
    }
    .mode-label {
      display: none;
    }
    .mode-btn {
      padding: 3px 6px;
    }
  }

  @media (max-width: 680px) {
    .text-btn-sm {
      display: none;
    }
    .top-bar {
      padding: 0 8px;
    }
    .top-center {
      gap: 4px;
    }
    .page-count {
      display: none;
    }
  }
</style>
