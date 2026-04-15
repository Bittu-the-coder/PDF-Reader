import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import './styles.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const app = document.querySelector('#app');

const state = {
  pdf: null,
  fileName: 'No document',
  pageNumber: 1,
  pageCount: 0,
  zoom: 1,
  mode: 'dark',
  uiTheme: 'night',
  customTheme: {
    bg: '#0e1116',
    surface: '#151922',
    text: '#e9edf4',
    accent: '#7dd3fc',
  },
  pageAspect: 1.35,
  renderingSet: new Set(),
  renderKey: 0,
  pages: new Map(),
  thumbs: new Map(),
  rafScheduled: false,
  isFullscreen: false,
  sidebarOpen: true,
  search: {
    query: '',
    results: [],
    currentIndex: -1,
    loading: false,
  },
};

const UI_THEMES = {
  night: {
    label: 'Night',
    bg: '#0a0d11',
    surface: '#121722',
    text: '#e8edf5',
    accent: '#60a5fa',
  },
  paper: {
    label: 'Paper',
    bg: '#ece8df',
    surface: '#f6f2e7',
    text: '#2a2a2a',
    accent: '#7c3aed',
  },
  forest: {
    label: 'Forest',
    bg: '#0e1712',
    surface: '#17231c',
    text: '#e7f0e8',
    accent: '#34d399',
  },
  custom: {
    label: 'Custom',
  },
};

app.innerHTML = `
  <div class="shell theme-night" id="shell">
    <aside class="sidebar glass" id="sidebar">
      <div class="sidebar-top">
        <div class="brand minimal-row">
          <div class="brand-mark">◍</div>
          <div>
            <div class="brand-title">The Reader</div>
            <div class="brand-subtitle">Minimal PDF, maximal focus.</div>
          </div>
        </div>
        <button id="sidebar-close-btn" class="icon-btn" title="Close sidebar">×</button>
      </div>

      <div class="action-grid">
        <button id="open-btn" class="primary">Open</button>
        <button id="full-btn">Fullscreen</button>
      </div>

      <div class="panel compact">
        <div class="panel-label">Document</div>
        <div id="doc-name" class="doc-name">No document</div>
        <div class="meta-grid">
          <div><span>Page</span><strong id="page-counter">0 / 0</strong></div>
          <div><span>Zoom</span><strong id="zoom-value">100%</strong></div>
          <div><span>PDF Mode</span><strong id="mode-value">Dark</strong></div>
          <div><span>UI Theme</span><strong id="theme-value">Night</strong></div>
        </div>
      </div>

      <div class="panel compact">
        <div class="panel-label">Navigation</div>
        <div class="button-row">
          <button id="prev-btn">Prev</button>
          <button id="next-btn">Next</button>
        </div>
        <div class="button-row">
          <button id="zoom-out-btn">-</button>
          <button id="zoom-in-btn">+</button>
        </div>
        <div class="button-row">
          <button id="fit-width-btn">Fit Width</button>
          <button id="mode-btn">PDF Mode</button>
        </div>
      </div>

      <div class="panel compact">
        <div class="panel-label">Search</div>
        <div class="search-row">
          <input id="search-input" type="search" placeholder="Find in PDF" />
          <button id="search-btn">Find</button>
        </div>
        <div class="button-row">
          <button id="search-prev-btn">Prev</button>
          <button id="search-next-btn">Next</button>
        </div>
        <div class="search-meta">
          <span id="search-count">0 results</span>
        </div>
      </div>

      <div class="panel compact">
        <div class="panel-label">Theme</div>
        <div class="button-row">
          <button id="theme-btn">Toggle Theme</button>
          <button id="custom-toggle-btn">Custom</button>
        </div>
        <div id="custom-theme-panel" class="custom-theme hidden">
          <label>Background <input id="custom-bg" type="color" value="#0e1116" /></label>
          <label>Surface <input id="custom-surface" type="color" value="#151922" /></label>
          <label>Text <input id="custom-text" type="color" value="#e9edf4" /></label>
          <label>Accent <input id="custom-accent" type="color" value="#7dd3fc" /></label>
        </div>
      </div>

      <div class="panel compact">
        <div class="panel-label">Jump</div>
        <div class="jump-row">
          <input id="page-input" type="number" min="1" value="1" />
          <button id="go-btn">Go</button>
        </div>
      </div>

      <div class="panel note compact">
        <div class="panel-label">Low RAM Design</div>
        <p>Only visible pages are rendered. Far-off canvases are released to keep memory low.</p>
      </div>

      <div class="panel compact thumb-panel">
        <div class="panel-label">Thumbnails</div>
        <div id="thumbs-rail" class="thumbs-rail"></div>
      </div>

      <input id="file-input" type="file" accept="application/pdf" hidden />
    </aside>

    <main class="reader">
      <div class="toolbar glass">
        <div class="toolbar-left">
          <button id="sidebar-btn" class="icon-btn" title="Toggle sidebar">☰</button>
          <span class="pill" id="status-pill">Ready</span>
        </div>
        <div class="toolbar-right">
          <button id="prev-top">←</button>
          <button id="next-top">→</button>
          <button id="open-top">Open</button>
        </div>
      </div>

      <div id="canvas-shell" class="canvas-shell drop-zone">
        <div id="empty-state" class="empty-state">
          <div class="empty-mark">◍</div>
          <h1>Drop a PDF to begin</h1>
          <p>Minimal chrome, aesthetic UI, vertical reading flow, and dark rendering modes for mixed/scanned PDFs.</p>
          <button id="empty-open" class="primary">Open PDF</button>
        </div>
        <div id="pages-stack" class="pages-stack"></div>
      </div>
    </main>
  </div>
`;

