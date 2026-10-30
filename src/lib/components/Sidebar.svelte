<script lang="ts">
  import { appState } from "../stores/appState.svelte";
  import type { PDFViewer, OutlineNode } from "../pdf/pdfViewer";
  import { SvelteSet } from "svelte/reactivity";
  import Icon from "./Icon.svelte";

  let { pdfViewer }: { pdfViewer: PDFViewer | null } = $props();
  let activeTab = $state<"thumbnails" | "outline" | "bookmarks">("outline");

  let contentEl = $state<HTMLDivElement>();

  function jumpToPage(page: number) {
    appState.jumpToPage(page);
    // In small windows the panel covers the page, so get out of the way
    if (appState.isCompact) appState.sidebarVisible = false;
  }

  // Contents come from the PDF's own (nested) outline; fall back to stored chapters
  let hasOutline = $derived(appState.outline.length > 0);

  // The entry the reader is in: the last one starting at or before the current page
  let currentNode = $derived.by(() => {
    let current: OutlineNode | null = null;
    for (const n of appState.outlineFlat) {
      if ((n.page ?? Infinity) <= appState.currentPage) current = n;
      else break;
    }
    return current;
  });

  let currentChapterId = $derived.by(() => {
    let current: number | null = null;
    for (const ch of appState.chapters) {
      if (ch.start_page <= appState.currentPage) current = ch.id;
    }
    return current;
  });

  // Expanded branches; the path to the current entry is always open
  const expanded = new SvelteSet<OutlineNode>();
  $effect(() => {
    const target = currentNode;
    if (!target) return;
    const path: OutlineNode[] = [];
    const find = (nodes: OutlineNode[]): boolean => {
      for (const n of nodes) {
        path.push(n);
        if (n === target || find(n.children)) return true;
        path.pop();
      }
      return false;
    };
    find(appState.outline);
    for (const n of path) if (n.children.length) expanded.add(n);
  });

  // Show Contents when the book has one (it loads after the pages), Pages otherwise,
  // until the reader picks a tab themselves
  let userPickedTab = false;
  $effect(() => {
    const hasContents = hasOutline || appState.chapters.length > 0;
    if (!userPickedTab) activeTab = hasContents ? "outline" : "thumbnails";
  });

  function pickTab(tab: typeof activeTab) {
    userPickedTab = true;
    activeTab = tab;
  }

  function toggle(n: OutlineNode) {
    if (expanded.has(n)) expanded.delete(n);
    else expanded.add(n);
  }

  // Keep the active thumbnail / chapter in view as the reader moves through the book
  $effect(() => {
    const page = appState.currentPage;
    const visible = appState.sidebarVisible;
    const tab = activeTab;
    const chapter = currentChapterId;
    if (!visible || !contentEl) return;
    currentNode;
    const selector =
      tab === "thumbnails" ? `[data-thumb="${page}"]` : tab === "outline" ? `.chapter-item.current` : `[data-bm="${page}"]`;
    const el = contentEl.querySelector(selector) as HTMLElement | null;
    if (!el) return;
    const box = contentEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });

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

