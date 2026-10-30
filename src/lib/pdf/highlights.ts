import type { Highlight } from "../api";

export type HighlightColor = "yellow" | "green" | "blue" | "purple" | "pink" | "orange";

export interface ColorDef {
  id: HighlightColor;
  name: string;
  label: string;
  hex: string;
  color: string;
  highlightBg: string;
  highlightBorder: string;
  underlineColor: string;
}

export const ANNOTATION_COLORS: ColorDef[] = [
  {
    id: "yellow",
    name: "Amber Yellow",
    label: "Amber",
    hex: "#facc15",
    color: "#facc15",
    highlightBg: "rgba(250, 204, 21, 0.42)",
    highlightBorder: "rgba(234, 179, 8, 0.55)",
    underlineColor: "#eab308",
  },
  {
    id: "green",
    name: "Emerald Green",
    label: "Green",
    hex: "#4ade80",
    color: "#4ade80",
    highlightBg: "rgba(74, 222, 128, 0.40)",
    highlightBorder: "rgba(34, 197, 94, 0.55)",
    underlineColor: "#16a34a",
  },
  {
    id: "blue",
    name: "Sky Blue",
    label: "Blue",
    hex: "#60a5fa",
    color: "#60a5fa",
    highlightBg: "rgba(96, 165, 250, 0.40)",
    highlightBorder: "rgba(59, 130, 246, 0.55)",
    underlineColor: "#2563eb",
  },
  {
    id: "purple",
    name: "Amethyst Purple",
    label: "Purple",
    hex: "#c084fc",
    color: "#c084fc",
    highlightBg: "rgba(192, 132, 252, 0.40)",
    highlightBorder: "rgba(168, 85, 247, 0.55)",
    underlineColor: "#9333ea",
  },
  {
    id: "pink",
    name: "Rose Pink",
    label: "Pink",
    hex: "#f472b6",
    color: "#f472b6",
    highlightBg: "rgba(244, 114, 182, 0.40)",
    highlightBorder: "rgba(236, 72, 153, 0.55)",
    underlineColor: "#e11d48",
  },
  {
    id: "orange",
    name: "Sunset Orange",
    label: "Orange",
    hex: "#fb923c",
    color: "#fb923c",
    highlightBg: "rgba(251, 146, 60, 0.40)",
    highlightBorder: "rgba(249, 115, 22, 0.55)",
    underlineColor: "#ea580c",
  },
];

export const ANNOTATION_COLORS_MAP: Record<HighlightColor, ColorDef> = Object.fromEntries(
  ANNOTATION_COLORS.map((c) => [c.id, c])
) as Record<HighlightColor, ColorDef>;

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isUnderlineAnnotation(color: string): boolean {
  if (!color) return false;
  return color === "underline" || color.startsWith("underline-");
}

export function getAnnotationColorName(color: string): HighlightColor {
  if (!color) return "yellow";
  const clean = color.replace(/^underline-/, "").toLowerCase();
  if (clean in ANNOTATION_COLORS_MAP) {
    return clean as HighlightColor;
  }
  return "yellow";
}

export function getColorDef(color: string): ColorDef {
  const name = getAnnotationColorName(color);
  return ANNOTATION_COLORS_MAP[name] || ANNOTATION_COLORS[0];
}

export function getAnnotationFullColorKey(isUnderline: boolean, colorName: HighlightColor): string {
  return isUnderline ? `underline-${colorName}` : colorName;
}

/**
 * Merges raw, fragmented, or duplicate client rects (such as those returned by
 * Range.getClientRects() across multiple spans, italic words, and punctuation)
 * into clean, unified, non-overlapping bounding rectangles—one per visual line.
 *
 * This completely eliminates:
 * 1. Wireframe box seams and vertical split lines between adjacent words in highlights.
 * 2. Parallel double/triple underline tracks caused by duplicate or slight-height rects.
 * 3. Opacity-doubling dark artifacts at overlapping fragment borders.
 */
