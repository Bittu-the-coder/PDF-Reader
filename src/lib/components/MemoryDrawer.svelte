<script lang="ts">
  import { appState, type MemoryTab } from "../stores/appState.svelte";
  import { api } from "../api";
  import { isUnderlineAnnotation, getColorDef } from "../pdf/highlights";
  import Icon from "./Icon.svelte";
  import { buildMarkdown } from "../exportNotes";

  async function handleExport() {
    const book = appState.activeBook;
    if (!book) return;
    const md = buildMarkdown(
      book,
      { highlights: appState.highlights, notes: appState.notes, words: appState.words },
      appState.targetLanguage,
      (p) => appState.chapterTitleFor(p)
    );
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const safeName = book.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "notes";
      const path = await save({
        defaultPath: `${safeName} - notes.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      await writeTextFile(path, md);
      appState.showToast("Notes exported");
    } catch (err) {
      console.warn("File export unavailable, copying instead:", err);
      try {
        await navigator.clipboard.writeText(md);
        appState.showToast("Copied notes as Markdown to the clipboard");
      } catch {
        appState.showToast("Could not export notes.", "error");
      }
    }
  }

  let searchQuery = $state("");
  let composerOpen = $state(false);

  // Composer state
  let newWordText = $state("");
  let newWordMeaning = $state("");
  let newWordTranslation = $state("");
  let newNoteContent = $state("");

  // Inline note editing
  let editingNoteId = $state<number | null>(null);
  let editingNoteText = $state("");

  const tabs: { id: MemoryTab; label: string; icon: string }[] = [
    { id: "words", label: "Words", icon: "bookmark" },
    { id: "notes", label: "Notes", icon: "pen" },
    { id: "highlights", label: "Highlights", icon: "highlighter" },
  ];

  function count(tab: MemoryTab) {
    return tab === "words" ? appState.words.length : tab === "notes" ? appState.notes.length : appState.highlights.length;
  }

  function jumpTo(page?: number | null, textToFlash?: string | null) {
    if (!page) return;
    appState.jumpToPage(page, textToFlash || undefined);
    if (appState.isCompact) appState.memoryDrawerOpen = false;
  }

  async function refresh() {
    if (appState.activeBook) await appState.refreshBookMemory(appState.activeBook.id);
  }

  async function handleDeleteWord(id: number) {
    try {
      await api.deleteWord(id);
      await refresh();
    } catch (err) {
      appState.showToast("Could not delete the word.", "error");
      console.error("Failed to delete word:", err);
    }
  }

  async function handleDeleteNote(id: number) {
    try {
      await api.deleteNote(id);
      await refresh();
    } catch (err) {
      appState.showToast("Could not delete the note.", "error");
      console.error("Failed to delete note:", err);
    }
  }

  async function handleSaveNoteEdit(id: number) {
    const text = editingNoteText.trim();
    if (!text) return;
    try {
      await api.updateNote(id, text);
      editingNoteId = null;
      await refresh();
    } catch (err) {
      appState.showToast("Could not save the note.", "error");
      console.error("Failed to update note:", err);
    }
  }

  async function handleCreate() {
    if (!appState.activeBook) return;
    try {
      if (appState.activeMemoryTab === "words") {
        if (!newWordText.trim() || !newWordMeaning.trim()) return;
        await api.addWord({
          bookId: appState.activeBook.id,
          word: newWordText.trim(),
          meaning: newWordMeaning.trim(),
          meaningHindi: newWordTranslation.trim() || null,
          page: appState.currentPage,
        });
        newWordText = newWordMeaning = newWordTranslation = "";
      } else {
        if (!newNoteContent.trim()) return;
        await api.addNote({
          bookId: appState.activeBook.id,
          content: newNoteContent.trim(),
          page: appState.currentPage,
        });
        newNoteContent = "";
      }
      composerOpen = false;
      await refresh();
    } catch (err) {
      appState.showToast("Could not save. Is that word already saved?", "error");
      console.error("Failed to add memory item:", err);
    }
  }

  function matches(...fields: (string | null | undefined)[]) {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return fields.some((f) => f && f.toLowerCase().includes(q));
  }

  /** Split a list into items on the current page(s) and the rest, newest first. */
  function split<T extends { page: number | null; id: number }>(items: T[]) {
    const visible = new Set([appState.currentPage]);
    if (appState.layoutMode === "dual") visible.add(appState.currentPage + 1);
    const sorted = [...items].sort((a, b) => b.id - a.id);
    return {
      here: sorted.filter((i) => i.page != null && visible.has(i.page)),
      elsewhere: sorted.filter((i) => i.page == null || !visible.has(i.page)),
    };
  }

  let words = $derived(split(appState.words.filter((w) => matches(w.word, w.meaning, w.meaning_hindi))));
  let notes = $derived(split(appState.notes.filter((n) => matches(n.content, n.quote))));
  let highlights = $derived(split(appState.highlights.filter((h) => matches(h.text))));

  let activeGroups = $derived(
    appState.activeMemoryTab === "words" ? words : appState.activeMemoryTab === "notes" ? notes : highlights
  );
  let isEmpty = $derived(activeGroups.here.length + activeGroups.elsewhere.length === 0);

  $effect(() => {
    // Reset transient UI when switching tabs
    appState.activeMemoryTab;
    composerOpen = false;
    editingNoteId = null;
  });
</script>

{#snippet wordCard(w: (typeof appState.words)[number])}
  <article class="memory-card">
    <div class="card-top">
      <button type="button" class="card-title-btn" onclick={() => jumpTo(w.page, w.word)} title="Find on page {w.page}">
        {w.word}
      </button>
      {#if w.page}
        <button type="button" class="page-tag" onclick={() => jumpTo(w.page, w.word)}>p. {w.page}</button>
      {/if}
      <button class="delete-btn" onclick={() => handleDeleteWord(w.id)} title="Delete word" aria-label="Delete {w.word}">
        <Icon name="trash" size={14} />
      </button>
    </div>
    <p class="card-meaning">{w.meaning}</p>
    {#if w.meaning_hindi}
      <p class="card-translation"><span class="lang-tag">{appState.targetLanguage}</span>{w.meaning_hindi}</p>
    {/if}
    {#if w.example_sentence}
      <p class="card-example">“{w.example_sentence}”</p>
    {/if}
  </article>
{/snippet}

{#snippet noteCard(n: (typeof appState.notes)[number])}
  <article class="memory-card">
    <div class="card-top">
      <span class="note-date">{new Date(n.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
      {#if n.page}
        <button type="button" class="page-tag" onclick={() => jumpTo(n.page, n.quote || n.content)}>p. {n.page}</button>
      {/if}
      <button
        class="delete-btn"
        onclick={() => {
          editingNoteId = n.id;
          editingNoteText = n.content;
        }}
        title="Edit note"
        aria-label="Edit note"
      >
        <Icon name="pen" size={14} />
      </button>
      <button class="delete-btn" onclick={() => handleDeleteNote(n.id)} title="Delete note" aria-label="Delete note">
        <Icon name="trash" size={14} />
      </button>
    </div>
    {#if n.quote}
      <button type="button" class="card-quote" onclick={() => jumpTo(n.page, n.quote)} title="Find this passage">
        {n.quote}
      </button>
    {/if}
    {#if editingNoteId === n.id}
      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        class="edit-area"
        bind:value={editingNoteText}
        rows="4"
        autofocus
        onkeydown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSaveNoteEdit(n.id);
          if (e.key === "Escape") {
            e.stopPropagation();
            editingNoteId = null;
          }
        }}
      ></textarea>
      <div class="edit-actions">
        <button class="btn-ghost sm" onclick={() => (editingNoteId = null)}>Cancel</button>
        <button class="btn-primary sm" onclick={() => handleSaveNoteEdit(n.id)} disabled={!editingNoteText.trim()}>Save</button>
      </div>
    {:else}
      <p class="card-note-content">{n.content}</p>
    {/if}
  </article>
{/snippet}

{#snippet highlightCard(h: (typeof appState.highlights)[number])}
  {@const colorDef = getColorDef(h.color)}
  {@const underline = isUnderlineAnnotation(h.color)}
  <article class="memory-card highlight-card" style="--hl: {colorDef.color};">
    <div class="card-top">
      <span class="type-pill">
        <Icon name={underline ? "underline" : "highlighter"} size={12} />
        {underline ? "Underline" : "Highlight"}
      </span>
      <button type="button" class="page-tag" onclick={() => jumpTo(h.page, h.text)}>p. {h.page}</button>
      <button class="delete-btn" onclick={() => appState.removeHighlight(h.id)} title="Delete annotation" aria-label="Delete annotation">
        <Icon name="trash" size={14} />
      </button>
    </div>
    <button type="button" class="highlight-text" class:underline onclick={() => jumpTo(h.page, h.text)} title="Find this passage">
      {h.text}
    </button>
  </article>
{/snippet}

{#snippet group(title: string, items: any[])}
  {#if items.length > 0}
    <section class="group">
      <h4 class="group-title">{title}<span>{items.length}</span></h4>
      <div class="items-list">
        {#each items as item (item.id)}
          {#if appState.activeMemoryTab === "words"}
            {@render wordCard(item)}
          {:else if appState.activeMemoryTab === "notes"}
            {@render noteCard(item)}
          {:else}
            {@render highlightCard(item)}
          {/if}
        {/each}
      </div>
    </section>
  {/if}
{/snippet}

<aside
  class="memory-drawer"
  class:visible={appState.memoryDrawerOpen}
  class:overlay={appState.isCompact}
  aria-label="Book memory"
  aria-hidden={!appState.memoryDrawerOpen}
  inert={!appState.memoryDrawerOpen}
>
  <div class="drawer-header">
    <div class="header-title">
      <Icon name="brain" size={18} />
      <span>Book memory</span>
    </div>
    <div class="header-actions">
      <button
        class="icon-btn"
        onclick={handleExport}
        disabled={appState.highlights.length + appState.notes.length + appState.words.length === 0}
        title="Export highlights, notes & words (Markdown)"
        aria-label="Export"
      >
        <Icon name="upload" size={16} />
      </button>
      <button class="icon-btn" onclick={() => (appState.memoryDrawerOpen = false)} title="Close (Esc)" aria-label="Close book memory">
        <Icon name="x" size={17} />
      </button>
    </div>
  </div>

  {#if appState.activeMemoryTab === "words" && appState.words.length > 0}
    <button class="review-banner" onclick={() => (appState.reviewOpen = true)}>
      <Icon name="sparkles" size={16} />
      <span class="review-text">
        <strong>Review words</strong>
        <span>{appState.dueCount > 0 ? `${appState.dueCount} due now` : "All caught up"}</span>
      </span>
      <Icon name="chevron-right" size={16} />
    </button>
  {/if}

  <div class="drawer-tabs" role="tablist">
    {#each tabs as t}
      <button
        class="tab-btn"
        class:active={appState.activeMemoryTab === t.id}
        role="tab"
        aria-selected={appState.activeMemoryTab === t.id}
        onclick={() => (appState.activeMemoryTab = t.id)}
      >
        <span>{t.label}</span>
        <span class="tab-count">{count(t.id)}</span>
      </button>
    {/each}
  </div>

  <div class="drawer-toolbar">
    <div class="search-field">
      <Icon name="search" size={14} />
      <input type="search" bind:value={searchQuery} placeholder="Search {appState.activeMemoryTab}…" aria-label="Search" />
    </div>
    {#if appState.activeMemoryTab !== "highlights"}
      <button class="add-btn" class:active={composerOpen} onclick={() => (composerOpen = !composerOpen)} title="Add manually">
        <Icon name={composerOpen ? "x" : "plus"} size={15} />
        <span>Add</span>
      </button>
    {/if}
  </div>

  {#if composerOpen}
    <form
      class="composer"
      onsubmit={(e) => {
        e.preventDefault();
        handleCreate();
      }}
    >
      {#if appState.activeMemoryTab === "words"}
        <input type="text" bind:value={newWordText} placeholder="Word" required />
        <textarea bind:value={newWordMeaning} placeholder="Meaning" rows="2" required></textarea>
        <input type="text" bind:value={newWordTranslation} placeholder="{appState.targetLanguage} translation (optional)" />
      {:else}
        <textarea bind:value={newNoteContent} placeholder="Note for page {appState.currentPage}…" rows="3" required></textarea>
      {/if}
      <div class="edit-actions">
        <button type="button" class="btn-ghost sm" onclick={() => (composerOpen = false)}>Cancel</button>
        <button type="submit" class="btn-primary sm">Save</button>
      </div>
    </form>
  {/if}

  <div class="drawer-content">
    {#if isEmpty}
      <div class="empty-state">
        <div class="empty-icon">
          <Icon name={tabs.find((t) => t.id === appState.activeMemoryTab)?.icon ?? "brain"} size={22} />
        </div>
        {#if searchQuery.trim()}
          <p>Nothing matches “{searchQuery.trim()}”.</p>
        {:else if appState.activeMemoryTab === "words"}
          <p><strong>No saved words yet.</strong></p>
          <p>Double-click any word in the book to see its meaning, then save it here.</p>
        {:else if appState.activeMemoryTab === "notes"}
          <p><strong>No notes yet.</strong></p>
          <p>Select a passage and choose <em>Note</em>, or add one manually.</p>
        {:else}
          <p><strong>No highlights yet.</strong></p>
          <p>Select text and pick a color to highlight or underline it.</p>
        {/if}
      </div>
    {:else}
      {@render group(appState.layoutMode === "dual" ? "On these pages" : "On this page", activeGroups.here)}
      {@render group("Elsewhere in the book", activeGroups.elsewhere)}
    {/if}
  </div>
</aside>

<style>
  .memory-drawer {
    width: 340px;
    background: var(--bg-surface);
    border-left: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
    flex-shrink: 0;
    z-index: 90;
  }

  .memory-drawer:not(.visible) {
    display: none;
  }

  .memory-drawer.overlay {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 96;
    width: min(380px, 92vw);
    box-shadow: var(--shadow-lg);
    animation: slideIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes slideIn {
    from {
      transform: translateX(24px);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }

  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 8px 6px 16px;
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 650;
    color: var(--text-primary);
  }

  .header-actions {
    display: flex;
    gap: 2px;
  }

  .review-banner {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    margin: 4px 12px 2px;
    padding: 10px 12px;
    text-align: left;
    color: var(--accent);
    background: var(--accent-subtle);
    border-radius: var(--radius-md);
  }

  .review-banner:hover {
    filter: brightness(1.1);
  }

  .review-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .review-text strong {
    font-size: 13px;
    color: var(--text-primary);
  }

  .review-text span {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .drawer-tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2px;
    margin: 6px 12px;
    padding: 3px;
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
  }

  .tab-btn {
    height: 30px;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
  }

  .tab-btn:hover {
    color: var(--text-primary);
  }

  .tab-btn.active {
    background: var(--bg-surface-elevated);
    color: var(--text-primary);
    box-shadow: var(--shadow-sm);
  }

  .tab-count {
    font-size: 11px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .tab-btn.active .tab-count {
    color: var(--accent);
  }

  .drawer-toolbar {
    display: flex;
    gap: 6px;
    padding: 6px 12px 10px;
  }

  .search-field {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    height: 32px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-muted);
  }

  .search-field:focus-within {
    border-color: var(--accent);
  }

  .search-field input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    padding: 0;
    height: 100%;
  }

  .add-btn {
    height: 32px;
    padding: 0 10px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-subtle);
  }

  .add-btn:hover,
  .add-btn.active {
    background: var(--accent);
    color: var(--accent-text);
  }

  .composer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0 12px 10px;
    padding: 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
  }

  .composer textarea,
  .edit-area {
    resize: vertical;
    min-height: 56px;
    line-height: 1.5;
  }

  .edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  .btn-ghost.sm,
  .btn-primary.sm {
    height: 28px;
    font-size: 12.5px;
  }

  .drawer-content {
    flex: 1;
    overflow-y: auto;
    padding: 2px 12px 24px;
    overscroll-behavior: contain;
  }

  .group + .group {
    margin-top: 18px;
  }

  .group-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 4px 2px 8px;
  }

  .group-title span {
    font-weight: 500;
    letter-spacing: 0;
  }

  .items-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .memory-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    transition: border-color var(--transition-fast);
  }

  .memory-card:hover {
    border-color: var(--border-strong);
  }

  .card-top {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
  }

  .card-title-btn {
    flex: 1;
    justify-content: flex-start;
    text-align: left;
    font-family: var(--font-reading);
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    padding: 0;
    min-width: 0;
    word-break: break-word;
  }

  .card-title-btn:hover {
    color: var(--accent);
  }

  .note-date {
    flex: 1;
    font-size: 11.5px;
    color: var(--text-muted);
  }

  .page-tag {
    height: 22px;
    padding: 0 8px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    background: var(--bg-active);
    border-radius: var(--radius-full);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .page-tag:hover {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .delete-btn {
    width: 26px;
    height: 26px;
    color: var(--text-muted);
    flex-shrink: 0;
    opacity: 0;
  }

  .memory-card:hover .delete-btn,
  .memory-card:focus-within .delete-btn {
    opacity: 1;
  }

  @media (hover: none) {
    .delete-btn {
      opacity: 1;
    }
  }

  .delete-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .card-meaning {
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-primary);
  }

  .card-translation {
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .lang-tag {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--accent);
    background: var(--accent-subtle);
    border-radius: var(--radius-xs);
    padding: 0 5px;
    margin-right: 6px;
    vertical-align: 1px;
  }

  .card-example {
    font-size: 12.5px;
    font-style: italic;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .card-quote {
    display: block;
    text-align: left;
    font-family: var(--font-reading);
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-secondary);
    border-left: 2px solid var(--border-strong);
    border-radius: 0;
    padding: 0 0 0 10px;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-quote:hover {
    color: var(--text-primary);
    border-left-color: var(--accent);
  }

  .card-note-content {
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    user-select: text;
  }

  .type-pill {
    flex: 1;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .type-pill :global(svg) {
    color: var(--hl);
  }

  .highlight-text {
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-align: left;
    font-family: var(--font-reading);
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--text-primary);
    padding: 2px 0 2px 10px;
    border-left: 3px solid var(--hl);
    border-radius: 0;
  }

  .highlight-text.underline {
    border-left-style: dashed;
  }

  .highlight-text:hover {
    color: var(--accent);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 48px 20px;
    text-align: center;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .empty-state strong {
    color: var(--text-secondary);
  }

  .empty-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 6px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
  }
</style>
