<script lang="ts">
  import { untrack } from "svelte";
  import { appState } from "../stores/appState.svelte";
  import { api, type WordLookupResult } from "../api";
  import { ANNOTATION_COLORS } from "../pdf/highlights";
  import { formatAiMarkdown } from "../aiFormat";
  import Icon from "./Icon.svelte";

  type PassageMode = "explain" | "translate" | "summarize";

  let isSaving = $state(false);
  let saveFeedback = $state<string | null>(null);
  let showNoteInput = $state(false);
  let noteContent = $state("");
  let lookupResult = $state<WordLookupResult | null>(null);
  let isLoadingLookup = $state(false);
  let lookupError = $state<string | null>(null);
  let activeQuery = "";
  let requestToken = 0;

  // Follow-up chat
  interface MiniChatMessage {
    role: "user" | "model";
    text: string;
  }
  let chatMessages = $state<MiniChatMessage[]>([]);
  let chatInput = $state("");
  let isChatting = $state(false);
  let showChat = $state(false);
  let chatThreadEl = $state<HTMLDivElement>();

  // Passage explanation & translation
  let passageResult = $state<{ mode: PassageMode; text: string } | null>(null);
  let isLoadingPassage = $state<PassageMode | null>(null);
  let passageError = $state<string | null>(null);

  // Annotation style chosen in the footer
  let underlineMode = $state(false);
  let copied = $state(false);

  // Dragging & measuring
  let dragX = $state<number | null>(null);
  let dragY = $state<number | null>(null);
  let cardHeight = $state(320);

  // Lookups are cached for the session so re-selecting a word is instant
  const lookupCache = new Map<string, WordLookupResult>();

  const providerName = $derived(appState.aiProvider === "openrouter" ? "OpenRouter" : "Gemini");
  const wordCount = $derived(appState.selectedText.trim().split(/\s+/).filter(Boolean).length);
  const isPhrase = $derived(wordCount > 3);
  const canAnnotate = $derived(appState.selectionNormalizedRects.length > 0);
  const sheet = $derived(appState.isCompact);

  let isWordSaved = $derived.by(() => {
    const text = appState.selectedText.trim().toLowerCase();
    return appState.words.some((w) => w.word.toLowerCase() === text);
  });

  // Float next to the selection, flipping above it when there is no room below
  let positionStyle = $derived.by(() => {
    if (sheet) return "";
    const vw = appState.windowWidth;
    const vh = appState.windowHeight;
    const width = Math.min(vw - 24, isPhrase ? 420 : 380);
    if (dragX !== null && dragY !== null) {
      return `top: ${Math.round(dragY)}px; left: ${Math.round(dragX)}px; width: ${width}px; max-height: ${vh - Math.round(dragY) - 12}px;`;
    }
    const r = appState.selectionRect;
    if (!r) return "display: none;";

    const left = Math.max(12, Math.min(vw - width - 12, r.left + r.width / 2 - width / 2));
    const spaceBelow = vh - (r.top + r.height) - 20;
    const spaceAbove = r.top - 20;
    const h = Math.min(cardHeight, vh - 24);
    let top: number;
    let maxHeight: number;
    if (spaceBelow >= h || spaceBelow >= spaceAbove) {
      top = r.top + r.height + 10;
      maxHeight = Math.max(200, vh - top - 12);
    } else {
      maxHeight = Math.max(200, spaceAbove);
      top = Math.max(12, r.top - 10 - Math.min(h, maxHeight));
    }
    return `top: ${Math.round(top)}px; left: ${Math.round(left)}px; width: ${width}px; max-height: ${Math.round(maxHeight)}px;`;
  });

  function startDrag(e: PointerEvent) {
    if (sheet || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const cardEl = (e.currentTarget as HTMLElement).closest(".lookup-card") as HTMLElement | null;
    if (!cardEl) return;
    const rect = cardEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: PointerEvent) => {
      dragX = Math.max(8, Math.min(appState.windowWidth - rect.width - 8, rect.left + ev.clientX - startX));
      dragY = Math.max(8, Math.min(appState.windowHeight - 120, rect.top + ev.clientY - startY));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function resetCard() {
    lookupResult = null;
    lookupError = null;
    isLoadingLookup = false;
    showNoteInput = false;
    noteContent = "";
    chatMessages = [];
    chatInput = "";
    showChat = false;
    saveFeedback = null;
    dragX = null;
    dragY = null;
    passageResult = null;
    passageError = null;
    isLoadingPassage = null;
    copied = false;
  }

  // Fetch the definition when the card opens for a new word
  $effect(() => {
    const text = appState.selectedText.trim();
    const visible = appState.lookupCardVisible;
    if (!visible || !text) {
      activeQuery = "";
      requestToken++;
      resetCard();
      return;
    }
    const phrase = isPhrase;
    if (text === activeQuery) {
      // A key was just added in Settings while the card was open: fetch now
      if (appState.hasApiKey && !phrase && !lookupResult && !isLoadingLookup && !lookupError) {
        untrack(() => fetchDefinition(text));
      }
      return;
    }
    activeQuery = text;
    requestToken++;
    untrack(() => {
      resetCard();
      if (!phrase) fetchDefinition(text);
    });
  });

  function cacheKey(word: string) {
    return `${appState.aiProvider}|${appState.targetLanguage}|${word.toLowerCase()}`;
  }

  async function ensureKey(): Promise<boolean> {
    if (appState.hasApiKey) return true;
    await appState.checkApiKey();
    return appState.hasApiKey;
  }

  async function fetchDefinition(word: string) {
    const token = requestToken;
    const cached = lookupCache.get(cacheKey(word));
    if (cached) {
      lookupResult = cached;
      return;
    }
    isLoadingLookup = true;
    lookupError = null;
    if (!(await ensureKey())) {
      if (token === requestToken) isLoadingLookup = false;
      return;
    }

    // Give the page-text sentence extraction a moment to provide fuller context
    await new Promise((r) => setTimeout(r, 60));
    if (token !== requestToken) return;

    try {
      const res = await api.lookupWord({
        word,
        contextSentence: appState.selectedSentence || null,
        targetLanguage: appState.targetLanguage,
        provider: appState.aiProvider,
      });
      lookupCache.set(cacheKey(word), res);
      if (token === requestToken) lookupResult = res;
    } catch (err: any) {
      console.warn("AI lookup failed:", err);
      if (token === requestToken) lookupError = describeError(err, "Could not get a definition.");
    } finally {
      if (token === requestToken) isLoadingLookup = false;
    }
  }

  function describeError(err: any, fallback: string): string {
    const msg = typeof err === "string" ? err : err?.message || fallback;
    if (/429|quota|rate/i.test(msg)) return "The AI provider is rate-limiting requests. Wait a few seconds and retry, or switch models in Settings.";
    if (/network|connect|dns|timed? ?out/i.test(msg)) return "Couldn't reach the AI provider. Check your internet connection and retry.";
    if (/401|403|invalid.*key|api key/i.test(msg)) return "The API key was rejected. Update it in Settings.";
    return msg;
  }

  async function handleExplainPassage(mode: PassageMode) {
    const text = appState.selectedText.trim();
    if (!text || isLoadingPassage) return;
    const token = requestToken;
    isLoadingPassage = mode;
    passageError = null;
    if (!(await ensureKey())) {
      isLoadingPassage = null;
      return;
    }
    try {
      const res = await api.explainPassage({
        passage: text,
        mode,
        targetLanguage: appState.targetLanguage,
        context: appState.selectedSentence || null,
        provider: appState.aiProvider,
      });
      if (token === requestToken) passageResult = { mode, text: res };
    } catch (err: any) {
      console.error("Passage explanation error:", err);
      if (token === requestToken) passageError = describeError(err, "Could not process the passage.");
    } finally {
      if (token === requestToken) isLoadingPassage = null;
    }
  }

  function passageLabel(mode: PassageMode) {
    return mode === "translate" ? `Translation · ${appState.targetLanguage}` : mode === "summarize" ? "Summary" : "Explanation";
  }

  async function addNote(content: string, feedback = "Saved to notes") {
    if (!appState.activeBook) return;
    try {
      await api.addNote({
        bookId: appState.activeBook.id,
        content,
        quote: appState.selectedText,
        page: appState.selectedPage || appState.currentPage,
      });
      await appState.refreshBookMemory(appState.activeBook.id);
      appState.showToast(feedback);
    } catch (err) {
      appState.showToast("Could not save the note.", "error");
      console.error("Failed to save note:", err);
    }
  }

  function playPronunciation() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(appState.selectedText);
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  async function handleSaveWord() {
    if (!appState.activeBook || isSaving) return;
    isSaving = true;
    const word = appState.selectedText.trim();
    const existing = appState.words.find((w) => w.word.toLowerCase() === word.toLowerCase());
    try {
      if (existing) {
        await api.updateWord(
          existing.id,
          lookupResult?.meaning || existing.meaning,
          lookupResult?.meaning_hindi || existing.meaning_hindi,
          lookupResult?.example || existing.example_sentence
        );
        saveFeedback = "Updated";
      } else {
        await api.addWord({
          bookId: appState.activeBook.id,
          word,
          meaning: lookupResult?.meaning || `“${word}”`,
          meaningHindi: lookupResult?.meaning_hindi || null,
          exampleSentence: lookupResult?.example || appState.selectedSentence || null,
          page: appState.selectedPage || appState.currentPage,
          aiGenerated: !!lookupResult,
        });
        saveFeedback = "Saved";
      }
      await appState.refreshBookMemory(appState.activeBook.id);
      setTimeout(() => (saveFeedback = null), 2000);
    } catch (err) {
      appState.showToast("Could not save the word.", "error");
      console.error("Failed to save word:", err);
    } finally {
      isSaving = false;
    }
  }

  async function handleSendChat(customQuery?: string) {
    const q = (customQuery || chatInput).trim();
    if (!q || isChatting) return;
    const token = requestToken;
    const priorHistory = chatMessages.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
    chatMessages = [...chatMessages, { role: "user", text: q }];
    chatInput = "";
    isChatting = true;
    scrollChat();

    try {
      const reply = await api.chatWordInquiry({
        word: appState.selectedText.trim(),
        context: appState.selectedSentence || null,
        query: q,
        history: priorHistory,
        targetLanguage: appState.targetLanguage,
        provider: appState.aiProvider,
      });
      if (token === requestToken) chatMessages = [...chatMessages, { role: "model", text: reply }];
    } catch (err: any) {
      console.error("Follow-up chat error:", err);
      if (token === requestToken) {
        chatMessages = [...chatMessages, { role: "model", text: `⚠ ${describeError(err, "Could not get an answer.")}` }];
      }
    } finally {
      isChatting = false;
      scrollChat();
    }
  }

  function scrollChat() {
    requestAnimationFrame(() => chatThreadEl?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  async function handleSaveNote() {
    if (!noteContent.trim() || isSaving) return;
    isSaving = true;
    await addNote(noteContent.trim(), "Note saved");
    isSaving = false;
    showNoteInput = false;
    noteContent = "";
    appState.lookupCardVisible = false;
  }

  async function handleAnnotate(colorId: string) {
    if (!canAnnotate) return;
    const color = underlineMode ? `underline-${colorId}` : colorId;
    const rects = appState.selectionNormalizedRects;
    const page = appState.selectedPage || appState.currentPage;
    const text = appState.selectedText;
    appState.lookupCardVisible = false;
    window.getSelection()?.removeAllRanges();
    await appState.addHighlight({ page, text, rects, color });
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(appState.selectedText);
      copied = true;
      setTimeout(() => (copied = false), 1400);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }

  function close() {
    appState.lookupCardVisible = false;
  }

  const wordChips = $derived([
    { label: `Use in ${appState.targetLanguage}`, q: `${appState.targetLanguage} translation & sentence examples` },
    { label: "Simpler", q: "Explain in simple terms with nuances" },
    { label: "Etymology", q: "Word origin & etymology" },
  ]);
  const passageChips = $derived([
    { label: "Key arguments", q: "Break down the key arguments simply" },
    { label: `Line by line (${appState.targetLanguage})`, q: `Translate into ${appState.targetLanguage} line by line` },
    { label: "Context & tone", q: "Explain historical or literary context" },
  ]);
</script>

{#snippet loading(label: string)}
  <div class="lookup-loading" aria-live="polite">
    <div class="shimmer-line" style="width: 92%"></div>
    <div class="shimmer-line" style="width: 76%"></div>
    <div class="shimmer-line" style="width: 54%"></div>
    <span class="loading-label">{label}</span>
  </div>
{/snippet}

{#snippet noKey(what: string)}
  <div class="banner info">
    <Icon name="key" size={16} />
    <div>
      <p>Add a free {providerName} API key to {what}.</p>
      <button class="link-btn" onclick={() => (appState.settingsModalOpen = true)}>Open settings →</button>
    </div>
  </div>
{/snippet}

{#snippet chat(chips: { label: string; q: string }[], placeholder: string)}
  <div class="chat-section">
    <button class="chat-toggle" class:expanded={showChat} onclick={() => (showChat = !showChat)} aria-expanded={showChat}>
      <Icon name="message" size={14} />
      <span>Ask a follow-up</span>
      <Icon name={showChat ? "chevron-up" : "chevron-down"} size={14} />
    </button>

    {#if showChat}
      <div class="mini-chat">
        {#if chatMessages.length === 0}
          <div class="quick-chips">
            {#each chips as c}
              <button class="chip" onclick={() => handleSendChat(c.q)}>{c.label}</button>
            {/each}
          </div>
        {:else}
          <div class="chat-thread" bind:this={chatThreadEl}>
            {#each chatMessages as msg}
              <div class="chat-bubble {msg.role}">
                {#if msg.role === "model"}
                  <div class="ai-text">{@html formatAiMarkdown(msg.text)}</div>
                  <button class="bubble-action" onclick={() => addNote(`[AI on “${appState.selectedText}”]:\n${msg.text}`)} title="Save answer to notes">
                    <Icon name="pen" size={12} /> Save as note
                  </button>
                {:else}
                  {msg.text}
                {/if}
              </div>
            {/each}
            {#if isChatting}
              <div class="chat-thinking"><span></span><span></span><span></span></div>
            {/if}
          </div>
        {/if}

        <form
          class="chat-input-bar"
          onsubmit={(e) => {
            e.preventDefault();
            handleSendChat();
          }}
        >
          <input type="text" bind:value={chatInput} {placeholder} aria-label="Follow-up question" />
          <button type="submit" class="send-btn" disabled={isChatting || !chatInput.trim()} aria-label="Send">
            <Icon name="send" size={14} />
          </button>
        </form>
      </div>
    {/if}
  </div>
{/snippet}

{#if appState.lookupCardVisible && appState.selectedText}
  {#if sheet}
    <button class="sheet-scrim" aria-label="Close" onclick={close}></button>
  {/if}
  <div
    class="lookup-card"
    class:sheet
    style={positionStyle}
    bind:offsetHeight={cardHeight}
    role="dialog"
    aria-label="Lookup: {appState.selectedText}"
    tabindex="-1"
    onpointerdown={(e) => e.stopPropagation()}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header class="card-header" onpointerdown={startDrag}>
      {#if sheet}<div class="sheet-handle"></div>{/if}
      <div class="word-info">
        {#if isPhrase}
          <span class="kind-label"><Icon name="sparkles" size={13} /> Passage · {wordCount} words</span>
        {:else}
          <span class="selected-word" title={appState.selectedText}>{appState.selectedText}</span>
          {#if lookupResult?.pronunciation}
            <span class="pronunciation">{lookupResult.pronunciation}</span>
          {/if}
          {#if lookupResult?.part_of_speech}
            <span class="pos-badge">{lookupResult.part_of_speech}</span>
          {/if}
          <button class="icon-btn xs" onclick={playPronunciation} title="Pronounce" aria-label="Pronounce">
            <Icon name="volume" size={15} />
          </button>
        {/if}
      </div>
      <button class="icon-btn xs" onclick={close} title="Close (Esc)" aria-label="Close">
        <Icon name="x" size={16} />
      </button>
    </header>

    {#if showNoteInput}
      <div class="quick-note">
        <blockquote class="quote">{appState.selectedText}</blockquote>
        <!-- svelte-ignore a11y_autofocus -->
        <textarea
          bind:value={noteContent}
          placeholder="Your thoughts on this passage…"
          rows="4"
          autofocus
          onkeydown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSaveNote();
          }}
        ></textarea>
        <div class="note-actions">
          <span class="hint">Ctrl + Enter to save</span>
          <button class="btn-ghost" onclick={() => (showNoteInput = false)}>Cancel</button>
          <button class="btn-primary" onclick={handleSaveNote} disabled={isSaving || !noteContent.trim()}>
            {isSaving ? "Saving…" : "Save note"}
          </button>
        </div>
      </div>
    {:else}
      <div class="card-body">
        {#if isPhrase}
          <blockquote class="quote clamp">{appState.selectedText}</blockquote>

          <div class="passage-actions">
            {#each [{ id: "explain", label: "Explain", icon: "lightbulb" }, { id: "translate", label: "Translate", icon: "languages" }, { id: "summarize", label: "Summarize", icon: "list" }] as a}
              <button
                class="passage-btn"
                class:active={passageResult?.mode === a.id}
                onclick={() => handleExplainPassage(a.id as PassageMode)}
                disabled={!!isLoadingPassage}
              >
                {#if isLoadingPassage === a.id}
                  <span class="mini-spinner"></span>
                {:else}
                  <Icon name={a.icon} size={15} />
                {/if}
                {a.label}
              </button>
            {/each}
          </div>

          {#if isLoadingPassage}
            {@render loading(`Thinking with ${providerName}…`)}
          {:else if !appState.hasApiKey && !passageResult}
            {@render noKey("explain, translate and summarize passages")}
          {:else if passageError}
            <div class="banner error">
              <Icon name="alert" size={16} />
              <div>
                <p>{passageError}</p>
                <button class="link-btn" onclick={() => handleExplainPassage(passageResult?.mode || "explain")}>Retry</button>
              </div>
            </div>
          {:else if passageResult}
            <section class="result">
              <div class="result-header">
                <span class="result-badge">{passageLabel(passageResult.mode)}</span>
                <button
                  class="link-btn"
                  onclick={() => passageResult && addNote(`[AI ${passageLabel(passageResult.mode)}]:\n${passageResult.text}`)}
                >
                  <Icon name="pen" size={12} /> Save as note
                </button>
              </div>
              <div class="ai-text">{@html formatAiMarkdown(passageResult.text)}</div>
            </section>
            {@render chat(passageChips, "Ask about this passage…")}
          {/if}
        {:else if isLoadingLookup}
          {@render loading(`Looking up with ${providerName}…`)}
        {:else if !appState.hasApiKey}
          {@render noKey(`see meanings and ${appState.targetLanguage} translations instantly`)}
        {:else if lookupError}
          <div class="banner error">
            <Icon name="alert" size={16} />
            <div>
              <p>{lookupError}</p>
              <button class="link-btn" onclick={() => {
                lookupError = null;
                lookupCache.delete(cacheKey(appState.selectedText));
                fetchDefinition(appState.selectedText);
              }}>Retry</button>
            </div>
          </div>
        {:else if lookupResult}
          <div class="definition">
            <p class="meaning">{lookupResult.meaning}</p>

            {#if lookupResult.meaning_hindi}
              <div class="translation">
                <span class="lang-tag">{appState.targetLanguage}</span>
                <p>{lookupResult.meaning_hindi}</p>
              </div>
            {/if}

            {#if lookupResult.meaning_in_context}
              <div class="in-context">
                <span class="section-label">Here it means</span>
                <p>{lookupResult.meaning_in_context}</p>
              </div>
            {/if}

            {#if lookupResult.example}
              <p class="example">“{lookupResult.example}”</p>
            {/if}

            {#if lookupResult.synonyms && lookupResult.synonyms.length > 0}
              <div class="synonyms">
                <span class="section-label">Similar</span>
                {#each lookupResult.synonyms.slice(0, 5) as syn}
                  <span class="syn-chip">{syn}</span>
                {/each}
              </div>
            {/if}
          </div>
          {@render chat(wordChips, "Ask anything about this word…")}
        {/if}
      </div>

      <footer class="card-actions">
        {#if canAnnotate}
          <div class="annotate-group" role="group" aria-label="Highlight selection">
            <button
              class="mode-toggle"
              onclick={() => (underlineMode = !underlineMode)}
              title={underlineMode ? "Underline mode (click for highlight)" : "Highlight mode (click for underline)"}
              aria-label={underlineMode ? "Switch to highlight" : "Switch to underline"}
            >
              <Icon name={underlineMode ? "underline" : "highlighter"} size={15} />
            </button>
            {#each ANNOTATION_COLORS as col}
              <button
                class="swatch"
                class:underline={underlineMode}
                style="--c: {col.color};"
                title="{underlineMode ? 'Underline' : 'Highlight'} {col.label}"
                aria-label="{underlineMode ? 'Underline' : 'Highlight'} in {col.label}"
                onclick={() => handleAnnotate(col.id)}
              ></button>
            {/each}
          </div>
        {/if}

        <div class="action-buttons">
          <button class="icon-btn sm" onclick={handleCopy} title="Copy" aria-label="Copy text">
            <Icon name={copied ? "check" : "copy"} size={15} />
          </button>
          <button class="icon-btn sm" onclick={() => (showNoteInput = true)} title="Add note" aria-label="Add note">
            <Icon name="pen" size={15} />
          </button>
          {#if !isPhrase}
            <button class="save-btn" class:saved={isWordSaved || !!saveFeedback} onclick={handleSaveWord} disabled={isSaving}>
              <Icon name={isWordSaved || saveFeedback ? "bookmark-check" : "bookmark"} size={15} />
              <span>{isSaving ? "Saving…" : saveFeedback || (isWordSaved ? "Saved" : "Save word")}</span>
            </button>
          {/if}
        </div>
      </footer>
    {/if}
  </div>
{/if}

<style>
  .lookup-card {
    position: fixed;
    width: 380px;
    max-height: calc(100vh - 24px);
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    z-index: 500;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: cardPop 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes cardPop {
    from {
      opacity: 0;
      transform: translateY(4px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  /* Bottom sheet in narrow windows */
  .lookup-card.sheet {
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    max-height: min(70vh, 560px);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    border-bottom: none;
    animation: sheetUp 0.24s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes sheetUp {
    from {
      transform: translateY(40px);
      opacity: 0.4;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }

  .sheet-scrim {
    position: fixed;
    inset: 0;
    z-index: 499;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 0;
    cursor: default;
  }

  .sheet-handle {
    position: absolute;
    top: 5px;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--border-strong);
  }

  .card-header {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 8px 8px 16px;
    cursor: grab;
    user-select: none;
    flex-shrink: 0;
  }

  .sheet .card-header {
    cursor: default;
    padding-top: 16px;
  }

  .card-header:active {
    cursor: grabbing;
  }

  .word-info {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 8px;
    min-width: 0;
  }

  .selected-word {
    font-family: var(--font-reading);
    font-size: 21px;
    font-weight: 600;
    line-height: 1.2;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 230px;
  }

  .pronunciation {
    font-size: 12.5px;
    color: var(--text-muted);
  }

  .pos-badge {
    font-size: 11.5px;
    font-style: italic;
    color: var(--accent);
  }

  .kind-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-secondary);
  }

  .icon-btn.xs {
    width: 28px;
    height: 28px;
    align-self: center;
  }

  .icon-btn.sm {
    width: 30px;
    height: 30px;
  }

  .card-body {
    padding: 2px 16px 14px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 13.5px;
    color: var(--text-primary);
    min-height: 0;
    flex: 1;
    user-select: text;
  }

  .card-body:empty {
    display: none;
  }

  .meaning {
    font-size: 14.5px;
    line-height: 1.55;
  }

  .definition {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .translation {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 8px 10px;
    background: var(--accent-subtle);
    border-radius: var(--radius-sm);
    line-height: 1.5;
  }

  .lang-tag {
    flex-shrink: 0;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--accent);
    text-transform: uppercase;
  }

  .section-label {
    display: block;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 3px;
  }

  .in-context p {
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .example {
    font-family: var(--font-reading);
    font-style: italic;
    line-height: 1.5;
    color: var(--text-secondary);
    padding-left: 10px;
    border-left: 2px solid var(--border-strong);
  }

  .synonyms {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .synonyms .section-label {
    width: 100%;
    margin: 0;
  }

  .syn-chip {
    font-size: 12px;
    padding: 2px 10px;
    border-radius: var(--radius-full);
    background: var(--bg-active);
    color: var(--text-secondary);
  }

  .quote {
    font-family: var(--font-reading);
    font-size: 14px;
    line-height: 1.55;
    color: var(--text-secondary);
    padding-left: 12px;
    border-left: 3px solid var(--accent);
  }

  .quote.clamp {
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .passage-actions {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .passage-btn {
    height: 34px;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-primary);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
  }

  .passage-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .passage-btn.active {
    background: var(--accent-subtle);
    border-color: var(--accent);
    color: var(--accent);
  }

  .mini-spinner {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: spin 0.7s linear infinite;
  }

  .result {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .result-badge {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .link-btn {
    gap: 4px;
    padding: 2px 0;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent);
  }

  .link-btn:hover {
    text-decoration: underline;
  }

  .ai-text {
    font-size: 13.5px;
    line-height: 1.6;
  }

  .ai-text :global(p.ai-p) {
    margin-bottom: 6px;
  }

  .ai-text :global(p.ai-p:last-child) {
    margin-bottom: 0;
  }

  .ai-text :global(ul.ai-list) {
    margin: 4px 0 6px 18px;
  }

  .ai-text :global(ul.ai-list li) {
    margin-bottom: 3px;
  }

  .ai-text :global(strong) {
    font-weight: 650;
  }

  .ai-text :global(code) {
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 12px;
    background: var(--bg-active);
    padding: 1px 5px;
    border-radius: 4px;
  }

  .ai-text :global(.ai-spacer) {
    height: 4px;
  }

  .ai-text :global(.ai-numbered-item) {
    display: flex;
    gap: 6px;
    margin-bottom: 3px;
  }

  .ai-text :global(.ai-numbered-item .num) {
    color: var(--accent);
    font-weight: 600;
  }

  /* Loading */
  .lookup-loading {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 0;
  }

  .shimmer-line {
    height: 11px;
    border-radius: 6px;
    background: linear-gradient(90deg, var(--bg-active) 0%, var(--bg-hover) 50%, var(--bg-active) 100%);
    background-size: 200% 100%;
    animation: shimmer 1.3s ease-in-out infinite;
  }

  @keyframes shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  .loading-label {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  /* Banners */
  .banner {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    font-size: 13px;
    line-height: 1.5;
  }

  .banner :global(svg) {
    margin-top: 2px;
  }

  .banner.info {
    background: var(--accent-subtle);
    color: var(--text-primary);
  }

  .banner.info :global(svg) {
    color: var(--accent);
  }

  .banner.error {
    background: var(--danger-subtle);
    color: var(--text-primary);
  }

  .banner.error :global(svg) {
    color: var(--danger);
  }

  /* Follow-up chat */
  .chat-section {
    border-top: 1px solid var(--border-subtle);
    padding-top: 10px;
  }

  .chat-toggle {
    width: 100%;
    justify-content: flex-start;
    gap: 8px;
    padding: 4px 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .chat-toggle span {
    flex: 1;
    text-align: left;
  }

  .chat-toggle:hover,
  .chat-toggle.expanded {
    color: var(--text-primary);
  }

  .mini-chat {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  }

  .quick-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    height: 28px;
    padding: 0 12px;
    font-size: 12px;
    color: var(--text-secondary);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
  }

  .chip:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .chat-thread {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .chat-bubble {
    max-width: 92%;
    padding: 8px 12px;
    border-radius: 14px;
    font-size: 13px;
    line-height: 1.55;
  }

  .chat-bubble.user {
    align-self: flex-end;
    background: var(--accent);
    color: var(--accent-text);
    border-bottom-right-radius: 4px;
  }

  .chat-bubble.model {
    align-self: flex-start;
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-bottom-left-radius: 4px;
  }

  .bubble-action {
    margin-top: 6px;
    gap: 4px;
    padding: 0;
    font-size: 11.5px;
    color: var(--text-muted);
  }

  .bubble-action:hover {
    color: var(--accent);
  }

  .chat-thinking {
    display: flex;
    gap: 4px;
    padding: 8px 12px;
  }

  .chat-thinking span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    animation: blink 1.2s infinite ease-in-out;
  }

  .chat-thinking span:nth-child(2) {
    animation-delay: 0.15s;
  }

  .chat-thinking span:nth-child(3) {
    animation-delay: 0.3s;
  }

  @keyframes blink {
    0%,
    80%,
    100% {
      opacity: 0.25;
    }
    40% {
      opacity: 1;
    }
  }

  .chat-input-bar {
    display: flex;
    gap: 6px;
  }

  .chat-input-bar input {
    flex: 1;
    min-width: 0;
    height: 34px;
    border-radius: var(--radius-full);
    padding: 0 14px;
  }

  .send-btn {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-text);
    flex-shrink: 0;
  }

  .send-btn:disabled {
    background: var(--bg-active);
    color: var(--text-muted);
  }

  /* Footer actions */
  .card-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 10px 8px 12px;
    border-top: 1px solid var(--border-subtle);
    background: var(--bg-surface);
    flex-shrink: 0;
  }

  .annotate-group {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .mode-toggle {
    width: 30px;
    height: 30px;
    color: var(--text-secondary);
    margin-right: 2px;
  }

  .mode-toggle:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .swatch {
    width: 26px;
    height: 30px;
    padding: 0;
    position: relative;
  }

  .swatch::before {
    content: "";
    position: absolute;
    left: 5px;
    right: 5px;
    top: 8px;
    bottom: 8px;
    border-radius: 50%;
    background: var(--c);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
    transition: transform var(--transition-fast);
  }

  .swatch.underline::before {
    top: auto;
    bottom: 9px;
    height: 3px;
    border-radius: 2px;
    box-shadow: none;
  }

  .swatch:hover::before {
    transform: scale(1.2);
  }

  .action-buttons {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
  }

  .save-btn {
    height: 30px;
    padding: 0 12px;
    margin-left: 4px;
    font-size: 12.5px;
    font-weight: 600;
    background: var(--accent);
    color: var(--accent-text);
  }

  .save-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .save-btn.saved {
    background: var(--success-subtle);
    color: var(--success);
  }

  /* Note composer */
  .quick-note {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 4px 16px 14px;
  }

  .quick-note .quote {
    font-size: 13px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .quick-note textarea {
    resize: vertical;
    min-height: 84px;
    line-height: 1.5;
  }

  .note-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .note-actions .hint {
    flex: 1;
    font-size: 11.5px;
    color: var(--text-muted);
  }
</style>
