import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { attachTextLayerSelection } from "./textSelection";

// Set worker source
if (typeof window !== "undefined") {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  } catch (err) {
    console.warn("Failed to set PDF worker src:", err);
  }
}

export interface OutlineItem {
  title: string;
  page: number;
}

export interface OutlineNode {
  title: string;
  page: number | null;
  depth: number;
  children: OutlineNode[];
}

export interface PageLink {
  /** Position as fractions (0..1) of the page box */
  x: number;
  y: number;
  width: number;
  height: number;
  url?: string;
  page?: number;
}

export class PDFViewer {
  doc: pdfjsLib.PDFDocumentProxy | null = null;
  numPages = 0;
  activeRenderTasks = new Map<HTMLCanvasElement, any>();
  private activeTextLayers = new Map<HTMLElement, pdfjsLib.TextLayer>();
  private renderGenerations = new WeakMap<HTMLCanvasElement, number>();
  private pageTextCache = new Map<number, string>();
  private linkCache = new Map<number, PageLink[]>();

  async load(source: string | ArrayBuffer | Uint8Array): Promise<number> {
    const buildParam = () => {
      if (typeof source === "string") {
        return { url: source };
      } else if (source instanceof Uint8Array) {
        // ALWAYS slice the Uint8Array so PDF.js worker transfer does not neuter the caller's buffer!
        return { data: source.slice() };
      } else {
        return { data: new Uint8Array(source).slice() };
      }
    };

    try {
      const loadingTask = pdfjsLib.getDocument(buildParam());
      const loadedDoc = await loadingTask.promise;
      this.doc = loadedDoc;
      this.numPages = loadedDoc.numPages;
      return this.numPages;
    } catch (err: any) {
      console.warn("Primary PDF loadingTask failed, attempting fallback:", err);
      try {
        // Fallback without worker (runs on main thread if worker environment is restricted)
        const fallbackTask = (pdfjsLib as any).getDocument({
          ...buildParam(),
          disableWorker: true,
        });
        const fallbackDoc = await fallbackTask.promise;
        this.doc = fallbackDoc;
        this.numPages = fallbackDoc.numPages;
        return this.numPages;
      } catch (fallbackErr) {
        console.error("PDFViewer fallback load failed:", fallbackErr);
        throw fallbackErr;
      }
    }
  }

  async getPage(pageNumber: number): Promise<pdfjsLib.PDFPageProxy> {
    if (!this.doc) throw new Error("No PDF loaded");
    return this.doc.getPage(pageNumber);
  }

  /**
   * Render a page into `canvas` and (optionally) its text layer.
   *
   * The page is drawn into an offscreen canvas first and copied over in one step,
   * so zooming or re-rendering never flashes a blank page. Each target canvas
   * carries a generation number: if a newer render starts before an older one
   * finishes, the stale result is dropped instead of leaving the text layer of
   * the wrong page (which used to break selection and highlight placement).
   */
  async renderPage(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    textLayerDiv?: HTMLElement | null,
    scale: number = 1.0
  ): Promise<{ width: number; height: number }> {
    if (!this.doc) throw new Error("No PDF loaded");

    const generation = (this.renderGenerations.get(canvas) ?? 0) + 1;
    this.renderGenerations.set(canvas, generation);
    const isStale = () => this.renderGenerations.get(canvas) !== generation;

    // Cancel in-flight work on this canvas; the newer request supersedes it
    const prevTask = this.activeRenderTasks.get(canvas);
    if (prevTask) {
      try {
        prevTask.cancel();
      } catch {
        // Ignore cancel errors
      }
      this.activeRenderTasks.delete(canvas);
    }
    if (textLayerDiv) {
      this.activeTextLayers.get(textLayerDiv)?.cancel();
      this.activeTextLayers.delete(textLayerDiv);
    }

    const page = await this.doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const cssWidth = Math.floor(viewport.width);
    const cssHeight = Math.floor(viewport.height);
    if (isStale()) return { width: viewport.width, height: viewport.height };

    // Render offscreen at device resolution, then blit to the visible canvas
    const outputScale = window.devicePixelRatio || 1;
    const buffer = document.createElement("canvas");
    buffer.width = Math.floor(viewport.width * outputScale);
    buffer.height = Math.floor(viewport.height * outputScale);
    const bufferCtx = buffer.getContext("2d");
    if (!bufferCtx) throw new Error("Could not get 2d context");

    const renderTask = page.render({
      canvasContext: bufferCtx,
      viewport,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
    });
    this.activeRenderTasks.set(canvas, renderTask);

    try {
      await renderTask.promise;
    } catch (renderErr: any) {
      if (renderErr?.name === "RenderingCancelledException") {
        return { width: viewport.width, height: viewport.height };
      }
      throw renderErr;
    } finally {
      if (this.activeRenderTasks.get(canvas) === renderTask) {
        this.activeRenderTasks.delete(canvas);
      }
    }
    if (isStale()) return { width: viewport.width, height: viewport.height };

    canvas.width = buffer.width;
    canvas.height = buffer.height;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.getContext("2d")?.drawImage(buffer, 0, 0);
    buffer.width = buffer.height = 0;

    if (textLayerDiv) {
      await this.renderTextLayer(page, viewport, textLayerDiv, scale, isStale);
    }

    return { width: viewport.width, height: viewport.height };
  }