export function mergeLineRects(rects: NormalizedRect[]): NormalizedRect[] {
  if (!rects || rects.length <= 1) return rects || [];

  // Filter out degenerate zero/near-zero rects
  const valid = rects.filter((r) => r.width > 0.001 && r.height > 0.001);
  if (valid.length <= 1) return valid;

  // Sort primarily by Y (top to bottom), secondarily by X (left to right)
  const sorted = [...valid].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 0.004) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });

  // Group rects into visual lines
  interface LineGroup {
    minY: number;
    maxY: number;
    rects: NormalizedRect[];
  }

  const lines: LineGroup[] = [];

  for (const r of sorted) {
    const rBottom = r.y + r.height;
    const rMid = r.y + r.height / 2;

    // Find if this rect belongs to an existing line
    let matchedLine: LineGroup | null = null;

    for (const line of lines) {
      const lineMid = (line.minY + line.maxY) / 2;
      const lineHeight = line.maxY - line.minY;
      const minH = Math.min(r.height, lineHeight);

      // Check vertical overlap
      const overlap = Math.max(0, Math.min(line.maxY, rBottom) - Math.max(line.minY, r.y));
      const overlapRatio = minH > 0 ? overlap / minH : 0;
      const midDiff = Math.abs(rMid - lineMid);

      if (overlapRatio >= 0.45 || midDiff <= minH * 0.45) {
        matchedLine = line;
        break;
      }
    }

    if (matchedLine) {
      matchedLine.minY = Math.min(matchedLine.minY, r.y);
      matchedLine.maxY = Math.max(matchedLine.maxY, rBottom);
      matchedLine.rects.push(r);
    } else {
      lines.push({
        minY: r.y,
        maxY: rBottom,
        rects: [r],
      });
    }
  }

  // Merge rects within each line
  const mergedResult: NormalizedRect[] = [];

  // Gap tolerance in normalized coordinates (~2.5% of page width, bridges word spaces)
  const GAP_TOLERANCE = 0.025;

  for (const line of lines) {
    // Sort rects in line from left to right
    line.rects.sort((a, b) => a.x - b.x);

    let current: NormalizedRect | null = null;

    for (const r of line.rects) {
      if (!current) {
        current = {
          x: r.x,
          y: line.minY,
          width: r.width,
          height: line.maxY - line.minY,
        };
        continue;
      }

      const currentRight = current.x + current.width;
      const rRight = r.x + r.width;

      // If r overlaps or is within word gap tolerance of current rect
      if (r.x <= currentRight + GAP_TOLERANCE) {
        const newRight = Math.max(currentRight, rRight);
        current.width = newRight - current.x;
      } else {
        // Disconnected span on same line (e.g. multi-column or wide gap)
        mergedResult.push(current);
        current = {
          x: r.x,
          y: line.minY,
          width: r.width,
          height: line.maxY - line.minY,
        };
      }
    }

    if (current) {
      mergedResult.push(current);
    }
  }

  return mergedResult;
}

/**
 * Resolve normalized rectangles (0..1 coordinates relative to page container)
 * for a highlight, either from rects_json or via span search fallback.
 */
