<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { appState } from "../stores/appState.svelte";
  import { api } from "../api";
  import { PDFViewer } from "../pdf/pdfViewer";
  import { applyHighlightsToTextLayer } from "../pdf/highlights";
  import "../styles/pdfTextLayer.css";

  let { pdfViewer = $bindable() }: { pdfViewer: PDFViewer | null } = $props();

  let containerEl: HTMLDivElement;
  let scrollContainerEl: HTMLDivElement | null = $state(null);
  let resizeObserver: ResizeObserver | null = null;
  let selectionDebounceTimer: any = null;

  // Single page canvas & textLayer
  let singleCanvasEl = $state<HTMLCanvasElement>();
  let singleTextLayerEl = $state<HTMLDivElement>();

  // Dual page canvases & textLayers
  let leftCanvasEl = $state<HTMLCanvasElement>();
  let rightCanvasEl = $state<HTMLCanvasElement>();
  let leftTextLayerEl = $state<HTMLDivElement>();
  let rightTextLayerEl = $state<HTMLDivElement>();

  // 3D Flip animation state
  let isFlipping = $state(false);
  let flipDirection = $state<"next" | "prev">("next");

  function onHighlightClick() {
    appState.activeMemoryTab = "highlights";
    appState.memoryDrawerOpen = true;
  }

  // Dual page numbering calculation:
  // For dual mode: Page 1 can be alone, or pages 2-3, 4-5, etc.
  let dualLeftPage = $derived.by(() => {
    const cur = appState.currentPage;
    if (cur === 1) return 1;
    return cur % 2 === 0 ? cur : cur - 1;
  });

  let dualRightPage = $derived.by(() => {
    const left = dualLeftPage;
    if (left === 1 && appState.pageCount > 1) return 2;
    const right = left + 1;
    return right <= appState.pageCount ? right : null;
  });

  // Calculate rendering scale
  async function computeScale(targetWidth: number, isDual = false): Promise<number> {
    if (appState.fitMode === "custom") {
      return appState.zoom;
    }

    if (!pdfViewer || !pdfViewer.doc || targetWidth <= 100) {
      return appState.zoom;
    }

    try {
      const page = await pdfViewer.getPage(appState.currentPage || 1);
      const unscaled = page.getViewport({ scale: 1.0 });

      if (appState.fitMode === "width") {
        const availableWidth = targetWidth - (isDual ? 96 : 48);
        const desiredScale = isDual
          ? (availableWidth / 2) / unscaled.width
          : availableWidth / unscaled.width;
        return Math.max(0.35, Math.min(2.5, Number(desiredScale.toFixed(2))));
      } else if (appState.fitMode === "page" && containerEl) {
        const availableHeight = containerEl.clientHeight - 80;
        const desiredScale = availableHeight / unscaled.height;
        return Math.max(0.35, Math.min(2.5, Number(desiredScale.toFixed(2))));
      }
    } catch (e) {
      // Fallback
    }
    return appState.zoom;
  }

  // Render Single Page Mode
  async function renderSinglePage() {
    if (!pdfViewer || !pdfViewer.doc || !singleCanvasEl || !singleTextLayerEl || !containerEl) return;
    try {
      const scale = await computeScale(containerEl.clientWidth, false);
      if (appState.fitMode !== "custom") {
        appState.zoom = scale;
      }
      await pdfViewer.renderPage(appState.currentPage, singleCanvasEl, singleTextLayerEl, scale);
      applyHighlightsToTextLayer(singleTextLayerEl, appState.currentPage, appState.highlights, onHighlightClick);
    } catch (err: any) {
      if (err?.name !== "RenderingCancelledException") {
        console.error("Single page render error:", err);
      }
    }
  }

  // Render Dual Page Spread
  async function renderDualPages() {
    if (!pdfViewer || !pdfViewer.doc || !containerEl) return;
    try {
      const scale = await computeScale(containerEl.clientWidth, true);
      if (appState.fitMode !== "custom") {
        appState.zoom = scale;
      }

      if (leftCanvasEl && dualLeftPage) {
        await pdfViewer.renderPage(dualLeftPage, leftCanvasEl, leftTextLayerEl, scale);
        applyHighlightsToTextLayer(leftTextLayerEl, dualLeftPage, appState.highlights, onHighlightClick);
      }
      if (rightCanvasEl && dualRightPage) {
        await pdfViewer.renderPage(dualRightPage, rightCanvasEl, rightTextLayerEl, scale);
        applyHighlightsToTextLayer(rightTextLayerEl, dualRightPage, appState.highlights, onHighlightClick);
      }
    } catch (err: any) {
      if (err?.name !== "RenderingCancelledException") {
        console.error("Dual page render error:", err);
      }
    }
  }

  // 3D Flip navigation trigger
  async function flipNext() {
    if (isFlipping) return;
    const step = appState.readingMode === "dual" ? 2 : 1;
    if (appState.currentPage + step <= appState.pageCount) {
      flipDirection = "next";
      isFlipping = true;
      setTimeout(() => {
        appState.saveCurrentProgress(appState.currentPage + step);
        setTimeout(() => {
          isFlipping = false;
        }, 320);
      }, 150);
    }
  }

  async function flipPrev() {
    if (isFlipping) return;
    const step = appState.readingMode === "dual" ? 2 : 1;
    if (appState.currentPage - step >= 1) {
      flipDirection = "prev";
      isFlipping = true;
      setTimeout(() => {
        appState.saveCurrentProgress(appState.currentPage - step);
        setTimeout(() => {
          isFlipping = false;
        }, 320);
      }, 150);
    }
  }

  // Svelte action for lazy rendering pages in vertical scroll mode
  function renderScrollCanvas(canvasNode: HTMLCanvasElement, param: { pageNum: number; zoom: number; fitMode: string }) {
    let cancelled = false;
    let currentParam = param;
    let isIntersecting = false;

    const render = async () => {
      if (cancelled || !pdfViewer || !pdfViewer.doc) return;
      try {
        const textDiv = canvasNode.parentElement?.querySelector(".textLayer") as HTMLElement | null;
        let scale = currentParam.zoom;
        if (currentParam.fitMode === "width" && scrollContainerEl) {
          scale = await computeScale(scrollContainerEl.clientWidth, false);
        } else if (currentParam.fitMode === "page" && scrollContainerEl) {
          scale = await computeScale(scrollContainerEl.clientWidth, false);
        }
        await pdfViewer.renderPage(currentParam.pageNum, canvasNode, textDiv, scale);
        applyHighlightsToTextLayer(textDiv, currentParam.pageNum, appState.highlights, onHighlightClick);
      } catch (e: any) {
        if (e?.name !== "RenderingCancelledException") {
          console.warn(`Scroll page ${currentParam.pageNum} render error:`, e);
        }
      }
    };

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          isIntersecting = entries[0].isIntersecting;
          if (isIntersecting && !cancelled) {
            render();
          }
        },
        { rootMargin: "400px" }
      );
      observer.observe(canvasNode);
    } else {
      isIntersecting = true;
      render();
    }

    return {
      update(newParam: { pageNum: number; zoom: number; fitMode: string }) {
        currentParam = newParam;
        if (isIntersecting && !cancelled) {
          render();
        }
      },
      destroy() {
        cancelled = true;
        observer?.disconnect();
      },
    };
  }

  // Text selection handler triggered specifically on mouseup within the reader viewport
  function handleViewportMouseUp(e: MouseEvent) {
    if ((e.target as HTMLElement).closest(".lookup-card")) return;
    clearTimeout(selectionDebounceTimer);
    selectionDebounceTimer = setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;

      const text = selection.toString().trim();
      if (!text || text.length === 0) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      let sentence = "";
      try {
        const fullNodeText = range.startContainer.textContent || "";
        sentence = fullNodeText.trim();
      } catch (e) {
        sentence = text;
      }

      let detectedPage = appState.currentPage;
      try {
        const startNode = range.startContainer;
        const parentEl = (startNode instanceof HTMLElement ? startNode : startNode.parentElement) as HTMLElement | null;
        const pageEl = parentEl?.closest("[data-page]");
        if (pageEl) {
          const p = parseInt(pageEl.getAttribute("data-page") || "0", 10);
          if (p > 0) detectedPage = p;
        }
      } catch (err) {}

      appState.selectedText = text;
      appState.selectedSentence = sentence || text;
      appState.selectedPage = detectedPage;
      appState.selectionRect = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
      appState.lookupCardVisible = true;
    }, 120);
  }

  function handleViewportClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest(".lookup-card")) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      appState.lookupCardVisible = false;
    }
  }

  // Keyboard controls
  function handleKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
      e.preventDefault();
      flipNext();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      flipPrev();
    } else if (e.key === "Escape") {
      if (appState.lookupCardVisible) {
        appState.lookupCardVisible = false;
        window.getSelection()?.removeAllRanges();
        return;
      }
      if (appState.memoryDrawerOpen) {
        appState.memoryDrawerOpen = false;
        return;
      }
      if (appState.isFullscreen) {
        appState.exitFullscreen();
        return;
      }
      window.getSelection()?.removeAllRanges();
    }
  }

  let isProgrammaticScroll = false;
  let programmaticScrollTimer: any = null;
  let scrollSaveTimer: any = null;
  let pageObserver: IntersectionObserver | null = null;

  // Realtime scroll handler to update page indicator in TopBar and persist progress
  function handleScroll() {
    if (isProgrammaticScroll || appState.readingMode !== "scroll") return;
    const scrollEl = containerEl || scrollContainerEl;
    if (!scrollEl) return;
    const containerRect = scrollEl.getBoundingClientRect();
    const probeY = containerRect.top + Math.min(220, containerRect.height * 0.35);

    const pages = scrollEl.querySelectorAll<HTMLElement>(".scroll-page-item");
    for (const page of pages) {
      const rect = page.getBoundingClientRect();
      if (rect.top <= probeY && rect.bottom >= probeY) {
        const p = Number(page.dataset.page);
        if (p && p !== appState.currentPage) {
          appState.currentPage = p;
          clearTimeout(scrollSaveTimer);
          scrollSaveTimer = setTimeout(() => {
            if (appState.activeBook) {
              api.saveProgress(appState.activeBook.id, p, appState.zoom).catch(console.error);
            }
          }, 350);
        }
        break;
      }
    }
  }

  // IntersectionObserver for scroll page tracking
  $effect(() => {
    if (appState.readingMode !== "scroll" || !containerEl || !appState.pageCount) {
      pageObserver?.disconnect();
      pageObserver = null;
      return;
    }

    pageObserver?.disconnect();
    if (typeof IntersectionObserver !== "undefined") {
      pageObserver = new IntersectionObserver(
        (entries) => {
          if (isProgrammaticScroll) return;
          let bestEntry: IntersectionObserverEntry | null = null;
          for (const entry of entries) {
            if (entry.isIntersecting) {
              if (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio) {
                bestEntry = entry;
              }
            }
          }
          if (bestEntry && bestEntry.target) {
            const p = Number((bestEntry.target as HTMLElement).dataset.page);
            if (p && p !== appState.currentPage) {
              appState.currentPage = p;
              clearTimeout(scrollSaveTimer);
              scrollSaveTimer = setTimeout(() => {
                if (appState.activeBook) {
                  api.saveProgress(appState.activeBook.id, p, appState.zoom).catch(console.error);
                }
              }, 350);
            }
          }
        },
        {
          root: containerEl,
          threshold: [0.15, 0.4, 0.7],
        }
      );

      const items = containerEl.querySelectorAll(".scroll-page-item");
      items.forEach((item) => pageObserver?.observe(item));
    }

    return () => {
      pageObserver?.disconnect();
      pageObserver = null;
    };
  });

  // Reactive effect for re-rendering on zoom, fit mode, or reading mode change
  $effect(() => {
    if (pdfViewer && appState.currentPage) {
      const _mode = appState.readingMode;

      if (_mode === "single") {
        renderSinglePage();
      } else if (_mode === "dual") {
        renderDualPages();
      }
    }
  });

  // Dedicated effect for jump events (from thumbnails, outline, Book Memory, or page input)
  $effect(() => {
    const jump = appState.jumpEvent;
    if (!jump || !pdfViewer) return;

    if (appState.readingMode === "single") {
      renderSinglePage();
    } else if (appState.readingMode === "dual") {
      renderDualPages();
    } else if (appState.readingMode === "scroll" && scrollContainerEl) {
      const targetPageEl = scrollContainerEl.querySelector(`[data-page="${jump.page}"]`) as HTMLElement | null;
      if (targetPageEl) {
        isProgrammaticScroll = true;
        clearTimeout(programmaticScrollTimer);
        targetPageEl.scrollIntoView({ behavior: "smooth", block: "start" });
        programmaticScrollTimer = setTimeout(() => {
          isProgrammaticScroll = false;
        }, 800);
      }
    }
  });

  // Flash text effect when jumping to a saved word or note
  // Flash text effect when jumping to a saved word or note from Book Memory
  $effect(() => {
    const target = appState.flashTargetText;
    if (!target) return;

    let attempts = 0;
    let timerId: any = null;

    const findAndSpotlight = () => {
      attempts++;
      const lower = target.trim().toLowerCase().slice(0, 70);
      if (!lower) return;

      const textLayers = document.querySelectorAll(".textLayer");
      let found = false;

      for (const tl of textLayers) {
        // Search both spans and marks
        const candidates = tl.querySelectorAll<HTMLElement>("mark.pdf-highlight-mark, span");
        for (const el of candidates) {
          const elText = (el.textContent || "").toLowerCase();
          if (elText && (elText.includes(lower) || (lower.includes(elText) && elText.length >= 4))) {
            el.classList.add("flash-highlight");
            el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
            found = true;
            setTimeout(() => {
              el.classList.remove("flash-highlight");
            }, 3200);
            break;
          }
        }
        if (found) break;
      }

      if (!found && attempts < 6) {
        timerId = setTimeout(findAndSpotlight, 140);
      }
    };

    timerId = setTimeout(findAndSpotlight, 120);

    return () => clearTimeout(timerId);
  });

  // Re-apply highlights whenever appState.highlights updates (e.g. user adds or deletes a highlight)
  $effect(() => {
    const highlights = appState.highlights;
    if (appState.readingMode === "single" && singleTextLayerEl) {
      applyHighlightsToTextLayer(singleTextLayerEl, appState.currentPage, highlights, onHighlightClick);
    } else if (appState.readingMode === "dual") {
      if (leftTextLayerEl && dualLeftPage) {
        applyHighlightsToTextLayer(leftTextLayerEl, dualLeftPage, highlights, onHighlightClick);
      }
      if (rightTextLayerEl && dualRightPage) {
        applyHighlightsToTextLayer(rightTextLayerEl, dualRightPage, highlights, onHighlightClick);
      }
    } else if (appState.readingMode === "scroll" && scrollContainerEl) {
      const items = scrollContainerEl.querySelectorAll(".scroll-page-item");
      items.forEach((item) => {
        const page = Number((item as HTMLElement).dataset.page);
        const textLayer = item.querySelector(".textLayer") as HTMLElement | null;
        if (page && textLayer) {
          applyHighlightsToTextLayer(textLayer, page, highlights, onHighlightClick);
        }
      });
    }
  });

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);

    if (containerEl && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        if (appState.fitMode !== "custom") {
          if (appState.readingMode === "single") {
            renderSinglePage();
          } else if (appState.readingMode === "dual") {
            renderDualPages();
          }
        }
      });
      resizeObserver.observe(containerEl);
    }
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeyDown);
    resizeObserver?.disconnect();
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="reader-viewport"
  bind:this={containerEl}
  onscroll={handleScroll}
  onmouseup={handleViewportMouseUp}
  onclick={handleViewportClick}
  role="region"
  aria-label="PDF Document Viewport"