const els = {
  fileInput: document.querySelector('#file-input'),
  openBtn: document.querySelector('#open-btn'),
  openTop: document.querySelector('#open-top'),
  emptyOpen: document.querySelector('#empty-open'),
  prevBtn: document.querySelector('#prev-btn'),
  nextBtn: document.querySelector('#next-btn'),
  prevTop: document.querySelector('#prev-top'),
  nextTop: document.querySelector('#next-top'),
  zoomInBtn: document.querySelector('#zoom-in-btn'),
  zoomOutBtn: document.querySelector('#zoom-out-btn'),
  fitWidthBtn: document.querySelector('#fit-width-btn'),
  modeBtn: document.querySelector('#mode-btn'),
  pageInput: document.querySelector('#page-input'),
  goBtn: document.querySelector('#go-btn'),
  searchInput: document.querySelector('#search-input'),
  searchBtn: document.querySelector('#search-btn'),
  searchPrevBtn: document.querySelector('#search-prev-btn'),
  searchNextBtn: document.querySelector('#search-next-btn'),
  searchCount: document.querySelector('#search-count'),
  docName: document.querySelector('#doc-name'),
  pageCounter: document.querySelector('#page-counter'),
  zoomValue: document.querySelector('#zoom-value'),
  modeValue: document.querySelector('#mode-value'),
  themeValue: document.querySelector('#theme-value'),
  statusPill: document.querySelector('#status-pill'),
  canvasShell: document.querySelector('#canvas-shell'),
  pagesStack: document.querySelector('#pages-stack'),
  emptyState: document.querySelector('#empty-state'),
  shell: document.querySelector('#shell'),
  fullBtn: document.querySelector('#full-btn'),
  themeBtn: document.querySelector('#theme-btn'),
  customToggleBtn: document.querySelector('#custom-toggle-btn'),
  customThemePanel: document.querySelector('#custom-theme-panel'),
  customBg: document.querySelector('#custom-bg'),
  customSurface: document.querySelector('#custom-surface'),
  customText: document.querySelector('#custom-text'),
  customAccent: document.querySelector('#custom-accent'),
  thumbsRail: document.querySelector('#thumbs-rail'),
  sidebarBtn: document.querySelector('#sidebar-btn'),
  sidebarCloseBtn: document.querySelector('#sidebar-close-btn'),
  sidebar: document.querySelector('#sidebar'),
};

