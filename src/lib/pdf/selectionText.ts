/** Collapse whitespace and re-join words hyphenated across a line break ("exam-\nple"). */
export function normalizeSelectedText(raw: string): string {
  return raw
    .replace(/(\p{Ll})-\s*\n\s*(\p{Ll})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** For short lookups, strip quotes/punctuation glued to the word: `“word,”` -> `word`. */
export function cleanLookupTerm(text: string): string {
  if (text.split(" ").length > 3) return text;
  const cleaned = text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return cleaned || text;
}

const MAX_CONTEXT = 420;

/**
 * Find the sentence of `pageText` that contains `selected`, so the AI sees the
 * real context instead of a single text-layer line fragment.
 */
export function extractSentence(pageText: string, selected: string, hint?: string): string {
  const flat = normalizeSelectedText(pageText);
  const target = normalizeSelectedText(selected);
  if (!flat || !target) return hint || selected;

  const lowerFlat = flat.toLowerCase();
  let idx = -1;
  // Prefer the occurrence near the text-layer fragment the selection started in
  if (hint) {
    const hintIdx = lowerFlat.indexOf(normalizeSelectedText(hint).toLowerCase().slice(0, 60));
    if (hintIdx !== -1) {
      idx = lowerFlat.indexOf(target.toLowerCase(), Math.max(0, hintIdx - target.length));
    }
  }
  if (idx === -1) idx = lowerFlat.indexOf(target.toLowerCase());
  if (idx === -1) return hint ? normalizeSelectedText(hint) : target;

  const boundary = /[.!?;。]["”’)\]]?\s/g;
  let start = 0;
  boundary.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(flat)) && m.index < idx) {
    start = m.index + m[0].length;
  }
  boundary.lastIndex = idx + target.length;
  const endMatch = boundary.exec(flat);
  let end = endMatch ? endMatch.index + 1 : flat.length;

  // Keep the context bounded for very long sentences / lists without punctuation
  if (end - start > MAX_CONTEXT) {
    const half = Math.floor((MAX_CONTEXT - target.length) / 2);
    start = Math.max(start, idx - half);
    end = Math.min(end, idx + target.length + half);
  }
  return flat.slice(start, end).trim();
}
