<script lang="ts">
  import { appState } from "../stores/appState.svelte";
  import { api } from "../api";

  let isSaving = $state(false);
  let showNoteInput = $state(false);
  let noteContent = $state("");

  // Position calculation so it floats near selection without going offscreen
  let positionStyle = $derived.by(() => {
    if (!appState.selectionRect) return "display: none;";
    const r = appState.selectionRect;
    const cardWidth = 320;
    const cardHeight = 220;

    let left = r.left + r.width / 2 - cardWidth / 2;
    if (left < 16) left = 16;
    if (left + cardWidth > window.innerWidth - 16) {
      left = window.innerWidth - cardWidth - 16;
    }

    // Place below selection by default, or above if close to bottom
    let top = r.top + r.height + 8;
    if (top + cardHeight > window.innerHeight - 16) {
      top = Math.max(16, r.top - cardHeight - 8);
    }

    return `top: ${Math.round(top)}px; left: ${Math.round(left)}px;`;
  });

  let isWordSaved = $derived.by(() => {
    const text = appState.selectedText.trim().toLowerCase();
    return appState.words.some((w) => w.word.toLowerCase() === text);
  });

  let isPhrase = $derived.by(() => {
    return appState.selectedText.trim().split(/\s+/).length > 3;
  });

  function playPronunciation() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(appState.selectedText);
      window.speechSynthesis.speak(utterance);
    }
  }

  async function handleSaveWord() {
    if (!appState.activeBook || isSaving) return;
    isSaving = true;
    try {
      await api.addWord({
        bookId: appState.activeBook.id,
        word: appState.selectedText,
        meaning: `Definition for "${appState.selectedText}"`,
        exampleSentence: appState.selectedSentence || null,
        page: appState.currentPage,
      });
      await appState.refreshBookMemory(appState.activeBook.id);
    } catch (err) {
      console.error("Failed to save word:", err);
    } finally {
      isSaving = false;
    }
  }

  async function handleSaveNote() {
    if (!appState.activeBook || !noteContent.trim() || isSaving) return;
    isSaving = true;
    try {
      await api.addNote({
        bookId: appState.activeBook.id,
        content: noteContent.trim(),
        quote: appState.selectedText,
        page: appState.currentPage,
      });
      await appState.refreshBookMemory(appState.activeBook.id);
      showNoteInput = false;
      noteContent = "";
      appState.lookupCardVisible = false;
    } catch (err) {
      console.error("Failed to save note:", err);
    } finally {
      isSaving = false;
    }
  }

  async function handleAddHighlight() {
    if (!appState.activeBook) return;
    try {
      await api.addHighlight({
        bookId: appState.activeBook.id,
        page: appState.currentPage,
        text: appState.selectedText,
        rectsJson: JSON.stringify(appState.selectionRect),
        color: "yellow",
      });
      await appState.refreshBookMemory(appState.activeBook.id);
      appState.lookupCardVisible = false;
    } catch (err) {
      console.error("Failed to add highlight:", err);
    }
  }

  function handleOpenMemory(tab: "words" | "notes") {
    appState.activeMemoryTab = tab;
    appState.memoryDrawerOpen = true;
    appState.lookupCardVisible = false;
  }
</script>

{#if appState.lookupCardVisible && appState.selectedText}
  <div class="lookup-card" style={positionStyle}>
    <div class="card-header">
      <div class="word-info">
        <span class="selected-text">{appState.selectedText}</span>
        {#if !isPhrase}
          <button class="speaker-btn" onclick={playPronunciation} title="Pronounce">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
          </button>
        {/if}
      </div>
      <button class="close-btn" onclick={() => (appState.lookupCardVisible = false)}>×</button>
    </div>

    {#if !showNoteInput}
      <div class="card-body">
        {#if isWordSaved}
          <div class="saved-indicator">
            <span>✓ Saved in chapter vocabulary</span>
            <button class="link-btn" onclick={() => handleOpenMemory('words')}>View in Memory →</button>
          </div>
        {:else if isPhrase}
          <div class="phrase-preview">
            <span class="label">Passage:</span>
            <p class="quote">"{appState.selectedText}"</p>
          </div>
        {:else}
          <div class="context-preview">
            <span class="label">Context sentence:</span>
            <p class="sentence">"{appState.selectedSentence}"</p>
          </div>
        {/if}
      </div>

      <div class="card-actions">
        {#if !isWordSaved && !isPhrase}
          <button class="btn btn-primary" onclick={handleSaveWord} disabled={isSaving}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
            </svg>
            <span>Save Word</span>
          </button>
        {/if}

        <button class="btn btn-secondary" onclick={() => (showNoteInput = true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
          </svg>
          <span>Note</span>
        </button>

        <button class="btn btn-secondary" onclick={handleAddHighlight}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 11-6 6v3h3l6-6"/>
            <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>
          </svg>
          <span>Highlight</span>
        </button>
      </div>
    {:else}
      <div class="note-box">
        <textarea
          bind:value={noteContent}
          placeholder="Write your note here..."
          rows="3"
          autofocus
        ></textarea>
        <div class="note-actions">
          <button class="btn btn-ghost" onclick={() => (showNoteInput = false)}>Cancel</button>
          <button class="btn btn-primary" onclick={handleSaveNote} disabled={isSaving || !noteContent.trim()}>
            Save Note
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .lookup-card {
    position: fixed;
    width: 320px;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    z-index: 200;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: fadeIn 150ms ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border-subtle);
    padding-bottom: 8px;
  }

  .word-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .selected-text {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .speaker-btn {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: var(--text-muted);
  }

  .speaker-btn:hover {
    background: var(--bg-hover);
    color: var(--accent);
  }

  .close-btn {
    width: 20px;
    height: 20px;
    font-size: 16px;
    color: var(--text-muted);
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .card-body {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .saved-indicator {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--success);
    font-weight: 500;
  }

  .link-btn {
    font-size: 11px;
    color: var(--accent);
    padding: 0;
    justify-content: flex-start;
  }

  .link-btn:hover {
    text-decoration: underline;
  }

  .label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    font-weight: 600;
    display: block;
    margin-bottom: 2px;
  }

  .sentence, .quote {
    font-style: italic;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .btn {
    padding: 5px 10px;
    font-size: 12px;
    font-weight: 500;
    border-radius: var(--radius-sm);
  }

  .btn-primary {
    background: var(--accent);
    color: var(--accent-text);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-secondary {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background: var(--bg-active);
  }

  .btn-ghost {
    color: var(--text-secondary);
  }

  .btn-ghost:hover {
    color: var(--text-primary);
  }

  .note-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .note-box textarea {
    width: 100%;
    resize: none;
    font-size: 12px;
  }

  .note-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }
</style>
