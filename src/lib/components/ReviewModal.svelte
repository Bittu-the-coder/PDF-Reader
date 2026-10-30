<script lang="ts">
  import { appState } from "../stores/appState.svelte";
  import { api, type ReviewCard } from "../api";
  import Icon from "./Icon.svelte";

  let cards = $state<ReviewCard[]>([]);
  let index = $state(0);
  let revealed = $state(false);
  let loading = $state(false);
  let reviewed = $state(0);
  let againCount = $state(0);
  let scopeBook = $state(true);

  const grades = [
    { grade: 1, label: "Again", hint: "10 min", cls: "again" },
    { grade: 2, label: "Hard", hint: "", cls: "hard" },
    { grade: 3, label: "Good", hint: "", cls: "good" },
    { grade: 4, label: "Easy", hint: "", cls: "easy" },
  ] as const;

  let card = $derived(cards[index] ?? null);
  let done = $derived(!loading && cards.length > 0 && index >= cards.length);
  let bookId = $derived(scopeBook && appState.currentView === "reader" ? appState.activeBook?.id ?? null : null);

  $effect(() => {
    if (!appState.reviewOpen) return;
    bookId;
    load();
  });

  async function load() {
    loading = true;
    index = 0;
    reviewed = 0;
    againCount = 0;
    revealed = false;
    try {
      const due = await api.listDueCards(bookId, 40);
      // Shuffle so related words aren't always in the same order
      for (let i = due.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [due[i], due[j]] = [due[j], due[i]];
      }
      cards = due;
    } catch (err) {
      console.error("Could not load review cards:", err);
      cards = [];
    } finally {
      loading = false;
    }
  }

  async function grade(g: 1 | 2 | 3 | 4) {
    if (!card || !revealed) return;
    const current = card;
    reviewed++;
    if (g === 1) {
      againCount++;
      // See it again at the end of this session
      cards = [...cards, current];
    }
    index++;
    revealed = false;
    try {
      await api.reviewCard(current.word_id, g);
    } catch (err) {
      console.error("Could not save review:", err);
    }
    appState.refreshDueCount();
  }

  function close() {
    appState.reviewOpen = false;
    appState.refreshDueCount();
  }

  function onKeydown(e: KeyboardEvent) {
    if (!appState.reviewOpen) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!revealed && card) revealed = true;
      else if (revealed) grade(3);
    } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
      e.preventDefault();
      grade(Number(e.key) as 1 | 2 | 3 | 4);
    }
  }

  function speak(word: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }

  /** Hide the word inside its example sentence so the reader recalls it. */
  function cloze(sentence: string, word: string) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return sentence.replace(new RegExp(escaped, "gi"), "_____");
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if appState.reviewOpen}
  <div class="backdrop" role="presentation" onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
    <div class="review" role="dialog" aria-modal="true" aria-label="Vocabulary review" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <header>
        <div class="title">
          <Icon name="sparkles" size={17} />
          <span>Review words</span>
        </div>
        {#if appState.currentView === "reader" && appState.activeBook}
          <div class="scope">
            <button class:active={scopeBook} onclick={() => (scopeBook = true)}>This book</button>
            <button class:active={!scopeBook} onclick={() => (scopeBook = false)}>All books</button>
          </div>
        {/if}
        <button class="icon-btn" onclick={close} aria-label="Close review" title="Close (Esc)">
          <Icon name="x" size={18} />
        </button>
      </header>

      {#if cards.length > 0 && !done}
        <div class="progress"><div style="width: {(index / cards.length) * 100}%"></div></div>
      {/if}

      <div class="body">
        {#if loading}
          <div class="center"><div class="spinner"></div></div>
        {:else if cards.length === 0}
          <div class="center empty">
            <div class="empty-icon"><Icon name="check" size={26} /></div>
            <h3>You're all caught up</h3>
            <p>No words are due right now. Save words while you read, and they'll come back here just before you'd forget them.</p>
          </div>
        {:else if done}
          <div class="center empty">
            <div class="empty-icon success"><Icon name="check" size={26} /></div>
            <h3>Session complete</h3>
            <p>You reviewed {reviewed} {reviewed === 1 ? "card" : "cards"}{againCount ? `, ${againCount} to practise again` : ""}.</p>
            <button class="btn-primary" onclick={close}>Done</button>
          </div>
        {:else if card}
          <div class="card">
            <div class="meta">{index + 1} / {cards.length}{#if card.page}{` · from page ${card.page}`}{/if}</div>
            <div class="word-row">
              <h2 class="word">{card.word}</h2>
              <button class="icon-btn" onclick={() => speak(card.word)} aria-label="Pronounce" title="Pronounce">
                <Icon name="volume" size={17} />
              </button>
            </div>
            {#if card.example_sentence && !revealed}
              <p class="example">“{cloze(card.example_sentence, card.word)}”</p>
            {/if}

            {#if revealed}
              <div class="answer">
                <p class="meaning">{card.meaning}</p>
                {#if card.meaning_hindi}
                  <p class="translation"><span>{appState.targetLanguage}</span>{card.meaning_hindi}</p>
                {/if}
                {#if card.example_sentence}
                  <p class="example">“{card.example_sentence}”</p>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      {#if card && !done && !loading}
        <footer>
          {#if !revealed}
            <button class="btn-primary reveal" onclick={() => (revealed = true)}>
              Show meaning <kbd>Space</kbd>
            </button>
          {:else}
            <div class="grades">
              {#each grades as g}
                <button class="grade {g.cls}" onclick={() => grade(g.grade)}>
                  <span>{g.label}</span>
                  <kbd>{g.grade}</kbd>
                </button>
              {/each}
            </div>
          {/if}
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1100;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .review {
    width: 100%;
    max-width: 520px;
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    animation: pop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 10px 12px 18px;
  }

  .title {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 650;
    font-size: 15px;
    color: var(--text-primary);
  }

  .title :global(svg) {
    color: var(--accent);
  }

  .scope {
    display: flex;
    padding: 2px;
    gap: 2px;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
  }

  .scope button {
    height: 26px;
    padding: 0 10px;
    font-size: 12px;
    color: var(--text-secondary);
    border-radius: var(--radius-xs);
  }

  .scope button.active {
    background: var(--bg-surface-elevated);
    color: var(--text-primary);
    box-shadow: var(--shadow-sm);
  }

  .progress {
    height: 3px;
    background: var(--bg-active);
  }

  .progress div {
    height: 100%;
    background: var(--accent);
    transition: width var(--transition-normal);
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 28px 28px 20px;
    min-height: 260px;
  }

  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 10px;
    min-height: 220px;
  }

  .empty h3 {
    font-size: 17px;
    color: var(--text-primary);
  }

  .empty p {
    max-width: 340px;
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }

  .empty-icon {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .empty-icon.success {
    background: var(--success-subtle);
    color: var(--success);
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 14px;
  }

  .meta {
    font-size: 12px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .word-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .word {
    font-family: var(--font-reading);
    font-size: clamp(28px, 6vw, 38px);
    font-weight: 600;
    color: var(--text-primary);
    word-break: break-word;
  }

  .example {
    font-family: var(--font-reading);
    font-style: italic;
    font-size: 15px;
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 420px;
  }

  .answer {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    padding-top: 16px;
    border-top: 1px solid var(--border-subtle);
    animation: pop 0.2s ease;
  }

  .meaning {
    font-size: 16px;
    line-height: 1.55;
    color: var(--text-primary);
  }

  .translation {
    font-size: 15px;
    color: var(--text-secondary);
  }

  .translation span {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--accent);
    margin-right: 8px;
  }

  footer {
    padding: 14px 18px 18px;
    border-top: 1px solid var(--border-subtle);
  }

  .reveal {
    width: 100%;
    height: 42px;
    font-size: 14px;
    gap: 10px;
  }

  kbd {
    font-family: inherit;
    font-size: 10.5px;
    font-weight: 500;
    padding: 1px 6px;
    border-radius: var(--radius-xs);
    border: 1px solid currentColor;
    opacity: 0.6;
  }

  .grades {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .grade {
    height: 46px;
    flex-direction: column;
    gap: 2px;
    font-size: 13.5px;
    font-weight: 600;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-strong);
  }

  .grade kbd {
    font-size: 10px;
    border: none;
    padding: 0;
  }

  .grade.again {
    color: var(--danger);
  }

  .grade.again:hover {
    background: var(--danger-subtle);
    border-color: var(--danger);
  }

  .grade.hard {
    color: var(--warning);
  }

  .grade.hard:hover {
    border-color: var(--warning);
  }

  .grade.good {
    color: var(--accent);
  }

  .grade.good:hover {
    background: var(--accent-subtle);
    border-color: var(--accent);
  }

  .grade.easy {
    color: var(--success);
  }

  .grade.easy:hover {
    background: var(--success-subtle);
    border-color: var(--success);
  }
</style>
