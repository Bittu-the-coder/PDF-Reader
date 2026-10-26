<script lang="ts">
  import { appState } from "../stores/appState.svelte";
  import type { PDFViewer } from "../pdf/pdfViewer";

  let { pdfViewer }: { pdfViewer: PDFViewer | null } = $props();
  let activeTab = $state<"thumbnails" | "outline">("thumbnails");

  function jumpToPage(page: number) {
    appState.saveCurrentProgress(page);
  }
</script>

<!-- Hot zone detector on the left edge of the window -->
<div
  class="left-hot-zone"
  onmouseenter={() => appState.onLeftEdgeEnter()}
  role="region"
  aria-label="Sidebar navigation hot zone"
></div>

<aside
  class="sidebar {appState.sidebarVisible || appState.sidebarPinned ? 'visible' : ''}"
  onmouseenter={() => appState.onLeftEdgeEnter()}
  onmouseleave={() => appState.onLeftEdgeLeave()}
>
  <div class="sidebar-header">
    <div class="sidebar-tabs">
      <button
        class="tab-btn {activeTab === 'thumbnails' ? 'active' : ''}"
        onclick={() => (activeTab = "thumbnails")}
      >
        Pages
      </button>
      <button
        class="tab-btn {activeTab === 'outline' ? 'active' : ''}"
        onclick={() => (activeTab = "outline")}
      >
        Chapters ({appState.chapters.length})
      </button>
    </div>

    <button
      class="icon-btn {appState.sidebarPinned ? 'active' : ''}"
      onclick={() => (appState.sidebarPinned = !appState.sidebarPinned)}
      title="Pin Sidebar (Ctrl+B)"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="17" x2="12" y2="22"/>
        <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
      </svg>
    </button>
  </div>

  <div class="sidebar-content">
    {#if activeTab === "thumbnails"}
      <div class="thumbnails-grid">
        {#each Array(appState.pageCount) as _, i}
          {@const pageNum = i + 1}
          <button
            class="thumbnail-card {appState.currentPage === pageNum ? 'active' : ''}"
            onclick={() => jumpToPage(pageNum)}
          >
            <div class="thumb-placeholder">
              <span class="thumb-page-label">{pageNum}</span>
            </div>
            <span class="page-num-tag">{pageNum}</span>
          </button>
        {/each}
      </div>
    {:else}
      <div class="outline-list">
        {#if appState.chapters.length === 0}
          <div class="empty-state">No outline chapters detected in this PDF.</div>
        {:else}
          {#each appState.chapters as ch}
            <button
              class="chapter-item {appState.currentPage >= ch.start_page ? 'current' : ''}"
              onclick={() => jumpToPage(ch.start_page)}
            >
              <span class="chapter-title">{ch.title}</span>
              <span class="chapter-page">{ch.start_page}</span>
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</aside>

<style>
  .left-hot-zone {
    position: fixed;
    top: 48px;
    left: 0;
    bottom: 0;
    width: 6px;
    z-index: 100;
  }

  .sidebar {
    position: fixed;
    top: 48px;
    left: 0;
    bottom: 0;
    width: 240px;
    background: var(--bg-glass);
    backdrop-filter: blur(12px);
    border-right: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    z-index: 98;
    transform: translateX(-100%);
    opacity: 0;
    pointer-events: none;
    transition: transform var(--transition-normal), opacity var(--transition-normal);
    box-shadow: var(--shadow-md);
  }

  .sidebar.visible {
    transform: translateX(0);
    opacity: 1;
    pointer-events: auto;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .sidebar-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-surface);
    border-radius: var(--radius-sm);
    padding: 2px;
  }

  .tab-btn {
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .tab-btn.active {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  .icon-btn {
    width: 26px;
    height: 26px;
    color: var(--text-secondary);
  }

  .icon-btn.active {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }

  .thumbnails-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  .thumbnail-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    background: var(--bg-surface);
    transition: border-color var(--transition-fast), transform var(--transition-fast);
  }

  .thumbnail-card:hover {
    border-color: var(--border-strong);
    transform: translateY(-1px);
  }

  .thumbnail-card.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-subtle);
  }

  .thumb-placeholder {
    width: 100%;
    aspect-ratio: 1 / 1.414;
    background: var(--pdf-bg);
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 12px;
  }

  .page-num-tag {
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 4px;
  }

  .outline-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .chapter-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 10px;
    font-size: 12px;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    text-align: left;
  }

  .chapter-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .chapter-item.current {
    font-weight: 500;
    color: var(--text-primary);
  }

  .chapter-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .chapter-page {
    font-size: 11px;
    color: var(--text-muted);
    margin-left: 8px;
  }

  .empty-state {
    font-size: 12px;
    color: var(--text-muted);
    padding: 16px;
    text-align: center;
  }
</style>
