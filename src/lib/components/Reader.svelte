<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import { appState } from "../stores/appState.svelte";
  import { PDFViewer } from "../pdf/pdfViewer";
  import {
    applyHighlightsToAnnotationLayer,
    mergeLineRects,
    spotlightText,
    ANNOTATION_COLORS,
    getAnnotationColorName,
    isUnderlineAnnotation,
    type HighlightColor,
  } from "../pdf/highlights";
  import { pruneDetachedTextLayers } from "../pdf/textSelection";
  import { buildSearchRegex, findInTextLayer } from "../pdf/search";
  import { formatDuration } from "../format";
  import { cleanLookupTerm, extractSentence, normalizeSelectedText } from "../pdf/selectionText";
  import Icon from "./Icon.svelte";
  import type { Highlight } from "../api";
  import "../styles/pdfTextLayer.css";

  let { pdfViewer = $bindable() }: { pdfViewer: PDFViewer | null } = $props();

  let containerEl: HTMLDivElement;
  let resizeObserver: ResizeObserver | null = null;
  let selectionTimer: any = null;

  // Single page canvas, annotation layer & text layer
  let singleCanvasEl = $state<HTMLCanvasElement>();
  let singleAnnotationLayerEl = $state<HTMLDivElement>();
  let singleTextLayerEl = $state<HTMLDivElement>();

  // Dual page canvases, annotation layers & text layers
  let leftCanvasEl = $state<HTMLCanvasElement>();
  let rightCanvasEl = $state<HTMLCanvasElement>();
  let leftAnnotationLayerEl = $state<HTMLDivElement>();
  let rightAnnotationLayerEl = $state<HTMLDivElement>();
  let leftTextLayerEl = $state<HTMLDivElement>();
  let rightTextLayerEl = $state<HTMLDivElement>();

  // Page-turn animation state (dual mode)
  let isFlipping = $state(false);
  let flipDirection = $state<"next" | "prev">("next");
  let copyFeedback = $state(false);

  // Unscaled page sizes, so scroll mode can reserve space before pages render
  let pageSizes = $state<{ width: number; height: number }[]>([]);

  $effect(() => {
    const viewer = pdfViewer;
    pageSizes = [];
    if (!viewer) return;
    viewer.getPageSizes().then((sizes) => {
      if (pdfViewer === viewer) pageSizes = sizes;
    });
  });

  // ---------------------------------------------------------------------------
  // Layout & scale
  // ---------------------------------------------------------------------------

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

  const PAGE_GUTTER = 48;

  /** Scale for the current fit mode. Synchronous, so effects track what it reads. */
  function computeScale(pageNum: number, isDual = false): number {
    if (appState.fitMode === "custom") return appState.zoom;
    const size = pageSizes[pageNum - 1] ?? pageSizes[0];
    const width = appState.readerWidth;
    const height = appState.readerHeight;
    if (!size || width <= 100) return appState.zoom;

    let scale: number;
    if (appState.fitMode === "width") {
      const available = width - (isDual ? PAGE_GUTTER * 2 + 16 : PAGE_GUTTER);
      scale = isDual ? available / 2 / size.width : available / size.width;
      // Don't blow small-format pages up absurdly on wide monitors
      scale = Math.min(scale, 2.2);
    } else {
      const available = height - 56;
      scale = Math.min(available / size.height, (width - (isDual ? 96 : PAGE_GUTTER)) / ((isDual ? 2 : 1) * size.width));
    }
    return Math.max(0.3, Math.min(3, Number(scale.toFixed(3))));
  }

  /** Scroll mode uses one scale for all pages, fitted to the widest page. */
  let widestPage = $derived.by(() => {
    let best = 0;
    pageSizes.forEach((s, i) => {
      if (s.width > (pageSizes[best]?.width ?? 0)) best = i;
    });
    return best + 1;
  });
  let scrollScale = $derived(computeScale(widestPage, false));

  // Reflect fitted scale in the zoom indicator
  $effect(() => {
    if (appState.fitMode === "custom" || pageSizes.length === 0) return;
    const mode = appState.layoutMode;
    const scale =
      mode === "scroll"
        ? scrollScale
        : computeScale(mode === "dual" ? dualLeftPage : appState.currentPage || 1, mode === "dual");
    untrack(() => {
      if (Math.abs(appState.zoom - scale) > 0.001) appState.zoom = Number(scale.toFixed(2));
    });
  });

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  async function renderInto(
    pageNum: number,
    canvas: HTMLCanvasElement | undefined,
    textLayer: HTMLDivElement | undefined,
    annotationLayer: HTMLDivElement | undefined,
    scale: number
  ): Promise<void> {
    if (!pdfViewer?.doc || !canvas) return;
    try {
      await pdfViewer.renderPage(pageNum, canvas, textLayer, scale);
      applyHighlightsToAnnotationLayer(annotationLayer, pageNum, appState.highlights, undefined, textLayer);
      drawSearchHits(pageNum, textLayer, annotationLayer);
      renderLinks(pageNum, canvas.parentElement);
    } catch (err: any) {
      if (err?.name !== "RenderingCancelledException") {
        console.error(`Render error on page ${pageNum}:`, err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Zoom: live pinch preview & keeping the reading position centred
  // ---------------------------------------------------------------------------

  /** Scale the paged canvases are currently rendered at (what is on screen). */
  let renderedScale = $state(0);

  function captureCenter() {
    if (!containerEl) return null;
    const el = containerEl;
    return {
      fx: (el.scrollLeft + el.clientWidth / 2) / Math.max(1, el.scrollWidth),
      fy: (el.scrollTop + el.clientHeight / 2) / Math.max(1, el.scrollHeight),
    };
  }

  function restoreCenter(c: { fx: number; fy: number } | null) {
    if (!c || !containerEl) return;
    const el = containerEl;
    el.scrollLeft = c.fx * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = c.fy * el.scrollHeight - el.clientHeight / 2;
  }

  // CSS-only preview while a pinch / ctrl+scroll gesture is running
  let previewTransform = $derived.by(() => {
    const target = appState.pinchZoom;
    if (target == null) return "";
    const base = appState.layoutMode === "scroll" ? scrollScale : renderedScale || appState.zoom;
    const k = target / base;
    if (Math.abs(k - 1) < 0.001 || !containerEl) return "";
    const ox = containerEl.scrollLeft + containerEl.clientWidth / 2;
    const oy = containerEl.scrollTop + containerEl.clientHeight / 2;
    return `transform: scale(${k.toFixed(4)}); transform-origin: ${ox}px ${oy}px;`;
  });

  // Paged modes: re-render whenever page, mode, size or zoom changes
  let lastPaged = { key: "", scale: 0 };
  let renderSeq = 0;
  $effect(() => {
    if (!pdfViewer || pageSizes.length === 0) return;
    const mode = appState.layoutMode;
    if (mode === "scroll") return;
    const seq = ++renderSeq;
    const page = mode === "dual" ? dualLeftPage : appState.currentPage;
    const right = dualRightPage;
    const scale = computeScale(page, mode === "dual");
    const key = `${mode}:${page}`;

    // Same pages at a new zoom: keep the spot the reader was looking at centred
    const center = untrack(() => (key === lastPaged.key && scale !== lastPaged.scale ? captureCenter() : null));
    lastPaged = { key, scale };

    const renders =
      mode === "single"
        ? [renderInto(page, singleCanvasEl, singleTextLayerEl, singleAnnotationLayerEl, scale)]
        : [
            renderInto(page, leftCanvasEl, leftTextLayerEl, leftAnnotationLayerEl, scale),
            right ? renderInto(right, rightCanvasEl, rightTextLayerEl, rightAnnotationLayerEl, scale) : Promise.resolve(),
          ];
    Promise.all(renders).then(() => {
      if (seq !== renderSeq) return;
      renderedScale = scale;
      if (!appState.pinchActive && appState.pinchZoom != null && Math.abs(appState.pinchZoom - scale) < 0.01) {
        appState.pinchZoom = null;
      }
      restoreCenter(center);
    });
    untrack(() => pruneDetachedTextLayers());
  });

  // Scroll mode: page boxes resize immediately with the scale, so re-centre right away
  let prevScrollScale = 0;
  let pendingScrollCenter: { fx: number; fy: number } | null = null;
  $effect.pre(() => {
    const s = scrollScale;
    if (appState.layoutMode !== "scroll") {
      prevScrollScale = 0;
      return;
    }
    if (prevScrollScale && s !== prevScrollScale) pendingScrollCenter = untrack(captureCenter);
    prevScrollScale = s;
  });
  $effect(() => {
    scrollScale;
    if (appState.layoutMode !== "scroll") return;
    untrack(() => {
      if (pendingScrollCenter) {
        isProgrammaticScroll = true;
        restoreCenter(pendingScrollCenter);
        pendingScrollCenter = null;
        setTimeout(() => (isProgrammaticScroll = false), 60);
      }
      if (!appState.pinchActive && appState.pinchZoom != null && Math.abs(appState.pinchZoom - scrollScale) < 0.01) {
        appState.pinchZoom = null;
      }
    });
  });

  // Two-finger pinch on touchscreens
  const touches = new Map<number, { x: number; y: number }>();
  let touchStartDistance = 0;

  function touchDistance() {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function handleTouchPointerDown(e: PointerEvent) {
    if (e.pointerType !== "touch") return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      touchStartDistance = touchDistance();
      appState.beginPinch();
    }
  }

  function handleTouchPointerMove(e: PointerEvent) {
    if (e.pointerType !== "touch" || !touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2 && touchStartDistance > 0) {
      appState.updatePinch(touchDistance() / touchStartDistance);
    }
  }

  function handleTouchPointerUp(e: PointerEvent) {
    if (e.pointerType !== "touch") return;
    touches.delete(e.pointerId);
    if (touches.size < 2 && touchStartDistance > 0) {
      touchStartDistance = 0;
      appState.endPinch();
    }
  }

  // Continuous scroll: render pages near the viewport and free pages far away
  function scrollPage(node: HTMLElement, param: { pageNum: number; scale: number }) {
    let current = param;
    let near = false;
    let renderedScale = 0;
    const canvas = node.querySelector("canvas") as HTMLCanvasElement;
    const textLayer = node.querySelector(".textLayer") as HTMLDivElement;
    const annotationLayer = node.querySelector(".annotation-layer") as HTMLDivElement;

    const render = () => {
      if (!near || !pdfViewer) return;
      if (renderedScale === current.scale) return;
      renderedScale = current.scale;
      renderInto(current.pageNum, canvas, textLayer, annotationLayer, current.scale);
    };

    const release = () => {
      if (renderedScale === 0) return;
      renderedScale = 0;
      pdfViewer?.releaseCanvas(canvas);
      textLayer.replaceChildren();
      annotationLayer.replaceChildren();
      node.querySelector(".link-layer")?.replaceChildren();
    };

    const root = node.closest(".reader-viewport");
    const renderObserver = new IntersectionObserver(
      (entries) => {
        near = entries[0].isIntersecting;
        render();
      },
      { root, rootMargin: "600px 0px" }
    );
    const releaseObserver = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) release();
      },
      { root, rootMargin: "3000px 0px" }
    );
    renderObserver.observe(node);
    releaseObserver.observe(node);

    return {
      update(next: { pageNum: number; scale: number }) {
        current = next;
        render();
      },
      destroy() {
        renderObserver.disconnect();
        releaseObserver.disconnect();
        release();
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Search hits
  // ---------------------------------------------------------------------------

  let pendingSearchScroll = false;

  function drawSearchHits(pageNum: number, textLayer?: HTMLElement, annotationLayer?: HTMLElement) {
    if (!textLayer || !annotationLayer) return;
    annotationLayer.querySelectorAll(".pdf-search-hit").forEach((el) => el.remove());
    if (!appState.searchOpen) return;
    const regex = buildSearchRegex(appState.searchQuery);
    if (!regex || appState.searchQuery.trim().length < 2) return;
    const pageEl = annotationLayer.closest(".page-container") as HTMLElement | null;
    if (!pageEl) return;
    const pageRect = pageEl.getBoundingClientRect();
    if (pageRect.width === 0) return;

    const current = appState.searchMatches[appState.searchIndex];
    const perMatch = findInTextLayer(textLayer, regex);
    perMatch.forEach((rects, k) => {
      const isCurrent = current?.page === pageNum && current.indexOnPage === k;
      const normalized = mergeLineRects(
        rects.map((r) => ({
          x: (r.left - pageRect.left) / pageRect.width,
          y: (r.top - pageRect.top) / pageRect.height,
          width: r.width / pageRect.width,
          height: r.height / pageRect.height,
        }))
      );
      normalized.forEach((r, i) => {
        const box = document.createElement("div");
        box.className = isCurrent ? "pdf-search-hit current" : "pdf-search-hit";
        box.style.left = `${(r.x * 100).toFixed(3)}%`;
        box.style.top = `${(r.y * 100).toFixed(3)}%`;
        box.style.width = `${(r.width * 100).toFixed(3)}%`;
        box.style.height = `${(r.height * 100).toFixed(3)}%`;
        annotationLayer.appendChild(box);
        if (isCurrent && i === 0 && pendingSearchScroll) {
          pendingSearchScroll = false;
          // Defer so it wins over the page-level scroll of the jump itself
          setTimeout(() => box.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" }), 40);
        }
      });
    });
  }

  function redrawSearchHits() {
    containerEl?.querySelectorAll<HTMLElement>(".page-container").forEach((pageEl) => {
      const page = Number(pageEl.dataset.page);
      const textLayer = pageEl.querySelector(".textLayer") as HTMLElement | null;
      const annotationLayer = pageEl.querySelector(".annotation-layer") as HTMLElement | null;
      if (page && textLayer?.querySelector("span") && annotationLayer) drawSearchHits(page, textLayer, annotationLayer);
    });
  }

  $effect(() => {
    appState.searchOpen;
    appState.searchQuery;
    appState.searchMatches;
    appState.searchIndex;
    untrack(() => {
      pendingSearchScroll = appState.searchIndex >= 0;
      redrawSearchHits();
    });
  });

  // ---------------------------------------------------------------------------
  // Links inside the PDF
  // ---------------------------------------------------------------------------

  async function renderLinks(pageNum: number, pageEl: HTMLElement | null) {
    if (!pdfViewer || !pageEl) return;
    let layer = pageEl.querySelector(".link-layer") as HTMLElement | null;
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "link-layer";
      pageEl.appendChild(layer);
    }
    const links = await pdfViewer.getLinks(pageNum).catch(() => []);
    if (Number(pageEl.dataset.page) !== pageNum) return;
    layer.replaceChildren(
      ...links.map((link) => {
        const a = document.createElement("a");
        a.className = "pdf-link";
        a.style.left = `${link.x * 100}%`;
        a.style.top = `${link.y * 100}%`;
        a.style.width = `${link.width * 100}%`;
        a.style.height = `${link.height * 100}%`;
        a.href = link.url ?? "#";
        a.title = link.url ?? `Go to page ${link.page}`;
        a.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (link.page) appState.jumpToPage(link.page, undefined, true);
          else if (link.url) openExternal(link.url);
        };
        return a;
      })
    );
  }

  async function openExternal(url: string) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener");
    }
  }

  // ---------------------------------------------------------------------------
  // Reading status (page, time left) shown briefly after each page change
  // ---------------------------------------------------------------------------

  let statusVisible = $state(false);
  let statusTimer: any = null;

  $effect(() => {
    appState.currentPage;
    if (!pdfViewer) return;
    statusVisible = true;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (statusVisible = false), 2600);
  });

  let statusText = $derived.by(() => {
    const page = appState.currentPage;
    const perPage = appState.secondsPerPage;
    const chapterEnd = appState.chapterEndFor(page);
    const bookLeft = (appState.pageCount - page) * perPage;
    const parts = [`${page} of ${appState.pageCount}`];
    if (appState.outlineFlat.length > 0 && chapterEnd >= page && chapterEnd < appState.pageCount) {
      parts.push(`${formatDuration((chapterEnd - page + 1) * perPage)} left in chapter`);
    } else if (bookLeft > 0) {
      parts.push(`${formatDuration(bookLeft)} left in book`);
    } else {
      parts.push("Last page");
    }
    return parts.join(" · ");
  });

  // Re-apply annotations when highlights change (add / recolor / delete)
  $effect(() => {
    const highlights = appState.highlights;
    const mode = appState.layoutMode;
    untrack(() => {
      if (mode === "single") {
        applyHighlightsToAnnotationLayer(singleAnnotationLayerEl, appState.currentPage, highlights);
      } else if (mode === "dual") {
        if (dualLeftPage) applyHighlightsToAnnotationLayer(leftAnnotationLayerEl, dualLeftPage, highlights);
        if (dualRightPage) applyHighlightsToAnnotationLayer(rightAnnotationLayerEl, dualRightPage, highlights);
      } else if (containerEl) {
        containerEl.querySelectorAll<HTMLElement>(".scroll-page-item").forEach((item) => {
          const page = Number(item.dataset.page);
          const layer = item.querySelector(".annotation-layer") as HTMLElement | null;
          if (page && layer && item.querySelector(".textLayer span")) {
            applyHighlightsToAnnotationLayer(layer, page, highlights);
          }
        });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  function goNext() {
    const step = appState.pageStep;
    const target = appState.layoutMode === "dual" ? dualLeftPage + step : appState.currentPage + step;
    if (target > appState.pageCount) return;
    if (appState.layoutMode === "dual") {
      if (isFlipping) return;
      flipDirection = "next";
      isFlipping = true;
      setTimeout(() => {
        appState.jumpToPage(target);
        setTimeout(() => (isFlipping = false), 320);
      }, 150);
    } else {
      appState.jumpToPage(target);
    }
  }

  function goPrev() {
    const step = appState.pageStep;
    const target = appState.layoutMode === "dual" ? Math.max(1, dualLeftPage - step) : appState.currentPage - step;
    if (target < 1 || target === appState.currentPage) return;
    if (appState.layoutMode === "dual") {
      if (isFlipping) return;
      flipDirection = "prev";
      isFlipping = true;
      setTimeout(() => {
        appState.jumpToPage(target);
        setTimeout(() => (isFlipping = false), 320);
      }, 150);
    } else {
      appState.jumpToPage(target);
    }
  }

  function isTypingTarget(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (appState.settingsModalOpen || appState.reviewOpen || appState.shortcutsOpen || appState.searchOpen && isTypingTarget(document.activeElement)) return;

    const scrolling = appState.layoutMode === "scroll";
    if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && !scrolling && !e.shiftKey)) {
      if (scrolling && e.key === "PageDown") return; // native scrolling
      e.preventDefault();
      goNext();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp" || (e.key === " " && !scrolling && e.shiftKey)) {
      if (scrolling && e.key === "PageUp") return;
      e.preventDefault();
      goPrev();
    } else if (e.key === "Home" && !scrolling) {
      e.preventDefault();
      appState.jumpToPage(1);
    } else if (e.key === "End" && !scrolling) {
      e.preventDefault();
      appState.jumpToPage(appState.pageCount);
    }
  }

  // Scroll mode: jump requests scroll the target page into view
  let isProgrammaticScroll = false;
  let programmaticScrollTimer: any = null;
  let scrollSaveTimer: any = null;

  let handledJumpToken = 0;
  $effect(() => {
    const jump = appState.jumpEvent;
    if (!jump || jump.token === handledJumpToken) return;
    handledJumpToken = jump.token;
    untrack(() => {
      if (!pdfViewer || appState.layoutMode !== "scroll" || !containerEl) return;
      const target = containerEl.querySelector(`.scroll-page-item[data-page="${jump.page}"]`) as HTMLElement | null;
      if (!target) return;
      isProgrammaticScroll = true;
      clearTimeout(programmaticScrollTimer);
      const distance = Math.abs(target.offsetTop - containerEl.scrollTop);
      // Long jumps scroll instantly; smooth-scrolling across hundreds of pages is slow
      containerEl.scrollTo({ top: target.offsetTop - 16, behavior: distance > containerEl.clientHeight * 3 ? "auto" : "smooth" });
      programmaticScrollTimer = setTimeout(() => (isProgrammaticScroll = false), 700);
    });
  });

  // When switching into scroll mode, start at the current page
  $effect(() => {
    if (appState.layoutMode !== "scroll" || !containerEl || pageSizes.length === 0) return;
    untrack(() => {
      requestAnimationFrame(() => {
        const target = containerEl.querySelector(`.scroll-page-item[data-page="${appState.currentPage}"]`) as HTMLElement | null;
        if (target) {
          isProgrammaticScroll = true;
          containerEl.scrollTop = target.offsetTop - 16;
          setTimeout(() => (isProgrammaticScroll = false), 100);
        }
      });
    });
  });

  function handleScroll() {
    if (appState.activeHighlight) {
      appState.activeHighlight = null;
      appState.activeHighlightRect = null;
    }
    if (isProgrammaticScroll || appState.layoutMode !== "scroll" || !containerEl) return;

    const probeY = containerEl.getBoundingClientRect().top + containerEl.clientHeight * 0.35;
    for (const page of containerEl.querySelectorAll<HTMLElement>(".scroll-page-item")) {
      const rect = page.getBoundingClientRect();
      if (rect.top <= probeY && rect.bottom >= probeY) {
        const p = Number(page.dataset.page);
        if (p && p !== appState.currentPage) {
          appState.currentPage = p;
          clearTimeout(scrollSaveTimer);
          scrollSaveTimer = setTimeout(() => appState.saveCurrentProgress(p), 400);
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Selection -> lookup card
  // ---------------------------------------------------------------------------

  let pointerIsDown = false;
  let lastPointerType = "mouse";

  function isUiChrome(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    return !!el?.closest?.(".lookup-card, .annotation-action-bar");
  }

  function handlePointerDown(e: PointerEvent) {
    pointerIsDown = true;
    lastPointerType = e.pointerType;
    if (isUiChrome(e.target)) return;
    appState.activeHighlight = null;
    appState.activeHighlightRect = null;
    if (e.button === 0) appState.lookupCardVisible = false;
  }

  function handlePointerUp(e: PointerEvent) {
    pointerIsDown = false;
    handleTouchPointerUp(e);
    if (isUiChrome(e.target)) return;
    scheduleSelectionCheck(20);
  }

  function handleKeyUp(e: KeyboardEvent) {
    // Shift+Arrow keyboard selection
    if (e.shiftKey || e.key === "Shift") scheduleSelectionCheck(250);
  }

  function handleSelectionChange() {
    // Touch devices adjust selections with handles and may never fire pointerup on the text
    if (lastPointerType === "touch" && !pointerIsDown) scheduleSelectionCheck(500);
  }

  function scheduleSelectionCheck(delay: number) {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(readSelection, delay);
  }

  async function readSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    if (!containerEl || !containerEl.contains(range.commonAncestorContainer)) return;

    const rawText = selection.toString();
    const text = normalizeSelectedText(rawText);
    if (!text || !/[\p{L}\p{N}]/u.test(text)) return;

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const startEl = (range.startContainer instanceof HTMLElement ? range.startContainer : range.startContainer.parentElement) as HTMLElement | null;
    const pageEl = startEl?.closest(".page-container") as HTMLElement | null;
    let detectedPage = appState.currentPage;
    if (pageEl) {
      const p = parseInt(pageEl.dataset.page || "0", 10);
      if (p > 0) detectedPage = p;
    }

    // Normalized rects (0..1 of the page), merged into one box per visual line
    let normalizedRects: { x: number; y: number; width: number; height: number }[] = [];
    if (pageEl) {
      const pageRect = pageEl.getBoundingClientRect();
      if (pageRect.width > 0 && pageRect.height > 0) {
        const raw = Array.from(range.getClientRects())
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

    const fragment = range.startContainer.textContent || "";
    appState.selectedText = cleanLookupTerm(text);
    appState.selectedSentence = normalizeSelectedText(fragment) || text;
    appState.selectedPage = detectedPage;
    appState.selectionNormalizedRects = normalizedRects;
    appState.selectionRect = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    appState.activeHighlight = null;
    appState.lookupCardVisible = true;

    // Upgrade the context to the full sentence from the page text
    if (pdfViewer) {
      const selectedAt = appState.selectedText;
      try {
        const pageText = await pdfViewer.getPageText(detectedPage);
        if (appState.selectedText === selectedAt) {
          appState.selectedSentence = extractSentence(pageText, text, fragment);
        }
      } catch {
        // keep the fragment as context
      }
    }
  }

  function handleViewportClick(e: MouseEvent) {
    if (isUiChrome(e.target)) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return;

    // Annotation boxes sit under the text layer, so hit-test them manually
    const hit = document
      .elementsFromPoint(e.clientX, e.clientY)
      .find((el) => el.classList.contains("pdf-annotation-rect")) as HTMLElement | undefined;
    if (hit?.dataset.highlightId) {
      const found = appState.highlights.find((h) => h.id === Number(hit.dataset.highlightId));
      if (found) openAnnotationBar(found, hit);
    }
  }

  // ---------------------------------------------------------------------------
  // Spotlight when jumping from Book Memory
  // ---------------------------------------------------------------------------

  $effect(() => {
    const jump = appState.jumpEvent;
    const target = jump?.textToFlash;
    if (!jump || !target) return;

    let attempts = 0;
    let timer: any = null;
    const tryFind = () => {
      attempts++;
      const page = containerEl?.querySelector(`.page-container[data-page="${jump.page}"]`) as HTMLElement | null;
      const found = page ? spotlightText(page, target, appState.highlights) : false;
      if (!found && attempts < 20) timer = setTimeout(tryFind, 150);
    };
    timer = setTimeout(tryFind, 150);
    return () => clearTimeout(timer);
  });

  // ---------------------------------------------------------------------------
  // Annotation action bar
  // ---------------------------------------------------------------------------

  function openAnnotationBar(h: Highlight, anchor: HTMLElement) {
    // Use the union of all boxes of this annotation as the anchor
    const boxes = Array.from(
      anchor.parentElement?.querySelectorAll<HTMLElement>(`[data-highlight-id="${h.id}"]`) ?? [anchor]
    ).map((b) => b.getBoundingClientRect());
    const top = Math.min(...boxes.map((r) => r.top));
    const bottom = Math.max(...boxes.map((r) => r.bottom));
    const left = Math.min(...boxes.map((r) => r.left));
    const right = Math.max(...boxes.map((r) => r.right));
    appState.lookupCardVisible = false;
    appState.activeHighlight = h;
    appState.activeHighlightRect = { top, left, width: right - left, height: bottom - top };
  }

  let barWidth = $state(360);
  let annotationBarStyle = $derived.by(() => {
    const r = appState.activeHighlightRect;
    if (!r) return "display: none;";
    const vw = appState.windowWidth;
    const width = Math.min(barWidth, vw - 24);
    const left = Math.max(12, Math.min(vw - width - 12, r.left + r.width / 2 - width / 2));
    let top = r.top - 52;
    if (top < 60) top = r.top + r.height + 10;
    return `top: ${Math.round(top)}px; left: ${Math.round(left)}px;`;
  });

  function handleUpdateHighlightColor(colorId: HighlightColor) {
    const h = appState.activeHighlight;
    if (!h) return;
    appState.setHighlightColor(h.id, isUnderlineAnnotation(h.color) ? `underline-${colorId}` : colorId);
  }

  function handleToggleHighlightType() {
    const h = appState.activeHighlight;
    if (!h) return;
    const base = getAnnotationColorName(h.color);
    appState.setHighlightColor(h.id, isUnderlineAnnotation(h.color) ? base : `underline-${base}`);
  }

  function handleDeleteActiveHighlight() {
    const h = appState.activeHighlight;
    if (h) appState.removeHighlight(h.id);
  }

  async function handleCopyHighlightText() {
    const text = appState.activeHighlight?.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyFeedback = true;
      setTimeout(() => (copyFeedback = false), 1400);
    } catch (err) {
      console.error("Failed to copy highlight text:", err);
    }
  }

  function handleLookupHighlight() {
    const h = appState.activeHighlight;
    const r = appState.activeHighlightRect;
    if (!h || !r) return;
    appState.selectedText = cleanLookupTerm(normalizeSelectedText(h.text));
    appState.selectedSentence = normalizeSelectedText(h.text);
    appState.selectedPage = h.page;
    appState.selectionNormalizedRects = [];
    appState.selectionRect = r;
    appState.activeHighlight = null;
    appState.activeHighlightRect = null;
    appState.lookupCardVisible = true;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("selectionchange", handleSelectionChange);

    if (containerEl) {
      let resizeTimer: any = null;
      const measure = () => {
        appState.readerWidth = containerEl.clientWidth;
        appState.readerHeight = containerEl.clientHeight;
      };
      measure();
      resizeObserver = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(measure, 90);
      });
      resizeObserver.observe(containerEl);
    }
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener("pointerup", handlePointerUp);
    document.removeEventListener("selectionchange", handleSelectionChange);
    resizeObserver?.disconnect();
    clearTimeout(selectionTimer);
  });
</script>

<div class="reader-frame">
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="reader-viewport mode-{appState.layoutMode}"
  bind:this={containerEl}
  onscroll={handleScroll}
  onpointerdown={(e) => {
    handleTouchPointerDown(e);
    handlePointerDown(e);
  }}
  onpointermove={handleTouchPointerMove}
  onpointercancel={handleTouchPointerUp}
  onclick={handleViewportClick}
  role="region"
  aria-label="PDF document"
>
  {#if appState.layoutMode === "single"}
    <div class="single-page-wrapper" style={previewTransform}>
      <div class="page-container" data-page={appState.currentPage}>
        <canvas bind:this={singleCanvasEl} class="pdf-canvas"></canvas>
        <div bind:this={singleAnnotationLayerEl} class="annotation-layer"></div>
        <div bind:this={singleTextLayerEl} class="textLayer"></div>
        {#if appState.isBookmarked(appState.currentPage)}<div class="page-ribbon" title="Bookmarked"></div>{/if}
      </div>
    </div>

  {:else if appState.layoutMode === "dual"}
    <div class="book-spread-container" style={previewTransform}>
      <button class="spread-nav-zone" onclick={goPrev} disabled={dualLeftPage <= 1} aria-label="Previous pages">
        <Icon name="chevron-left" size={26} />
      </button>

      <div class="book-spread">
        <div class="book-leaf leaf-left">
          <div class="page-container dual-page left-page" data-page={dualLeftPage}>
            <canvas bind:this={leftCanvasEl} class="pdf-canvas"></canvas>
            <div bind:this={leftAnnotationLayerEl} class="annotation-layer"></div>
            <div bind:this={leftTextLayerEl} class="textLayer"></div>
            {#if appState.isBookmarked(dualLeftPage)}<div class="page-ribbon" title="Bookmarked"></div>{/if}
          </div>
          <span class="leaf-page-tag">{dualLeftPage}</span>
        </div>

        <div class="book-spine-gutter"></div>

        <div class="book-leaf leaf-right">
          {#if dualRightPage}
            <div class="page-container dual-page right-page" data-page={dualRightPage}>
              <canvas bind:this={rightCanvasEl} class="pdf-canvas"></canvas>
              <div bind:this={rightAnnotationLayerEl} class="annotation-layer"></div>
              <div bind:this={rightTextLayerEl} class="textLayer"></div>
              {#if appState.isBookmarked(dualRightPage)}<div class="page-ribbon" title="Bookmarked"></div>{/if}
            </div>
            <span class="leaf-page-tag">{dualRightPage}</span>
          {:else}
            <div class="blank-page-end"><span>End of document</span></div>
          {/if}
        </div>

        {#if isFlipping}
          <div class="flip-animation-leaf {flipDirection === 'next' ? 'flipping-next' : 'flipping-prev'}">
            <div class="flip-face flip-front"></div>
            <div class="flip-face flip-back"></div>
            <div class="flip-shadow"></div>
          </div>
        {/if}
      </div>

      <button class="spread-nav-zone" onclick={goNext} disabled={!dualRightPage || dualRightPage >= appState.pageCount} aria-label="Next pages">
        <Icon name="chevron-right" size={26} />
      </button>
    </div>

  {:else}
    <div class="scroll-track" style={previewTransform}>
      {#each Array(appState.pageCount) as _, i (i)}
        {@const pageNum = i + 1}
        {@const size = pageSizes[i] ?? pageSizes[0] ?? { width: 612, height: 792 }}
        <div class="scroll-page-item" data-page={pageNum}>
          <div
            class="page-container"
            data-page={pageNum}
            style="width: {Math.floor(size.width * scrollScale)}px; height: {Math.floor(size.height * scrollScale)}px;"
            use:scrollPage={{ pageNum, scale: scrollScale }}
          >
            <canvas class="pdf-canvas"></canvas>
            <div class="annotation-layer"></div>
            <div class="textLayer"></div>
            {#if appState.isBookmarked(pageNum)}<div class="page-ribbon" title="Bookmarked"></div>{/if}
          </div>
          <div class="scroll-page-label">{pageNum}</div>
        </div>
      {/each}
    </div>
  {/if}

  {#if appState.activeHighlight && appState.activeHighlightRect}
    {@const isUnderline = isUnderlineAnnotation(appState.activeHighlight.color)}
    {@const currentColor = getAnnotationColorName(appState.activeHighlight.color)}
    <div
      class="annotation-action-bar"
      style={annotationBarStyle}
      bind:offsetWidth={barWidth}
      onclick={(e) => e.stopPropagation()}
      role="toolbar"
      tabindex="-1"
      aria-label="Annotation actions"
    >
      <div class="action-bar-colors">
        {#each ANNOTATION_COLORS as col}
          <button
            class="action-color-dot"
            class:active={currentColor === col.id}
            style="--dot: {col.color};"
            title={col.label}
            aria-label="Change color to {col.label}"
            onclick={() => handleUpdateHighlightColor(col.id)}
          ></button>
        {/each}
      </div>

      <div class="action-bar-divider"></div>

      <button
        class="action-btn"
        title={isUnderline ? "Switch to highlight" : "Switch to underline"}
        onclick={handleToggleHighlightType}
      >
        <Icon name={isUnderline ? "highlighter" : "underline"} size={15} />
        <span class="action-label">{isUnderline ? "Highlight" : "Underline"}</span>
      </button>

      <button class="action-btn" title="Look up / explain" onclick={handleLookupHighlight}>
        <Icon name="sparkles" size={15} />
        <span class="action-label">Explain</span>
      </button>

      <button class="action-btn" title="Copy text" onclick={handleCopyHighlightText}>
        <Icon name={copyFeedback ? "check" : "copy"} size={15} />
      </button>

      <button class="action-btn danger" title="Delete annotation" onclick={handleDeleteActiveHighlight}>
        <Icon name="trash" size={15} />
      </button>
    </div>
  {/if}
</div>

{#if appState.backStack.length > 0}
  <button class="back-chip" onclick={() => appState.goBack()} title="Go back (Alt+←)">
    <Icon name="arrow-left" size={15} />
    Back to p. {appState.backStack[appState.backStack.length - 1]}
  </button>
{/if}

{#if pdfViewer}
  <div class="reading-status" class:visible={statusVisible} aria-live="polite">{statusText}</div>
{/if}

{#if appState.layoutMode === "single" && appState.pageCount > 1}
  <button class="page-turn prev" onclick={goPrev} disabled={appState.currentPage <= 1} aria-label="Previous page" title="Previous page (←)">
    <Icon name="chevron-left" size={22} />
  </button>
  <button class="page-turn next" onclick={goNext} disabled={appState.currentPage >= appState.pageCount} aria-label="Next page" title="Next page (→)">
    <Icon name="chevron-right" size={22} />
  </button>
{/if}
</div>

<style>
  .back-chip {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 50px;
    z-index: 30;
    height: 34px;
    padding: 0 14px 0 10px;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--accent-text);
    background: var(--accent);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-md);
    animation: chipIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .back-chip:hover {
    background: var(--accent-hover);
  }

  @keyframes chipIn {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%);
    }
  }

  .reading-status {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translate(-50%, 6px);
    z-index: 25;
    padding: 5px 12px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-glass);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    backdrop-filter: blur(10px);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    font-variant-numeric: tabular-nums;
    transition: opacity 0.35s ease, transform 0.35s ease;
  }

  .reading-status.visible {
    opacity: 1;
    transform: translate(-50%, 0);
  }

  .reader-frame:hover .reading-status {
    opacity: 1;
    transform: translate(-50%, 0);
  }

  .page-ribbon {
    position: absolute;
    top: -4px;
    right: 28px;
    width: 18px;
    height: 34px;
    z-index: 4;
    background: var(--danger);
    clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 75%, 0 100%);
    box-shadow: var(--shadow-sm);
    pointer-events: none;
  }

  .reader-frame {
    flex: 1;
    display: flex;
    position: relative;
    min-width: 0;
    min-height: 0;
  }

  .reader-viewport {
    flex: 1;
    width: 100%;
    height: 100%;
    overflow: auto;
    position: relative;
    background-color: var(--pdf-bg);
    user-select: text;
    overscroll-behavior: contain;
  }

  /* Single page */
  .single-page-wrapper {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    min-height: 100%;
    min-width: max-content;
    padding: 24px 24px 48px;
  }

  .page-container {
    position: relative;
    background: #ffffff;
    box-shadow: var(--shadow-page);
    border-radius: 3px;
    margin: 0 auto;
    flex-shrink: 0;
  }

  .pdf-canvas {
    display: block;
    border-radius: 3px;
    transition: filter 250ms ease;
  }

  .scroll-track .pdf-canvas {
    width: 100% !important;
    height: 100% !important;
  }

  .page-turn {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 40px;
    height: 64px;
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    background: var(--bg-glass);
    border: 1px solid var(--border-subtle);
    box-shadow: var(--shadow-sm);
    opacity: 0;
    z-index: 20;
    transition: opacity var(--transition-normal), background var(--transition-fast), color var(--transition-fast);
    backdrop-filter: blur(10px);
  }

  .reader-frame:hover .page-turn:not(:disabled) {
    opacity: 0.85;
  }

  .page-turn:hover:not(:disabled) {
    opacity: 1 !important;
    color: var(--text-primary);
    background: var(--bg-surface-elevated);
  }

  .page-turn:disabled {
    pointer-events: none;
  }

  .page-turn.prev {
    left: 12px;
  }

  .page-turn.next {
    right: 12px;
  }

  /* On touch screens, hover never happens: keep page-turn buttons faintly visible */
  @media (hover: none) {
    .page-turn:not(:disabled) {
      opacity: 0.7;
    }
  }

  /* Dual page spread */
  .book-spread-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    min-width: max-content;
    perspective: 2000px;
    position: relative;
    padding: 24px 8px 48px;
    gap: 8px;
  }

  .spread-nav-zone {
    width: 44px;
    align-self: stretch;
    color: var(--text-muted);
    border-radius: var(--radius-md);
    opacity: 0.5;
    transition: opacity var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
  }

  .spread-nav-zone:hover:not(:disabled) {
    opacity: 1;
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .spread-nav-zone:disabled {
    opacity: 0.15;
    cursor: default;
  }

  .book-spread {
    display: flex;
    align-items: stretch;
    position: relative;
    box-shadow: var(--shadow-page);
    border-radius: 4px;
    transform-style: preserve-3d;
  }

  .book-leaf {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
  }

  .book-leaf .page-container {
    box-shadow: none;
  }

  .leaf-left .page-container {
    border-radius: 3px 0 0 3px;
  }

  .leaf-right .page-container {
    border-radius: 0 3px 3px 0;
  }

  .leaf-left .page-container::after,
  .leaf-right .page-container::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    width: 28px;
    pointer-events: none;
    z-index: 3;
  }

  .leaf-left .page-container::after {
    right: 0;
    background: linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.08));
  }

  .leaf-right .page-container::after {
    left: 0;
    background: linear-gradient(-90deg, transparent, rgba(0, 0, 0, 0.08));
  }

  .leaf-page-tag {
    position: absolute;
    bottom: -24px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .book-spine-gutter {
    width: 1px;
    background: rgba(0, 0, 0, 0.25);
    z-index: 5;
  }

  .blank-page-end {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-width: 240px;
    height: 100%;
    background: var(--bg-surface);
    color: var(--text-muted);
    font-size: 13px;
    font-style: italic;
  }

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
    from {
      transform: rotateY(0deg);
    }
    to {
      transform: rotateY(-180deg);
    }
  }

  @keyframes flipPrevAnim {
    from {
      transform: rotateY(0deg);
    }
    to {
      transform: rotateY(180deg);
    }
  }

  .flip-face {
    position: absolute;
    inset: 0;
    backface-visibility: hidden;
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
  }

  /* Continuous scroll */
  .scroll-track {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 24px 24px 80px;
    min-width: max-content;
  }

  .scroll-page-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  .scroll-page-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    padding-bottom: 12px;
  }

  /* Floating annotation action bar */
  .annotation-action-bar {
    position: fixed;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px;
    max-width: calc(100vw - 24px);
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    animation: popIn 0.16s cubic-bezier(0.16, 1, 0.3, 1);
    user-select: none;
  }

  @keyframes popIn {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .action-bar-colors {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px;
  }

  .action-color-dot {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    padding: 0;
    position: relative;
  }

  .action-color-dot::before {
    content: "";
    position: absolute;
    inset: 6px;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
    transition: transform var(--transition-fast);
  }

  .action-color-dot:hover::before {
    transform: scale(1.15);
  }

  .action-color-dot.active::before {
    inset: 5px;
    box-shadow: 0 0 0 2px var(--bg-surface-elevated), 0 0 0 3.5px var(--dot);
  }

  .action-bar-divider {
    width: 1px;
    height: 20px;
    background: var(--border-strong);
    margin: 0 2px;
  }

  .action-btn {
    height: 30px;
    padding: 0 8px;
    color: var(--text-secondary);
    font-size: 12.5px;
    font-weight: 500;
    border-radius: var(--radius-sm);
  }

  .action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .action-btn.danger:hover {
    background: var(--danger-subtle);
    color: var(--danger);
  }

  @media (max-width: 560px) {
    .action-label {
      display: none;
    }
    .single-page-wrapper,
    .scroll-track {
      padding-left: 8px;
      padding-right: 8px;
    }
    .page-turn {
      display: none;
    }
  }
</style>