function loadSettings() {
  try {
    const raw = localStorage.getItem('the-reader-settings');
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.mode) state.mode = saved.mode;
    if (saved.uiTheme) state.uiTheme = saved.uiTheme;
    if (saved.zoom) state.zoom = saved.zoom;
    if (typeof saved.sidebarOpen === 'boolean')
      state.sidebarOpen = saved.sidebarOpen;
    if (saved.customTheme) {
      state.customTheme = { ...state.customTheme, ...saved.customTheme };
    }
  } catch (error) {
    console.warn('Failed to load settings', error);
  }
}

function saveSettings() {
  try {
    localStorage.setItem(
      'the-reader-settings',
      JSON.stringify({
        mode: state.mode,
        uiTheme: state.uiTheme,
        zoom: state.zoom,
        sidebarOpen: state.sidebarOpen,
        customTheme: state.customTheme,
      })
    );
  } catch (error) {
    console.warn('Failed to save settings', error);
  }
}

function setStatus(text) {
  els.statusPill.textContent = text;
}

function updateHeader() {
  els.docName.textContent = state.fileName;
  els.pageCounter.textContent = `${state.pageNumber} / ${state.pageCount || 0}`;
  els.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
  els.modeValue.textContent = modeLabel(state.mode);
  els.themeValue.textContent = UI_THEMES[state.uiTheme].label;
  els.pageInput.max = String(state.pageCount || 1);
  els.pageInput.value = String(state.pageNumber);
  els.fullBtn.textContent = state.isFullscreen
    ? 'Exit Fullscreen'
    : 'Fullscreen';
  els.sidebarBtn.textContent = state.sidebarOpen ? '☰' : '☷';
  els.sidebarBtn.title = state.sidebarOpen ? 'Hide sidebar' : 'Show sidebar';
}

function modeLabel(mode) {
  return (
    {
      dark: 'Dark',
      sepia: 'Sepia Dark',
      contrast: 'High Contrast',
      original: 'Original',
    }[mode] || 'Dark'
  );
}

function nextMode() {
  const modes = ['dark', 'sepia', 'contrast', 'original'];
  const idx = modes.indexOf(state.mode);
  return modes[(idx + 1) % modes.length];
}

function nextUiTheme() {
  const modes = ['night', 'paper', 'forest', 'custom'];
  const idx = modes.indexOf(state.uiTheme);
  return modes[(idx + 1) % modes.length];
}

function setMode(mode) {
  state.mode = mode;
  invalidateRenderedPages();
  updateHeader();
  applySearchHighlights();
  saveSettings();
  scheduleRender();
}

function setUiTheme(theme) {
  state.uiTheme = theme;
  applyUiTheme();
  updateHeader();
  saveSettings();
}

function applyUiTheme() {
  const palette =
    state.uiTheme === 'custom' ? state.customTheme : UI_THEMES[state.uiTheme];
  els.shell.className = `shell theme-${state.uiTheme}`;
  els.shell.style.setProperty('--ui-bg', palette.bg);
  els.shell.style.setProperty('--ui-surface', palette.surface);
  els.shell.style.setProperty('--ui-text', palette.text);
  els.shell.style.setProperty('--ui-accent', palette.accent);
  els.customBg.value = state.customTheme.bg;
  els.customSurface.value = state.customTheme.surface;
  els.customText.value = state.customTheme.text;
  els.customAccent.value = state.customTheme.accent;
  els.shell.classList.toggle('sidebar-collapsed', !state.sidebarOpen);
}

function setSidebar(open) {
  state.sidebarOpen = open;
  els.shell.classList.toggle('sidebar-collapsed', !state.sidebarOpen);
  updateHeader();
  saveSettings();
}

