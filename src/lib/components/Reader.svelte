<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { appState } from "../stores/appState.svelte";
  import { PDFViewer } from "../pdf/pdfViewer";
  import "../styles/pdfTextLayer.css";

  let { pdfViewer = $bindable() }: { pdfViewer: PDFViewer | null } = $props();

  let containerEl: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;
  let textLayerEl: HTMLDivElement;
  let isRendering = false;
  let renderPending = false;
  let resizeObserver: ResizeObserver | null = null;
  let selectionDebounceTimer: any = null;

  async function renderCurrentPage() {
    if (!pdfViewer || !pdfViewer.doc || !canvasEl || !textLayerEl) return;
    if (isRendering) {
      renderPending = true;
      return;
    }

    isRendering = true;
    try {
      let scale = appState.zoom;
      if (appState.fitMode === "width" && containerEl) {
        const page = await pdfViewer.getPage(appState.currentPage);
        const unscaled = page.getViewport({ scale: 1.0 });
        const availableWidth = containerEl.clientWidth - 48; // padding
        if (availableWidth > 100) {
          scale = Math.max(0.4, Number((availableWidth / unscaled.width).toFixed(2)));
        }
      }

      await pdfViewer.renderPage(appState.currentPage, canvasEl, textLayerEl, scale);
    } catch (err: any) {
      if (err?.name !== "RenderingCancelledException") {
        console.error("Page render error:", err);
      }
    } finally {
      isRendering = false;
      if (renderPending) {
        renderPending = false;
        renderCurrentPage();
      }
    }
  }

  // Handle text selection in the text layer
  function handleSelectionChange() {
    clearTimeout(selectionDebounceTimer);
    selectionDebounceTimer = setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        appState.lookupCardVisible = false;
        return;
      }

      const text = selection.toString().trim();
      if (!text || text.length === 0) {
        appState.lookupCardVisible = false;
        return;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      // Extract surrounding sentence if possible
      let sentence = "";
      try {
        const fullNodeText = range.startContainer.textContent || "";
        sentence = fullNodeText.trim();
      } catch (e) {
        sentence = text;
      }

      appState.selectedText = text;
      appState.selectedSentence = sentence || text;
      appState.selectionRect = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
      appState.lookupCardVisible = true;
    }, 250);
  }

  // Keyboard navigation
  function handleKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
      e.preventDefault();
      if (appState.currentPage < appState.pageCount) {
        appState.saveCurrentProgress(appState.currentPage + 1);
      }
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      if (appState.currentPage > 1) {
        appState.saveCurrentProgress(appState.currentPage - 1);
      }
    } else if (e.key === "f" || e.key === "F") {
      appState.toggleFocusMode();
    } else if (e.key === "Escape") {
      appState.lookupCardVisible = false;
      window.getSelection()?.removeAllRanges();
    }
  }

  $effect(() => {
    // Re-render when pdfViewer is loaded or page/zoom changes
    if (pdfViewer && appState.currentPage && canvasEl && textLayerEl) {
      const _zoom = appState.zoom;
      const _page = appState.currentPage;
      const _fit = appState.fitMode;
      renderCurrentPage();
    }
  });

  onMount(() => {
    document.addEventListener("selectionchange", handleSelectionChange);
    window.addEventListener("keydown", handleKeyDown);

    if (containerEl && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        if (appState.fitMode === "width") {
          renderCurrentPage();
        }
      });
      resizeObserver.observe(containerEl);
    }
  });

  onDestroy(() => {
    document.removeEventListener("selectionchange", handleSelectionChange);
    window.removeEventListener("keydown", handleKeyDown);
    resizeObserver?.disconnect();
  });
</script>

<div class="reader-viewport" bind:this={containerEl}>
  <div class="page-container">
    <canvas bind:this={canvasEl} class="pdf-canvas"></canvas>
    <div bind:this={textLayerEl} class="textLayer"></div>
  </div>
</div>

<style>
  .reader-viewport {
    flex: 1;
    width: 100%;
    height: 100%;
    overflow: auto;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 32px 16px;
    background-color: var(--pdf-bg);
    position: relative;
  }

  .page-container {
    position: relative;
    background: #ffffff;
    box-shadow: var(--shadow-lg);
    border-radius: 2px;
    margin: 0 auto;
    transition: transform var(--transition-fast);
  }

  .pdf-canvas {
    display: block;
  }
</style>
