<script lang="ts">
  import { appState } from "../stores/appState.svelte";
  import type { PDFViewer } from "../pdf/pdfViewer";

  let { pdfViewer }: { pdfViewer: PDFViewer | null } = $props();
  let activeTab = $state<"thumbnails" | "outline">("thumbnails");

  function jumpToPage(page: number) {
    appState.jumpToPage(page);
  }

  // Pre-aggregate annotations per page for fast lookup
  let pageAnnotationMap = $derived.by(() => {
    const map = new Map<number, { highlights: number; notes: number; words: number }>();
    for (const h of appState.highlights) {
      if (h.page) {
        const cur = map.get(h.page) || { highlights: 0, notes: 0, words: 0 };
        cur.highlights++;
        map.set(h.page, cur);
      }
    }
    for (const n of appState.notes) {
      if (n.page) {
        const cur = map.get(n.page) || { highlights: 0, notes: 0, words: 0 };
        cur.notes++;
        map.set(n.page, cur);
      }
    }
    for (const w of appState.words) {
      if (w.page) {
        const cur = map.get(w.page) || { highlights: 0, notes: 0, words: 0 };
        cur.words++;
        map.set(w.page, cur);
      }
    }
    return map;
  });

  // Svelte action to lazily render page thumbnail onto canvas
  function renderThumb(node: HTMLCanvasElement, params: { pageNum: number; viewer: PDFViewer | null }) {
    let cancelled = false;
    let rendered = false;
    let currentPageNum = params.pageNum;
    let currentViewer = params.viewer;

    const render = async () => {
      if (cancelled || rendered || !currentViewer || !currentViewer.doc) return;
      try {
        rendered = true;
        await currentViewer.renderThumbnail(currentPageNum, node, 150);
      } catch {
        rendered = false;
      }
    };

    if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && !cancelled && !rendered) {
            if (currentViewer && currentViewer.doc) {
              observer.disconnect();
              render();
            }
          }
        },
        { rootMargin: "300px" }
      );
      observer.observe(node);

      return {
        update(newParams: { pageNum: number; viewer: PDFViewer | null }) {
          currentPageNum = newParams.pageNum;
          currentViewer = newParams.viewer;
          if (currentViewer && currentViewer.doc && !rendered) {
            render();
          }
        },
        destroy() {
          cancelled = true;
          observer.disconnect();
        },
      };
    } else {
      render();
      return {
        update(newParams: { pageNum: number; viewer: PDFViewer | null }) {
          currentPageNum = newParams.pageNum;
          currentViewer = newParams.viewer;
          if (currentViewer && currentViewer.doc && !rendered) {
            render();
          }
        },
        destroy() {
          cancelled = true;
        },
      };
    }
  }
</script>

<aside
  class="sidebar {appState.sidebarVisible ? 'visible' : ''} {appState.sidebarPinned ? 'pinned' : 'floating'}"
  onmouseleave={() => appState.onLeftEdgeLeave()}
