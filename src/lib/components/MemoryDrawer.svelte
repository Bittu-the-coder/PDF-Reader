<script lang="ts">
  import { appState } from "../stores/appState.svelte";
  import { api, type Word, type Note, type Highlight } from "../api";

  let searchQuery = $state("");
  let newWordModal = $state(false);
  let newNoteModal = $state(false);

  // New word form state
  let newWordText = $state("");
  let newWordMeaning = $state("");
  let newWordHindi = $state("");
  let newWordExample = $state("");

  // New note form state
  let newNoteContent = $state("");

  function jumpToPage(page?: number | null, textToFlash?: string | null) {
    if (page) {
      appState.jumpToPage(page, textToFlash || undefined);
    }
  }

  async function handleDeleteWord(id: number) {
    if (!appState.activeBook) return;
    try {
      await api.deleteWord(id);
      await appState.refreshBookMemory(appState.activeBook.id);
    } catch (err) {
      console.error("Failed to delete word:", err);
    }
  }

  async function handleDeleteNote(id: number) {
    if (!appState.activeBook) return;
    try {
      await api.deleteNote(id);
      await appState.refreshBookMemory(appState.activeBook.id);
    } catch (err) {
      console.error("Failed to delete note:", err);
    }
  }

  async function handleDeleteHighlight(id: number) {
    if (!appState.activeBook) return;
    try {
      await api.deleteHighlight(id);
      await appState.refreshBookMemory(appState.activeBook.id);
    } catch (err) {
      console.error("Failed to delete highlight:", err);
    }
  }

  async function handleCreateWord() {
    if (!appState.activeBook || !newWordText.trim() || !newWordMeaning.trim()) return;
    try {
      await api.addWord({
        bookId: appState.activeBook.id,
        word: newWordText.trim(),
        meaning: newWordMeaning.trim(),
        meaningHindi: newWordHindi.trim() || null,
        exampleSentence: newWordExample.trim() || null,
        page: appState.currentPage,
      });
      await appState.refreshBookMemory(appState.activeBook.id);
      newWordModal = false;
      newWordText = "";
      newWordMeaning = "";
      newWordHindi = "";
      newWordExample = "";
    } catch (err) {
      console.error("Failed to add word:", err);
    }
  }

  async function handleCreateNote() {
    if (!appState.activeBook || !newNoteContent.trim()) return;
    try {
      await api.addNote({
        bookId: appState.activeBook.id,
        content: newNoteContent.trim(),
        page: appState.currentPage,
      });
      await appState.refreshBookMemory(appState.activeBook.id);
      newNoteModal = false;
      newNoteContent = "";
    } catch (err) {
      console.error("Failed to add note:", err);
    }
  }

  // Filtered lists
  let filteredWords = $derived.by(() => {
    if (!searchQuery.trim()) return appState.words;
    const q = searchQuery.toLowerCase();
    return appState.words.filter(
      (w) =>
        w.word.toLowerCase().includes(q) ||
        w.meaning.toLowerCase().includes(q) ||
        (w.meaning_hindi && w.meaning_hindi.toLowerCase().includes(q))
    );
  });

  let filteredNotes = $derived.by(() => {
    if (!searchQuery.trim()) return appState.notes;
    const q = searchQuery.toLowerCase();
    return appState.notes.filter((n) => n.content.toLowerCase().includes(q));
  });

  // Priority sorting: Items for the current page appear at the very top!
  let sortedWords = $derived.by(() => {
    const list = [...filteredWords];
    const curr = appState.currentPage;
    return list.sort((a, b) => {
      const aIsCurrent = a.page === curr ? 1 : 0;
      const bIsCurrent = b.page === curr ? 1 : 0;
      if (aIsCurrent !== bIsCurrent) return bIsCurrent - aIsCurrent;
      return (b.id || 0) - (a.id || 0);
    });
  });

  let sortedNotes = $derived.by(() => {
    const list = [...filteredNotes];
    const curr = appState.currentPage;
    return list.sort((a, b) => {
      const aIsCurrent = a.page === curr ? 1 : 0;
      const bIsCurrent = b.page === curr ? 1 : 0;
      if (aIsCurrent !== bIsCurrent) return bIsCurrent - aIsCurrent;
      return (b.id || 0) - (a.id || 0);
    });
  });

  let sortedHighlights = $derived.by(() => {
    const list = [...appState.highlights];
    const curr = appState.currentPage;
    return list.sort((a, b) => {
      const aIsCurrent = a.page === curr ? 1 : 0;
      const bIsCurrent = b.page === curr ? 1 : 0;
      if (aIsCurrent !== bIsCurrent) return bIsCurrent - aIsCurrent;
      return (b.id || 0) - (a.id || 0);
    });
  });