export function resolveHighlightRects(
  h: Highlight,
  textLayerDiv?: HTMLElement | null
): NormalizedRect[] {
  let rawRects: NormalizedRect[] = [];

  // 1. Try parsing rects_json
  if (h.rects_json) {
    try {
      const parsed = JSON.parse(h.rects_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Verify they are valid normalized coordinates (or client coordinates)
        const first = parsed[0];
        if (typeof first.x === "number" && typeof first.y === "number") {
          // If first.x <= 1.05 and first.y <= 1.05, it's normalized (0..1)
          if (first.x <= 1.05 && first.y <= 1.05) {
            rawRects = parsed.map((r: any) => ({
              x: Math.max(0, Math.min(1, Number(r.x) || 0)),
              y: Math.max(0, Math.min(1, Number(r.y) || 0)),
              width: Math.max(0, Math.min(1, Number(r.width) || 0)),
              height: Math.max(0, Math.min(1, Number(r.height) || 0)),
            }));
          }
        }
      }
    } catch (e) {
      // Ignore parse failure and fall back to textLayer matching
    }
  }

  // 2. Fallback: Search textLayer for matching text and compute client rects
  if (rawRects.length === 0 && textLayerDiv) {
    const target = (h.text || "").trim();
    if (target) {
      const pageContainer = textLayerDiv.closest(".page-container");
      if (pageContainer) {
        const pageRect = pageContainer.getBoundingClientRect();
        if (pageRect.width > 0 && pageRect.height > 0) {
          const spans = Array.from(textLayerDiv.querySelectorAll("span")) as HTMLSpanElement[];
          if (spans.length > 0) {
            const targetLower = target.toLowerCase().replace(/\s+/g, " ");

            // Strategy A: Find inside single span
            for (const span of spans) {
              const text = (span.textContent || "").toLowerCase().replace(/\s+/g, " ");
              const idx = text.indexOf(targetLower);
              if (idx !== -1) {
                // Find exact range within span's text nodes
                const rects = getSubstringRects(span, idx, targetLower.length);
                if (rects.length > 0) {
                  rawRects = rects.map((r) => normalizeRect(r, pageRect));
                  break;
                }
                const r = span.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  rawRects = [normalizeRect(r, pageRect)];
                  break;
                }
              }
            }

            // Strategy B: Contiguous multi-span text search
            if (rawRects.length === 0) {
              let combined = "";
              const spanPositions: { span: HTMLSpanElement; start: number; end: number }[] = [];
              for (const span of spans) {
                const t = (span.textContent || "").replace(/\s+/g, " ");
                if (!t) continue;
                const start = combined.length;
                combined += t + " ";
                spanPositions.push({ span, start, end: combined.length });
              }

              const combinedLower = combined.toLowerCase();
              const matchIdx = combinedLower.indexOf(targetLower);
              if (matchIdx !== -1) {
                const matchEnd = matchIdx + targetLower.length;
                const matchedRects: DOMRect[] = [];
                for (const item of spanPositions) {
                  if (item.end > matchIdx && item.start < matchEnd) {
                    const r = item.span.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                      matchedRects.push(r);
                    }
                  }
                }
                if (matchedRects.length > 0) {
                  rawRects = matchedRects.map((r) => normalizeRect(r, pageRect));
                }
              }
            }
          }
        }
      }
    }
  }

  if (rawRects.length > 0) {
    return mergeLineRects(rawRects);
  }

  return [];
}

function normalizeRect(r: DOMRect, pageRect: DOMRect): NormalizedRect {
  return {
    x: Math.max(0, Math.min(1, (r.left - pageRect.left) / pageRect.width)),
    y: Math.max(0, Math.min(1, (r.top - pageRect.top) / pageRect.height)),
    width: Math.max(0, Math.min(1, r.width / pageRect.width)),
    height: Math.max(0, Math.min(1, r.height / pageRect.height)),
  };
}

/**
 * Client rects of the substring [start, start+length) of a text-layer span.
 * Offsets are in whitespace-collapsed characters, matching how the caller searched.
 */
function getSubstringRects(span: HTMLElement, start: number, length: number): DOMRect[] {
  const node = span.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return [];
  const raw = node.textContent || "";

  // Map collapsed-whitespace offsets back to raw offsets
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const isSpace = /\s/.test(raw[i]);
    if (isSpace && prevSpace) continue;
    map.push(i);
    prevSpace = isSpace;
  }
  map.push(raw.length);
  const rawStart = map[Math.min(start, map.length - 1)];
  const rawEnd = map[Math.min(start + length, map.length - 1)];
  if (rawEnd <= rawStart) return [];

  try {
    const range = document.createRange();
    range.setStart(node, rawStart);
    range.setEnd(node, rawEnd);
    return Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
  } catch {
    return [];
  }
}

/**
 * Briefly pulse a marker over `text` on the given page, then scroll it into view.
 * Draws in the annotation layer so the pdf.js text spans (and their transforms)
 * are never touched. Returns false when the text is not on the rendered page yet.
 */