  private async renderTextLayer(
    page: pdfjsLib.PDFPageProxy,
    viewport: pdfjsLib.PageViewport,
    textLayerDiv: HTMLElement,
    scale: number,
    isStale: () => boolean
  ) {
    try {
      const textContent = await page.getTextContent();
      if (isStale()) return;

      // Build into a detached node and swap it in only if this render is still current
      const staging = document.createElement("div");
      staging.style.setProperty("--scale-factor", `${scale}`);
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: staging,
        viewport,
      });
      this.activeTextLayers.set(textLayerDiv, textLayer);
      await textLayer.render();
      if (this.activeTextLayers.get(textLayerDiv) === textLayer) {
        this.activeTextLayers.delete(textLayerDiv);
      }
      if (isStale()) return;

      textLayerDiv.replaceChildren(...Array.from(staging.childNodes));
      textLayerDiv.style.setProperty("--scale-factor", `${scale}`);
      textLayerDiv.style.width = staging.style.width;
      textLayerDiv.style.height = staging.style.height;
      attachTextLayerSelection(textLayerDiv);
    } catch (textErr: any) {
      if (textErr?.name !== "AbortException") {
        console.warn("Text layer render skipped/errored:", textErr);
      }
    }
  }

  /** Free the pixel buffer of a canvas that scrolled far out of view. */
  releaseCanvas(canvas: HTMLCanvasElement) {
    this.renderGenerations.set(canvas, (this.renderGenerations.get(canvas) ?? 0) + 1);
    this.activeRenderTasks.get(canvas)?.cancel();
    this.activeRenderTasks.delete(canvas);
    canvas.width = 0;
    canvas.height = 0;
  }

  /** Page sizes at scale 1, used to reserve space before pages render. */
  async getPageSizes(): Promise<{ width: number; height: number }[]> {
    if (!this.doc) return [];
    const sizes: { width: number; height: number }[] = [];
    for (let i = 1; i <= this.numPages; i++) {
      const page = await this.doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      sizes.push({ width: vp.width, height: vp.height });
    }
    return sizes;
  }

  /** Plain text of a page, used to give the AI the full sentence around a selection. */
  async getPageText(pageNumber: number): Promise<string> {
    if (!this.doc) return "";
    const cached = this.pageTextCache.get(pageNumber);
    if (cached !== undefined) return cached;
    const page = await this.doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => (item.str ?? "") + (item.hasEOL ? "\n" : ""))
      .join("");
    this.pageTextCache.set(pageNumber, text);
    return text;
  }

  /** Resolve an internal destination (named or explicit) to a 1-based page number. */
  async resolveDestination(dest: unknown): Promise<number | null> {
    if (!this.doc || !dest) return null;
    try {
      const explicit = typeof dest === "string" ? await this.doc.getDestination(dest) : (dest as any[]);
      const ref = explicit?.[0];
      if (ref == null) return null;
      if (typeof ref === "number") return ref + 1;
      return (await this.doc.getPageIndex(ref)) + 1;
    } catch {
      return null;
    }
  }

  /** The full, nested table of contents. */
  async getOutlineTree(): Promise<OutlineNode[]> {
    if (!this.doc) return [];
    const outline = await this.doc.getOutline().catch(() => null);
    if (!outline) return [];
    const walk = async (items: any[], depth: number): Promise<OutlineNode[]> =>
      Promise.all(
        items.map(async (item) => ({
          title: (item.title || "Untitled").trim(),
          page: await this.resolveDestination(item.dest),
          depth,
          children: item.items?.length ? await walk(item.items, depth + 1) : [],
        }))
      );
    return walk(outline, 0);
  }

  /** Link annotations on a page (internal jumps and web URLs). */
  async getLinks(pageNumber: number): Promise<PageLink[]> {
    if (!this.doc) return [];
    const cached = this.linkCache.get(pageNumber);
    if (cached) return cached;
    const page = await this.doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const annotations = await page.getAnnotations({ intent: "display" });
    const links: PageLink[] = [];
    for (const a of annotations as any[]) {
      if (a.subtype !== "Link" || !a.rect) continue;
      const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect);
      const rect = {
        x: Math.min(x1, x2) / viewport.width,
        y: Math.min(y1, y2) / viewport.height,
        width: Math.abs(x2 - x1) / viewport.width,
        height: Math.abs(y2 - y1) / viewport.height,
      };
      if (a.url || a.unsafeUrl) {
        const url = a.url || a.unsafeUrl;
        if (/^(https?:|mailto:)/i.test(url)) links.push({ ...rect, url });
      } else if (a.dest) {
        const target = await this.resolveDestination(a.dest);
        if (target) links.push({ ...rect, page: target });
      }
    }
    this.linkCache.set(pageNumber, links);
    return links;
  }

  destroy() {
    for (const task of this.activeRenderTasks.values()) {
      try {
        task.cancel();
      } catch {
        // ignore
      }
    }
    this.activeRenderTasks.clear();
    this.doc?.destroy();
    this.doc = null;
  }

  async renderThumbnail(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    targetWidth: number
  ): Promise<void> {
    if (!this.doc) return;
    try {
      const page = await this.doc.getPage(pageNumber);
      const unscaledViewport = page.getViewport({ scale: 1.0 });
      const scale = targetWidth / unscaledViewport.width;
      const viewport = page.getViewport({ scale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      await page.render({
        canvasContext: ctx,
        viewport,
      }).promise;
    } catch (e) {
      console.error(`Thumbnail render failed for page ${pageNumber}:`, e);
    }
  }

  async generateCoverPng(): Promise<number[] | null> {
    if (!this.doc || this.numPages === 0) return null;
    try {
      const page = await this.doc.getPage(1);
      const unscaled = page.getViewport({ scale: 1.0 });
      const scale = 300 / unscaled.width; // 300px width thumbnail
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      await page.render({ canvasContext: ctx, viewport }).promise;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!blob) return null;

      const arrayBuffer = await blob.arrayBuffer();
      return Array.from(new Uint8Array(arrayBuffer));
    } catch (err) {
      console.error("Failed to generate cover:", err);
      return null;
    }
  }

  async extractOutline(): Promise<OutlineItem[]> {
    if (!this.doc) return [];
    try {
      const outline = await this.doc.getOutline();
      if (!outline) return [];

      const result: OutlineItem[] = [];
      for (const item of outline) {
        let pageNum = 1;
        if (typeof item.dest === "string") {
          const dest = await this.doc.getDestination(item.dest);
          if (dest && dest[0]) {
            const pageIndex = await this.doc.getPageIndex(dest[0]);
            pageNum = pageIndex + 1;
          }
        } else if (Array.isArray(item.dest) && item.dest[0]) {
          const pageIndex = await this.doc.getPageIndex(item.dest[0]);
          pageNum = pageIndex + 1;
        }

        result.push({
          title: item.title || "Untitled Chapter",
          page: pageNum,
        });
      }
      return result;
    } catch (err) {
      console.warn("Could not extract outline:", err);
      return [];
    }
  }
}
