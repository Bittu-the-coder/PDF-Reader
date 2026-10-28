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
  import SettingsModal from "../lib/components/SettingsModal.svelte";

  import { onMount } from "svelte";
  import { api } from "../lib/api";

  let pdfViewer = $state<PDFViewer | null>(null);
  let isLoadingDoc = $state(false);
  let loadError = $state<string | null>(null);

  onMount(() => {
    let wheelAccumulator = 0;
    let lastWheelTime = 0;

    const handleGlobalWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        if (appState.currentView === "reader") {
          const now = Date.now();
          wheelAccumulator += e.deltaY;
          if (now - lastWheelTime > 40 || Math.abs(wheelAccumulator) >= 25) {
            if (wheelAccumulator < 0) {
              appState.zoomIn();
            } else if (wheelAccumulator > 0) {
              appState.zoomOut();
            }
            wheelAccumulator = 0;
            lastWheelTime = now;
          }
        }
      }
    };

    const handleKeyShortcuts = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        appState.zoomIn();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        appState.zoomOut();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        appState.setZoom(1.0);
        return;
      }

      if (e.key === "Escape") {
        if (appState.settingsModalOpen) {
          appState.settingsModalOpen = false;
          return;
        }
        if (appState.lookupCardVisible) {
          appState.lookupCardVisible = false;
          return;
        }
        e.preventDefault();
        appState.exitFullscreen();
        return;
      }

      if (e.key === "F11" || (e.key === "f" && !e.ctrlKey && !e.altKey && !e.metaKey)) {
        e.preventDefault();
        appState.toggleFullscreen();
      }
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!appState.topBarPinned && appState.currentView === "reader") {
        if (e.clientY <= 24) {
          appState.onTopEdgeEnter();
        }
      }
      if (!appState.sidebarPinned && appState.currentView === "reader") {
        if (e.clientX <= 16) {
          appState.onLeftEdgeEnter();
        }
      }
    };

    const preventGesture = (e: Event) => e.preventDefault();

    // Check initial launch file argument from CLI or system "Open With"
    api.getLaunchFile().then((filePath) => {
      if (filePath) {
        appState.openPdfFilePath(filePath);
      }
    }).catch(console.error);

    // Listen for single-instance open events when user clicks another PDF while app is running
    let unlistenEvent: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<string>("open-pdf-file", (event) => {
        if (event.payload) {
          appState.openPdfFilePath(event.payload);
        }
      }).then((unlisten) => {
        unlistenEvent = unlisten;
      });
    }).catch(console.error);

    window.addEventListener("wheel", handleGlobalWheel, { passive: false });
    window.addEventListener("keydown", handleKeyShortcuts);
    window.addEventListener("mousemove", handleGlobalMouseMove);
    window.addEventListener("gesturestart", preventGesture, { passive: false });
    window.addEventListener("gesturechange", preventGesture, { passive: false });
    window.addEventListener("gestureend", preventGesture, { passive: false });

    return () => {
      unlistenEvent?.();
      window.removeEventListener("wheel", handleGlobalWheel);
      window.removeEventListener("keydown", handleKeyShortcuts);
      window.removeEventListener("mousemove", handleGlobalMouseMove);
      window.removeEventListener("gesturestart", preventGesture);
      window.removeEventListener("gesturechange", preventGesture);
      window.removeEventListener("gestureend", preventGesture);
    };
  });

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
    <!-- Top Edge Trigger Zone (when unpinned) -->
    {#if !appState.topBarPinned}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="top-edge-trigger"
        onmouseenter={() => appState.onTopEdgeEnter()}
      ></div>
    {/if}

    <!-- Left Edge Trigger Zone (when unpinned) -->
    {#if !appState.sidebarPinned}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="left-edge-trigger"
        onmouseenter={() => appState.onLeftEdgeEnter()}
      ></div>
    {/if}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      class="top-chrome {appState.topBarPinned ? 'pinned' : 'floating'} {appState.topBarVisible || appState.topBarPinned ? 'visible' : ''}"
      onmouseenter={() => appState.onTopEdgeEnter()}
      onmouseleave={() => appState.onTopEdgeLeave()}
    >
      <Tabs />
      <TopBar />
    </header>

    <div class="reader-workspace {appState.sidebarPinned ? 'has-pinned-sidebar' : ''}">
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

      <MemoryDrawer />
    </div>

    <LookupCard />
  </div>
{/if}

<SettingsModal />

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

  .top-edge-trigger {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 20px;
    z-index: 99;
    background: transparent;
  }

  .left-edge-trigger {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 16px;
    z-index: 94;
    background: transparent;
  }

  .top-chrome {
    width: 100%;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    z-index: 100;
    transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
  }

  .top-chrome.pinned {
    position: relative;
    transform: none;
    opacity: 1;
    flex-shrink: 0;
  }

  .top-chrome.floating {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    transform: translateY(-100%);
    opacity: 0;
    pointer-events: none;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  }

  .top-chrome.floating.visible {
    transform: translateY(0);
    opacity: 1;
    pointer-events: auto;
  }

  .reader-workspace {
    flex: 1;
    display: flex;
    flex-direction: row;
    overflow: hidden;
    position: relative;
    width: 100%;
    height: 100%;
  }

  .reader-main {
    flex: 1;
    display: flex;
    overflow: hidden;
    position: relative;
    width: 100%;
    height: 100%;
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
