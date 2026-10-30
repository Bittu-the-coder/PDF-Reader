<script lang="ts">
  import { appState } from "../stores/appState.svelte";
  import Icon from "./Icon.svelte";

  function handleCloseTab(e: MouseEvent, bookId: number) {
    e.stopPropagation();
    appState.closeTab(bookId);
  }

  function handleAuxClick(e: MouseEvent, bookId: number) {
    if (e.button === 1) {
      e.preventDefault();
      appState.closeTab(bookId);
    }
  }
</script>

{#if appState.openTabs.length > 0}
  <div class="tabs-container">
    <button class="shelf-btn" onclick={() => appState.goToShelf()} title="Back to library">
      <Icon name="library" size={16} />
      <span>Library</span>
    </button>

    <div class="tabs-list" role="tablist">
      {#each appState.openTabs as tab (tab.book.id)}
        {@const active = appState.activeBook?.id === tab.book.id}
        <div
          class="tab"
          class:active
          role="tab"
          aria-selected={active}
          tabindex="0"
          onclick={() => appState.openBook(tab.book.id)}
          onkeydown={(e) => (e.key === "Enter" || e.key === " ") && appState.openBook(tab.book.id)}
          onauxclick={(e) => handleAuxClick(e, tab.book.id)}
          title={tab.book.title}
        >
          <Icon name="file-text" size={14} />
          <span class="tab-title">{tab.book.title}</span>
          <button class="tab-close" onclick={(e) => handleCloseTab(e, tab.book.id)} title="Close tab (middle-click)" aria-label="Close {tab.book.title}">
            <Icon name="x" size={13} />
          </button>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .tabs-container {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    height: var(--tabs-height);
    min-height: var(--tabs-height);
    flex-shrink: 0;
    padding: 0 8px;
    background: var(--bg-primary);
    border-bottom: 1px solid var(--border-subtle);
  }

  .shelf-btn {
    height: 28px;
    margin-bottom: 4px;
    padding: 0 10px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .shelf-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tabs-list {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .tabs-list::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    flex: 0 1 220px;
    min-width: 110px;
    padding: 0 6px 0 12px;
    font-size: 12.5px;
    color: var(--text-secondary);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    cursor: pointer;
    position: relative;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tab.active {
    background: var(--bg-surface);
    color: var(--text-primary);
    font-weight: 500;
    box-shadow: 0 -1px 0 var(--border-subtle) inset, 1px 0 0 var(--border-subtle), -1px 0 0 var(--border-subtle);
  }

  .tab.active::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 1px;
    background: var(--bg-surface);
  }

  .tab-title {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-close {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    color: var(--text-muted);
    opacity: 0;
    border-radius: var(--radius-xs);
  }

  .tab.active .tab-close,
  .tab:hover .tab-close,
  .tab:focus-within .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  @media (hover: none) {
    .tab-close {
      opacity: 1;
    }
  }

  @media (max-width: 560px) {
    .shelf-btn span {
      display: none;
    }
    .tab {
      min-width: 90px;
    }
  }
</style>
