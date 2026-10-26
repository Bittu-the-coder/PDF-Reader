<script lang="ts">
  import { appState } from "../lib/stores/appState.svelte";
  import { PDFViewer } from "../lib/pdf/pdfViewer";
  import Shelf from "../lib/components/Shelf.svelte";
  import Tabs from "../lib/components/Tabs.svelte";
  import TopBar from "../lib/components/TopBar.svelte";
  import Sidebar from "../lib/components/Sidebar.svelte";
  import Reader from "../lib/components/Reader.svelte";
  import LookupCard from "../lib/components/LookupCard.svelte";
  import MemoryDrawer from "../lib/components/MemoryDrawer.svelte";

  import { api } from "../lib/api";

  let pdfViewer = $state<PDFViewer | null>(null);
  let isLoadingDoc = $state(false);
  let loadError = $state<string | null>(null);

  $effect(() => {
    // When active book changes in reader, load the document
    if (appState.currentView === "reader" && appState.activeBook) {
      const book = appState.activeBook;
      isLoadingDoc = true;
      loadError = null;
      pdfViewer = null;

      const viewer = new PDFViewer();

      const loadFromUint8 = async (uint8: Uint8Array) => {
        try {
          const count = await viewer.load(uint8);
          appState.pageCount = count;
          pdfViewer = viewer;
          isLoadingDoc = false;
        } catch (err: any) {
          console.error("Failed to parse PDF document:", err);
          loadError = `Failed to parse document: ${err?.message || err}`;
          isLoadingDoc = false;
        }
      };

      // Check if master bytes are cached
      if (appState.docBufferCache.has(book.id) && appState.docBufferCache.get(book.id)!.length > 0) {
        const cached = appState.docBufferCache.get(book.id)!;
        loadFromUint8(cached);
      } else {
        api.readPdfBytes(book.file_path)
          .then((bytes) => {
            const uint8 = new Uint8Array(bytes);
            appState.docBufferCache.set(book.id, uint8);
            return loadFromUint8(uint8);
          })
          .catch((err: any) => {
            console.error("Failed to read PDF bytes from disk:", err);
            loadError = `Could not open file: ${err?.message || err}. Path: ${book.file_path}`;
            isLoadingDoc = false;
          });
      }
    }
  });
</script>

{#if appState.currentView === "shelf"}
  <Shelf />
{:else}
  <div class="reader-shell">
    <Tabs />
    <TopBar />
    <Sidebar {pdfViewer} />
    
    <main class="reader-main">
      {#if isLoadingDoc}
        <div class="reader-loading">
          <div class="spinner"></div>
          <p>Opening {appState.activeBook?.title || "book"}...</p>
        </div>
      {:else if loadError}
        <div class="reader-error">
          <div class="error-card">
            <h3>Unable to Open Document</h3>
            <p>{loadError}</p>
            <div class="error-actions">
              <button class="btn-primary" onclick={() => appState.goToShelf()}>
                Return to 3D Library
              </button>
            </div>
          </div>
        </div>
      {:else}
        <Reader bind:pdfViewer />
      {/if}
    </main>

    <LookupCard />
    <MemoryDrawer />
  </div>
{/if}

<style>
  .reader-shell {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    background: var(--pdf-bg);
  }

  .reader-main {
    flex: 1;
    display: flex;
    overflow: hidden;
    position: relative;
  }

  .reader-loading {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: var(--text-secondary);
    font-size: 14px;
  }

  .reader-error {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }

  .error-card {
    max-width: 480px;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: 24px 28px;
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .error-card h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--danger, #ef4444);
  }

  .error-card p {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-secondary);
    word-break: break-word;
  }

  .error-actions {
    margin-top: 8px;
    display: flex;
    justify-content: flex-end;
  }
</style>