function toggleSidebar() {
  setSidebar(!state.sidebarOpen);
}

function invalidateRenderedPages() {
  state.renderKey += 1;
  for (const pageMeta of state.pages.values()) {
    pageMeta.key = '';
  }
}

function makePageCard(pageNo) {
  const card = document.createElement('section');
  card.className = 'page-card glass';
  card.dataset.pageNo = String(pageNo);

  const label = document.createElement('div');
  label.className = 'page-label';
  label.textContent = `Page ${pageNo}`;

  const viewport = document.createElement('div');
  viewport.className = 'page-viewport';

  const canvas = document.createElement('canvas');
  canvas.className = 'pdf-canvas';

  viewport.appendChild(canvas);
  card.appendChild(label);
  card.appendChild(viewport);
  els.pagesStack.appendChild(card);

  state.pages.set(pageNo, {
    card,
    canvas,
    key: '',
  });
}

function buildPageStack() {
  els.pagesStack.innerHTML = '';
  state.pages.clear();
  for (let i = 1; i <= state.pageCount; i += 1) {
    makePageCard(i);
  }
}

function buildThumbRail() {
  els.thumbsRail.innerHTML = '';
  state.thumbs.clear();

  for (let i = 1; i <= state.pageCount; i += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'thumb-card';
    button.dataset.pageNo = String(i);
    button.innerHTML = `
      <div class="thumb-head">
        <span>Page ${i}</span>
        <span class="thumb-state" data-role="state">...</span>
      </div>
      <canvas class="thumb-canvas"></canvas>
    `;
    button.addEventListener('click', () => scrollToPage(i));
    els.thumbsRail.appendChild(button);
    state.thumbs.set(i, {
      button,
      canvas: button.querySelector('canvas'),
      rendered: false,
      key: '',
    });
  }
}

function resetSearchState() {
  state.search.query = '';
  state.search.results = [];
  state.search.currentIndex = -1;
  state.search.loading = false;
  els.searchInput.value = '';
  updateSearchUi();
  clearSearchHighlights();
}

function updateSearchUi() {
  if (!els.searchCount) return;
  const count = state.search.results.length;
  const index = state.search.currentIndex;
  if (!count) {
    els.searchCount.textContent = '0 results';
    return;
  }

  els.searchCount.textContent =
    index >= 0
      ? `${count} result${count === 1 ? '' : 's'} • ${index + 1}/${count}`
      : `${count} result${count === 1 ? '' : 's'}`;
}

function clearSearchHighlights() {
  for (const meta of state.pages.values()) {
    meta.card.classList.remove('search-hit', 'search-current');
  }
}

function applySearchHighlights() {
  clearSearchHighlights();
  state.search.results.forEach((pageNo, index) => {
    const meta = state.pages.get(pageNo);
    if (!meta) return;
    meta.card.classList.add('search-hit');
    if (index === state.search.currentIndex) {
      meta.card.classList.add('search-current');
    }
  });
  updateSearchUi();
}

function syncActiveIndicators() {
  for (const [pageNo, meta] of state.pages.entries()) {
    meta.card.classList.toggle('active', pageNo === state.pageNumber);
  }

  for (const [pageNo, thumbMeta] of state.thumbs.entries()) {
    thumbMeta.button.classList.toggle('active', pageNo === state.pageNumber);
    if (state.search.results.includes(pageNo)) {
      thumbMeta.button.classList.add('search-hit');
    } else {
      thumbMeta.button.classList.remove('search-hit');
    }
  }

  applySearchHighlights();
}

