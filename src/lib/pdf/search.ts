import type { PDFViewer } from "./pdfViewer";

export interface SearchMatch {
  page: number;
  /** Index of this match among the matches on its page */
  indexOnPage: number;
  before: string;
  text: string;
  after: string;
}

const MAX_MATCHES = 1000;

/**
 * Regex for a user query: case-insensitive, and tolerant of line breaks or
 * missing spaces between words in the PDF's text layer.
 */
export function buildSearchRegex(query: string): RegExp | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("[\\s\\-]*"), "giu");
}

/**
 * Search every page of the document. Calls `onProgress` as pages are scanned so
 * results can stream in for long books; resolves with all matches.
 */
export async function searchDocument(
  viewer: PDFViewer,
  query: string,
  isCancelled: () => boolean,
  onProgress?: (matches: SearchMatch[], scanned: number) => void
): Promise<SearchMatch[]> {
  const regex = buildSearchRegex(query);
  if (!regex) return [];
  const matches: SearchMatch[] = [];

  for (let page = 1; page <= viewer.numPages; page++) {
    if (isCancelled()) return matches;
    const text = (await viewer.getPageText(page)).replace(/\s+/g, " ");
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    let indexOnPage = 0;
    while ((m = regex.exec(text)) && matches.length < MAX_MATCHES) {
      if (m[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      matches.push({
        page,
        indexOnPage: indexOnPage++,
        before: text.slice(Math.max(0, m.index - 40), m.index).trimStart(),
        text: m[0],
        after: text.slice(m.index + m[0].length, m.index + m[0].length + 60).trimEnd(),
      });
    }
    if (onProgress && (page % 10 === 0 || page === viewer.numPages)) onProgress(matches.slice(), page);
    if (matches.length >= MAX_MATCHES) break;
  }
  return matches;
}

/**
 * Client rects of every match of `regex` inside a rendered text layer, grouped
 * per match. Text nodes are concatenated (with a space between spans) so a match
 * may cross span boundaries, as long as it stays on this page.
 */
export function findInTextLayer(textLayer: HTMLElement, regex: RegExp): DOMRect[][] {
  const nodes: { node: Text; start: number }[] = [];
  let full = "";
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    if (!t.data) continue;
    if (full && !/\s$/.test(full)) full += " ";
    nodes.push({ node: t, start: full.length });
    full += t.data;
  }
  if (!full) return [];

  const locate = (offset: number, isEnd: boolean) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const { node, start } = nodes[i];
      if (offset > start || (!isEnd && offset === start)) {
        return { node, offset: Math.min(offset - start, node.data.length) };
      }
    }
    return { node: nodes[0].node, offset: 0 };
  };

  const results: DOMRect[][] = [];
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(full))) {
    if (m[0].length === 0) {
      regex.lastIndex++;
      continue;
    }
    const a = locate(m.index, false);
    const b = locate(m.index + m[0].length, true);
    try {
      const range = document.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      results.push(Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5));
    } catch {
      results.push([]);
    }
  }
  return results;
}