>
  <div class="sidebar-header">
    <div class="sidebar-tabs">
      <button
        class="tab-btn {activeTab === 'thumbnails' ? 'active' : ''}"
        onclick={() => (activeTab = "thumbnails")}
      >
        Pages ({appState.pageCount})
      </button>
      <button
        class="tab-btn {activeTab === 'outline' ? 'active' : ''}"
        onclick={() => (activeTab = "outline")}
      >
        Chapters ({appState.chapters.length})
      </button>
    </div>

    <div class="header-actions">
      <button
        class="icon-btn {appState.sidebarPinned ? 'active pinned' : ''}"
        onclick={() => appState.toggleSidebarPinned()}
        title={appState.sidebarPinned ? "Unpin sidebar (Auto-hide on leave)" : "Pin sidebar"}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={appState.sidebarPinned ? "currentColor" : "none"} stroke="currentColor" stroke-width="2">
          <path d="M12 17v5"/>
          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V5h1a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1z"/>
        </svg>
      </button>

      <button
        class="icon-btn"
        onclick={() => (appState.sidebarVisible = false)}
        title="Close Sidebar"
      >
        ✕
      </button>
    </div>
  </div>

  <div class="sidebar-content">
    {#if activeTab === "thumbnails"}
      <div class="thumbnails-grid">
        {#each Array(appState.pageCount) as _, i}
          {@const pageNum = i + 1}
          {@const ann = pageAnnotationMap.get(pageNum)}
          <button
            class="thumbnail-card {appState.currentPage === pageNum ? 'active' : ''}"
            onclick={() => jumpToPage(pageNum)}
            title="Page {pageNum}{ann ? ` (${ann.highlights} highlights, ${ann.notes} notes, ${ann.words} words)` : ''}"
          >
            <div class="thumb-canvas-box">
              <canvas use:renderThumb={{ pageNum, viewer: pdfViewer }} class="thumb-canvas"></canvas>
              {#if ann && (ann.highlights > 0 || ann.notes > 0 || ann.words > 0)}
                <div class="thumb-annotations-bar">
                  {#if ann.highlights > 0}
                    <span class="ann-pill hl" title="{ann.highlights} highlights">● {ann.highlights}</span>
                  {/if}
                  {#if ann.notes > 0}
                    <span class="ann-pill note" title="{ann.notes} notes">✎ {ann.notes}</span>
                  {/if}
                  {#if ann.words > 0}
                    <span class="ann-pill word" title="{ann.words} vocabulary words">📖 {ann.words}</span>
                  {/if}
                </div>
              {/if}
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
  .sidebar {
    width: 250px;
    background: var(--bg-surface);
    border-right: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    z-index: 90;
    flex-shrink: 0;
    height: 100%;
    position: relative;
    box-shadow: var(--shadow-sm);
    transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
  }

  /* Floating unpinned mode */
  .sidebar.floating {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 95;
    background: var(--bg-surface-elevated, #1c1c1f);
    box-shadow: 6px 0 28px rgba(0, 0, 0, 0.45);
    transform: translateX(-100%);
    opacity: 0;
    pointer-events: none;
  }

  .sidebar.floating.visible {
    transform: translateX(0);
    opacity: 1;
    pointer-events: auto;
  }

  /* Pinned docked mode */
  .sidebar.pinned {
    position: relative;
    transform: none;
    opacity: 1;
    pointer-events: auto;
  }

  .sidebar.pinned:not(.visible) {
    display: none;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
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
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .tab-btn.active {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    color: var(--text-secondary);
    border-radius: var(--radius-xs);
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .icon-btn.active {
    color: var(--accent);
    background: var(--accent-subtle);
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
    transition: border-color var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast);
    cursor: pointer;
    overflow: hidden;
  }

  .thumbnail-card:hover {
    border-color: var(--border-strong);
    transform: translateY(-2px);
    box-shadow: var(--shadow-sm);
  }

  .thumbnail-card.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-subtle);
    background: var(--bg-surface-elevated);
  }

  .thumb-canvas-box {
    position: relative;
    width: 100%;
    min-height: 110px;
    aspect-ratio: 1 / 1.414;
    background: #ffffff;
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  }

  .thumb-annotations-bar {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    z-index: 2;
    pointer-events: none;
  }

  .ann-pill {
    font-size: 8.5px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 3px;
    line-height: 1.2;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  }

  .ann-pill.hl {
    background: rgba(234, 179, 8, 0.95);
    color: #422006;
  }

  .ann-pill.note {
    background: rgba(59, 130, 246, 0.95);
    color: #ffffff;
  }

  .ann-pill.word {
    background: rgba(168, 85, 247, 0.95);
    color: #ffffff;
  }

  .thumb-canvas {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  .page-num-tag {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-top: 6px;
  }

  .thumbnail-card.active .page-num-tag {
    color: var(--accent);
    font-weight: 700;
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
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .chapter-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .chapter-item.current {
    font-weight: 600;
    color: var(--text-primary);
    background: var(--bg-active);
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
    font-weight: 500;
  }

  .empty-state {
    font-size: 12px;
    color: var(--text-muted);
    padding: 24px 16px;
    text-align: center;
  }

  @media (max-width: 640px) {
    .sidebar {
      width: min(280px, 85vw);
    }
    .thumbnails-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