async function renderThumb(pageNo) {
  const thumbMeta = state.thumbs.get(pageNo);
  if (!state.pdf || !thumbMeta) return;

  const key = `${pageNo}@${state.mode}@thumb@${state.renderKey}`;
  if (thumbMeta.key === key) return;

  const page = await state.pdf.getPage(pageNo);
  const viewport = page.getViewport({ scale: 1 });
  const targetWidth = 180;
  const scale = targetWidth / viewport.width;
  const thumbViewport = page.getViewport({ scale });
  const outputScale = Math.max(window.devicePixelRatio || 1, 1);
  const canvas = thumbMeta.canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  canvas.width = Math.floor(thumbViewport.width * outputScale);
  canvas.height = Math.floor(thumbViewport.height * outputScale);
  canvas.style.width = `${Math.floor(thumbViewport.width)}px`;
  canvas.style.height = `${Math.floor(thumbViewport.height)}px`;

  const renderContext = {
    canvasContext: ctx,
    viewport: page.getViewport({ scale: scale * outputScale }),
  };

  await page.render(renderContext).promise;
  page.cleanup();

  if (state.mode !== 'original') {
    applyDarkMode(canvas, state.mode);
  }

  thumbMeta.key = key;
  thumbMeta.rendered = true;
  const status = thumbMeta.button.querySelector('[data-role="state"]');
  if (status) status.textContent = 'ready';
}

function renderVisibleThumbs() {
  const viewportTop = els.thumbsRail.scrollTop;
  const viewportBottom = viewportTop + els.thumbsRail.clientHeight;
  const buffer = 280;

  for (let pageNo = 1; pageNo <= state.pageCount; pageNo += 1) {
    const thumbMeta = state.thumbs.get(pageNo);
    if (!thumbMeta) continue;
    const top = thumbMeta.button.offsetTop;
    const bottom = top + thumbMeta.button.offsetHeight;
    const visible =
      bottom >= viewportTop - buffer && top <= viewportBottom + buffer;
    if (visible) {
      renderThumb(pageNo).catch(error => console.error(error));
    }
  }
}

async function searchDocument(query) {
  const normalized = query.trim().toLowerCase();
  state.search.query = normalized;
  state.search.results = [];
  state.search.currentIndex = -1;

  if (!normalized) {
    resetSearchState();
    return;
  }

  state.search.loading = true;
  setStatus('Searching...');

  const matches = [];
  for (let pageNo = 1; pageNo <= state.pageCount; pageNo += 1) {
    const page = await state.pdf.getPage(pageNo);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map(item => ('str' in item ? item.str : ''))
      .join(' ')
      .toLowerCase();
    page.cleanup();
    if (text.includes(normalized)) {
      matches.push(pageNo);
    }
  }

  state.search.results = matches;
  state.search.currentIndex = matches.length ? 0 : -1;
  state.pageNumber = matches.length ? matches[0] : state.pageNumber;
  applySearchHighlights();
  state.search.loading = false;

  if (matches.length) {
    scrollToPage(matches[0]);
    setStatus(`Found ${matches.length} page${matches.length === 1 ? '' : 's'}`);
  } else {
    setStatus('No results');
  }
}

function goToSearchResult(delta) {
  if (!state.search.results.length) return;
  const total = state.search.results.length;
  state.search.currentIndex =
    (state.search.currentIndex + delta + total) % total;
  const pageNo = state.search.results[state.search.currentIndex];
  applySearchHighlights();
  scrollToPage(pageNo);
}

async function openPdfFromFile(file) {
  if (!file || file.type !== 'application/pdf') {
    setStatus('Pick a PDF file');
    return;
  }

  state.fileName = file.name;
  const fileBytes = await file.arrayBuffer();
  state.pageNumber = 1;
  state.zoom = 1;
  state.pageCount = 0;
  state.pdf = null;
  state.renderingSet.clear();
  updateHeader();
  setStatus('Loading...');

  const typed = new Uint8Array(fileBytes);
  const loadingTask = pdfjsLib.getDocument({
    data: typed,
    useWorkerFetch: true,
  });
  state.pdf = await loadingTask.promise;
  state.pageCount = state.pdf.numPages;
  state.pageNumber = 1;
  resetSearchState();

  const firstPage = await state.pdf.getPage(1);
  const v = firstPage.getViewport({ scale: 1 });
  state.pageAspect = v.height / v.width;
  firstPage.cleanup();

  buildPageStack();
  buildThumbRail();
  invalidateRenderedPages();

  updateHeader();
  els.emptyState.classList.add('hidden');
  setStatus('Ready');
  scheduleRender();
}