</script>

<aside class="memory-drawer {appState.memoryDrawerOpen ? 'visible' : ''}">
  <div class="drawer-header">
    <div class="header-title">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
        <path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z"/>
      </svg>
      <span>Book Memory</span>
    </div>
    <div class="header-actions">
      <button class="icon-btn-sm" onclick={() => (appState.memoryDrawerOpen = false)} title="Close Memory">✕</button>
    </div>
  </div>

  <!-- Tabs: Vocabulary, Notes, Highlights -->
  <div class="drawer-tabs">
    <button
      class="tab-btn {appState.activeMemoryTab === 'words' ? 'active' : ''}"
      onclick={() => (appState.activeMemoryTab = "words")}
    >
      Vocabulary ({appState.words.length})
    </button>
    <button
      class="tab-btn {appState.activeMemoryTab === 'notes' ? 'active' : ''}"
      onclick={() => (appState.activeMemoryTab = "notes")}
    >
      Notes ({appState.notes.length})
    </button>
    <button
      class="tab-btn {appState.activeMemoryTab === 'highlights' ? 'active' : ''}"
      onclick={() => (appState.activeMemoryTab = "highlights")}
    >
      Highlights ({appState.highlights.length})
    </button>
  </div>

  <!-- Search bar & Add Button -->
  <div class="drawer-toolbar">
    <input
      type="text"
      bind:value={searchQuery}
      placeholder="Filter..."
      class="search-input"
    />
    {#if appState.activeMemoryTab === "words"}
      <button class="add-btn" onclick={() => (newWordModal = true)}>+ Word</button>
    {:else if appState.activeMemoryTab === "notes"}
      <button class="add-btn" onclick={() => (newNoteModal = true)}>+ Note</button>
    {/if}
  </div>

  <div class="drawer-content">
    {#if appState.activeMemoryTab === "words"}
      {#if sortedWords.length === 0}
        <div class="empty-state">No saved words found. Select text in the document to look up and save words!</div>
      {:else}
        <div class="items-list">
          {#each sortedWords as w (w.id)}
            <div class="memory-card {w.page === appState.currentPage ? 'current-page-card' : ''}">
              <div class="card-top">
                <button
                  type="button"
                  class="card-word-btn"
                  onclick={() => jumpToPage(w.page, w.word)}
                  title="Jump to page {w.page} and locate word"
                >
                  {w.word}
                </button>
                {#if w.page}
                  <button
                    type="button"
                    class="page-tag {w.page === appState.currentPage ? 'active-page-tag' : ''}"
                    onclick={() => jumpToPage(w.page, w.word)}
                    title={w.page === appState.currentPage ? "Current Page" : `Go to page ${w.page}`}
                  >
                    {w.page === appState.currentPage ? `📍 Page ${w.page}` : `p. ${w.page}`}
                  </button>
                {/if}
                <button class="delete-btn" onclick={() => handleDeleteWord(w.id)} title="Delete word">×</button>
              </div>
              <div class="card-meaning">{w.meaning}</div>
              {#if w.meaning_hindi}
                <div class="card-hindi">
                  <span class="lang-tag-hi">{appState.targetLanguage}</span>
                  <span>{w.meaning_hindi}</span>
                </div>
              {/if}
              {#if w.example_sentence}
                <div class="card-example">"{w.example_sentence}"</div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {:else if appState.activeMemoryTab === "notes"}
      {#if sortedNotes.length === 0}
        <div class="empty-state">No notes added yet. Add a note from selection or the + Note button!</div>
      {:else}
        <div class="items-list">
          {#each sortedNotes as n (n.id)}
            <div class="memory-card {n.page === appState.currentPage ? 'current-page-card' : ''}">
              <div class="card-top">
                <span class="note-date">{new Date(n.created_at).toLocaleDateString()}</span>
                {#if n.page}
                  <button
                    type="button"
                    class="page-tag {n.page === appState.currentPage ? 'active-page-tag' : ''}"
                    onclick={() => jumpToPage(n.page, n.quote || n.content)}
                    title={n.page === appState.currentPage ? "Current Page" : `Go to page ${n.page} and locate note`}
                  >
                    {n.page === appState.currentPage ? `📍 Page ${n.page}` : `p. ${n.page}`}
                  </button>
                {/if}
                <button class="delete-btn" onclick={() => handleDeleteNote(n.id)} title="Delete note">×</button>
              </div>
              {#if n.quote}
                <div
                  class="card-quote clickable"
                  onclick={() => jumpToPage(n.page, n.quote)}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => e.key === "Enter" && jumpToPage(n.page, n.quote)}
                  title="Locate quote on page"
                >
                  "{n.quote}"
                </div>
              {/if}
              <div
                class="card-note-content"
                onclick={() => jumpToPage(n.page, n.quote || n.content)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === "Enter" && jumpToPage(n.page, n.quote || n.content)}
                title="Locate on page"
              >
                {n.content}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {:else if appState.activeMemoryTab === "highlights"}
      {#if sortedHighlights.length === 0}
        <div class="empty-state">No highlights yet. Select text in the reader to highlight!</div>
      {:else}
        <div class="items-list">
          {#each sortedHighlights as h (h.id)}
            <div class="memory-card highlight-card {h.page === appState.currentPage ? 'current-page-card' : ''}">
              <div class="card-top">
                <div class="tag-group">
                  <button
                    type="button"
                    class="page-tag {h.page === appState.currentPage ? 'active-page-tag' : ''}"
                    onclick={() => jumpToPage(h.page, h.text)}
                    title={h.page === appState.currentPage ? "Current Page" : `Go to page ${h.page}`}
                  >
                    {h.page === appState.currentPage ? `📍 Page ${h.page}` : `Page ${h.page}`}
                  </button>
                  <span class="type-pill {h.color === 'underline' ? 'underline' : 'highlight'}">
                    {h.color === 'underline' ? 'Underline' : 'Highlight'}
                  </span>
                </div>
                <button class="delete-btn" onclick={() => handleDeleteHighlight(h.id)} title="Delete annotation">×</button>
              </div>
              <div class="highlight-text {h.color === 'underline' ? 'underline-text' : ''}">"{h.text}"</div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</aside>

<!-- Add Word Modal -->
{#if newWordModal}
  <div
    class="modal-backdrop"
    onclick={() => (newWordModal = false)}
    onkeydown={(e) => e.key === "Escape" && (newWordModal = false)}
    role="dialog"
    tabindex="-1"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal" onclick={(e) => e.stopPropagation()} role="presentation">
      <h3>Add New Word</h3>
      <input type="text" bind:value={newWordText} placeholder="Word (e.g. Ephemeral)" />
      <textarea bind:value={newWordMeaning} placeholder="Meaning / Definition (English)" rows="2"></textarea>
      <input type="text" bind:value={newWordHindi} placeholder="{appState.targetLanguage} Meaning / अनुवाद (optional)" />
      <textarea bind:value={newWordExample} placeholder="Example Sentence (optional)" rows="2"></textarea>
      <div class="modal-actions">
        <button class="btn-ghost" onclick={() => (newWordModal = false)}>Cancel</button>
        <button class="btn-primary" onclick={handleCreateWord}>Save Word</button>
      </div>
    </div>
  </div>
{/if}

<!-- Add Note Modal -->
{#if newNoteModal}
  <div
    class="modal-backdrop"
    onclick={() => (newNoteModal = false)}
    onkeydown={(e) => e.key === "Escape" && (newNoteModal = false)}
    role="dialog"
    tabindex="-1"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal" onclick={(e) => e.stopPropagation()} role="presentation">
      <h3>Add New Note</h3>
      <textarea bind:value={newNoteContent} placeholder="Write note..." rows="4"></textarea>
      <div class="modal-actions">
        <button class="btn-ghost" onclick={() => (newNoteModal = false)}>Cancel</button>
        <button class="btn-primary" onclick={handleCreateNote}>Save Note</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .memory-drawer {
    width: 310px;
    background: var(--bg-surface-elevated);
    border-left: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
    flex-shrink: 0;
    box-shadow: var(--shadow-sm);
  }

  .memory-drawer:not(.visible) {
    display: none;
  }

  .current-page-card {
    border-color: var(--accent) !important;
    background: var(--bg-surface-elevated);
    box-shadow: 0 0 0 1px var(--accent-subtle, rgba(234, 179, 8, 0.25));
  }

  .active-page-tag {
    background: var(--accent-subtle, rgba(234, 179, 8, 0.15)) !important;
    border: 1px solid var(--accent) !important;
    color: var(--accent) !important;
    font-weight: 600;
  }

  .card-hindi {
    font-size: 12px;
    color: var(--text-primary);
    background: var(--bg-surface);
    padding: 4px 8px;
    border-radius: var(--radius-xs, 4px);
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--border-subtle);
  }

  .lang-tag-hi {
    font-size: 10px;
    font-weight: 700;
    color: #eab308;
    background: rgba(234, 179, 8, 0.15);
    padding: 1px 4px;
    border-radius: 3px;
  }

  @keyframes slideInRight {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }

  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
  }

  .drawer-tabs {
    display: flex;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-surface);
  }

  .tab-btn {
    flex: 1;
    padding: 8px 4px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    border-bottom: 2px solid transparent;
    border-radius: 0;
  }

  .tab-btn.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
    background: var(--bg-surface-elevated);
  }

  .drawer-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .search-input {
    flex: 1;
    height: 28px;
    font-size: 12px;
  }

  .add-btn {
    padding: 0 10px;
    height: 28px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 500;
    flex-shrink: 0;
  }

  .add-btn:hover {
    background: var(--accent-hover);
  }

  .drawer-content {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }

  .items-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .memory-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: border-color var(--transition-fast);
  }

  .memory-card:hover {
    border-color: var(--border-strong);
  }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .card-word-btn {
    background: transparent;
    border: none;
    padding: 0;
    font-family: inherit;
    font-weight: 600;
    font-size: 13px;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }

  .card-word-btn:hover {
    color: var(--accent);
  }

  .page-tag {
    background: var(--bg-hover);
    border: none;
    font-family: inherit;
    font-size: 10px;
    color: var(--text-muted);
    padding: 2px 7px;
    border-radius: var(--radius-full);
    cursor: pointer;
    margin-left: auto;
    margin-right: 6px;
    transition: all 0.15s ease;
  }

  .page-tag:hover {
    color: var(--accent);
    background: var(--hover-bg, rgba(255, 255, 255, 0.12));
  }

  .delete-btn {
    width: 18px;
    height: 18px;
    font-size: 14px;
    color: var(--text-muted);
    line-height: 1;
  }

  .delete-btn:hover {
    color: var(--danger);
  }

  .card-meaning {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .card-example, .card-quote {
    font-size: 11px;
    font-style: italic;
    color: var(--text-muted);
    border-left: 2px solid var(--accent);
    padding-left: 6px;
  }

  .card-quote.clickable {
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .card-quote.clickable:hover {
    color: var(--accent);
  }

  .card-note-content {
    font-size: 12px;
    color: var(--text-primary);
    white-space: pre-wrap;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .card-note-content:hover {
    color: var(--accent);
  }

  .tag-group {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    margin-right: 6px;
  }

  .type-pill {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 1px 6px;
    border-radius: var(--radius-full);
  }

  .type-pill.highlight {
    background: rgba(250, 204, 21, 0.2);
    color: #eab308;
    border: 1px solid rgba(234, 179, 8, 0.35);
  }

  .type-pill.underline {
    background: rgba(99, 102, 241, 0.15);
    color: var(--accent);
    border: 1px solid rgba(99, 102, 241, 0.3);
  }

  .highlight-text {
    font-size: 12px;
    color: var(--text-primary);
    font-style: italic;
  }

  .highlight-text.underline-text {
    text-decoration: underline 1.5px #eab308;
    text-underline-offset: 3px;
  }

  .note-date {
    font-size: 10px;
    color: var(--text-muted);
  }

  .empty-state {
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
    padding: 32px 16px;
    line-height: 1.6;
  }

  /* Modals */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .modal {
    width: 360px;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: var(--shadow-lg);
  }

  .modal h3 {
    font-size: 15px;
    font-weight: 600;
  }

  .modal-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  .btn-ghost {
    padding: 6px 12px;
    color: var(--text-secondary);
  }

  .btn-primary {
    padding: 6px 14px;
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 500;
  }
</style>