export function spotlightText(pageContainer: HTMLElement, text: string, highlights: Highlight[]): boolean {
  const annotationLayer = pageContainer.querySelector(".annotation-layer") as HTMLElement | null;
  const textLayer = pageContainer.querySelector(".textLayer") as HTMLElement | null;
  if (!annotationLayer || !textLayer || !textLayer.querySelector("span")) return false;

  const pageNum = Number(pageContainer.dataset.page);
  const needle = text.trim().replace(/\s+/g, " ").slice(0, 160);
  if (!needle) return false;

  // Prefer the stored geometry of a matching highlight, then fall back to a text search
  const match = highlights.find(
    (h) => h.page === pageNum && h.text.trim().replace(/\s+/g, " ").toLowerCase().startsWith(needle.toLowerCase().slice(0, 60))
  );
  let rects = resolveHighlightRects(
    match ?? ({ id: -1, page: pageNum, text: needle, rects_json: "", color: "yellow" } as Highlight),
    textLayer
  );
  if (rects.length === 0 && needle.length > 40) {
    // Long quotes often span several text-layer lines; retry with the opening words
    rects = resolveHighlightRects(
      { id: -1, page: pageNum, text: needle.split(" ").slice(0, 5).join(" "), rects_json: "", color: "yellow" } as Highlight,
      textLayer
    );
  }
  if (rects.length === 0) return false;

  const boxes: HTMLElement[] = [];
  for (const rect of rects) {
    const box = document.createElement("div");
    box.className = "pdf-spotlight";
    box.style.left = `${(rect.x * 100).toFixed(3)}%`;
    box.style.top = `${(rect.y * 100).toFixed(3)}%`;
    box.style.width = `${(rect.width * 100).toFixed(3)}%`;
    box.style.height = `${(rect.height * 100).toFixed(3)}%`;
    annotationLayer.appendChild(box);
    boxes.push(box);
  }
  boxes[0].scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  setTimeout(() => boxes.forEach((b) => b.remove()), 2600);
  return true;
}

/**
 * Render all page highlights into the dedicated annotation layer div.
 * Does NOT touch or mutate the textLayer DOM, ensuring native selection never breaks!
 */
export function applyHighlightsToAnnotationLayer(
  annotationLayerEl: HTMLElement | null | undefined,
  pageNum: number,
  highlights: Highlight[],
  onHighlightClick?: (h: Highlight, clientRect: DOMRect) => void,
  textLayerDiv?: HTMLElement | null | undefined
) {
  if (!annotationLayerEl) return;
  if (!textLayerDiv && annotationLayerEl.parentElement) {
    textLayerDiv = annotationLayerEl.parentElement.querySelector(".textLayer") as HTMLElement | null;
  }

  // Clear existing annotation boxes (keep any running spotlight pulse)
  annotationLayerEl.querySelectorAll(".pdf-annotation-rect").forEach((el) => el.remove());

  const pageHighlights = highlights.filter((h) => h.page === pageNum);
  if (pageHighlights.length === 0) return;

  for (const h of pageHighlights) {
    const rects = resolveHighlightRects(h, textLayerDiv);
    if (!rects || rects.length === 0) continue;

    const isUnderline = isUnderlineAnnotation(h.color);
    const colorName = getAnnotationColorName(h.color);
    const colorDef = getColorDef(h.color);

    const title = isUnderline
      ? `Underline (${colorDef.name}): "${h.text}"`
      : `Highlight (${colorDef.name}): "${h.text}"`;

    for (const rect of rects) {
      const box = document.createElement("div");
      box.className = `pdf-annotation-rect ${isUnderline ? "underline" : "highlight"} color-${colorName}`;
      box.dataset.highlightId = String(h.id);
      box.title = title;

      box.style.left = `${(rect.x * 100).toFixed(3)}%`;
      box.style.top = `${(rect.y * 100).toFixed(3)}%`;
      box.style.width = `${(rect.width * 100).toFixed(3)}%`;
      box.style.height = `${(rect.height * 100).toFixed(3)}%`;

      if (isUnderline) {
        box.style.setProperty("border-bottom-color", colorDef.underlineColor, "important");
      } else {
        box.style.setProperty("background-color", colorDef.highlightBg, "important");
      }

      annotationLayerEl.appendChild(box);
    }
  }
}

// Backwards compatibility export for any existing callers
export function applyHighlightsToTextLayer(
  textLayerDiv: HTMLElement | null | undefined,
  pageNum: number,
  highlights: Highlight[],
  onHighlightClick?: (h: Highlight) => void
) {
  if (!textLayerDiv) return;
  const parent = textLayerDiv.parentElement;
  if (!parent) return;
  let annotationLayer = parent.querySelector(".annotation-layer") as HTMLElement | null;
  if (!annotationLayer) {
    annotationLayer = document.createElement("div");
    annotationLayer.className = "annotation-layer";
    parent.insertBefore(annotationLayer, textLayerDiv);
  }
  applyHighlightsToAnnotationLayer(
    annotationLayer,
    pageNum,
    highlights,
    onHighlightClick ? (h: Highlight) => onHighlightClick(h) : undefined,
    textLayerDiv
  );
}