async function renderPageToCanvas(pageNo) {
  const pageMeta = state.pages.get(pageNo);
  if (!state.pdf || !pageMeta) {
    return;
  }

  const renderKey = `${pageNo}@${state.zoom.toFixed(3)}@${state.mode}@${state.renderKey}`;
  if (pageMeta.key === renderKey || state.renderingSet.has(pageNo)) {
    return;
  }

  state.renderingSet.add(pageNo);

  try {
    const page = await state.pdf.getPage(pageNo);
    const viewportBase = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(380, els.canvasShell.clientWidth - 96);
    const widthScale = availableWidth / viewportBase.width;
    const scale = widthScale * state.zoom;
    const viewport = page.getViewport({ scale });
    const outputScale = Math.max(window.devicePixelRatio || 1, 1);

    const canvas = pageMeta.canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const renderContext = {
      canvasContext: ctx,
      viewport: page.getViewport({ scale: scale * outputScale }),
    };

    setStatus(`Rendering ${pageNo}/${state.pageCount}`);
    await page.render(renderContext).promise;
    page.cleanup();

    if (state.mode !== 'original') {
      applyDarkMode(canvas, state.mode);
    }

    pageMeta.key = renderKey;
  } catch (error) {
    console.error(error);
    setStatus(`Render failed on page ${pageNo}`);
  } finally {
    state.renderingSet.delete(pageNo);
  }
}

function applyDarkMode(canvas, mode) {
  const ctx2 = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx2.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a === 0) continue;

    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    let nr = r;
    let ng = g;
    let nb = b;

    if (mode === 'contrast') {
      const value = lum > 0.5 ? 0 : 255;
      nr = ng = nb = value;
    } else if (mode === 'sepia') {
      const target = lum > 0.72 ? 0.08 : lum < 0.28 ? 0.88 : 1 - lum * 0.9;
      nr = clamp(target * 255 * 1.08);
      ng = clamp(target * 255 * 1.0);
      nb = clamp(target * 255 * 0.78);
    } else {
      const target = lum > 0.72 ? 0.08 : lum < 0.22 ? 0.9 : 1 - lum * 0.95;
      nr = clamp(target * 255 * 1.02);
      ng = clamp(target * 255 * 1.02);
      nb = clamp(target * 255 * 1.02);
    }

    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }

  ctx2.putImageData(image, 0, 0);
}

function clamp(value) {
  return Math.max(0, Math.min(255, value));
}

function currentCenterPage() {
  if (!state.pageCount) return 1;

  const viewportTop = els.canvasShell.scrollTop;
  const center = viewportTop + els.canvasShell.clientHeight / 2;
  let bestPage = state.pageNumber;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let pageNo = 1; pageNo <= state.pageCount; pageNo += 1) {
    const meta = state.pages.get(pageNo);
    if (!meta) continue;
    const top = meta.card.offsetTop;
    const mid = top + meta.card.offsetHeight / 2;
    const distance = Math.abs(mid - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPage = pageNo;
    }
  }

  return bestPage;
}

function releaseFarCanvas(pageNo, distanceThreshold = 3200) {
  const meta = state.pages.get(pageNo);
  if (!meta || !meta.key) return;

  const viewportTop = els.canvasShell.scrollTop;
  const viewportBottom = viewportTop + els.canvasShell.clientHeight;
  const top = meta.card.offsetTop;
  const bottom = top + meta.card.offsetHeight;
  const farAbove = viewportTop - bottom > distanceThreshold;
  const farBelow = top - viewportBottom > distanceThreshold;

  if (farAbove || farBelow) {
    const canvas = meta.canvas;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    canvas.width = 0;
    canvas.height = 0;
    canvas.style.width = '0px';
    canvas.style.height = '0px';
    meta.key = '';
  }
}

