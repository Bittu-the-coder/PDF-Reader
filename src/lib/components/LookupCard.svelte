<script lang="ts">
  import { appState } from "../stores/appState.svelte";
  import { api, type WordLookupResult } from "../api";

  let isSaving = $state(false);
  let saveFeedback = $state<string | null>(null);
  let showNoteInput = $state(false);
  let noteContent = $state("");
  let lookupResult = $state<WordLookupResult | null>(null);
  let isLoadingLookup = $state(false);
  let lookupError = $state<string | null>(null);
  let activeQuery = $state<string>("");

  // In-place Mini AI Chat
  interface MiniChatMessage {
    role: "user" | "model";
    text: string;
  }
  let chatMessages = $state<MiniChatMessage[]>([]);
  let chatInput = $state("");
  let isChatting = $state(false);
  let showChat = $state(false);

  // Passage explanation & translation state
  let passageResult = $state<{ mode: "explain" | "translate" | "summarize"; text: string } | null>(null);
  let isLoadingPassage = $state(false);
  let passageError = $state<string | null>(null);

  // Dragging state
  let dragX = $state<number | null>(null);
  let dragY = $state<number | null>(null);
  let isDragging = $state(false);

  let isPhrase = $derived.by(() => {
    return appState.selectedText.trim().split(/\s+/).length > 3;
  });

  // Position calculation so it floats near selection without going offscreen
  let positionStyle = $derived.by(() => {
    if (dragX !== null && dragY !== null) {
      return `top: ${Math.round(dragY)}px; left: ${Math.round(dragX)}px;`;
    }
    if (!appState.selectionRect) return "display: none;";
    const r = appState.selectionRect;
    const cardWidth = isPhrase ? 400 : 350;
    const cardHeight = isPhrase ? 430 : (showChat ? 420 : 320);

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

  function startDrag(e: MouseEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    isDragging = true;
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;

    const cardEl = (e.currentTarget as HTMLElement).closest(".lookup-card") as HTMLElement | null;
    const rect = cardEl ? cardEl.getBoundingClientRect() : { left: 100, top: 100 };
    const initialLeft = rect.left;
    const initialTop = rect.top;

    const handleMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startMouseX;
      const dy = ev.clientY - startMouseY;
      const cardWidth = isPhrase ? 400 : 350;
      dragX = Math.max(8, Math.min(window.innerWidth - cardWidth - 10, initialLeft + dx));
      dragY = Math.max(8, Math.min(window.innerHeight - 100, initialTop + dy));
    };

    const handleMouseUp = () => {
      isDragging = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  let isWordSaved = $derived.by(() => {
    const text = appState.selectedText.trim().toLowerCase();
    return appState.words.some((w) => w.word.toLowerCase() === text);
  });

  function formatAiMarkdown(text: string): string {
    if (!text) return "";
    let escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Bold: **text** or __text__
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    escaped = escaped.replace(/__(.*?)__/g, "<strong>$1</strong>");

    // Inline code: `code`
    escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Italics: *text* (excluding already matched strong)
    escaped = escaped.replace(/(^|[^\*])\*([^\*]+)\*([^\*]|$)/g, "$1<em>$2</em>$3");

    // Convert bullet asterisks and newlines
    const rawLines = escaped.split("\n");
    const processedLines: string[] = [];
    let inList = false;

    for (let rawLine of rawLines) {
      let line = rawLine.trim();
      if (!line) {
        if (inList) {
          processedLines.push("</ul>");
          inList = false;
        }
        processedLines.push("<div class='ai-spacer'></div>");
        continue;
      }

      // Check if line contains inline bullet delimiters like " * " or "•"
      if (line.includes(" * ")) {
        const parts = line.split(/\s\*\s/);
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i].trim();
          if (!part) continue;
          if (i === 0 && !line.startsWith("* ")) {
            if (inList) {
              processedLines.push("</ul>");
              inList = false;
            }
            processedLines.push(`<p class="ai-p">${part}</p>`);
          } else {
            if (!inList) {
              processedLines.push("<ul class='ai-list'>");
              inList = true;
            }
            processedLines.push(`<li>${part}</li>`);
          }
        }
        continue;
      }

      if (line.startsWith("* ") || line.startsWith("- ") || line.startsWith("• ")) {
        if (!inList) {
          processedLines.push("<ul class='ai-list'>");
          inList = true;
        }
        const content = line.replace(/^[\*\-•]\s+/, "");
        processedLines.push(`<li>${content}</li>`);
        continue;
      }

      // Numbered list items
      const numMatch = line.match(/^(\d+)\.\s+(.*)/);
      if (numMatch) {
        if (inList) {
          processedLines.push("</ul>");
          inList = false;
        }
        processedLines.push(`<div class="ai-numbered-item"><span class="num">${numMatch[1]}.</span> <span>${numMatch[2]}</span></div>`);
        continue;
      }

      if (inList) {
        processedLines.push("</ul>");
        inList = false;
      }
      processedLines.push(`<p class="ai-p">${line}</p>`);
    }

    if (inList) processedLines.push("</ul>");
    return processedLines.join("");
  }

  // Automatically fetch AI definition when card becomes visible for a word
  $effect(() => {
    const text = appState.selectedText.trim();
    if (!appState.lookupCardVisible || !text) {
      lookupResult = null;
      lookupError = null;
      isLoadingLookup = false;
      showNoteInput = false;
      chatMessages = [];
      chatInput = "";
      showChat = false;
      saveFeedback = null;
      dragX = null;
      dragY = null;
      passageResult = null;
      passageError = null;
      isLoadingPassage = false;
      return;
    }

    if (isPhrase) {
      lookupResult = null;
      passageResult = null;
      passageError = null;
      isLoadingPassage = false;
      return;
    }

    if (text !== activeQuery) {
      activeQuery = text;
      lookupResult = null;
      lookupError = null;
      chatMessages = [];
      chatInput = "";
      saveFeedback = null;
      dragX = null;
      dragY = null;
      passageResult = null;
      passageError = null;
      fetchDefinition(text, appState.selectedSentence);
    }
  });

  async function handleExplainPassage(mode: "explain" | "translate" | "summarize" = "explain") {
    const text = appState.selectedText.trim();
    if (!text || isLoadingPassage) return;
    isLoadingPassage = true;
    passageError = null;

    await appState.checkApiKey();
    if (!appState.hasApiKey) {
      isLoadingPassage = false;
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
      passageResult = { mode, text: res };
    } catch (err: any) {
      console.error("Passage explanation error:", err);
      const msg = typeof err === "string" ? err : err?.message || "Could not process passage.";
      passageError = msg;
    } finally {
      isLoadingPassage = false;
    }
  }

  async function handleSavePassageNote() {
    if (!appState.activeBook || !passageResult) return;
    const modeLabel = passageResult.mode === "translate"
      ? `Translation (${appState.targetLanguage})`
      : (passageResult.mode === "summarize" ? "Key Summary" : "Explanation");
    try {
      await api.addNote({
        bookId: appState.activeBook.id,
        content: `[AI ${modeLabel}]:\n${passageResult.text}`,
        quote: appState.selectedText,
        page: appState.currentPage,
      });
      await appState.refreshBookMemory(appState.activeBook.id);
      saveFeedback = "Saved to Notes ✓";
      setTimeout(() => (saveFeedback = null), 2400);
    } catch (err) {
      console.error("Failed to save passage note:", err);
    }
  }

  async function fetchDefinition(word: string, contextSentence?: string) {
    isLoadingLookup = true;
    lookupError = null;

    // Check if key is configured
    await appState.checkApiKey();
    if (!appState.hasApiKey) {
      isLoadingLookup = false;
      return;
    }

    try {
      const res = await api.lookupWord({
        word,
        contextSentence: contextSentence || null,
        targetLanguage: appState.targetLanguage,
        provider: appState.aiProvider,
      });
      lookupResult = res;
    } catch (err: any) {
      console.warn("AI lookup failed:", err);
      const msg = typeof err === "string" ? err : err?.message || "Could not retrieve definition.";
      lookupError = msg;
    } finally {
      isLoadingLookup = false;
    }
  }

  function playPronunciation() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(appState.selectedText);
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  }

  async function handleSaveWord() {
    if (!appState.activeBook || isSaving) return;
    isSaving = true;
    saveFeedback = null;
    try {
      const meaningToSave = lookupResult?.meaning || `Selected word: "${appState.selectedText}"`;
      const meaningHindiToSave = lookupResult?.meaning_hindi || null;
      const exampleToSave = lookupResult?.example || appState.selectedSentence || null;

      await api.addWord({
        bookId: appState.activeBook.id,
        word: appState.selectedText.trim(),
        meaning: meaningToSave,
        meaningHindi: meaningHindiToSave,
        exampleSentence: exampleToSave,
        page: appState.selectedPage || appState.currentPage,
        aiGenerated: !!lookupResult,
      });
      await appState.refreshBookMemory(appState.activeBook.id);
      saveFeedback = "Saved ✓";
      setTimeout(() => (saveFeedback = null), 2400);
    } catch (err) {
      // If duplicate, update existing word
      const existing = appState.words.find(
        (w) => w.word.toLowerCase() === appState.selectedText.trim().toLowerCase()
      );
      if (existing) {
        try {
          const meaningToSave = lookupResult?.meaning || existing.meaning;
          const meaningHindiToSave = lookupResult?.meaning_hindi || existing.meaning_hindi;
          const exampleToSave = lookupResult?.example || existing.example_sentence;
          await api.updateWord(existing.id, meaningToSave, meaningHindiToSave, exampleToSave);
          await appState.refreshBookMemory(appState.activeBook.id);
          saveFeedback = "Updated ✓";
          setTimeout(() => (saveFeedback = null), 2400);
        } catch (uErr) {
          console.error("Failed to update existing word:", uErr);
        }
      } else {
        console.error("Failed to save word:", err);
      }
    } finally {
      isSaving = false;
    }
  }

  async function handleSendChat(customQuery?: string) {
    const q = (customQuery || chatInput).trim();
    if (!q || isChatting) return;

    // Capture prior history before pushing the new query
    const priorHistory = chatMessages.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));

    chatMessages = [...chatMessages, { role: "user", text: q }];
    chatInput = "";
    isChatting = true;

    try {
      const reply = await api.chatWordInquiry({
        word: appState.selectedText.trim(),
        context: appState.selectedSentence || null,
        query: q,
        history: priorHistory,
        targetLanguage: appState.targetLanguage,
        provider: appState.aiProvider,
      });

      chatMessages = [...chatMessages, { role: "model", text: reply }];
    } catch (err: any) {
      console.error("Mini chat inquiry error:", err);
      const msg = typeof err === "string" ? err : err?.message || "Could not get AI response.";
      chatMessages = [...chatMessages, { role: "model", text: `⚠️ ${msg}` }];
    } finally {
      isChatting = false;
    }
  }

  async function handleSaveChatAsNote(text: string) {
    if (!appState.activeBook) return;
    try {
      await api.addNote({
        bookId: appState.activeBook.id,
        content: `[AI Inquiry on "${appState.selectedText}"]:\n${text}`,
        quote: appState.selectedText,
        page: appState.selectedPage || appState.currentPage,
      });
      await appState.refreshBookMemory(appState.activeBook.id);
    } catch (err) {
      console.error("Failed to save chat answer as note:", err);
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
        page: appState.selectedPage || appState.currentPage,
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

  async function handleAddAnnotation(color: "yellow" | "underline" = "yellow") {
    if (!appState.activeBook) return;
    try {
      await api.addHighlight({
        bookId: appState.activeBook.id,
        page: appState.selectedPage || appState.currentPage,
        text: appState.selectedText,
        rectsJson: JSON.stringify(appState.selectionRect),
        color,
      });
      await appState.refreshBookMemory(appState.activeBook.id);
      appState.lookupCardVisible = false;
    } catch (err) {
      console.error("Failed to add annotation:", err);
    }
  }

  async function handleAddHighlight() {
    return handleAddAnnotation("yellow");
  }

  function handleOpenMemory(tab: "words" | "notes") {
    appState.activeMemoryTab = tab;
    appState.memoryDrawerOpen = true;
    appState.lookupCardVisible = false;
  }
</script>

{#if appState.lookupCardVisible && appState.selectedText}
  <div
    class="lookup-card"
    style={positionStyle}
    role="dialog"
    aria-label="Word Definition & Actions"
    onclick={(e) => e.stopPropagation()}
    onmousedown={(e) => e.stopPropagation()}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="card-header"
      onmousedown={startDrag}
      style="cursor: grab;"
      title="Click and drag to move card"
    >
      <div class="word-info">
        <span class="drag-handle" title="Drag to move">⋮⋮</span>
        <span class="selected-text">{appState.selectedText}</span>
        {#if lookupResult?.part_of_speech}
          <span class="pos-badge">{lookupResult.part_of_speech}</span>
        {/if}
        {#if !isPhrase}
          <button class="speaker-btn" onclick={playPronunciation} title="Pronounce word">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
        {#if isWordSaved && !saveFeedback}
          <div class="saved-indicator">
            <span>✓ Saved in vocabulary</span>
            <button class="link-btn" onclick={() => handleOpenMemory('words')}>View in Memory →</button>
          </div>
        {:else if saveFeedback}
          <div class="saved-indicator feedback">
            <span>{saveFeedback}</span>
            <button class="link-btn" onclick={() => handleOpenMemory('words')}>View in Memory →</button>
          </div>
        {/if}

        {#if isPhrase}
          <div class="phrase-preview">
            <div class="phrase-header">
              <span class="label">Passage ({appState.selectedText.trim().split(/\s+/).length} words):</span>
            </div>
            <p class="quote">"{appState.selectedText}"</p>

            <!-- Action buttons for paragraph: Explain, Translate, Summarize -->
            <div class="passage-actions-bar">
              <button
                class="passage-action-btn {passageResult?.mode === 'explain' ? 'active' : ''}"
                onclick={() => handleExplainPassage('explain')}
                disabled={isLoadingPassage}
              >
                💡 Explain Passage
              </button>
              <button
                class="passage-action-btn {passageResult?.mode === 'translate' ? 'active' : ''}"
                onclick={() => handleExplainPassage('translate')}
                disabled={isLoadingPassage}
              >
                🌐 Translate ({appState.targetLanguage})
              </button>
              <button
                class="passage-action-btn {passageResult?.mode === 'summarize' ? 'active' : ''}"
                onclick={() => handleExplainPassage('summarize')}
                disabled={isLoadingPassage}
              >
                📝 Key Summary
              </button>
            </div>

            {#if isLoadingPassage}
              <div class="lookup-loading">
                <div class="shimmer-line line-1"></div>
                <div class="shimmer-line line-2"></div>
                <div class="shimmer-line line-3"></div>
                <span class="loading-label">Analyzing with {appState.aiProvider === 'openrouter' ? 'OpenRouter' : 'Gemini'}...</span>
              </div>
            {:else if !appState.hasApiKey}
              <div class="no-key-banner">
                <p>Connect your {appState.aiProvider === 'openrouter' ? 'OpenRouter' : 'Gemini'} API key in Settings to explain and translate passages.</p>
                <button class="btn-setup-key" onclick={() => (appState.settingsModalOpen = true)}>
                  Configure API Key in Settings
                </button>
              </div>
            {:else if passageError}
              <div class="lookup-error-banner">
                <p>{passageError}</p>
                <button class="btn-retry" onclick={() => handleExplainPassage(passageResult?.mode || 'explain')}>
                  Retry
                </button>
              </div>
            {:else if passageResult}
              <div class="passage-result-card">
                <div class="passage-result-header">
                  <span class="result-badge {passageResult.mode}">
                    {passageResult.mode === 'translate' ? `Translation (${appState.targetLanguage})` : (passageResult.mode === 'summarize' ? 'Key Summary' : 'Explanation')}
                  </span>
                  <button class="save-passage-note-btn" onclick={handleSavePassageNote} title="Save to Book Notes">
                    + Save to Notes
                  </button>
                </div>
                <div class="passage-result-text model-formatted">
                  {@html formatAiMarkdown(passageResult.text)}
                </div>
              </div>

              <!-- Mini AI Inquiry Chat Toggle for Passages -->
              <button
                class="chat-toggle-btn {showChat ? 'expanded' : ''}"
                onclick={() => (showChat = !showChat)}
              >
                <div class="chat-toggle-left">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/>
                  </svg>
                  <span>Inquire Further About Passage</span>
                </div>
                <span class="arrow">{showChat ? "▲" : "▼"}</span>
              </button>

              {#if showChat}
                <div class="mini-chat-section">
                  <div class="quick-chips">
                    <button class="chip" onclick={() => handleSendChat("Break down the key arguments simply")}>
                      Key arguments
                    </button>
                    <button class="chip" onclick={() => handleSendChat(`Translate into ${appState.targetLanguage} line by line`)}>
                      {appState.targetLanguage} line-by-line
                    </button>
                    <button class="chip" onclick={() => handleSendChat("Explain historical or literary context")}>
                      Context & tone
                    </button>
                  </div>

                  {#if chatMessages.length > 0}
                    <div class="chat-thread">
                      {#each chatMessages as msg}
                        <div class="chat-bubble {msg.role}">
                          {#if msg.role === "model"}
                            <div class="bubble-text model-formatted">{@html formatAiMarkdown(msg.text)}</div>
                          {:else}
                            <div class="bubble-text">{msg.text}</div>
                          {/if}
                          {#if msg.role === "model"}
                            <button
                              class="save-answer-btn"
                              onclick={() => handleSaveChatAsNote(msg.text)}
                              title="Save response to notes"
                            >
                              + Note
                            </button>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}

                  {#if isChatting}
                    <div class="chat-thinking">
                      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
                      <span class="thinking-text">Thinking...</span>
                    </div>
                  {/if}

                  <div class="mini-chat-input-bar">
                    <input
                      type="text"
                      bind:value={chatInput}
                      onkeydown={(e) => e.key === "Enter" && handleSendChat()}
                      placeholder="Ask question about this passage..."
                      class="chat-input"
                    />
                    <button
                      class="send-btn"
                      onclick={() => handleSendChat()}
                      disabled={isChatting || !chatInput.trim()}
                      title="Send inquiry"
                    >
                      ➔
                    </button>
                  </div>
                </div>
              {/if}
            {/if}
          </div>
        {:else if isLoadingLookup}
          <div class="lookup-loading">
            <div class="shimmer-line line-1"></div>
            <div class="shimmer-line line-2"></div>
            <div class="shimmer-line line-3"></div>
            <span class="loading-label">Looking up with {appState.aiProvider === 'openrouter' ? 'OpenRouter' : 'Gemini'}...</span>
          </div>
        {:else if !appState.hasApiKey}
          <div class="no-key-banner">
            <p>Connect your {appState.aiProvider === 'openrouter' ? 'OpenRouter' : 'Gemini'} API key in Settings to unlock instant {appState.targetLanguage} meanings and AI inquiry.</p>
            <button class="btn-setup-key" onclick={() => (appState.settingsModalOpen = true)}>
              Configure API Key in Settings
            </button>
          </div>
        {:else if lookupResult}
          <div class="definition-content">
            <!-- English Meaning -->
            <div class="def-block">
              <span class="def-lang-tag en">EN</span>
              <p class="definition-meaning">{lookupResult.meaning}</p>
            </div>

            <!-- Target Language Meaning -->
            {#if lookupResult.meaning_hindi}
              <div class="def-block hindi-block">
                <span class="def-lang-tag hi">{appState.targetLanguage}</span>
                <p class="definition-hindi">{lookupResult.meaning_hindi}</p>
              </div>
            {/if}
            
            {#if lookupResult.meaning_in_context}
              <div class="context-meaning">
                <span class="context-label">In context:</span>
                <span class="context-text">{lookupResult.meaning_in_context}</span>
              </div>
            {/if}

            {#if lookupResult.example}
              <div class="example-quote">
                <em>"{lookupResult.example}"</em>
              </div>
            {/if}

            {#if lookupResult.synonyms && lookupResult.synonyms.length > 0}
              <div class="synonyms-list">
                {#each lookupResult.synonyms.slice(0, 4) as syn}
                  <span class="syn-chip">{syn}</span>
                {/each}
              </div>
            {/if}

            <!-- Mini AI Inquiry Chat Toggle -->
            <button
              class="chat-toggle-btn {showChat ? 'expanded' : ''}"
              onclick={() => (showChat = !showChat)}
            >
              <div class="chat-toggle-left">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/>
                </svg>
                <span>Inquire Further</span>
              </div>
              <span class="arrow">{showChat ? "▲" : "▼"}</span>
            </button>

            <!-- Mini Chat Container -->
            {#if showChat}
              <div class="mini-chat-section">
                <!-- Suggested Quick Prompts -->
                <div class="quick-chips">
                  <button class="chip" onclick={() => handleSendChat(`${appState.targetLanguage} translation & sentence examples`)}>
                    {appState.targetLanguage} usage
                  </button>
                  <button class="chip" onclick={() => handleSendChat("Explain in simple terms with nuances")}>
                    Simpler terms
                  </button>
                  <button class="chip" onclick={() => handleSendChat("Word origin & etymology")}>
                    Etymology
                  </button>
                </div>

                {#if chatMessages.length > 0}
                  <div class="chat-thread">
                    {#each chatMessages as msg}
                      <div class="chat-bubble {msg.role}">
                        {#if msg.role === "model"}
                          <div class="bubble-text model-formatted">{@html formatAiMarkdown(msg.text)}</div>
                        {:else}
                          <div class="bubble-text">{msg.text}</div>
                        {/if}
                        {#if msg.role === "model"}
                          <button
                            class="save-answer-btn"
                            onclick={() => handleSaveChatAsNote(msg.text)}
                            title="Save response to notes"
                          >
                            + Note
                          </button>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}

                {#if isChatting}
                  <div class="chat-thinking">
                    <span class="dot"></span><span class="dot"></span><span class="dot"></span>
                    <span class="thinking-text">{appState.aiProvider === 'openrouter' ? 'OpenRouter' : 'Gemini'} is thinking...</span>
                  </div>
                {/if}

                <div class="mini-chat-input-bar">
                  <input
                    type="text"
                    bind:value={chatInput}
                    onkeydown={(e) => e.key === "Enter" && handleSendChat()}
                    placeholder="Ask follow-up question..."
                    class="chat-input"
                  />
                  <button
                    class="send-btn"
                    onclick={() => handleSendChat()}
                    disabled={isChatting || !chatInput.trim()}
                    title="Send inquiry"
                  >
                    ➔
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {:else if lookupError}
          <div class="lookup-error-banner">
            <p>{lookupError}</p>
            <button class="btn-retry" onclick={() => fetchDefinition(appState.selectedText, appState.selectedSentence)}>
              Retry
            </button>
          </div>
        {:else}
          <div class="context-preview">
            <span class="label">Context sentence:</span>
            <p class="sentence">"{appState.selectedSentence}"</p>
          </div>
        {/if}
      </div>

      <div class="card-actions">
        {#if !isPhrase}
          <button class="btn btn-primary" onclick={handleSaveWord} disabled={isSaving}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
            </svg>
            <span>{isSaving ? "Saving..." : (saveFeedback || (isWordSaved ? "Saved ✓" : "Save Word"))}</span>
          </button>
        {/if}

        <button class="btn btn-secondary" onclick={() => (showNoteInput = true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
          </svg>
          <span>Note</span>
        </button>

        <button class="btn btn-ghost" onclick={() => handleAddAnnotation("yellow")} title="Highlight text">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 11-6 6v3h3l6-6"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>
          </svg>
          <span>Highlight</span>
        </button>

        <button class="btn btn-ghost" onclick={() => handleAddAnnotation("underline")} title="Underline text">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/>
            <line x1="4" y1="21" x2="20" y2="21"/>
          </svg>
          <span>Underline</span>
        </button>
      </div>
    {:else}
      <!-- Quick Inline Note Input -->
      <div class="quick-note">
        <div class="quote-preview">"{appState.selectedText}"</div>
        <textarea
          bind:value={noteContent}
          placeholder="Write your note here..."
          rows="3"
        ></textarea>
        <div class="note-actions">
          <button class="btn-ghost" onclick={() => (showNoteInput = false)}>Cancel</button>
          <button class="btn-primary" onclick={handleSaveNote} disabled={isSaving || !noteContent.trim()}>
            {isSaving ? "Saving..." : "Save Note"}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .lookup-card {
    position: fixed;
    width: 350px;
    background: var(--bg-surface-elevated, #1c1c1f);
    border: 1px solid var(--border-subtle, #333);
    border-radius: var(--radius-md, 8px);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    z-index: 500;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: cardPop 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes cardPop {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(4px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-surface);
    user-select: none;
  }

  .drag-handle {
    color: var(--text-muted);
    font-size: 13px;
    user-select: none;
    letter-spacing: -2px;
    margin-right: 4px;
    cursor: grab;
  }

  .word-info {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }

  .selected-text {
    font-weight: 600;
    font-size: 13.5px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 190px;
  }

  .pos-badge {
    font-size: 10px;
    font-style: italic;
    background: var(--accent-subtle);
    color: var(--accent);
    padding: 1px 6px;
    border-radius: 4px;
    text-transform: lowercase;
  }

  .speaker-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    transition: color 0.15s ease;
  }

  .speaker-btn:hover {
    color: var(--accent);
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .card-body {
    padding: 12px 14px;
    font-size: 12.5px;
    color: var(--text-primary);
    max-height: 320px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .saved-indicator {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: rgba(16, 185, 129, 0.12);
    border: 1px solid rgba(16, 185, 129, 0.25);
    border-radius: var(--radius-sm, 6px);
    color: #10b981;
    font-size: 11.5px;
    font-weight: 500;
  }

  .link-btn {
    background: transparent;
    border: none;
    color: #10b981;
    font-size: 11px;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }

  .definition-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .def-block {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--bg-hover);
  }

  .def-block.hindi-block {
    background: var(--bg-hover);
    border-left: 3px solid var(--accent);
  }

  .def-lang-tag {
    font-size: 9.5px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.5px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .def-lang-tag.en {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .def-lang-tag.hi {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .definition-hindi {
    margin: 0;
    line-height: 1.45;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    font-family: inherit;
  }

  .chat-toggle-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    padding: 7px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    margin-top: 4px;
    transition: all 0.15s ease;
  }

  .chat-toggle-btn:hover,
  .chat-toggle-btn.expanded {
    background: var(--bg-hover);
    border-color: var(--accent);
  }

  .chat-toggle-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .mini-chat-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 2px;
    padding: 8px;
    background: var(--bg-surface);
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
  }

  .quick-chips {
    display: flex;
    gap: 5px;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .chip {
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    border-radius: 12px;
    padding: 3px 9px;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.12s ease;
  }

  .chip:hover {
    background: var(--accent-subtle);
    color: var(--accent);
    border-color: var(--accent);
  }

  .chat-thread {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 150px;
    overflow-y: auto;
    padding-right: 2px;
  }

  .chat-bubble {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 7px 10px;
    border-radius: 6px;
    font-size: 12px;
    line-height: 1.45;
  }

  .chat-bubble.user {
    align-self: flex-end;
    background: var(--accent);
    color: var(--accent-text, #ffffff);
    max-width: 85%;
  }

  .chat-bubble.model {
    align-self: flex-start;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    max-width: 95%;
  }

  .bubble-text.model-formatted,
  .passage-result-text.model-formatted {
    font-size: 12px;
    line-height: 1.5;
  }

  .bubble-text.model-formatted :global(p.ai-p),
  .passage-result-text.model-formatted :global(p.ai-p) {
    margin: 0 0 5px 0;
  }

  .bubble-text.model-formatted :global(p.ai-p:last-child),
  .passage-result-text.model-formatted :global(p.ai-p:last-child) {
    margin-bottom: 0;
  }

  .bubble-text.model-formatted :global(ul.ai-list),
  .passage-result-text.model-formatted :global(ul.ai-list) {
    margin: 3px 0 5px 0;
    padding-left: 16px;
    list-style-type: disc;
  }

  .bubble-text.model-formatted :global(ul.ai-list li),
  .passage-result-text.model-formatted :global(ul.ai-list li) {
    margin-bottom: 3px;
    line-height: 1.45;
  }

  .bubble-text.model-formatted :global(strong),
  .passage-result-text.model-formatted :global(strong) {
    font-weight: 600;
    color: var(--accent-light, #818cf8);
  }

  .bubble-text.model-formatted :global(em),
  .passage-result-text.model-formatted :global(em) {
    font-style: italic;
    color: var(--text-secondary);
  }

  .bubble-text.model-formatted :global(code),
  .passage-result-text.model-formatted :global(code) {
    background: rgba(255, 255, 255, 0.1);
    padding: 1px 4px;
    border-radius: 3px;
    font-family: monospace;
    font-size: 11px;
  }

  .bubble-text.model-formatted :global(.ai-spacer),
  .passage-result-text.model-formatted :global(.ai-spacer) {
    height: 5px;
  }

  .bubble-text.model-formatted :global(.ai-numbered-item),
  .passage-result-text.model-formatted :global(.ai-numbered-item) {
    display: flex;
    gap: 6px;
    margin-bottom: 3px;
  }

  .bubble-text.model-formatted :global(.ai-numbered-item .num),
  .passage-result-text.model-formatted :global(.ai-numbered-item .num) {
    font-weight: 600;
    color: var(--accent);
  }

  .save-answer-btn {
    align-self: flex-end;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    padding: 2px 7px;
    font-size: 10px;
    border-radius: 3px;
    cursor: pointer;
    margin-top: 3px;
  }

  .save-answer-btn:hover {
    background: var(--accent-subtle);
    color: var(--accent);
    border-color: var(--accent);
  }

  .chat-thinking {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--accent);
    padding: 4px 6px;
  }

  .dot {
    width: 5px;
    height: 5px;
    background: var(--accent);
    border-radius: 50%;
    animation: blink 1.2s infinite ease-in-out;
  }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes blink {
    0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
    40% { opacity: 1; transform: scale(1.2); }
  }

  .mini-chat-input-bar {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .chat-input {
    flex: 1;
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    color: var(--text-primary);
    padding: 6px 9px;
    font-size: 12px;
    outline: none;
  }

  .chat-input:focus {
    border-color: var(--accent);
  }

  .send-btn {
    background: var(--accent);
    border: none;
    color: var(--accent-text, #ffffff);
    padding: 6px 11px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .definition-meaning {
    margin: 0;
    line-height: 1.45;
    font-size: 13px;
    color: var(--text-primary);
  }

  .context-meaning {
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-primary);
    background: var(--accent-subtle);
    padding: 5px 8px;
    border-radius: 4px;
  }

  .context-label {
    font-weight: 600;
    margin-right: 4px;
  }

  .example-quote {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.4;
    border-left: 2px solid var(--accent);
    padding-left: 8px;
    margin-top: 2px;
  }

  .synonyms-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }

  .syn-chip {
    font-size: 10.5px;
    background: var(--bg-hover);
    color: var(--text-secondary);
    padding: 2px 7px;
    border-radius: 4px;
    border: 1px solid var(--border-subtle);
  }

  .lookup-loading {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 0;
  }

  .shimmer-line {
    height: 10px;
    border-radius: 4px;
    background: linear-gradient(90deg, var(--bg-hover) 25%, var(--border-strong) 50%, var(--bg-hover) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.4s infinite;
  }

  .shimmer-line.line-1 { width: 90%; }
  .shimmer-line.line-2 { width: 75%; }
  .shimmer-line.line-3 { width: 60%; }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .loading-label {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  .no-key-banner {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    background: var(--accent-subtle);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
  }

  .no-key-banner p {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--text-primary);
  }

  .btn-setup-key {
    background: var(--accent);
    border: none;
    color: var(--accent-text, #ffffff);
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    text-align: center;
  }

  .btn-setup-key:hover {
    opacity: 0.9;
  }

  .lookup-error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.25);
    border-radius: 6px;
  }

  .lookup-error-banner p {
    margin: 0;
    font-size: 11px;
    color: #ef4444;
  }

  .btn-retry {
    background: transparent;
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #ef4444;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    cursor: pointer;
  }

  .passage-preview,
  .context-preview {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .passage-actions-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }

  .passage-action-btn {
    flex: 1 1 auto;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
    white-space: nowrap;
  }

  .passage-action-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--accent);
    color: var(--accent);
  }

  .passage-action-btn.active {
    background: var(--accent-subtle);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  .passage-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .passage-result-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    background: var(--bg-hover);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    margin-top: 4px;
  }

  .passage-result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .result-badge {
    font-size: 10.5px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 4px;
    background: var(--accent-subtle);
    color: var(--accent);
    text-transform: capitalize;
  }

  .result-badge.translate {
    background: rgba(59, 130, 246, 0.15);
    color: #3b82f6;
  }

  .result-badge.summarize {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
  }

  .save-passage-note-btn {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    padding: 2px 8px;
    font-size: 10.5px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .save-passage-note-btn:hover {
    background: var(--accent-subtle);
    border-color: var(--accent);
    color: var(--accent);
  }

  .passage-result-text {
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--text-primary);
    white-space: pre-wrap;
    max-height: 180px;
    overflow-y: auto;
    padding-right: 4px;
  }

  .label {
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 500;
  }

  .quote,
  .sentence {
    margin: 0;
    font-style: italic;
    line-height: 1.4;
    color: var(--text-primary);
  }

  .card-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: var(--bg-surface);
    border-top: 1px solid var(--border-subtle);
  }

  .btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: var(--radius-sm, 6px);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s ease;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--accent-text, #ffffff);
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background: var(--bg-hover);
  }

  .btn-ghost {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    padding: 5px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11.5px;
  }

  .btn-ghost:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .quick-note {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .quote-preview {
    font-size: 11px;
    color: var(--text-secondary);
    font-style: italic;
    max-height: 40px;
    overflow: hidden;
    text-overflow: ellipsis;
    border-left: 2px solid var(--accent);
    padding-left: 6px;
  }

  .quick-note textarea {
    width: 100%;
    padding: 8px 10px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm, 6px);
    color: var(--text-primary);
    font-size: 12px;
    outline: none;
    box-sizing: border-box;
    resize: none;
  }

  .quick-note textarea:focus {
    border-color: var(--accent);
  }

  .note-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
