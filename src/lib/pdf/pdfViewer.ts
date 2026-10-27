import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

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

export class PDFViewer {
  doc: pdfjsLib.PDFDocumentProxy | null = null;
  numPages = 0;
  activeRenderTasks = new Map<HTMLCanvasElement, any>();

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

  async renderPage(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    textLayerDiv?: HTMLElement | null,
    scale: number = 1.0
  ): Promise<{ width: number; height: number }> {
    if (!this.doc) throw new Error("No PDF loaded");

    // Cancel in-flight render task if one is already running on this canvas
    const prevTask = this.activeRenderTasks.get(canvas);
    if (prevTask) {
      try {
        prevTask.cancel();
      } catch (e) {
        // Ignore cancel errors
      }
      this.activeRenderTasks.delete(canvas);
    }

    const page = await this.doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    // Handle high DPI displays
    const outputScale = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2d context");

    ctx.save();
    ctx.scale(outputScale, outputScale);

    const renderTask = page.render({
      canvasContext: ctx,
      viewport: viewport,
    });
    this.activeRenderTasks.set(canvas, renderTask);

    try {
      await renderTask.promise;
    } catch (renderErr: any) {
      if (renderErr?.name === "RenderingCancelledException") {
        // Render was superseded by a newer render request
        return { width: viewport.width, height: viewport.height };
      }
      throw renderErr;
    } finally {
      ctx.restore();
      if (this.activeRenderTasks.get(canvas) === renderTask) {
        this.activeRenderTasks.delete(canvas);
      }
    }

    // Render Text Layer safely
    if (textLayerDiv) {
      try {
        textLayerDiv.innerHTML = "";
        textLayerDiv.style.width = `${Math.floor(viewport.width)}px`;
        textLayerDiv.style.height = `${Math.floor(viewport.height)}px`;
        textLayerDiv.style.setProperty("--scale-factor", `${scale}`);

        const textContent = await page.getTextContent();
        const textLayer = new (pdfjsLib as any).TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport: viewport,
        });
        await textLayer.render();
      } catch (textErr) {
        console.warn("Text layer render skipped/errored:", textErr);
      }
    }

    return { width: viewport.width, height: viewport.height };
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
