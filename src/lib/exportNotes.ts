import type { Book, Highlight, Note, Word } from "./api";
import { getColorDef, isUnderlineAnnotation } from "./pdf/highlights";

/** Everything saved for a book, as a Markdown study sheet ordered by page. */
export function buildMarkdown(
  book: Book,
  data: { highlights: Highlight[]; notes: Note[]; words: Word[] },
  targetLanguage: string,
  chapterTitleFor: (page: number) => string | null
): string {
  const lines: string[] = [];
  lines.push(`# ${book.title}`);
  if (book.author) lines.push(`*${book.author}*`);
  lines.push("");
  lines.push(
    `> ${data.highlights.length} highlights · ${data.notes.length} notes · ${data.words.length} words — exported from Shelf on ${new Date().toLocaleDateString()}`
  );
  lines.push("");

  type Entry = { page: number; order: number; md: string };
  const entries: Entry[] = [];
  const quote = (t: string) => t.trim().replace(/\s+/g, " ");

  for (const h of data.highlights) {
    const kind = isUnderlineAnnotation(h.color) ? "underline" : "highlight";
    entries.push({ page: h.page, order: 0, md: `> ${quote(h.text)}\n\n<sub>${getColorDef(h.color).label} ${kind} · p. ${h.page}</sub>` });
  }
  for (const n of data.notes) {
    const parts: string[] = [];
    if (n.quote) parts.push(`> ${quote(n.quote)}\n`);
    parts.push(`**Note:** ${n.content.trim()}`);
    parts.push(`\n<sub>p. ${n.page ?? "?"}</sub>`);
    entries.push({ page: n.page ?? 0, order: 1, md: parts.join("\n") });
  }

  entries.sort((a, b) => a.page - b.page || a.order - b.order);
  if (entries.length) {
    lines.push("## Highlights & notes");
    let lastChapter: string | null = null;
    for (const e of entries) {
      const chapter = e.page ? chapterTitleFor(e.page) : null;
      if (chapter && chapter !== lastChapter) {
        lines.push("", `### ${chapter}`);
        lastChapter = chapter;
      }
      lines.push("", e.md);
    }
    lines.push("");
  }

  if (data.words.length) {
    lines.push("## Vocabulary", "");
    const words = [...data.words].sort((a, b) => a.word.localeCompare(b.word));
    for (const w of words) {
      let line = `- **${w.word}** — ${w.meaning.trim()}`;
      if (w.meaning_hindi) line += ` *(${targetLanguage}: ${w.meaning_hindi.trim()})*`;
      if (w.page) line += ` · p. ${w.page}`;
      lines.push(line);
      if (w.example_sentence) lines.push(`  - “${quote(w.example_sentence)}”`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
