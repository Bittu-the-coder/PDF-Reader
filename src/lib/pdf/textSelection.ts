/**
 * Port of the selection helpers pdf.js ships in its viewer's TextLayerBuilder.
 *
 * The core `TextLayer` only creates absolutely positioned spans. Without an
 * `.endOfContent` element, dragging a selection into the gaps between spans makes
 * the browser jump to the start or end of the page, so the selection flickers or
 * grabs whole paragraphs. pdf.js fixes this by moving an invisible full-size div
 * next to the selection anchor while the user drags. This module does the same
 * for every text layer we render.
 */

const textLayers = new Map<HTMLElement, HTMLElement>();
let abortController: AbortController | null = null;

function reset(end: HTMLElement, textLayer: HTMLElement) {
  textLayer.append(end);
  end.style.width = "";
  end.style.height = "";
  textLayer.classList.remove("selecting");
}

function enableGlobalSelectionListener() {
  if (abortController) return;
  abortController = new AbortController();
  const { signal } = abortController;

  let isPointerDown = false;
  let prevRange: Range | null = null;

  document.addEventListener("pointerdown", () => (isPointerDown = true), { signal });
  document.addEventListener(
    "pointerup",
    () => {
      isPointerDown = false;
      textLayers.forEach(reset);
    },
    { signal }
  );
  window.addEventListener(
    "blur",
    () => {
      isPointerDown = false;
      textLayers.forEach(reset);
    },
    { signal }
  );
  document.addEventListener(
    "keyup",
    () => {
      if (!isPointerDown) textLayers.forEach(reset);
    },
    { signal }
  );

  document.addEventListener(
    "selectionchange",
    () => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) {
        textLayers.forEach(reset);
        prevRange = null;
        return;
      }

      const active = new Set<HTMLElement>();
      for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i);
        for (const layer of textLayers.keys()) {
          if (!active.has(layer) && range.intersectsNode(layer)) active.add(layer);
        }
      }
      for (const [layer, end] of textLayers) {
        if (active.has(layer)) layer.classList.add("selecting");
        else reset(end, layer);
      }

      const range = selection.getRangeAt(0);
      const modifyStart =
        prevRange &&
        (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
          range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
      let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
      if (anchor && anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;

      const anchorEl = anchor as HTMLElement | null;
      const parentLayer = anchorEl?.parentElement?.closest(".textLayer") as HTMLElement | null;
      const end = parentLayer ? textLayers.get(parentLayer) : undefined;
      if (end && parentLayer && anchorEl?.parentElement) {
        end.style.width = parentLayer.style.width;
        end.style.height = parentLayer.style.height;
        anchorEl.parentElement.insertBefore(end, modifyStart ? anchorEl : anchorEl.nextSibling);
      }
      prevRange = range.cloneRange();
    },
    { signal }
  );
}

/** Call after a TextLayer finished rendering into `div`. Safe to call repeatedly. */
export function attachTextLayerSelection(div: HTMLElement) {
  let end = textLayers.get(div);
  if (!end || !div.contains(end)) {
    end = document.createElement("div");
    end.className = "endOfContent";
  }
  div.append(end);

  if (!div.dataset.selectionBound) {
    div.dataset.selectionBound = "1";
    div.addEventListener("pointerdown", () => div.classList.add("selecting"));
  }
  textLayers.set(div, end);
  enableGlobalSelectionListener();
}

/** Forget text layers that were removed from the document. */
export function pruneDetachedTextLayers() {
  for (const layer of textLayers.keys()) {
    if (!layer.isConnected) textLayers.delete(layer);
  }
  if (textLayers.size === 0) {
    abortController?.abort();
    abortController = null;
  }
}
