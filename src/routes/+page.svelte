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
  import SearchBar from "../lib/components/SearchBar.svelte";
  import ReviewModal from "../lib/components/ReviewModal.svelte";
  import ShortcutsModal from "../lib/components/ShortcutsModal.svelte";

  import { onMount, untrack } from "svelte";
  import { api } from "../lib/api";

  let pdfViewer = $state<PDFViewer | null>(null);
  let isLoadingDoc = $state(false);
  let loadError = $state<string | null>(null);

  onMount(() => {
    const handleGlobalWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      // Never let the webview zoom the whole UI; zoom the PDF instead
      e.preventDefault();
      e.stopPropagation();
      if (appState.currentView !== "reader") return;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      appState.wheelZoom(delta);
    };

    // Linux: the native side forwards touchpad pinch gestures here
    let unlistenPinch: (() => void) | null = null;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<[number, number]>("touchpad-pinch", ({ payload: [phase, scale] }) => {
          if (appState.currentView !== "reader") return;
          if (phase === 0) appState.beginPinch();
          else if (phase === 1) appState.updatePinch(scale);
          else appState.endPinch();
        })
      )
      .then((u) => (unlistenPinch = u))
      .catch(() => {});

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

      // Ctrl+F works even while typing elsewhere
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F") && appState.currentView === "reader") {
        e.preventDefault();
        appState.openSearch();
        return;
      }

      if (e.key === "Escape") {
        // Close the top-most layer first
        if (appState.shortcutsOpen) {
          appState.shortcutsOpen = false;
        } else if (appState.reviewOpen) {
          appState.reviewOpen = false;
        } else if (appState.settingsModalOpen) {
          appState.settingsModalOpen = false;
        } else if (appState.activeHighlight) {
          appState.activeHighlight = null;
          appState.activeHighlightRect = null;
        } else if (appState.lookupCardVisible) {
          appState.lookupCardVisible = false;
          window.getSelection()?.removeAllRanges();
        } else if (appState.searchOpen) {
          appState.closeSearch();
        } else if (appState.memoryDrawerOpen) {
          appState.memoryDrawerOpen = false;
        } else if (appState.isCompact && appState.sidebarVisible) {
          appState.sidebarVisible = false;
        } else if (appState.isFullscreen) {
          appState.exitFullscreen();
        } else {
          window.getSelection()?.removeAllRanges();
        }
        e.preventDefault();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        openPdfDialog();
        return;
      }

      if (appState.reviewOpen || appState.settingsModalOpen) return;

      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        appState.shortcutsOpen = !appState.shortcutsOpen;
        return;
      }

      if (appState.currentView !== "reader") return;

      if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        appState.toggleBookmark();
        return;
      }
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        appState.goBack();
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

    const handleResize = () => {
      appState.windowWidth = window.innerWidth;
      appState.windowHeight = window.innerHeight;
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    // Save reading time when the window is hidden or closed
    const flush = () => appState.flushReadingTime();
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", flush);
    const flushTimer = setInterval(flush, 60_000);

    appState.checkApiKey();

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
      unlistenPinch?.();
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", flush);
      clearInterval(flushTimer);
      window.removeEventListener("wheel", handleGlobalWheel);
      window.removeEventListener("keydown", handleKeyShortcuts);
      window.removeEventListener("mousemove", handleGlobalMouseMove);
      window.removeEventListener("gesturestart", preventGesture);
      window.removeEventListener("gesturechange", preventGesture);
      window.removeEventListener("gestureend", preventGesture);
    };
  });

  async function openPdfDialog() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
      });
      if (selected && typeof selected === "string") {
        await appState.openPdfFilePath(selected);
      }
    } catch (err) {
      console.warn("File dialog unavailable:", err);
    }
  }

  // Count reading time page by page
  $effect(() => {
    const page = appState.currentPage;
    if (appState.currentView !== "reader" || !appState.activeBook || !pdfViewer) return;
    untrack(() => appState.trackPageTurn(page));
  });

  // Load the document whenever the active book changes
  let loadToken = 0;
  let loadedBookId: number | null = null;
  $effect(() => {
    const book = appState.activeBook;
    if (appState.currentView !== "reader" || !book) {
      untrack(() => {
        pdfViewer?.destroy();
        pdfViewer = null;
        loadedBookId = null;
      });
      return;
    }
    if (book.id === loadedBookId) return;

    const token = ++loadToken;
    untrack(() => {
      pdfViewer?.destroy();
      pdfViewer = null;
    });
    loadedBookId = book.id;
    isLoadingDoc = true;
    loadError = null;

    (async () => {
      const viewer = new PDFViewer();
      try {
        let bytes = appState.docBufferCache.get(book.id);
        if (!bytes || bytes.length === 0) {
          bytes = await api.readPdfBytes(book.file_path);
          appState.docBufferCache.set(book.id, bytes);
        }
        const count = await viewer.load(bytes);
        if (token !== loadToken) {
          viewer.destroy();
          return;
        }
        appState.pageCount = count;
        pdfViewer = viewer;
        viewer.getOutlineTree().then((tree) => {
          if (token === loadToken) appState.outline = tree;
        });
      } catch (err: any) {
        viewer.destroy();
        if (token !== loadToken) return;
        console.error("Failed to open document:", err);
        const msg = err?.message || String(err);
        loadError = /no such file|not found|os error 2|cannot find/i.test(msg)
          ? `The file could not be found. It may have been moved or deleted.\n\n${book.file_path}`
          : `Could not open this document: ${msg}`;
        loadedBookId = null;
      } finally {
        if (token === loadToken) isLoadingDoc = false;
      }
    })();
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
      {#if appState.isCompact && (appState.sidebarVisible || appState.memoryDrawerOpen)}
        <button
          class="compact-scrim"
          aria-label="Close panel"
          onclick={() => {
            appState.sidebarVisible = false;
            appState.memoryDrawerOpen = false;
          }}
        ></button>
      {/if}
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
                  Back to Library
                </button>
              </div>
            </div>
          </div>
        {:else}
          <Reader bind:pdfViewer />
          <SearchBar {pdfViewer} />
        {/if}
      </main>

      <MemoryDrawer />
    </div>

    <LookupCard />
  </div>
{/if}

<SettingsModal />
<ReviewModal />
<ShortcutsModal />

{#if appState.importStatus}
  <div class="import-overlay" role="status" aria-live="polite">
    <div class="import-card">
      <div class="spinner"></div>
      <span>{appState.importStatus}</span>
    </div>
  </div>
{/if}

{#if appState.toast}
  {#key appState.toast.token}
    <div class="toast {appState.toast.kind}" role="status" aria-live="polite">
      {appState.toast.message}
    </div>
  {/key}
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
    white-space: pre-wrap;
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-secondary);
    word-break: break-word;
  }

  .compact-scrim {
    position: absolute;
    inset: 0;
    z-index: 95;
    background: rgba(0, 0, 0, 0.38);
    border-radius: 0;
    animation: fadeIn 0.18s ease;
  }

  .import-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(3px);
    animation: fadeIn 0.18s ease;
  }

  .import-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 18px 22px;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    color: var(--text-primary);
    font-size: 14px;
  }

  .toast {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: 2100;
    max-width: min(520px, calc(100vw - 32px));
    padding: 10px 16px;
    border-radius: var(--radius-full);
    background: var(--text-primary);
    color: var(--bg-primary);
    font-size: 13px;
    font-weight: 500;
    box-shadow: var(--shadow-lg);
    animation: toastIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    text-align: center;
  }

  .toast.error {
    background: var(--danger);
    color: #fff;
  }

  @keyframes toastIn {
    from {
      opacity: 0;
      transform: translate(-50%, 10px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .error-actions {
    margin-top: 8px;
    display: flex;
    justify-content: flex-end;
  }
</style>