async function renderVisiblePages() {
  if (!state.pdf) return;

  const viewportTop = els.canvasShell.scrollTop;
  const viewportBottom = viewportTop + els.canvasShell.clientHeight;
  const margin = 1200;
  const tasks = [];

  for (let pageNo = 1; pageNo <= state.pageCount; pageNo += 1) {
    const meta = state.pages.get(pageNo);
    if (!meta) continue;
    const top = meta.card.offsetTop;
    const bottom = top + meta.card.offsetHeight;
    const visible =
      bottom >= viewportTop - margin && top <= viewportBottom + margin;

    if (visible) {
      tasks.push(renderPageToCanvas(pageNo));
    } else {
      releaseFarCanvas(pageNo);
    }
  }

  await Promise.all(tasks);
  state.pageNumber = currentCenterPage();
  renderVisibleThumbs();
  syncActiveIndicators();
  setStatus('Ready');
  updateHeader();
}

function scheduleRender() {
  if (state.rafScheduled) return;
  state.rafScheduled = true;
  requestAnimationFrame(async () => {
    state.rafScheduled = false;
    await renderVisiblePages();
  });
}

function scrollToPage(pageNo) {
  const meta = state.pages.get(pageNo);
  if (!meta) return;
  meta.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  state.pageNumber = pageNo;
  syncActiveIndicators();
  updateHeader();
  scheduleRender();
}

function changePage(delta) {
  if (!state.pdf) return;
  const next = Math.max(1, Math.min(state.pageCount, state.pageNumber + delta));
  if (next === state.pageNumber) return;
  scrollToPage(next);
}

function zoomBy(delta) {
  state.zoom = Math.max(0.5, Math.min(3, state.zoom + delta));
  invalidateRenderedPages();
  updateHeader();
  saveSettings();
  scheduleRender();
}

function fitWidth() {
  if (!state.pdf) return;
  state.zoom = 1;
  invalidateRenderedPages();
  updateHeader();
  saveSettings();
  scheduleRender();
}

function focusSearch() {
  els.searchInput.focus();
  els.searchInput.select();
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen();
    state.isFullscreen = true;
  } else {
    await document.exitFullscreen();
    state.isFullscreen = false;
  }
  updateHeader();
}

function toggleCustomPanel() {
  els.customThemePanel.classList.toggle('hidden');
}

function applyCustomThemeFromInputs() {
  state.customTheme.bg = els.customBg.value;
  state.customTheme.surface = els.customSurface.value;
  state.customTheme.text = els.customText.value;
  state.customTheme.accent = els.customAccent.value;
  if (state.uiTheme === 'custom') {
    applyUiTheme();
  }
  saveSettings();
}

function openPicker() {
  els.fileInput.value = '';
  els.fileInput.click();
}

