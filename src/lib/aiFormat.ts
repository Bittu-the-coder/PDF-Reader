/** Tiny, escape-first markdown formatter for AI answers (bold, italics, code, lists). */
export function formatAiMarkdown(text: string): string {
  if (!text) return "";
  let escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold: **text** or __text__
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  escaped = escaped.replace(/__(.*?)__/g, "<strong>$1</strong>");

  // Inline code: `code`
  escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Italics: *text* (excluding already matched strong)
  escaped = escaped.replace(/(^|[^\*])\*([^\*]+)\*([^\*]|$)/g, "$1<em>$2</em>$3");

  // Convert bullet asterisks and newlines
  const rawLines = escaped.split("\n");
  const processedLines: string[] = [];
  let inList = false;

  for (let rawLine of rawLines) {
    let line = rawLine.trim();
    if (!line) {
      if (inList) {
        processedLines.push("</ul>");
        inList = false;
      }
      processedLines.push("<div class='ai-spacer'></div>");
      continue;
    }

    // Check if line contains inline bullet delimiters like " * " or "•"
    if (line.includes(" * ")) {
      const parts = line.split(/\s\*\s/);
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part) continue;
        if (i === 0 && !line.startsWith("* ")) {
          if (inList) {
            processedLines.push("</ul>");
            inList = false;
          }
          processedLines.push(`<p class="ai-p">${part}</p>`);
        } else {
          if (!inList) {
            processedLines.push("<ul class='ai-list'>");
            inList = true;
          }
          processedLines.push(`<li>${part}</li>`);
        }
      }
      continue;
    }

    if (line.startsWith("* ") || line.startsWith("- ") || line.startsWith("• ")) {
      if (!inList) {
        processedLines.push("<ul class='ai-list'>");
        inList = true;
      }
      const content = line.replace(/^[\*\-•]\s+/, "");
      processedLines.push(`<li>${content}</li>`);
      continue;
    }

    // Numbered list items
    const numMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      if (inList) {
        processedLines.push("</ul>");
        inList = false;
      }
      processedLines.push(`<div class="ai-numbered-item"><span class="num">${numMatch[1]}.</span> <span>${numMatch[2]}</span></div>`);
      continue;
    }

    if (inList) {
      processedLines.push("</ul>");
      inList = false;
    }
    processedLines.push(`<p class="ai-p">${line}</p>`);
  }

  if (inList) processedLines.push("</ul>");
  return processedLines.join("");
}