>
  <!-- MODE 1: Single Page Reading -->
  {#if appState.readingMode === "single"}
    <div class="single-page-wrapper">
      <div class="page-container" class:flipping={isFlipping} data-page={appState.currentPage}>
        <canvas bind:this={singleCanvasEl} class="pdf-canvas"></canvas>
        <div bind:this={singleTextLayerEl} class="textLayer"></div>
      </div>
    </div>

  <!-- MODE 2: Two Pages in Parallel (Book Mode with 3D Page Flip Animation) -->
  {:else if appState.readingMode === "dual"}
    <div class="book-spread-container" class:page-flip-next={isFlipping && flipDirection === 'next'} class:page-flip-prev={isFlipping && flipDirection === 'prev'}>
      <!-- Left Page Margins for navigation -->
      <button class="spread-nav-zone left-zone" onclick={flipPrev} title="Previous Page (Left Arrow)">
        <span class="nav-arrow">‹</span>
      </button>

      <!-- Book Spread Base -->
      <div class="book-spread">
        <!-- Left Page of Open Book -->
        <div class="book-leaf leaf-left">
          <div class="page-container dual-page left-page" data-page={dualLeftPage}>
            <canvas bind:this={leftCanvasEl} class="pdf-canvas"></canvas>
            <div bind:this={leftTextLayerEl} class="textLayer"></div>
          </div>
          <span class="leaf-page-tag">{dualLeftPage}</span>
        </div>

        <!-- Central Spine Gutter / Book Depth Shadow -->
        <div class="book-spine-gutter"></div>

        <!-- Right Page of Open Book -->
        <div class="book-leaf leaf-right">
          {#if dualRightPage}
            <div class="page-container dual-page right-page" data-page={dualRightPage}>
              <canvas bind:this={rightCanvasEl} class="pdf-canvas"></canvas>
              <div bind:this={rightTextLayerEl} class="textLayer"></div>
            </div>
            <span class="leaf-page-tag">{dualRightPage}</span>
          {:else}
            <div class="blank-page-end">
              <span>End of Document</span>
            </div>
          {/if}
        </div>

        <!-- 3D Flipping Page Simulation Overlay -->
        {#if isFlipping}
          <div class="flip-animation-leaf {flipDirection === 'next' ? 'flipping-next' : 'flipping-prev'}">
            <div class="flip-face flip-front"></div>
            <div class="flip-face flip-back"></div>
            <div class="flip-shadow"></div>
          </div>
        {/if}
      </div>

      <!-- Right Page Margins for navigation -->
      <button class="spread-nav-zone right-zone" onclick={flipNext} title="Next Page (Right Arrow)">
        <span class="nav-arrow">›</span>
      </button>
    </div>

  <!-- MODE 3: Continuous Free Vertical Scroll -->
  {:else if appState.readingMode === "scroll"}
    <div
      class="scroll-viewport"
      bind:this={scrollContainerEl}
      onscroll={handleScroll}
    >
      <div class="scroll-track">
        {#each Array(appState.pageCount) as _, i}
          {@const pageNum = i + 1}
          <div class="scroll-page-item" data-page={pageNum}>
            <div class="page-container scroll-page-container">
              <canvas use:renderScrollCanvas={{ pageNum, zoom: appState.zoom, fitMode: appState.fitMode }} class="pdf-canvas"></canvas>
              <div class="textLayer"></div>
            </div>
            <div class="scroll-page-label">
              <span>Page {pageNum} of {appState.pageCount}</span>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
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
    padding: 24px 16px;
    background-color: var(--pdf-bg);
    position: relative;
    user-select: text;
  }

  /* Single Page Mode */
  .single-page-wrapper {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100%;
    padding: 12px;
  }

  .page-container {
    position: relative;
    background: #ffffff;
    box-shadow: var(--shadow-lg);
    border-radius: 2px;
    margin: 0 auto;
    transition: transform 300ms ease, box-shadow 300ms ease;
  }

  .page-container.flipping {
    transform: scale(0.98) rotateY(-8deg);
  }

  .pdf-canvas {
    display: block;
    border-radius: 2px;
    transition: filter 250ms ease;
  }

  /* Dual Page Spread (Book Mode) */
  .book-spread-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    width: 100%;
    perspective: 2000px;
    position: relative;
    padding: 20px 0;
  }

  .spread-nav-zone {
    width: 50px;
    height: 80%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    opacity: 0;
    transition: opacity 200ms ease, background 200ms ease;
    z-index: 10;
  }

  .spread-nav-zone:hover {
    opacity: 1;
    background: rgba(0, 0, 0, 0.05);
  }

  .nav-arrow {
    font-size: 36px;
    font-weight: 300;
    color: var(--text-secondary);
  }

  .book-spread {
    display: flex;
    align-items: stretch;
    position: relative;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
    border-radius: 4px;
    transform-style: preserve-3d;
    background: #ffffff;
  }

  .book-leaf {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    background: #ffffff;
  }

  .leaf-left .page-container {
    box-shadow: inset -10px 0 20px rgba(0, 0, 0, 0.12);
    border-radius: 3px 0 0 3px;
  }

  .leaf-right .page-container {
    box-shadow: inset 10px 0 20px rgba(0, 0, 0, 0.12);
    border-radius: 0 3px 3px 0;
  }

  .leaf-page-tag {
    position: absolute;
    bottom: -22px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
  }

  .book-spine-gutter {
    width: 2px;
    background: linear-gradient(180deg, #999 0%, #444 50%, #999 100%);
    box-shadow: 0 0 12px rgba(0, 0, 0, 0.5);
    z-index: 5;
    position: relative;
  }

  .blank-page-end {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 450px;
    height: 600px;
    background: rgba(0, 0, 0, 0.03);
    color: var(--text-muted);
    font-size: 14px;
    font-style: italic;
  }

  /* 3D Page Flip Animation */
  .flip-animation-leaf {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 50%;
    transform-style: preserve-3d;
    z-index: 20;
    pointer-events: none;
  }

  .flip-animation-leaf.flipping-next {
    right: 0;
    transform-origin: left center;
    animation: flipNextAnim 420ms cubic-bezier(0.25, 1, 0.5, 1) forwards;
  }

  .flip-animation-leaf.flipping-prev {
    left: 0;
    transform-origin: right center;
    animation: flipPrevAnim 420ms cubic-bezier(0.25, 1, 0.5, 1) forwards;
  }

  @keyframes flipNextAnim {
    0% {
      transform: rotateY(0deg);
      box-shadow: -4px 0 14px rgba(0, 0, 0, 0.2);
    }
    50% {
      box-shadow: -12px 0 32px rgba(0, 0, 0, 0.35);
    }
    100% {
      transform: rotateY(-180deg);
      box-shadow: 4px 0 14px rgba(0, 0, 0, 0.1);
    }
  }

  @keyframes flipPrevAnim {
    0% {
      transform: rotateY(0deg);
      box-shadow: 4px 0 14px rgba(0, 0, 0, 0.2);
    }
    50% {
      box-shadow: 12px 0 32px rgba(0, 0, 0, 0.35);
    }
    100% {
      transform: rotateY(180deg);
      box-shadow: -4px 0 14px rgba(0, 0, 0, 0.1);
    }
  }

  .flip-face {
    position: absolute;
    inset: 0;
    backface-visibility: hidden;
    background: #ffffff;
  }

  .flip-front {
    background: linear-gradient(90deg, #f0ede6 0%, #ffffff 30%, #f7f4ed 100%);
  }

  .flip-back {
    transform: rotateY(180deg);
    background: linear-gradient(-90deg, #f0ede6 0%, #ffffff 30%, #f7f4ed 100%);
  }

  .flip-shadow {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, rgba(0, 0, 0, 0.15) 0%, transparent 60%);
    pointer-events: none;
  }

  /* Mode 3: Continuous Free Vertical Scroll */
  .scroll-viewport {
    width: 100%;
    display: flex;
    justify-content: center;
  }

  .scroll-track {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 36px;
    padding-bottom: 80px;
  }

  .scroll-page-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .scroll-page-container {
    min-height: 400px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .scroll-page-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
  }

  :global(.textLayer span.flash-highlight),
  :global(.textLayer span mark.flash-highlight) {
    background-color: #facc15 !important;
    color: #0f172a !important;
    border-radius: 4px !important;
    outline: 2px solid #ca8a04 !important;
    box-shadow: 0 0 22px 6px rgba(250, 204, 21, 0.95), 0 4px 12px rgba(0, 0, 0, 0.3) !important;
    animation: flashZoomPop 2.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards !important;
    opacity: 1 !important;
    z-index: 100 !important;
    display: inline-block !important;
    transform-origin: center center !important;
  }

  @keyframes flashZoomPop {
    0% {
      transform: scale(1);
      box-shadow: 0 0 0 0 rgba(250, 204, 21, 0.9);
      background-color: rgba(250, 204, 21, 0.3);
    }
    15% {
      transform: scale(1.22);
      box-shadow: 0 0 28px 8px rgba(250, 204, 21, 1);
      background-color: #facc15;
    }
    30% {
      transform: scale(1.05);
      box-shadow: 0 0 16px 4px rgba(250, 204, 21, 0.85);
    }
    45% {
      transform: scale(1.16);
      box-shadow: 0 0 24px 6px rgba(250, 204, 21, 0.9);
    }
    60% {
      transform: scale(1.02);
      box-shadow: 0 0 14px 3px rgba(250, 204, 21, 0.75);
    }
    80% {
      transform: scale(1.06);
      box-shadow: 0 0 18px 4px rgba(250, 204, 21, 0.8);
    }
    100% {
      transform: scale(1);
      box-shadow: 0 0 6px 1px rgba(250, 204, 21, 0.5);
      background-color: rgba(250, 204, 21, 0.45);
      outline: 1px solid rgba(202, 138, 4, 0.4);
    }
  }
</style>
