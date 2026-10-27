<script lang="ts">
  import { appState } from "../stores/appState.svelte";

  function handleTabClick(bookId: number) {
    appState.openBook(bookId);
  }

  function handleCloseTab(e: MouseEvent, bookId: number) {
    e.stopPropagation();
    appState.closeTab(bookId);
  }

  function handleAuxClick(e: MouseEvent, bookId: number) {
    if (e.button === 1) { // Middle click
      e.preventDefault();
      appState.closeTab(bookId);
    }
  }
</script>

{#if appState.openTabs.length > 0}
  <div class="tabs-container">
    <button
      class="shelf-btn"
      onclick={() => appState.goToShelf()}
      title="Back to Shelf"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
        <path d="M6 6h10"/>
        <path d="M6 10h10"/>
      </svg>
      <span>Shelf</span>
    </button>

    <div class="tabs-list">
      {#each appState.openTabs as tab (tab.book.id)}
        <div
          class="tab {appState.activeBook?.id === tab.book.id ? 'active' : ''}"
          role="button"
          tabindex="0"
          onclick={() => handleTabClick(tab.book.id)}
          onkeydown={(e) => e.key === 'Enter' && handleTabClick(tab.book.id)}
          onauxclick={(e) => handleAuxClick(e, tab.book.id)}
          title="{tab.book.title} (Page {tab.currentPage})"
        >
          <span class="tab-title">{tab.book.title}</span>
          <button
            class="tab-close"
            onclick={(e) => handleCloseTab(e, tab.book.id)}
            title="Close tab (Middle click)"
          >
            ×
          </button>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .tabs-container {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    min-height: 34px;
    flex-shrink: 0;
    padding: 0 12px;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border-subtle);
    user-select: none;
    overflow-x: auto;
    position: relative;
    z-index: 85;
  }

  .shelf-btn {
    padding: 4px 10px;
    height: 26px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-hover);
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }

  .shelf-btn:hover {
    color: var(--text-primary);
    background: var(--bg-active);
  }

  .tabs-list {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    overflow-x: auto;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    max-width: 220px;
    padding: 0 8px 0 12px;
    background: transparent;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    font-size: 12px;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
    flex-shrink: 0;
  }

  .tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tab.active {
    background: var(--bg-active);
    color: var(--text-primary);
    font-weight: 500;
  }

  .tab-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-close {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    font-size: 14px;
    line-height: 1;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity var(--transition-fast), background var(--transition-fast);
  }

  .tab:hover .tab-close,
  .tab.active .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