{#snippet outlineNodes(nodes: OutlineNode[])}
  {#each nodes as node}
    <div class="outline-node" style="--depth: {node.depth}" role="treeitem" aria-selected={node === currentNode} aria-expanded={node.children.length ? expanded.has(node) : undefined}>
      <div class="outline-row">
        {#if node.children.length}
          <button class="twisty" class:open={expanded.has(node)} onclick={() => toggle(node)} aria-label={expanded.has(node) ? "Collapse" : "Expand"}>
            <Icon name="chevron-right" size={13} />
          </button>
        {:else}
          <span class="twisty-space"></span>
        {/if}
        <button
          class="chapter-item"
          class:current={node === currentNode}
          class:top={node.depth === 0}
          disabled={!node.page}
          onclick={() => node.page && (appState.jumpToPage(node.page, undefined, true), appState.isCompact && (appState.sidebarVisible = false))}
          title={node.title}
        >
          <span class="chapter-title">{node.title}</span>
          {#if node.page}<span class="chapter-page">{node.page}</span>{/if}
        </button>
      </div>
      {#if node.children.length && expanded.has(node)}
        {@render outlineNodes(node.children)}
      {/if}
    </div>
  {/each}
{/snippet}

<aside
  class="sidebar {appState.sidebarVisible ? 'visible' : ''} {appState.sidebarPinned && !appState.isCompact ? 'pinned' : 'floating'}"
  onmouseleave={() => appState.onLeftEdgeLeave()}
  aria-label="Contents, pages and bookmarks"
  aria-hidden={!appState.sidebarVisible}
  inert={!appState.sidebarVisible}
>
  <div class="sidebar-header">
    <div class="sidebar-tabs">
      <button
        class="tab-btn {activeTab === 'outline' ? 'active' : ''}"
        onclick={() => pickTab("outline")}
        title="Table of contents"
      >
        Contents
      </button>
      <button
        class="tab-btn {activeTab === 'thumbnails' ? 'active' : ''}"
        onclick={() => pickTab("thumbnails")}
      >
        Pages
      </button>
      <button
        class="tab-btn {activeTab === 'bookmarks' ? 'active' : ''}"
        onclick={() => pickTab("bookmarks")}
        title="Bookmarks"
        aria-label="Bookmarks"
      >
        <Icon name="bookmark" size={13} />
        {#if appState.bookmarks.length}<span class="tab-count">{appState.bookmarks.length}</span>{/if}
      </button>
    </div>

    <div class="header-actions">
      {#if !appState.isCompact}
        <button
          class="icon-btn sm {appState.sidebarPinned ? 'active' : ''}"
          onclick={() => appState.toggleSidebarPinned()}
          title={appState.sidebarPinned ? "Undock (float over the page)" : "Dock next to the page"}
          aria-label={appState.sidebarPinned ? "Undock sidebar" : "Dock sidebar"}
        >
          <Icon name={appState.sidebarPinned ? "pin-off" : "pin"} size={15} />
        </button>
      {/if}

      <button class="icon-btn sm" onclick={() => (appState.sidebarVisible = false)} title="Close" aria-label="Close sidebar">
        <Icon name="x" size={16} />
      </button>
    </div>
  </div>

  <div class="sidebar-content" bind:this={contentEl}>
    {#if activeTab === "thumbnails"}
      <div class="thumbnails-grid">
        {#each Array(appState.pageCount) as _, i}
          {@const pageNum = i + 1}
          {@const ann = pageAnnotationMap.get(pageNum)}
          <button
            class="thumbnail-card {appState.currentPage === pageNum ? 'active' : ''}"
            data-thumb={pageNum}
            onclick={() => jumpToPage(pageNum)}
            title="Page {pageNum}{ann ? ` (${ann.highlights} highlights, ${ann.notes} notes, ${ann.words} words)` : ''}"
          >
            <div class="thumb-canvas-box">
              <canvas use:renderThumb={{ pageNum, viewer: pdfViewer }} class="thumb-canvas"></canvas>
              {#if ann && (ann.highlights > 0 || ann.notes > 0 || ann.words > 0)}
                <div class="thumb-annotations-bar">
                  {#if ann.highlights > 0}
                    <span class="ann-pill hl" title="{ann.highlights} highlights"><Icon name="highlighter" size={9} strokeWidth={2.5} />{ann.highlights}</span>
                  {/if}
                  {#if ann.notes > 0}
                    <span class="ann-pill note" title="{ann.notes} notes"><Icon name="pen" size={9} strokeWidth={2.5} />{ann.notes}</span>
                  {/if}
                  {#if ann.words > 0}
                    <span class="ann-pill word" title="{ann.words} saved words"><Icon name="bookmark" size={9} strokeWidth={2.5} />{ann.words}</span>
                  {/if}
                </div>
              {/if}
            </div>
            <span class="page-num-tag">{pageNum}</span>
          </button>
        {/each}
      </div>
    {:else if activeTab === "outline"}
      {#if hasOutline}
        <div class="outline-list" role="tree">
          {@render outlineNodes(appState.outline)}
        </div>
      {:else if appState.chapters.length > 0}
        <div class="outline-list">
          {#each appState.chapters as ch}
            <button
              class="chapter-item {currentChapterId === ch.id ? 'current' : ''}"
              data-chapter={ch.id}
              onclick={() => jumpToPage(ch.start_page)}
            >
              <span class="chapter-title">{ch.title}</span>
              <span class="chapter-page">{ch.start_page}</span>
            </button>
          {/each}
        </div>
      {:else}
        <div class="empty-state">
          <Icon name="list" size={22} />
          <p>This PDF has no table of contents.</p>
        </div>
      {/if}
    {:else}
      {#if appState.bookmarks.length === 0}
        <div class="empty-state">
          <Icon name="bookmark" size={22} />
          <p>No bookmarks yet.</p>
          <p class="hint">Press <kbd>Ctrl</kbd> + <kbd>D</kbd> or the bookmark button to mark a page.</p>
        </div>
      {:else}
        <div class="outline-list">
          {#each appState.bookmarks as bm (bm.id)}
            <div class="bookmark-row" class:current={bm.page === appState.currentPage} data-bm={bm.page}>
              <button class="chapter-item" onclick={() => jumpToPage(bm.page)}>
                <Icon name="bookmark" size={14} class="bm-icon" />
                <span class="chapter-title">{bm.label || `Page ${bm.page}`}</span>
                <span class="chapter-page">{bm.page}</span>
              </button>
              <button class="icon-btn sm remove" onclick={() => appState.toggleBookmark(bm.page)} title="Remove bookmark" aria-label="Remove bookmark on page {bm.page}">
                <Icon name="x" size={14} />
              </button>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</aside>

<style>
  .sidebar {
    width: 252px;
    background: var(--bg-surface);
    border-right: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    z-index: 90;
    flex-shrink: 0;
    height: 100%;
    position: relative;
    transition: transform var(--transition-normal), opacity 0.2s ease;
  }

  .sidebar.floating {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 96;
    background: var(--bg-surface-elevated);
    box-shadow: var(--shadow-lg);
    transform: translateX(-100%);
    opacity: 0;
    pointer-events: none;
  }

  .sidebar.floating.visible {
    transform: translateX(0);
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
    gap: 8px;
    padding: 8px 8px 8px 10px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .icon-btn.sm {
    width: 28px;
    height: 28px;
  }

  .sidebar-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    padding: 2px;
  }

  .tab-btn {
    height: 26px;
    padding: 0 12px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    border-radius: var(--radius-xs);
  }

  .tab-btn:hover {
    color: var(--text-primary);
  }

  .tab-btn.active {
    background: var(--bg-surface-elevated);
    color: var(--text-primary);
    box-shadow: var(--shadow-sm);
  }

  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    overscroll-behavior: contain;
  }

  .thumbnails-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 14px 12px;
  }

  .thumbnail-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .thumb-canvas-box {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1.414;
    background: #ffffff;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    box-shadow: 0 0 0 1px var(--border-subtle), var(--shadow-sm);
    transition: box-shadow var(--transition-fast), transform var(--transition-fast);
  }

  .thumbnail-card:hover .thumb-canvas-box {
    box-shadow: 0 0 0 1px var(--border-strong), var(--shadow-md);
  }

  .thumbnail-card.active .thumb-canvas-box {
    box-shadow: 0 0 0 2px var(--accent), var(--shadow-md);
  }

  .thumb-annotations-bar {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    z-index: 2;
    pointer-events: none;
  }

  .ann-pill {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 9px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 4px;
    line-height: 1.3;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  .ann-pill.hl {
    background: #facc15;
    color: #422006;
  }

  .ann-pill.note {
    background: #3b82f6;
    color: #ffffff;
  }

  .ann-pill.word {
    background: #a855f7;
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
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .thumbnail-card.active .page-num-tag {
    color: var(--accent);
    font-weight: 700;
  }

  .outline-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .chapter-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 10px;
    font-size: 13px;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    text-align: left;
    position: relative;
  }

  .chapter-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .chapter-item.current {
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-subtle);
  }

  .chapter-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .chapter-page {
    font-size: 11.5px;
    color: var(--text-muted);
    margin-left: 8px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .tab-btn {
    gap: 4px;
  }

  .tab-count {
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .outline-row {
    display: flex;
    align-items: center;
    padding-left: calc(var(--depth) * 14px);
  }

  .twisty,
  .twisty-space {
    width: 20px;
    height: 28px;
    flex-shrink: 0;
  }

  .twisty {
    color: var(--text-muted);
    border-radius: var(--radius-xs);
  }

  .twisty :global(svg) {
    transition: transform var(--transition-fast);
  }

  .twisty.open :global(svg) {
    transform: rotate(90deg);
  }

  .twisty:hover {
    color: var(--text-primary);
  }

  .outline-row .chapter-item {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
  }

  .chapter-item.top {
    color: var(--text-primary);
    font-weight: 500;
  }

  .chapter-item:disabled {
    opacity: 0.6;
  }

  .bookmark-row {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: var(--radius-sm);
  }

  .bookmark-row .chapter-item {
    flex: 1;
    min-width: 0;
    gap: 8px;
  }

  .bookmark-row :global(.bm-icon) {
    color: var(--danger);
    fill: var(--danger);
  }

  .bookmark-row.current .chapter-item {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .bookmark-row .remove {
    opacity: 0;
  }

  .bookmark-row:hover .remove,
  .bookmark-row:focus-within .remove {
    opacity: 1;
  }

  @media (hover: none) {
    .bookmark-row .remove {
      opacity: 1;
    }
  }

  .hint {
    font-size: 12px;
  }

  kbd {
    font-family: inherit;
    font-size: 11px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-xs);
    padding: 0 5px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--text-muted);
    padding: 40px 16px;
    text-align: center;
  }

  @media (max-width: 720px) {
    .sidebar {
      width: min(300px, 86vw);
    }
  }
</style>