els.openBtn.addEventListener('click', openPicker);
els.openTop.addEventListener('click', openPicker);
els.emptyOpen.addEventListener('click', openPicker);
els.sidebarBtn.addEventListener('click', toggleSidebar);
els.sidebarCloseBtn.addEventListener('click', () => setSidebar(false));
els.fileInput.addEventListener('change', async () => {
  const file = els.fileInput.files?.[0];
  if (file) await openPdfFromFile(file);
});
els.prevBtn.addEventListener('click', () => changePage(-1));
els.prevTop.addEventListener('click', () => changePage(-1));
els.nextBtn.addEventListener('click', () => changePage(1));
els.nextTop.addEventListener('click', () => changePage(1));
els.zoomInBtn.addEventListener('click', () => zoomBy(0.1));
els.zoomOutBtn.addEventListener('click', () => zoomBy(-0.1));
els.fitWidthBtn.addEventListener('click', fitWidth);
els.modeBtn.addEventListener('click', () => setMode(nextMode()));
els.fullBtn.addEventListener('click', toggleFullscreen);
els.themeBtn.addEventListener('click', () => setUiTheme(nextUiTheme()));
els.customToggleBtn.addEventListener('click', toggleCustomPanel);
els.customBg.addEventListener('input', applyCustomThemeFromInputs);
els.customSurface.addEventListener('input', applyCustomThemeFromInputs);
els.customText.addEventListener('input', applyCustomThemeFromInputs);
els.customAccent.addEventListener('input', applyCustomThemeFromInputs);
els.searchBtn.addEventListener('click', () => {
  searchDocument(els.searchInput.value).catch(error => console.error(error));
});
els.searchPrevBtn.addEventListener('click', () => goToSearchResult(-1));
els.searchNextBtn.addEventListener('click', () => goToSearchResult(1));
els.searchInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    searchDocument(els.searchInput.value).catch(error => console.error(error));
  } else if (event.key === 'Escape') {
    resetSearchState();
  }
});
els.goBtn.addEventListener('click', () => {
  if (!state.pdf) return;
  const value = Number(els.pageInput.value);
  if (Number.isFinite(value) && value >= 1 && value <= state.pageCount) {
    scrollToPage(value);
  }
});
els.pageInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    els.goBtn.click();
  }
});

window.addEventListener('keydown', event => {
  if (event.target && ['INPUT', 'TEXTAREA'].includes(event.target.tagName))
    return;

  if (event.ctrlKey && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    openPicker();
  } else if (event.ctrlKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    focusSearch();
  } else if (event.ctrlKey && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    setMode(nextMode());
  } else if (event.ctrlKey && event.key.toLowerCase() === 't') {
    event.preventDefault();
    setUiTheme(nextUiTheme());
  } else if (event.key === 'F11') {
    event.preventDefault();
    toggleFullscreen();
  } else if (event.ctrlKey && event.key === '+') {
    event.preventDefault();
    zoomBy(0.1);
  } else if (event.ctrlKey && event.key === '-') {
    event.preventDefault();
    zoomBy(-0.1);
  } else if (
    event.key === 'ArrowRight' ||
    event.key === 'ArrowDown' ||
    event.key === 'PageDown' ||
    event.key === ' '
  ) {
    event.preventDefault();
    changePage(1);
  } else if (
    event.key === 'ArrowLeft' ||
    event.key === 'ArrowUp' ||
    event.key === 'PageUp'
  ) {
    event.preventDefault();
    changePage(-1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    scrollToPage(1);
  } else if (event.key === 'End') {
    event.preventDefault();
    scrollToPage(state.pageCount);
  }
});

['dragenter', 'dragover'].forEach(eventName => {
  els.canvasShell.addEventListener(eventName, event => {
    event.preventDefault();
    els.canvasShell.classList.add('dragging');
  });
});

['dragleave', 'drop'].forEach(eventName => {
  els.canvasShell.addEventListener(eventName, event => {
    event.preventDefault();
    els.canvasShell.classList.remove('dragging');
  });
});

els.canvasShell.addEventListener('drop', async event => {
  const file = event.dataTransfer?.files?.[0];
  if (file) await openPdfFromFile(file);
});

els.canvasShell.addEventListener('scroll', () => {
  scheduleRender();
});

window.addEventListener('resize', () => {
  if (state.pdf) {
    invalidateRenderedPages();
    scheduleRender();
  }
});

els.thumbsRail.addEventListener('scroll', () => {
  renderVisibleThumbs();
});

document.addEventListener('fullscreenchange', () => {
  state.isFullscreen = !!document.fullscreenElement;
  updateHeader();
});

loadSettings();
applyUiTheme();
els.shell.classList.toggle('sidebar-collapsed', !state.sidebarOpen);
updateHeader();
setStatus('Ready');
