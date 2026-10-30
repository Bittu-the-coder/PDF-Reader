<script lang="ts">
  import { appState } from "../stores/appState.svelte";
  import Icon from "./Icon.svelte";

  const groups: { title: string; items: [string[], string][] }[] = [
    {
      title: "Reading",
      items: [
        [["←", "→"], "Previous / next page"],
        [["Space"], "Next page (Shift for previous)"],
        [["Home", "End"], "First / last page"],
        [["Alt", "←"], "Back to where you jumped from"],
        [["Ctrl", "F"], "Find in book"],
        [["Ctrl", "D"], "Bookmark this page"],
      ],
    },
    {
      title: "Words & notes",
      items: [
        [["Double-click"], "Look up a word in place"],
        [["Select text"], "Explain, translate, highlight or note"],
        [["Ctrl", "Enter"], "Save a note"],
      ],
    },
    {
      title: "View",
      items: [
        [["Ctrl", "+"], "Zoom in"],
        [["Ctrl", "−"], "Zoom out"],
        [["Ctrl", "0"], "Reset zoom"],
        [["F"], "Full screen"],
        [["Ctrl", "B"], "Dock / undock sidebar"],
        [["Ctrl", "Shift", "B"], "Auto-hide toolbar"],
      ],
    },
    {
      title: "App",
      items: [
        [["Ctrl", "O"], "Open a PDF"],
        [["Esc"], "Close the top-most panel"],
        [["?"], "Show this help"],
      ],
    },
  ];
</script>

{#if appState.shortcutsOpen}
  <div class="backdrop" role="presentation" onclick={() => (appState.shortcutsOpen = false)}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <header>
        <h2>Keyboard shortcuts</h2>
        <button class="icon-btn" onclick={() => (appState.shortcutsOpen = false)} aria-label="Close" title="Close (Esc)">
          <Icon name="x" size={18} />
        </button>
      </header>
      <div class="grid">
        {#each groups as g}
          <section>
            <h3>{g.title}</h3>
            {#each g.items as [keys, label]}
              <div class="row">
                <span class="label">{label}</span>
                <span class="keys">
                  {#each keys as k, i}
                    {#if i > 0}<span class="plus">+</span>{/if}<kbd>{k}</kbd>
                  {/each}
                </span>
              </div>
            {/each}
          </section>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1150;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .sheet {
    width: 100%;
    max-width: 720px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: 8px 22px 22px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0 8px;
  }

  h2 {
    font-size: 16px;
    font-weight: 650;
    color: var(--text-primary);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 8px 32px;
  }

  h3 {
    margin: 14px 0 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 13px;
  }

  .label {
    color: var(--text-secondary);
  }

  .keys {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .plus {
    font-size: 11px;
    color: var(--text-muted);
  }

  kbd {
    font-family: inherit;
    font-size: 11.5px;
    min-width: 22px;
    text-align: center;
    padding: 2px 6px;
    color: var(--text-primary);
    background: var(--bg-secondary);
    border: 1px solid var(--border-strong);
    border-bottom-width: 2px;
    border-radius: var(--radius-xs);
  }
</style>
