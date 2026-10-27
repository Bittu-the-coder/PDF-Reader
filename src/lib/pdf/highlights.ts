import type { Highlight } from "../api";

export function applyHighlightsToTextLayer(
  textLayerDiv: HTMLElement | null | undefined,
  pageNum: number,
  highlights: Highlight[],
  onHighlightClick?: (h: Highlight) => void
) {
  if (!textLayerDiv) return;

  // 1. Safely unwrap any existing marks and merge adjacent text nodes
  const existingMarks = textLayerDiv.querySelectorAll(".pdf-highlight-mark");
  existingMarks.forEach((m) => {
    const parent = m.parentNode;
    if (parent) {
      while (m.firstChild) {
        parent.insertBefore(m.firstChild, m);
      }
      parent.removeChild(m);
      if (parent instanceof HTMLElement) {
        parent.normalize();
        delete parent.dataset.originalText;
      }
    }
  });

  const existingSpans = textLayerDiv.querySelectorAll(".pdf-highlight-span");
  existingSpans.forEach((el) => {
    el.classList.remove("pdf-highlight-span", "underline");
    (el as HTMLElement).removeAttribute("title");
    (el as HTMLElement).onclick = null;
  });

  const pageHighlights = highlights.filter((h) => h.page === pageNum);
  if (pageHighlights.length === 0) return;

  const spans = Array.from(textLayerDiv.querySelectorAll("span")) as HTMLSpanElement[];
  if (spans.length === 0) return;

  function normalizeStr(s: string): string {
    return (s || "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanText(s: string): string {
    return normalizeStr(s).toLowerCase();
  }

  // Iterate through all highlights on this page
  for (const h of pageHighlights) {
    const rawTarget = (h.text || "").trim();
    if (!rawTarget) continue;
    const targetNorm = cleanText(rawTarget);
    if (!targetNorm) continue;
    const isUnderline = h.color === "underline";
    const title = isUnderline
      ? `Underline: "${rawTarget}" (Click to view in Book Memory)`
      : `Highlight: "${rawTarget}" (Click to view in Book Memory)`;

    let matched = false;

    // Check 1: Target word/phrase is inside a single span (most common)
    for (const span of spans) {
      const spanFullText = cleanText(span.textContent || "");
      if (!spanFullText) continue;

      // Check if target is inside span
      let canMatch = false;
      if (spanFullText === targetNorm) {
        canMatch = true;
      } else if (spanFullText.includes(targetNorm)) {
        canMatch = true;
      } else {
        try {
          const rx = new RegExp(`(^|\\s|[.,!?;:()"'])${escapeRegExp(targetNorm)}($|\\s|[.,!?;:()"'])`, "i");
          canMatch = rx.test(spanFullText);
        } catch {}
      }

      if (!canMatch) continue;

      // Exact full span match
      if (spanFullText === targetNorm && span.childNodes.length <= 1) {
        span.classList.add("pdf-highlight-span");
        if (isUnderline) span.classList.add("underline");
        span.title = title;
        if (onHighlightClick) {
          span.onclick = (e) => {
            e.stopPropagation();
            onHighlightClick(h);
          };
        }
        matched = true;
        break;
      }

      // Word/substring match: find matching text node inside span and wrap with <mark>
      const childNodes = Array.from(span.childNodes);
      for (const node of childNodes) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const val = node.nodeValue || "";
        if (!val) continue;

        let idx = -1;
        let matchLen = rawTarget.length;

        // Try exact case-insensitive match
        const lowerVal = val.toLowerCase();
        idx = lowerVal.indexOf(rawTarget.toLowerCase());

        if (idx === -1) {
          // Try normalized match
          const normVal = lowerVal
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/\u00A0/g, " ");
          idx = normVal.indexOf(targetNorm);
          matchLen = targetNorm.length;
        }

        if (idx === -1) {
          try {
            const rx = new RegExp(`(^|\\s|[.,!?;:()"'])${escapeRegExp(targetNorm)}($|\\s|[.,!?;:()"'])`, "i");
            const m = rx.exec(val);
            if (m) {
              const prefix = m[1] ? m[1].length : 0;
              idx = m.index + prefix;
              matchLen = targetNorm.length;
            }
          } catch {}
        }

        if (idx !== -1) {
          const beforeText = val.slice(0, idx);
          const matchedText = val.slice(idx, idx + matchLen);
          const afterText = val.slice(idx + matchLen);

          const mark = document.createElement("mark");
          mark.className = `pdf-highlight-mark ${isUnderline ? "underline" : "highlight"}`;
          mark.textContent = matchedText;
          mark.title = title;
          if (onHighlightClick) {
            mark.onclick = (e) => {
              e.stopPropagation();
              onHighlightClick(h);
            };
          }

          const parent = node.parentNode;
          if (parent) {
            if (afterText) {
              parent.insertBefore(document.createTextNode(afterText), node.nextSibling);
            }
            parent.insertBefore(mark, node.nextSibling);
            if (beforeText) {
              node.nodeValue = beforeText;
            } else {
              parent.removeChild(node);
            }
          }
          matched = true;
          break;
        }
      }

      if (matched) break;
    }

    if (matched) continue;

    // Check 2: Target text spans across multiple adjacent spans via contiguous substring search
    if (targetNorm.length > 2) {
      let combined = "";
      const spanRanges: { span: HTMLSpanElement; start: number; end: number }[] = [];

      for (const span of spans) {
        const text = cleanText(span.textContent || "");
        if (!text) continue;
        const start = combined.length;
        combined += text + " ";
        const end = combined.length;
        spanRanges.push({ span, start, end });
      }

      const found = combined.indexOf(targetNorm);
      if (found !== -1) {
        const foundEnd = found + targetNorm.length;
        for (const item of spanRanges) {
          if (item.end > found && item.start < foundEnd) {
            item.span.classList.add("pdf-highlight-span");
            if (isUnderline) item.span.classList.add("underline");
            item.span.title = title;
            if (onHighlightClick) {
              item.span.onclick = (e) => {
                e.stopPropagation();
                onHighlightClick(h);
              };
            }
          }
        }
        matched = true;
      }
    }

    if (matched) continue;

    // Check 3: Word-sequence exact matching across adjacent spans
    const targetWords = targetNorm.split(" ").filter((w) => w.length > 0);
    if (targetWords.length > 1) {
      const spanWordList: { span: HTMLSpanElement; word: string }[] = [];
      for (const span of spans) {
        const words = cleanText(span.textContent || "").split(" ").filter((w) => w.length > 0);
        for (const w of words) {
          spanWordList.push({ span, word: w });
        }
      }

      for (let i = 0; i <= spanWordList.length - targetWords.length; i++) {
        let allMatch = true;
        for (let j = 0; j < targetWords.length; j++) {
          const sw = spanWordList[i + j].word;
          const tw = targetWords[j];
          if (sw !== tw) {
            allMatch = false;
            break;
          }
        }

        if (allMatch) {
          for (let j = 0; j < targetWords.length; j++) {
            const span = spanWordList[i + j].span;
            span.classList.add("pdf-highlight-span");
            if (isUnderline) span.classList.add("underline");
            span.title = title;
            if (onHighlightClick) {
              span.onclick = (e) => {
                e.stopPropagation();
                onHighlightClick(h);
              };
            }
          }
          break;
        }
      }
    }
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
