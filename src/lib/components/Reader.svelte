<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { appState } from "../stores/appState.svelte";
  import { api } from "../api";
  import { PDFViewer } from "../pdf/pdfViewer";
  import {
    applyHighlightsToAnnotationLayer,
    mergeLineRects,
    ANNOTATION_COLORS,
    getAnnotationColorName,
    isUnderlineAnnotation,
    type HighlightColor,
  } from "../pdf/highlights";
  import type { Highlight } from "../api";
  import "../styles/pdfTextLayer.css";

  let { pdfViewer = $bindable() }: { pdfViewer: PDFViewer | null } = $props();

  let containerEl: HTMLDivElement;
  let scrollContainerEl: HTMLDivElement | null = $state(null);
  let resizeObserver: ResizeObserver | null = null;
  let selectionDebounceTimer: any = null;

  // Single page canvas, annotationLayer & textLayer
  let singleCanvasEl = $state<HTMLCanvasElement>();
  let singleAnnotationLayerEl = $state<HTMLDivElement>();
  let singleTextLayerEl = $state<HTMLDivElement>();

  // Dual page canvases, annotationLayers & textLayers
  let leftCanvasEl = $state<HTMLCanvasElement>();
  let rightCanvasEl = $state<HTMLCanvasElement>();
  let leftAnnotationLayerEl = $state<HTMLDivElement>();
  let rightAnnotationLayerEl = $state<HTMLDivElement>();
  let leftTextLayerEl = $state<HTMLDivElement>();
  let rightTextLayerEl = $state<HTMLDivElement>();

  // 3D Flip animation state
  let isFlipping = $state(false);
  let flipDirection = $state<"next" | "prev">("next");
  let copyFeedback = $state<string | null>(null);

  function onHighlightClick(h: Highlight, clientRect?: DOMRect) {
    appState.activeHighlight = h;
    if (clientRect) {
      appState.activeHighlightRect = {
        top: clientRect.top,
        left: clientRect.left,
        width: clientRect.width,
        height: clientRect.height,
      };
    } else {
      appState.activeHighlightRect = null;
    }
  }

  async function handleUpdateHighlightColor(colorId: HighlightColor) {
    if (!appState.activeHighlight) return;
    const isUnderline = isUnderlineAnnotation(appState.activeHighlight.color);
    const newColor = isUnderline ? `underline-${colorId}` : colorId;
    try {
      await api.updateHighlightColor(appState.activeHighlight.id, newColor);
      appState.activeHighlight.color = newColor;
      if (appState.activeBook) {
        await appState.refreshBookMemory(appState.activeBook.id);
      }
    } catch (err) {
      console.error("Failed to update highlight color:", err);
    }
  }

  async function handleToggleHighlightType() {
    if (!appState.activeHighlight) return;
    const isUnderline = isUnderlineAnnotation(appState.activeHighlight.color);
    const baseColor = getAnnotationColorName(appState.activeHighlight.color);
    const newColor = isUnderline ? baseColor : `underline-${baseColor}`;
    try {
      await api.updateHighlightColor(appState.activeHighlight.id, newColor);
      appState.activeHighlight.color = newColor;
      if (appState.activeBook) {
        await appState.refreshBookMemory(appState.activeBook.id);
      }
    } catch (err) {
      console.error("Failed to toggle highlight type:", err);
    }
  }

  async function handleDeleteActiveHighlight() {
    if (!appState.activeHighlight) return;
    try {
      await api.deleteHighlight(appState.activeHighlight.id);
      appState.activeHighlight = null;
      appState.activeHighlightRect = null;
      if (appState.activeBook) {
        await appState.refreshBookMemory(appState.activeBook.id);
      }
    } catch (err) {
      console.error("Failed to delete highlight:", err);
    }
  }

  async function handleCopyHighlightText() {
    if (!appState.activeHighlight?.text) return;
    try {
      await navigator.clipboard.writeText(appState.activeHighlight.text);
      copyFeedback = "Copied!";
      setTimeout(() => {
        copyFeedback = null;
      }, 1500);
    } catch (err) {
      console.error("Failed to copy highlight text:", err);
    }
  }

  function handleOpenHighlightMemory() {
    appState.activeMemoryTab = "highlights";
    appState.memoryDrawerOpen = true;
    appState.activeHighlight = null;
  }

  let annotationBarStyle = $derived.by(() => {
    if (!appState.activeHighlightRect) return "display: none;";
    const r = appState.activeHighlightRect;
    const barWidth = 330;
    const barHeight = 44;
    let left = r.left + r.width / 2 - barWidth / 2;
    left = Math.max(12, Math.min(window.innerWidth - barWidth - 12, left));

    let top = r.top - barHeight - 8;
    if (top < 56) {
      top = r.top + r.height + 8;
    }
    return `top: ${Math.round(top)}px; left: ${Math.round(left)}px;`;
  });

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
      applyHighlightsToAnnotationLayer(singleAnnotationLayerEl, appState.currentPage, appState.highlights, onHighlightClick, singleTextLayerEl);
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
        applyHighlightsToAnnotationLayer(leftAnnotationLayerEl, dualLeftPage, appState.highlights, onHighlightClick, leftTextLayerEl);
      }
      if (rightCanvasEl && dualRightPage) {
        await pdfViewer.renderPage(dualRightPage, rightCanvasEl, rightTextLayerEl, scale);
        applyHighlightsToAnnotationLayer(rightAnnotationLayerEl, dualRightPage, appState.highlights, onHighlightClick, rightTextLayerEl);
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
        const annDiv = canvasNode.parentElement?.querySelector(".annotation-layer") as HTMLElement | null;
        applyHighlightsToAnnotationLayer(annDiv, currentParam.pageNum, appState.highlights, onHighlightClick, textDiv);
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

  // Text selection handler triggered on mouseup anywhere in the window
  function handleViewportMouseUp(e: MouseEvent) {
    if ((e.target as HTMLElement).closest(".lookup-card") || (e.target as HTMLElement).closest(".annotation-action-bar")) return;
    clearTimeout(selectionDebounceTimer);
    selectionDebounceTimer = setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;

      const text = selection.toString().trim();
      if (!text || text.length === 0) return;

      const range = selection.getRangeAt(0);
      if (!containerEl || !containerEl.contains(range.commonAncestorContainer)) return;

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
      let startNode = range.startContainer;
      let parentEl = (startNode instanceof HTMLElement ? startNode : startNode.parentElement) as HTMLElement | null;
      let pageEl = parentEl?.closest(".page-container");
      if (pageEl) {
        const p = parseInt(pageEl.getAttribute("data-page") || "0", 10);
        if (p > 0) detectedPage = p;
      }

      // Extract normalized rects for all selected lines
      let normalizedRects: { x: number; y: number; width: number; height: number }[] = [];
      if (pageEl) {
        const pageRect = pageEl.getBoundingClientRect();
        if (pageRect.width > 0 && pageRect.height > 0) {
          const clientRects = Array.from(range.getClientRects());
          const raw = clientRects
            .filter((r) => r.width > 1 && r.height > 1 && r.bottom > pageRect.top && r.top < pageRect.bottom)
            .map((r) => ({
              x: Math.max(0, Math.min(1, (r.left - pageRect.left) / pageRect.width)),
              y: Math.max(0, Math.min(1, (r.top - pageRect.top) / pageRect.height)),
              width: Math.max(0, Math.min(1, r.width / pageRect.width)),
              height: Math.max(0, Math.min(1, r.height / pageRect.height)),
            }));
          normalizedRects = mergeLineRects(raw);
        }
      }

      appState.selectedText = text;
      appState.selectedSentence = sentence || text;
      appState.selectedPage = detectedPage;
      appState.selectionNormalizedRects = normalizedRects;
      appState.selectionRect = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
      appState.activeHighlight = null;
      appState.lookupCardVisible = true;
    }, 80);
  }

  function handleViewportMouseDown(e: MouseEvent) {
    if ((e.target as HTMLElement).closest(".lookup-card") || (e.target as HTMLElement).closest(".annotation-action-bar")) return;
    appState.lookupCardVisible = false;
    appState.activeHighlight = null;
    appState.activeHighlightRect = null;
  }

  function handleViewportClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest(".lookup-card") || (e.target as HTMLElement).closest(".annotation-action-bar")) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      appState.lookupCardVisible = false;
    }

    // Check if user clicked an existing annotation
    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    const annotationRectEl = elements.find((el) => el.classList.contains("pdf-annotation-rect")) as HTMLElement | undefined;
    if (annotationRectEl && annotationRectEl.dataset.highlightId) {
      const hId = Number(annotationRectEl.dataset.highlightId);
      const found = appState.highlights.find((h) => h.id === hId);
      if (found) {
        const r = annotationRectEl.getBoundingClientRect();
        onHighlightClick(found, r);
      }
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
    if (appState.readingMode === "single" && singleAnnotationLayerEl) {
      applyHighlightsToAnnotationLayer(singleAnnotationLayerEl, appState.currentPage, highlights, onHighlightClick);
    } else if (appState.readingMode === "dual") {
      if (leftAnnotationLayerEl && dualLeftPage) {
        applyHighlightsToAnnotationLayer(leftAnnotationLayerEl, dualLeftPage, highlights, onHighlightClick);
      }
      if (rightAnnotationLayerEl && dualRightPage) {
        applyHighlightsToAnnotationLayer(rightAnnotationLayerEl, dualRightPage, highlights, onHighlightClick);
      }
    } else if (appState.readingMode === "scroll" && scrollContainerEl) {
      const items = scrollContainerEl.querySelectorAll(".scroll-page-item");
      items.forEach((item) => {
        const page = Number((item as HTMLElement).dataset.page);
        const annotationLayer = item.querySelector(".annotation-layer") as HTMLElement | null;
        if (page && annotationLayer) {
          applyHighlightsToAnnotationLayer(annotationLayer, page, highlights, onHighlightClick);
        }
      });
    }
  });

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mouseup", handleViewportMouseUp);
    window.addEventListener("mousedown", handleViewportMouseDown);

    if (containerEl && typeof ResizeObserver !== "undefined") {
      let resizeTimer: any = null;
      resizeObserver = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (appState.fitMode !== "custom") {
            if (appState.readingMode === "single") {
              renderSinglePage();
            } else if (appState.readingMode === "dual") {
              renderDualPages();
            }
          }
        }, 120);
      });
      resizeObserver.observe(containerEl);
    }
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("mouseup", handleViewportMouseUp);
    window.removeEventListener("mousedown", handleViewportMouseDown);
    resizeObserver?.disconnect();
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="reader-viewport"
  bind:this={containerEl}
  onscroll={handleScroll}
  onmousedown={handleViewportMouseDown}
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
        <div bind:this={singleAnnotationLayerEl} class="annotation-layer"></div>
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
            <div bind:this={leftAnnotationLayerEl} class="annotation-layer"></div>
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
              <div bind:this={rightAnnotationLayerEl} class="annotation-layer"></div>
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
            <div class="page-container scroll-page-container" data-page={pageNum}>
              <canvas use:renderScrollCanvas={{ pageNum, zoom: appState.zoom, fitMode: appState.fitMode }} class="pdf-canvas"></canvas>
              <div class="annotation-layer"></div>
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

  {#if appState.activeHighlight && appState.activeHighlightRect}
    {@const isUnderline = isUnderlineAnnotation(appState.activeHighlight.color)}
    {@const currentColor = getAnnotationColorName(appState.activeHighlight.color)}
    <div
      class="annotation-action-bar"
      style="top: {Math.max(12, appState.activeHighlightRect.top - 54)}px; left: {Math.max(16, Math.min(window.innerWidth - 320, appState.activeHighlightRect.left + appState.activeHighlightRect.width / 2 - 140))}px;"
      onclick={(e) => e.stopPropagation()}
      role="toolbar"
      tabindex="-1"
      aria-label="Annotation Actions"
    >
      <div class="action-bar-colors">
        {#each ANNOTATION_COLORS as col}
          <button
            class="action-color-dot {col.id} {currentColor === col.id ? 'active' : ''}"
            style="background: {col.color};"
            title={col.label}
            onclick={() => handleUpdateHighlightColor(col.id)}
          ></button>
        {/each}
      </div>

      <div class="action-bar-divider"></div>

      <button
        class="action-btn toggle-type-btn {isUnderline ? 'is-underline' : 'is-highlight'}"
        title={isUnderline ? "Switch to Highlight" : "Switch to Underline"}
        onclick={handleToggleHighlightType}
      >
        {#if isUnderline}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5 4v3h5.5v12h3V7H19V4z"/>
          </svg>
          <span>Highlight</span>
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 3v7a6 6 0 0 0 12 0V3M4 21h16"/>
          </svg>
          <span>Underline</span>
        {/if}
      </button>

      <button class="action-btn copy-btn" title="Copy Text" onclick={handleCopyHighlightText}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span>{copyFeedback || "Copy"}</span>
      </button>

      <button class="action-btn delete-btn" title="Delete Annotation" onclick={handleDeleteActiveHighlight}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
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

  /* Floating Annotation Action Bar */
  .annotation-action-bar {
    position: fixed;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(24, 24, 30, 0.92);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 9999px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.25);
    animation: popIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    user-select: none;
  }

  @keyframes popIn {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .action-bar-colors {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .action-color-dot {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid rgba(255, 255, 255, 0.3);
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    padding: 0;
  }

  .action-color-dot:hover {
    transform: scale(1.25);
  }

  .action-color-dot.active {
    box-shadow: 0 0 0 2px #ffffff, 0 0 8px rgba(255, 255, 255, 0.5);
    transform: scale(1.15);
  }

  .action-bar-divider {
    width: 1px;
    height: 18px;
    background: rgba(255, 255, 255, 0.18);
    margin: 0 2px;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.85);
    font-size: 12px;
    font-weight: 500;
    padding: 4px 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
  }

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  .action-btn:active {
    transform: scale(0.96);
  }

  .action-btn.delete-btn {
    color: #f87171;
    padding: 4px 6px;
  }

  .action-btn.delete-btn:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
  }

  @media (max-width: 600px) {
    .annotation-action-bar {
      padding: 5px 8px;
      gap: 5px;
    }
    .action-btn span {
      display: none;
    }
    .action-color-dot {
      width: 15px;
      height: 15px;
    }
  }
</style>
