<script lang="ts">
  import { appState } from "../stores/appState.svelte";
  import type { PDFViewer } from "../pdf/pdfViewer";
  import { searchDocument } from "../pdf/search";
  import Icon from "./Icon.svelte";

  let { pdfViewer }: { pdfViewer: PDFViewer | null } = $props();

  let inputEl = $state<HTMLInputElement>();
  let showResults = $state(false);
  let scanned = $state(0);
  let searchToken = 0;
  let debounce: any = null;

  $effect(() => {
    appState.searchFocusToken;
    if (appState.searchOpen) {
      requestAnimationFrame(() => {
        inputEl?.focus();
        inputEl?.select();
      });
    }
  });

  // Prefill with the current selection when opening search
  $effect(() => {
    if (!appState.searchFocusToken) return;
    const sel = window.getSelection()?.toString().trim();
    if (sel && sel.length < 80 && !sel.includes("\n")) appState.searchQuery = sel;
  });

  // Re-run the search (debounced) when the query or document changes
  $effect(() => {
    const query = appState.searchQuery.trim();
    const viewer = pdfViewer;
    const open = appState.searchOpen;
    clearTimeout(debounce);
    const token = ++searchToken;
    if (!open || !viewer || query.length < 2) {
      appState.searchMatches = [];
      appState.searchIndex = -1;
      appState.searchScanning = false;
      return;
    }
    debounce = setTimeout(async () => {
      appState.searchScanning = true;
      appState.searchIndex = -1;
      scanned = 0;
      const isCancelled = () => token !== searchToken;
      const matches = await searchDocument(viewer, query, isCancelled, (partial, pages) => {
        if (isCancelled()) return;
        appState.searchMatches = partial;
        scanned = pages;
      });
      if (isCancelled()) return;
      appState.searchMatches = matches;
      appState.searchScanning = false;
      // Start from the first match at or after the current page
      if (matches.length > 0) {
        const start = matches.findIndex((m) => m.page >= appState.currentPage);
        appState.gotoMatch(start === -1 ? 0 : start);
      }
    }, 250);
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      appState.gotoMatch(appState.searchIndex + (e.shiftKey ? -1 : 1));
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      appState.closeSearch();
    }
  }

  let status = $derived.by(() => {
    const n = appState.searchMatches.length;
    if (appState.searchQuery.trim().length < 2) return "";
    if (n === 0) return appState.searchScanning ? `Searching… ${scanned}/${appState.pageCount}` : "No results";
    const count = n >= 1000 ? "1000+" : String(n);
    return appState.searchIndex >= 0 ? `${appState.searchIndex + 1} of ${count}` : count;
  });

  // Group results by page for the list
  let grouped = $derived.by(() => {
    const groups: { page: number; items: { index: number; m: (typeof appState.searchMatches)[number] }[] }[] = [];
    appState.searchMatches.forEach((m, index) => {
      const last = groups[groups.length - 1];
      if (last && last.page === m.page) last.items.push({ index, m });
      else groups.push({ page: m.page, items: [{ index, m }] });
    });
    return groups;
  });
</script>

{#if appState.searchOpen}
  <div class="search-panel" role="search">
    <div class="search-bar">
      <Icon name="search" size={15} />
      <input
        bind:this={inputEl}
        bind:value={appState.searchQuery}
        onkeydown={onKeydown}
        placeholder="Find in book"
        aria-label="Find in book"
        spellcheck="false"
      />
      {#if appState.searchScanning}<span class="mini-spinner"></span>{/if}
      <span class="status" aria-live="polite">{status}</span>
      <div class="divider"></div>
      <button class="icon-btn sm" onclick={() => appState.gotoMatch(appState.searchIndex - 1)} disabled={!appState.searchMatches.length} title="Previous (Shift+Enter)" aria-label="Previous match">
        <Icon name="chevron-up" size={16} />
      </button>
      <button class="icon-btn sm" onclick={() => appState.gotoMatch(appState.searchIndex + 1)} disabled={!appState.searchMatches.length} title="Next (Enter)" aria-label="Next match">
        <Icon name="chevron-down" size={16} />
      </button>
      <button class="icon-btn sm" class:active={showResults} onclick={() => (showResults = !showResults)} disabled={!appState.searchMatches.length} title="All results" aria-label="Show all results">
        <Icon name="list" size={15} />
      </button>
      <button class="icon-btn sm" onclick={() => appState.closeSearch()} title="Close (Esc)" aria-label="Close search">
        <Icon name="x" size={16} />
      </button>
    </div>

    {#if showResults && appState.searchMatches.length > 0}
      <div class="results">
        {#each grouped as g (g.page)}
          <div class="result-page">
            Page {g.page}
            {#if appState.chapterTitleFor(g.page)}<span class="chapter">· {appState.chapterTitleFor(g.page)}</span>{/if}
          </div>
          {#each g.items as { index, m } (index)}
            <button class="result" class:current={index === appState.searchIndex} onclick={() => appState.gotoMatch(index)}>
              <span class="ctx">…{m.before}</span><mark>{m.text}</mark><span class="ctx">{m.after}…</span>
            </button>
          {/each}
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .search-panel {
    position: absolute;
    top: 12px;
    right: 20px;
    z-index: 120;
    width: min(440px, calc(100% - 24px));
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    animation: dropIn 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes dropIn {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .search-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 4px 4px 12px;
    color: var(--text-muted);
  }

  .search-bar input {
    flex: 1;
    min-width: 60px;
    border: none;
    background: transparent;
    padding: 6px 4px;
    font-size: 14px;
  }

  .status {
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .divider {
    width: 1px;
    height: 20px;
    background: var(--border-subtle);
    margin: 0 2px;
  }

  .icon-btn.sm {
    width: 30px;
    height: 30px;
  }

  .mini-spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--text-muted);
    border-right-color: transparent;
    animation: spin 0.7s linear infinite;
  }

  .results {
    max-height: min(420px, 55vh);
    overflow-y: auto;
    border-top: 1px solid var(--border-subtle);
    padding: 4px 6px 8px;
  }

  .result-page {
    padding: 10px 8px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chapter {
    text-transform: none;
    font-weight: 500;
    letter-spacing: 0;
  }

  .result {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result:hover {
    background: var(--bg-hover);
  }

  .result.current {
    background: var(--accent-subtle);
  }

  mark {
    background: rgba(250, 204, 21, 0.45);
    color: var(--text-primary);
    border-radius: 2px;
    padding: 0 1px;
  }

  .ctx {
    color: var(--text-muted);
  }
</style>
