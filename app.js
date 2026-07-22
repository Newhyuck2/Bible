const STORAGE_KEY = "side-by-side-bible:v1";
const RELOAD_RESET_KEY = "side-by-side-bible:reset-on-load";
const TRANSLATION_COLORS = {
  ESV: "#9b5c34",
  NIV: "#476f9b",
  KJV: "#79652f",
  NASB: "#42808a",
  NRSV: "#8a6d1f",
  GAE: "#2f7663",
  SAENEW: "#805692",
  WLB: "#a24f62",
  CNV: "#5d5fa0",
};
const TRANSLATION_GROUPS = [
  { label: "English", ids: ["ESV", "NIV", "KJV", "NASB", "NRSV"] },
  { label: "Korean", ids: ["GAE", "SAENEW", "WLB"] },
  { label: "Chinese", ids: ["CNV"] },
];
const TRANSLATION_CANONICAL_ORDER = TRANSLATION_GROUPS.flatMap((group) => group.ids);
const DEFAULT_ENABLED_TRANSLATIONS = ["NIV", "GAE"];
const ASSET_VERSION = document.querySelector('meta[name="asset-version"]').content;
const MOBILE_LAYOUT_QUERY = "(max-width: 820px), (max-width: 1366px) and (any-pointer: coarse)";
const mobileLayout = window.matchMedia(MOBILE_LAYOUT_QUERY);
const landscapeMobile = window.matchMedia(
  "(orientation: landscape) and (max-width: 1366px) and (any-pointer: coarse)",
);
const touchPanelToggleLayout = window.matchMedia(
  "(orientation: landscape) and (max-width: 1366px) and (any-pointer: coarse), "
    + "(min-width: 600px) and (max-width: 1366px) and (any-pointer: coarse)",
);
const phonePortraitLayout = window.matchMedia("(orientation: portrait) and (max-width: 599px)");
const portraitLayout = window.matchMedia("(orientation: portrait)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const panelTrack = document.querySelector("#panel-track");
const panelTemplate = document.querySelector("#panel-template");
const addPanelButton = document.querySelector("#add-panel");
const searchDialog = document.querySelector("#search-dialog");
const openSearchButton = document.querySelector("#open-search");
const closeSearchButton = document.querySelector("#close-search");
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const searchTranslationList = document.querySelector("#search-translation-list");
const searchTranslationPicker = document.querySelector("#search-translation-picker");
const searchTranslationPickerToggle = document.querySelector("#search-translation-picker-toggle");
const searchTranslationPickerMenu = document.querySelector("#search-translation-picker-menu");
const searchMeta = document.querySelector("#search-meta");
const searchBookList = document.querySelector("#search-book-list");
const searchResults = document.querySelector("#search-results");
const fontSizeDownButton = document.querySelector("#font-size-down");
const fontSizeUpButton = document.querySelector("#font-size-up");
const fontSizeValue = document.querySelector("#font-size-value");
const panelCountOneButton = document.querySelector("#panel-count-one");
const panelCountTwoButton = document.querySelector("#panel-count-two");
const copyDialog = document.querySelector("#copy-dialog");
const closeCopyButton = document.querySelector("#close-copy");
const cancelCopyButton = document.querySelector("#cancel-copy");
const confirmCopyButton = document.querySelector("#confirm-copy");
const copyReference = document.querySelector("#copy-reference");
const copyTranslations = document.querySelector("#copy-translations");
const copyTranslationPicker = document.querySelector("#copy-translation-picker");
const copyTranslationPickerToggle = document.querySelector("#copy-translation-picker-toggle");
const copyTranslationPickerMenu = document.querySelector("#copy-translation-picker-menu");
const copyStatus = document.querySelector("#copy-status");
const siteBrand = document.querySelector("#site-brand");
const downloadAppButton = document.querySelector("#download-app");
const downloadAppLabel = document.querySelector("#download-app-label");
const installHint = document.querySelector("#install-hint");
const installHintClose = document.querySelector("#install-hint-close");

let manifest;
let state;
let activePanelId;
let panelIdCounter = 0;
let searchRequestId = 0;
let copyPanelState = null;
let copyTranslationOrder = [];
let copyTranslationControl = null;
let searchTranslationOrder = [];
let searchTranslationControl = null;
let panelMutationInProgress = false;
let panelLayoutFrame = 0;
const chapterCache = new Map();
const panelElements = new Map();
const searchWorker = new Worker(`./search-worker.js?v=${ASSET_VERSION}`);

function freshState() {
  return {
    fontSize: 16,
    touchPanelCount: null,
    desktopPanelMode: null,
    copySelectionMode: "range",
    panels: [{
      book: 0,
      chapter: 1,
      verse: 1,
      enabledTranslations: [...DEFAULT_ENABLED_TRANSLATIONS],
      verseLayout: "stacked",
      history: [{ book: 0, chapter: 1, verse: 1 }],
      historyIndex: 0,
    }],
  };
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || !Array.isArray(stored.panels)) return freshState();
    return { ...freshState(), ...stored };
  } catch {
    return freshState();
  }
}

function sanitizeState() {
  const validTranslations = new Set(manifest.translations.map((item) => item.id));

  // Translations and verse layout used to be single global settings shared
  // by every panel; saves from before the per-panel switch carry them at
  // the top level here. Treat those as each panel's starting point, then
  // drop the globals so the per-panel fields are the only source of truth.
  let legacyEnabled = null;
  if (Array.isArray(state.enabledTranslations)) {
    legacyEnabled = state.enabledTranslations.filter((id) => validTranslations.has(id));
    if (Array.isArray(state.translationOrder)) {
      // Migrate saves from when a separate translationOrder drove the chip row.
      const position = new Map(state.translationOrder.map((id, index) => [id, index]));
      legacyEnabled.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
    }
    legacyEnabled = [...new Set(legacyEnabled)];
  }
  delete state.enabledTranslations;
  delete state.translationOrder;
  const legacyVerseLayout = state.verseLayout === "columns" ? "columns" : null;
  delete state.verseLayout;

  state.fontSize = Math.max(10, Math.min(Number(state.fontSize) || 16, 22));
  state.copySelectionMode = state.copySelectionMode === "individual" ? "individual" : "range";
  const savedPanelCount = Number(state.touchPanelCount);
  state.touchPanelCount = phonePortraitLayout.matches
    ? 1
    : savedPanelCount === 1 || savedPanelCount === 2
    ? savedPanelCount
    : landscapeMobile.matches ? 2 : 1;
  const savedDesktopMode = Number(state.desktopPanelMode);
  state.desktopPanelMode = savedDesktopMode === 1 || savedDesktopMode === 2
    ? savedDesktopMode
    : desktopLikePanels() ? 2 : null;
  state.panels = state.panels
    .map((panel) => {
      const book = Math.max(0, Math.min(Number(panel.book) || 0, manifest.books.length - 1));
      const chapter = Math.max(1, Math.min(Number(panel.chapter) || 1, manifest.books[book].chapters));
      const verse = Math.max(1, Number(panel.verse) || 1);
      const width = panel.width == null ? Number.NaN : Number(panel.width);
      const history = Array.isArray(panel.history)
        ? panel.history
            .map((item) => ({
              book: Math.max(0, Math.min(Number(item.book) || 0, manifest.books.length - 1)),
              chapter: Math.max(1, Math.min(Number(item.chapter) || 1, manifest.books[
                Math.max(0, Math.min(Number(item.book) || 0, manifest.books.length - 1))
              ].chapters)),
              verse: Math.max(1, Number(item.verse) || 1),
            }))
            .slice(-100)
        : [];
      if (!history.length) history.push({ book, chapter, verse });
      const historyIndex = Math.max(0, Math.min(Number(panel.historyIndex) || 0, history.length - 1));
      const enabledTranslations = [...new Set(
        (Array.isArray(panel.enabledTranslations) ? panel.enabledTranslations : legacyEnabled ?? DEFAULT_ENABLED_TRANSLATIONS)
          .filter((id) => validTranslations.has(id)),
      )];
      const verseLayout = panel.verseLayout === "columns" || panel.verseLayout === "stacked"
        ? panel.verseLayout
        : legacyVerseLayout ?? "stacked";
      return {
        book,
        chapter,
        verse,
        history,
        historyIndex,
        width: Number.isFinite(width) ? Math.max(1, Math.min(width, 5000)) : null,
        enabledTranslations,
        verseLayout,
      };
    })
    .slice(0, 12);
  if (!state.panels.length) state.panels = freshState().panels;
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      fontSize: state.fontSize,
      touchPanelCount: state.touchPanelCount,
      desktopPanelMode: state.desktopPanelMode,
      copySelectionMode: state.copySelectionMode,
      panels: state.panels.map(({ book, chapter, verse, history, historyIndex, width, enabledTranslations, verseLayout }) => ({
        book,
        chapter,
        verse,
        history,
        historyIndex,
        width,
        enabledTranslations,
        verseLayout,
      })),
    }),
  );
}

// Phones in landscape and tablets use the exact desktop panel mechanism
// (pixel widths, free scrolling, the 1/2/fit presets); only phone portrait
// keeps the one-panel pager.
function desktopLikePanels() {
  return !mobileLayout.matches || touchPanelToggleLayout.matches;
}

function forcePhonePortraitOnePanel() {
  if (!phonePortraitLayout.matches || !state) return false;
  panelTrack.classList.remove("fit-all-panels");
  resetPanelWidths();
  state.touchPanelCount = 1;
  return true;
}

// Touch layouts running the two-panel desktop preset keep the long-press
// panel swap (the hover move buttons need a mouse).
function isTwoPanelTouchMode() {
  return Boolean(state && touchPanelToggleLayout.matches && state.desktopPanelMode === 2);
}

function enabledTranslationIds(panelState) {
  return panelState ? panelState.enabledTranslations : [];
}

function effectiveVerseLayout(panelState) {
  return panelState?.verseLayout === "columns" ? "columns" : "stacked";
}

function updatePanelVerseLayoutControls(panelState) {
  const elements = panelElements.get(panelState.id);
  if (!elements) return;
  const effectiveLayout = effectiveVerseLayout(panelState);
  elements.verseLayoutStacked.classList.toggle("selected", effectiveLayout === "stacked");
  elements.verseLayoutColumns.classList.toggle("selected", effectiveLayout === "columns");
  elements.verseLayoutStacked.setAttribute("aria-pressed", String(effectiveLayout === "stacked"));
  elements.verseLayoutColumns.setAttribute("aria-pressed", String(effectiveLayout === "columns"));
}

function applyPanelVerseLayout(panelState) {
  const elements = panelElements.get(panelState.id);
  if (!elements) return;
  elements.panel.dataset.verseLayout = effectiveVerseLayout(panelState);
  updatePanelVerseLayoutControls(panelState);
  renderPanelBody(panelState);
}

function setPanelVerseLayout(panelState, layout) {
  if (layout !== "stacked" && layout !== "columns") return;
  panelState.verseLayout = layout;
  saveState();
  applyPanelVerseLayout(panelState);
}

function updatePanelCountControls() {
  if (!state) return;
  const desktop = desktopLikePanels();
  const oneSelected = desktop ? state.desktopPanelMode === 1 : state.touchPanelCount === 1;
  const twoSelected = desktop ? state.desktopPanelMode === 2 : state.touchPanelCount !== 1;
  panelCountOneButton.classList.toggle("selected", oneSelected);
  panelCountTwoButton.classList.toggle("selected", twoSelected);
  panelCountOneButton.setAttribute("aria-pressed", String(oneSelected));
  panelCountTwoButton.setAttribute("aria-pressed", String(twoSelected));
}

function panelAvailableWidth() {
  const trackStyle = getComputedStyle(panelTrack);
  const horizontalPadding = (Number.parseFloat(trackStyle.paddingLeft) || 0)
    + (Number.parseFloat(trackStyle.paddingRight) || 0);
  return Math.max(1, panelTrack.clientWidth - horizontalPadding);
}

function exactPanelFitWidth(count) {
  const gap = Number.parseFloat(getComputedStyle(panelTrack).columnGap) || 0;
  return Math.max(1, (panelAvailableWidth() - gap * (count - 1)) / count);
}

function applyPanelWidth(panel, width, important = false) {
  panel.style.removeProperty("flex-basis");
  panel.style.removeProperty("width");
  panel.style.setProperty("flex-basis", `${width}px`, important ? "important" : "");
  if (important) panel.style.setProperty("width", `${width}px`, "important");
}

function setAllDesktopPanelWidths(width, important = false) {
  for (const panelState of state.panels) {
    panelState.width = width;
    const elements = panelElements.get(panelState.id);
    if (elements) applyPanelWidth(elements.panel, width, important);
  }
}

function resetPanelWidths() {
  for (const panelState of state.panels) {
    panelState.width = null;
    const panel = panelElements.get(panelState.id)?.panel;
    if (!panel) continue;
    panel.style.removeProperty("flex-basis");
    panel.style.removeProperty("width");
  }
}

function applyDesktopPanelWidths() {
  if (!state?.desktopPanelMode) return;
  const count = state.desktopPanelMode === 2 ? 2 : 1;
  setAllDesktopPanelWidths(exactPanelFitWidth(count));
}

function setDesktopPanelMode(mode) {
  if (mode !== 1 && mode !== 2) return;
  panelTrack.classList.remove("fit-all-panels");
  state.desktopPanelMode = mode;
  applyDesktopPanelWidths();
  updatePanelCountControls();
  saveState();
  alignPanelsAfterLayoutChange(panelIndexAtViewportStart());
}

// Manually resizing a panel breaks the uniform widths the desktop one/two
// panel presets promise, so the preset selection is dropped. Saving is left
// to the caller.
function clearDesktopPanelMode() {
  if (!state?.desktopPanelMode) return;
  state.desktopPanelMode = null;
  updatePanelCountControls();
}

function visiblePanelSpan() {
  const trackRect = panelTrack.getBoundingClientRect();
  let first = -1;
  let count = 0;
  state.panels.forEach((panelState, index) => {
    const panel = panelElements.get(panelState.id)?.panel;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    if (rect.right > trackRect.left + 1 && rect.left < trackRect.right - 1) {
      if (first < 0) first = index;
      count += 1;
    }
  });
  return { first: Math.max(0, first), count: Math.max(1, count) };
}

// Desktop fits the panels currently on screen; touch layouts fit every panel
// into the screen, no matter how many panels are open.
function fitVisiblePanels() {
  if (mobileLayout.matches || state.panels.length < 2) return;
  const touchLayout = mobileLayout.matches;
  const { first, count: visibleCount } = visiblePanelSpan();
  const count = touchLayout ? state.panels.length : visibleCount;
  panelTrack.classList.toggle("fit-all-panels", touchLayout);
  setAllDesktopPanelWidths(exactPanelFitWidth(count), touchLayout);
  clearDesktopPanelMode();
  saveState();
  alignPanelsAfterLayoutChange(touchLayout ? 0 : first);
}

function alignPanelsAfterLayoutChange(index) {
  if (!state?.panels?.length || index < 0) return;
  const targetIndex = Math.max(0, Math.min(index, state.panels.length - 1));
  panelTrack.classList.add("panel-count-changing");
  requestAnimationFrame(() => {
    panelTrack.scrollLeft = panelScrollLeft(targetIndex);
    requestAnimationFrame(() => {
      panelTrack.scrollLeft = panelScrollLeft(targetIndex);
      panelTrack.classList.remove("panel-count-changing");
      panelTrack.scrollLeft = panelScrollLeft(targetIndex);
    });
  });
}

function applyTouchPanelCount(alignmentIndex = -1) {
  if (!state) return;
  forcePhonePortraitOnePanel();
  document.documentElement.dataset.touchPanelCount = String(state.touchPanelCount);
  updatePanelCountControls();
  if (panelElements.size) refreshPanelBodies();
  alignPanelsAfterLayoutChange(alignmentIndex);
}

function setTouchPanelCount(count) {
  if (count !== 1 && count !== 2) return;
  if (phonePortraitLayout.matches) {
    state.touchPanelCount = 1;
    saveState();
    applyTouchPanelCount(panelIndexAtViewportStart());
    return;
  }
  panelTrack.classList.remove("fit-all-panels");
  resetPanelWidths();
  const alignmentIndex = state.panels.length ? panelIndexAtViewportStart() : -1;
  state.touchPanelCount = count;
  saveState();
  applyTouchPanelCount(alignmentIndex);
}

function schedulePanelLayoutAlignment() {
  if (!state) return;
  cancelAnimationFrame(panelLayoutFrame);
  const activeIndex = state.panels.findIndex((panelState) => panelState.id === activePanelId);
  panelLayoutFrame = requestAnimationFrame(() => {
    if (touchPanelToggleLayout.matches) {
      panelTrack.classList.remove("fit-all-panels");
      if (state.desktopPanelMode !== 1 && state.desktopPanelMode !== 2) state.desktopPanelMode = 2;
      applyDesktopPanelWidths();
      saveState();
    }
    applyTouchPanelCount(Math.max(0, activeIndex));
  });
}

function resetSite() {
  if (searchDialog.open) closeSearch();
  if (copyDialog.open) closeCopyDialog();
  localStorage.removeItem(STORAGE_KEY);

  for (const { panel, translationControl } of panelElements.values()) {
    translationControl.destroy();
    panel.remove();
  }
  panelElements.clear();
  state = freshState();
  sanitizeState();
  if (desktopLikePanels()) {
    if (touchPanelToggleLayout.matches) state.desktopPanelMode = 2;
    state.panels[0].width = touchPanelToggleLayout.matches
      ? exactPanelFitWidth(state.desktopPanelMode === 2 ? 2 : 1)
      : exactPanelFitWidth(2);
  }
  applyTouchPanelCount();
  activePanelId = undefined;
  applyFontSize();
  for (const panel of state.panels) createPanelElement(panel);
  if (desktopLikePanels()) applyDesktopPanelWidths();
  saveState();

  searchInput.value = "";
  searchMeta.textContent = "";
  searchBookList.replaceChildren();
  searchResults.replaceChildren();
  searchRequestId += 1;
}

function resetStoredStateForReload() {
  const navigation = performance.getEntriesByType?.("navigation")?.[0];
  const legacyReload = performance.navigation?.type === 1;
  const flaggedReload = sessionStorage.getItem(RELOAD_RESET_KEY) === "1";
  sessionStorage.removeItem(RELOAD_RESET_KEY);
  if (navigation?.type === "reload" || legacyReload || flaggedReload) {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function translationMeta(id) {
  return manifest.translations.find((item) => item.id === id);
}

function translationLanguage(id) {
  if (id === "CNV") return "zh";
  return ["ESV", "NIV", "KJV", "NASB", "NRSV"].includes(id) ? "en" : "ko";
}

function canonicalTranslationRank(id) {
  const rank = TRANSLATION_CANONICAL_ORDER.indexOf(id);
  return rank >= 0 ? rank : TRANSLATION_CANONICAL_ORDER.length;
}

function insertTranslationInOrder(order, id) {
  if (!translationMeta(id) || order.includes(id)) return false;
  const rank = canonicalTranslationRank(id);
  let index = order.findIndex((existing) => canonicalTranslationRank(existing) > rank);
  if (index < 0) index = order.length;
  order.splice(index, 0, id);
  return true;
}

function moveTranslationInOrder(order, from, to) {
  if (from < 0 || to < 0 || from >= order.length || to >= order.length) return false;
  const [item] = order.splice(from, 1);
  order.splice(to, 0, item);
  return true;
}

function renderTranslationChipList({ list, order, onRemove, onMove }) {
  list.replaceChildren();

  for (const id of order) {
    const meta = translationMeta(id);
    if (!meta) continue;
    const chip = document.createElement("div");
    chip.className = "translation-chip";
    chip.draggable = true;
    chip.dataset.translation = id;
    chip.setAttribute("aria-label", `${meta.label} translation`);

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";
    handle.setAttribute("aria-hidden", "true");
    setupTouchReorder({
      item: chip,
      handle,
      container: list,
      itemClass: "translation-chip",
      id,
      getOrder: () => order,
      onReorder: onMove,
    });

    const name = document.createElement("span");
    name.className = "translation-name";
    name.lang = translationLanguage(id);
    name.textContent = meta.label;
    name.style.setProperty("--translation-color", TRANSLATION_COLORS[id]);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "chip-remove close-button";
    removeButton.setAttribute("aria-label", `Remove ${meta.label}`);
    removeButton.title = `Remove ${meta.label}`;
    const removeIcon = document.createElement("span");
    removeIcon.setAttribute("aria-hidden", "true");
    removeButton.append(removeIcon);
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      onRemove(id);
    });
    removeButton.addEventListener("pointerdown", (event) => event.stopPropagation());

    chip.addEventListener("dragstart", (event) => {
      chip.classList.add("dragging");
      event.dataTransfer.setData("text/plain", id);
      event.dataTransfer.effectAllowed = "move";
    });
    chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
    chip.addEventListener("dragover", (event) => event.preventDefault());
    chip.addEventListener("drop", (event) => {
      event.preventDefault();
      const draggedId = event.dataTransfer.getData("text/plain");
      const from = order.indexOf(draggedId);
      const to = order.indexOf(id);
      if (from >= 0 && to >= 0 && from !== to) onMove(from, to);
    });

    chip.append(handle, name, removeButton);
    list.append(chip);
  }

  // Deferred a frame so a dialog opening in this same tick (showModal right
  // after render) has already become visible — scrollWidth/clientWidth read
  // 0/0 on a still-hidden <dialog>, which would misjudge overflow.
  requestAnimationFrame(() => {
    list.classList.toggle("translation-list--overflowing", list.scrollWidth > list.clientWidth + 1);
  });
}

// Native HTML5 drag-and-drop (dragstart/dragover/drop) does not fire on touch
// input, so touch reordering is driven by Pointer Events instead: the dragged
// item is lifted with a transform, elementFromPoint finds the item underneath
// the finger, and the swap only happens once on release (mirroring the mouse
// drop handler above). Touch drags start only on the ⠿ handle so that a swipe
// on the item body stays a native scroll of the surrounding list.
function setupTouchReorder({ item, handle, container, itemClass, id, getOrder, onReorder }) {
  let suppressClick = false;

  item.addEventListener("click", (event) => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClick = false;
  }, true);

  item.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    if (handle && !handle.contains(event.target)) return;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let hoverTarget = null;
    let dragging = false;

    item.setPointerCapture(pointerId);

    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) < 6) return;
      if (!dragging) {
        dragging = true;
        item.classList.add("dragging");
        item.style.position = "relative";
        item.style.zIndex = "5";
        item.style.pointerEvents = "none";
        document.body.classList.add("reordering-chip");
      }
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      item.style.transform = `translate(${dx}px, ${dy}px)`;
      const target = document
        .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
        ?.closest(`.${itemClass}`);
      const next = target && target !== item && target.parentElement === container ? target : null;
      if (hoverTarget && hoverTarget !== next) hoverTarget.classList.remove("drag-over");
      hoverTarget = next;
      hoverTarget?.classList.add("drag-over");
    };

    const finish = (finishEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      if (item.hasPointerCapture(pointerId)) item.releasePointerCapture(pointerId);
      item.removeEventListener("pointermove", move);
      item.removeEventListener("pointerup", finish);
      item.removeEventListener("pointercancel", finish);
      item.classList.remove("dragging");
      item.style.position = "";
      item.style.zIndex = "";
      item.style.pointerEvents = "";
      item.style.transform = "";
      document.body.classList.remove("reordering-chip");
      hoverTarget?.classList.remove("drag-over");
      if (dragging) {
        finishEvent.preventDefault();
        suppressClick = true;
        window.setTimeout(() => {
          suppressClick = false;
        }, 350);
      }
      if (dragging && hoverTarget) {
        const order = getOrder();
        const from = order.indexOf(id);
        const to = order.indexOf(hoverTarget.dataset.translation);
        if (from >= 0 && to >= 0 && from !== to) onReorder(from, to);
      }
    };

    item.addEventListener("pointermove", move, { passive: false });
    item.addEventListener("pointerup", finish);
    item.addEventListener("pointercancel", finish);
  });
}

// Native-select feel for touch: a press that starts on `opener` opens the
// menu, sliding the finger highlights the option underneath (auto-scrolling
// near the menu's edges), and lifting on an option picks it. A drag that
// starts on the menu itself stays a normal scroll, and a plain tap falls
// through to the regular click handlers.
function setupPressDragPick({ opener, menu, optionSelector, onOpen, onPick, onGestureEnd }) {
  opener.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    onOpen?.();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const startMenuScrollTop = menu.scrollTop;
    let dragging = false;
    let highlighted = null;
    let lastX = startX;
    let lastY = startY;
    let scrollFrame = 0;

    try {
      opener.setPointerCapture(pointerId);
    } catch {
      return;
    }

    const optionUnder = (x, y) => {
      const option = document.elementFromPoint(x, y)?.closest(optionSelector);
      return option && menu.contains(option) ? option : null;
    };
    const setHighlight = (option) => {
      if (highlighted === option) return;
      highlighted?.classList.remove("highlighted");
      highlighted = option;
      highlighted?.classList.add("highlighted");
    };
    const autoScroll = () => {
      scrollFrame = 0;
      if (!dragging || menu.scrollHeight <= menu.clientHeight) return;
      const rect = menu.getBoundingClientRect();
      const delta = lastY < rect.top + 36 ? -8 : lastY > rect.bottom - 36 ? 8 : 0;
      if (!delta) return;
      menu.scrollTop += delta;
      setHighlight(optionUnder(lastX, lastY));
      scrollFrame = requestAnimationFrame(autoScroll);
    };

    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      if (!dragging && Math.hypot(lastX - startX, lastY - startY) < 7) return;
      dragging = true;
      moveEvent.preventDefault();
      menu.scrollTop = startMenuScrollTop - (lastY - startY);
      setHighlight(optionUnder(lastX, lastY));
      if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
    };
    const finish = (finishEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      opener.removeEventListener("pointermove", move);
      opener.removeEventListener("pointerup", finish);
      opener.removeEventListener("pointercancel", cancel);
      cancelAnimationFrame(scrollFrame);
      if (opener.hasPointerCapture(pointerId)) opener.releasePointerCapture(pointerId);
      const picked = dragging ? highlighted : null;
      setHighlight(null);
      if (dragging) finishEvent.preventDefault();
      if (picked) onPick(picked);
      if (dragging) onGestureEnd?.(Boolean(picked));
    };
    const cancel = (cancelEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      opener.removeEventListener("pointermove", move);
      opener.removeEventListener("pointerup", finish);
      opener.removeEventListener("pointercancel", cancel);
      cancelAnimationFrame(scrollFrame);
      setHighlight(null);
      if (dragging) onGestureEnd?.(false);
    };

    opener.addEventListener("pointermove", move, { passive: false });
    opener.addEventListener("pointerup", finish);
    opener.addEventListener("pointercancel", cancel);
  });
}

function renderDialogTranslationPickerMenu({ menu, picker, getOrder, onToggle }) {
  menu.replaceChildren();
  if (!manifest) return;
  const order = getOrder();
  for (const group of TRANSLATION_GROUPS) {
    const ids = group.ids.filter((id) => translationMeta(id));
    if (!ids.length) continue;
    const section = document.createElement("div");
    section.className = "translation-picker-group";
    const heading = document.createElement("div");
    heading.className = "translation-picker-group-label";
    heading.textContent = group.label;
    section.append(heading);
    for (const id of ids) {
      const meta = translationMeta(id);
      const isEnabled = order.includes(id);
      const option = document.createElement("button");
      option.type = "button";
      option.className = "translation-picker-option";
      option.classList.toggle("selected", isEnabled);
      option.dataset.translation = id;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(isEnabled));

      const label = document.createElement("span");
      label.className = "picker-label";
      label.lang = translationLanguage(id);
      label.textContent = meta.label;
      label.style.setProperty("--translation-color", TRANSLATION_COLORS[id]);
      const name = document.createElement("span");
      name.className = "picker-name";
      name.textContent = meta.name;

      option.addEventListener("click", () => {
        onToggle(id);
        renderDialogTranslationPickerMenu({ menu, picker, getOrder, onToggle });
        positionTranslationPickerMenuFor(picker, menu);
      });
      option.append(label, name);
      section.append(option);
    }
    menu.append(section);
  }
}

function positionTranslationPickerMenuFor(picker, menu) {
  if (menu.hidden) return;
  const inDialog = Boolean(picker.closest("dialog"));
  const width = menu.getBoundingClientRect().width;
  const anchor = picker.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  if (inDialog) {
    const gap = 6;
    const below = window.innerHeight - anchor.bottom - gap - 8;
    const above = anchor.top - gap - 8;
    const openAbove = below < 220 && above > below;
    const maxHeight = Math.max(160, Math.min(480, openAbove ? above : below));
    menu.style.position = "fixed";
    menu.style.right = "auto";
    menu.style.left = `${left}px`;
    menu.style.top = openAbove ? "auto" : `${anchor.bottom + gap}px`;
    menu.style.bottom = openAbove ? `${window.innerHeight - anchor.top + gap}px` : "auto";
    menu.style.maxHeight = `${maxHeight}px`;
    return;
  }
  menu.style.position = "";
  menu.style.right = "auto";
  menu.style.left = `${left - anchor.left}px`;
  menu.style.top = "";
  menu.style.bottom = "";
  menu.style.maxHeight = "";
}

function setupDialogTranslationControl({ picker, toggle, menu, list, getOrder, setOrder, onChange }) {
  let suppressClickUntil = 0;
  let openedByTouchPress = false;
  const controls = picker.closest(".translation-controls");

  const render = () => {
    renderTranslationChipList({
      list,
      order: getOrder(),
      onRemove: (id) => {
        setOrder(getOrder().filter((item) => item !== id));
        render();
        onChange?.();
      },
      onMove: (from, to) => {
        const order = [...getOrder()];
        if (!moveTranslationInOrder(order, from, to)) return;
        setOrder(order);
        render();
        onChange?.();
      },
    });
    if (!menu.hidden) renderDialogTranslationPickerMenu({ menu, picker, getOrder, onToggle });
  };

  const onToggle = (id) => {
    const order = [...getOrder()];
    if (order.includes(id)) {
      setOrder(order.filter((item) => item !== id));
    } else if (insertTranslationInOrder(order, id)) {
      setOrder(order);
    }
    render();
    onChange?.();
  };

  const open = () => {
    if (!menu.hidden) return;
    renderDialogTranslationPickerMenu({ menu, picker, getOrder, onToggle });
    menu.hidden = false;
    controls?.classList.add("translation-picker-open");
    positionTranslationPickerMenuFor(picker, menu);
    toggle.setAttribute("aria-expanded", "true");
  };

  const close = () => {
    openedByTouchPress = false;
    if (menu.hidden) return;
    menu.hidden = true;
    controls?.classList.remove("translation-picker-open");
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", () => {
    const openedByThisPress = openedByTouchPress;
    openedByTouchPress = false;
    if (Date.now() < suppressClickUntil) return;
    if (menu.hidden) open();
    else if (!openedByThisPress) close();
  });

  const onOutsidePointerDown = (event) => {
    if (menu.hidden) return;
    if (picker.contains(event.target)) return;
    close();
    shieldOutsidePress(event);
  };
  document.addEventListener("pointerdown", onOutsidePointerDown, true);

  const onKeydown = (event) => {
    if (event.key === "Escape" && !menu.hidden) close();
  };
  document.addEventListener("keydown", onKeydown);

  setupPressDragPick({
    opener: toggle,
    menu,
    optionSelector: ".translation-picker-option",
    onOpen: () => {
      if (!menu.hidden) return;
      open();
      openedByTouchPress = true;
    },
    onPick: (option) => option.click(),
    onGestureEnd: () => {
      suppressClickUntil = Date.now() + 500;
    },
  });

  // Callers wired to a panel (which can be destroyed mid-session, unlike the
  // two dialogs this was originally built for) must be able to drop these
  // document-level listeners so a removed panel's picker/menu aren't kept
  // alive forever by them.
  const destroy = () => {
    controls?.classList.remove("translation-picker-open");
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    document.removeEventListener("keydown", onKeydown);
  };

  return { render, open, close, destroy };
}

const HANGUL_INITIALS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

function hangulInitials(value) {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      if (code < 0xac00 || code > 0xd7a3) return character;
      return HANGUL_INITIALS[Math.floor((code - 0xac00) / 588)];
    })
    .join("");
}

function matchesBook(item, query) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  if (`${item.ko} ${item.en}`.toLocaleLowerCase().includes(needle)) return true;
  const compact = needle.replace(/\s+/g, "");
  return [...compact].every((character) => HANGUL_INITIALS.includes(character))
    && hangulInitials(item.ko).includes(compact);
}

function syncTrackFreeScroll() {
  panelTrack.classList.toggle("free-scroll", desktopLikePanels());
}
syncTrackFreeScroll();

mobileLayout.addEventListener("change", () => {
  updatePanelCountControls();
  syncTrackFreeScroll();
  if (!mobileLayout.matches) {
    for (const { panel } of panelElements.values()) setPanelChromeHidden(panel, false);
  }
});

// Swallow the press that closed an open dropdown so it cannot reach — and
// act on — whatever sits underneath (e.g. a verse tap starting copy mode).
// Only that press's own click is swallowed: a new press or a short timeout
// disarms the guard.
function shieldOutsidePress(event) {
  event.preventDefault();
  event.stopPropagation();
  const swallowClick = (clickEvent) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    disarm();
  };
  const disarm = () => {
    document.removeEventListener("click", swallowClick, true);
    document.removeEventListener("pointerdown", disarm, true);
    window.clearTimeout(timer);
  };
  document.addEventListener("click", swallowClick, true);
  document.addEventListener("pointerdown", disarm, true);
  const timer = window.setTimeout(disarm, 700);
}

// A press outside an open book/chapter dropdown closes it; the input's text
// snaps back to the current selection (the combo listens for combo-restore).
// On touch the press is fully swallowed — it only dismisses the menu.
document.addEventListener(
  "pointerdown",
  (event) => {
    let closedByTouch = false;
    for (const menu of document.querySelectorAll(".combo-menu:not([hidden])")) {
      const combo = menu.closest(".combo");
      if (!combo || combo.contains(event.target)) continue;
      const input = combo.querySelector(".combo-input");
      if (event.pointerType === "touch") closedByTouch = true;
      if (document.activeElement === input) {
        // Blur closes the menu, restores the label, and puts the on-screen
        // keyboard away; on desktop the focus shift does it naturally.
        if (event.pointerType === "touch") input.blur();
        continue;
      }
      menu.hidden = true;
      input.setAttribute("aria-expanded", "false");
      combo.dispatchEvent(new CustomEvent("combo-restore"));
    }
    if (closedByTouch) shieldOutsidePress(event);
  },
  true,
);

// The portrait two-row header keeps the "Holy Bible" label only while it
// fits. The panel-count control sits in the flexible column of the top row,
// so when space runs out it is the first thing pushed into the brand: that
// overlap is the signal to drop the label (and re-measure on every resize
// so it comes back as soon as it fits again).
const brandLabel = siteBrand.querySelector("span:last-child");
const panelCountControl = panelCountOneButton.closest(".panel-count-control");

function updateBrandLabelVisibility() {
  if (!brandLabel) return;
  document.body.classList.remove("brand-label-hidden");
  if (phonePortraitLayout.matches) return;
  if (!mobileLayout.matches || touchPanelToggleLayout.matches) return;
  const brandRect = siteBrand.getBoundingClientRect();
  const controlLeft = panelCountControl.getBoundingClientRect().left;
  if (controlLeft < brandRect.right + 2) {
    document.body.classList.add("brand-label-hidden");
  }
}

let brandLabelFrame = 0;
function scheduleBrandLabelUpdate() {
  window.cancelAnimationFrame(brandLabelFrame);
  brandLabelFrame = window.requestAnimationFrame(updateBrandLabelVisibility);
}

window.addEventListener("resize", scheduleBrandLabelUpdate);
mobileLayout.addEventListener("change", scheduleBrandLabelUpdate);
phonePortraitLayout.addEventListener("change", scheduleBrandLabelUpdate);
touchPanelToggleLayout.addEventListener("change", scheduleBrandLabelUpdate);
scheduleBrandLabelUpdate();

// On desktop, wheel scrolling anywhere outside the reading surface — the app
// header bar, each panel's header bar, and the empty strips around the panels
// — pans the panel track. Wheel ticks arrive in coarse jumps, so instead of
// stepping instantly the deltas accumulate into a target the track glides
// toward each frame.
let headerPanTarget = null;
let headerPanFrame = 0;
let desktopPanelSnapTimer = 0;
let desktopPanelSnapping = false;

function shouldSnapDesktopPanels() {
  return !mobileLayout.matches && Boolean(state?.desktopPanelMode);
}

function scheduleDesktopPanelSnap(delay = 140) {
  if (!shouldSnapDesktopPanels() || desktopPanelSnapping) return;
  window.clearTimeout(desktopPanelSnapTimer);
  desktopPanelSnapTimer = window.setTimeout(snapDesktopPanelsToNearest, delay);
}

function snapDesktopPanelsToNearest() {
  desktopPanelSnapTimer = 0;
  if (!shouldSnapDesktopPanels() || desktopPanelSnapping) return;
  if (headerPanTarget != null || headerPanFrame) {
    scheduleDesktopPanelSnap(120);
    return;
  }
  const targetLeft = panelScrollLeft(panelIndexAtViewportStart());
  if (Math.abs(panelTrack.scrollLeft - targetLeft) <= 1) {
    panelTrack.scrollTo({ left: targetLeft, behavior: "instant" });
    return;
  }
  desktopPanelSnapping = true;
  animateTrackScroll(targetLeft, 220, () => {
    desktopPanelSnapping = false;
  });
}

function stepHeaderPan() {
  headerPanFrame = 0;
  if (headerPanTarget == null) return;
  const current = panelTrack.scrollLeft;
  const remaining = headerPanTarget - current;
  if (Math.abs(remaining) <= 1) {
    panelTrack.scrollTo({ left: headerPanTarget, behavior: "instant" });
    headerPanTarget = null;
    scheduleDesktopPanelSnap(80);
    return;
  }
  const step = Math.sign(remaining) * Math.max(1, Math.abs(remaining) * 0.16);
  panelTrack.scrollTo({ left: current + step, behavior: "instant" });
  headerPanFrame = requestAnimationFrame(stepHeaderPan);
}

function isWheelPanRegion(target) {
  if (!(target instanceof Element)) return false;
  // An open combo dropdown scrolls its own option list.
  if (target.closest(".combo-menu")) return false;
  if (target.closest(".app-header") || target.closest(".panel-header")) return true;
  // The track and workspace are only hit directly in the gaps around panels.
  return target === panelTrack || target.classList.contains("workspace");
}

document.addEventListener(
  "wheel",
  (event) => {
    if (mobileLayout.matches || !state?.panels?.length) return;
    if (!isWheelPanRegion(event.target)) return;
    const unit = event.deltaMode === 1 ? 16 : 1;
    const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit;
    if (!delta) return;
    event.preventDefault();
    const maxScroll = Math.max(0, panelTrack.scrollWidth - panelTrack.clientWidth);
    const base = headerPanTarget ?? panelTrack.scrollLeft;
    headerPanTarget = Math.max(0, Math.min(base + delta, maxScroll));
    if (reducedMotion.matches) {
      panelTrack.scrollTo({ left: headerPanTarget, behavior: "instant" });
      headerPanTarget = null;
      scheduleDesktopPanelSnap(80);
      return;
    }
    if (!headerPanFrame) headerPanFrame = requestAnimationFrame(stepHeaderPan);
  },
  { passive: false },
);

// A selected desktop preset means "full screen" or "half screen", so the
// widths follow the window when it is resized.
let desktopModeResizeTimer = 0;
window.addEventListener("resize", () => {
  if (!desktopLikePanels() || !state?.desktopPanelMode) return;
  window.clearTimeout(desktopModeResizeTimer);
  desktopModeResizeTimer = window.setTimeout(() => {
    const alignmentIndex = panelIndexAtViewportStart();
    applyDesktopPanelWidths();
    alignPanelsAfterLayoutChange(alignmentIndex);
    saveState();
  }, 150);
});

panelTrack.addEventListener(
  "scroll",
  () => {
    if (
      desktopPanelSnapping
      || headerPanTarget != null
      || panelTrack.classList.contains("panel-count-changing")
      || panelTrack.classList.contains("removing-panel")
    ) {
      return;
    }
    scheduleDesktopPanelSnap();
  },
  { passive: true },
);

function panelScrollLeft(index) {
  const panelState = state.panels[index];
  const panel = panelState ? panelElements.get(panelState.id)?.panel : null;
  if (!panel) return panelTrack.scrollLeft;
  const paddingLeft = Number.parseFloat(getComputedStyle(panelTrack).paddingLeft) || 0;
  return Math.max(0, panel.offsetLeft - paddingLeft);
}

function panelIndexAtViewportStart() {
  if (!state?.panels?.length) return 0;
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  state.panels.forEach((panelState, index) => {
    if (!panelElements.has(panelState.id)) return;
    const distance = Math.abs(panelTrack.scrollLeft - panelScrollLeft(index));
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });
  return closestIndex;
}

function scrollToPanelIndex(index, behavior = "smooth", activate = true) {
  if (!state.panels.length) return;
  const targetIndex = Math.max(0, Math.min(index, state.panels.length - 1));
  panelTrack.scrollTo({ left: panelScrollLeft(targetIndex), behavior });
  const targetState = state.panels[targetIndex];
  if (activate && targetState) setActivePanel(targetState.id);
}

function setupCombobox({ input, menu, items, selectedValue, matches, onSelect }) {
  let allItems = items;
  let selected = selectedValue;
  let filtered = [];
  let highlighted = 0;
  const comboKind = menu.closest(".book-combo")
    ? "book"
    : menu.closest(".chapter-combo")
      ? "chapter"
      : menu.closest(".verse-combo")
        ? "verse"
        : "";

  function selectedItem() {
    return allItems.find((item) => item.value === selected);
  }

  function close() {
    menu.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }

  function resetMenuPosition() {
    menu.style.removeProperty("left");
    menu.style.removeProperty("right");
    menu.style.removeProperty("width");
  }

  function positionMenu() {
    if (comboKind !== "book" || !mobileLayout.matches) {
      resetMenuPosition();
      return;
    }
    const combo = input.closest(".combo");
    const boundary = input.closest(".panel-selectors");
    if (!combo || !boundary) return;
    const comboRect = combo.getBoundingClientRect();
    const boundaryRect = boundary.getBoundingClientRect();
    if (!comboRect.width || !boundaryRect.width) return;
    menu.style.left = `${Math.round(boundaryRect.left - comboRect.left)}px`;
    menu.style.right = "auto";
    menu.style.width = `${Math.floor(boundaryRect.width)}px`;
  }

  function choose(item, notify = true) {
    if (!item) return;
    selected = item.value;
    input.value = item.label;
    close();
    if (notify) onSelect(item.value);
  }

  function menuHeading(text, extraClass = "") {
    const heading = document.createElement("div");
    heading.className = `combo-menu-heading${extraClass ? ` ${extraClass}` : ""}`;
    heading.textContent = text;
    return heading;
  }

  function render(query = "") {
    filtered = allItems.filter((item) => matches(item, query));
    // With no query, start the list from the current selection instead of
    // the top; while typing, keep the first match highlighted.
    const selectedIndex = query.trim() ? -1 : filtered.findIndex((item) => item.value === selected);
    highlighted = selectedIndex >= 0 ? selectedIndex : 0;
    menu.replaceChildren();
    const emptyQuery = !query.trim();
    if (emptyQuery && comboKind === "chapter") menu.append(menuHeading("CHAPTER"));
    if (emptyQuery && comboKind === "verse") menu.append(menuHeading("VERSE"));
    let addedNewTestamentHeading = false;
    if (emptyQuery && comboKind === "book") {
      menu.append(menuHeading("OLD TESTAMENT", "combo-menu-heading-old"));
    }
    for (const [index, item] of filtered.entries()) {
      if (
        emptyQuery &&
        comboKind === "book" &&
        !addedNewTestamentHeading &&
        item.testament === "new"
      ) {
        menu.append(menuHeading("NEW TESTAMENT", "combo-menu-heading-new"));
        addedNewTestamentHeading = true;
      }
      const option = document.createElement("button");
      option.type = "button";
      option.className = "combo-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(item.value === selected));
      option.textContent = item.label;
      option.addEventListener("click", () => choose(item));
      if (index === highlighted) option.classList.add("highlighted");
      menu.append(option);
    }
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "combo-empty";
      empty.textContent = "No matches";
      menu.append(empty);
    }
    if (query.trim()) menu.scrollTop = 0;
  }

  function updateHighlight(nextIndex) {
    if (!filtered.length) return;
    highlighted = (nextIndex + filtered.length) % filtered.length;
    menu.querySelectorAll(".combo-option").forEach((option, index) => {
      option.classList.toggle("highlighted", index === highlighted);
    });
    menu.querySelectorAll(".combo-option")[highlighted]?.scrollIntoView({ block: "nearest" });
  }

  function moveHighlight(nextIndex) {
    if (!filtered.length) return false;
    if (nextIndex < 0 || nextIndex >= filtered.length) return false;
    updateHighlight(nextIndex);
    return true;
  }

  function keyboardTarget(key) {
    const options = [...menu.querySelectorAll(".combo-option")];
    const current = options[highlighted];
    if (!current) return null;
    const currentRect = current.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;
    const sameRowTolerance = currentRect.height * 0.55;
    const sameColumnTolerance = currentRect.width * 0.55;
    let bestIndex = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const [index, option] of options.entries()) {
      if (index === highlighted) continue;
      const rect = option.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const dx = x - currentX;
      const dy = y - currentY;
      let valid = false;
      let score = Number.POSITIVE_INFINITY;
      if (key === "ArrowRight" && dx > 0 && Math.abs(dy) <= sameRowTolerance) {
        valid = true;
        score = dx + Math.abs(dy) * 8;
      } else if (key === "ArrowLeft" && dx < 0 && Math.abs(dy) <= sameRowTolerance) {
        valid = true;
        score = Math.abs(dx) + Math.abs(dy) * 8;
      } else if (key === "ArrowDown" && dy > 0 && Math.abs(dx) <= sameColumnTolerance) {
        valid = true;
        score = dy + Math.abs(dx) * 8;
      } else if (key === "ArrowUp" && dy < 0 && Math.abs(dx) <= sameColumnTolerance) {
        valid = true;
        score = Math.abs(dy) + Math.abs(dx) * 8;
      }
      if (valid && score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  function centerHighlighted() {
    const option = menu.querySelectorAll(".combo-option")[highlighted];
    if (!option) return;
    menu.scrollTop = option.offsetTop - (menu.clientHeight - option.offsetHeight) / 2;
  }

  // Opening fresh empties the input (ready to type) and shows the full list
  // scrolled so the current selection sits centered; the selection itself is
  // kept and snaps back if the menu is left without choosing.
  function open(clearText = false, focusInput = false) {
    if (clearText) input.value = "";
    render(clearText ? "" : input.value === selectedItem()?.label ? "" : input.value);
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
    positionMenu();
    if (focusInput) input.focus({ preventScroll: true });
    centerHighlighted();
  }

  let menuPointerActive = false;

  input.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" || !mobileLayout.matches) return;
    event.preventDefault();
    if (menu.hidden) open(true);
    input.blur();
  });
  input.addEventListener("focus", () => {
    if (menu.hidden) open(true);
  });
  input.addEventListener("click", () => {
    if (menu.hidden) open(true);
  });
  input.addEventListener("input", () => {
    render(input.value);
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
    positionMenu();
  });
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight"
    ) {
      event.preventDefault();
      if (menu.hidden) open();
      const nextIndex = keyboardTarget(event.key);
      if (nextIndex != null) moveHighlight(nextIndex);
    } else if (event.key === "Enter") {
      if (!menu.hidden && filtered.length) {
        event.preventDefault();
        choose(filtered[highlighted]);
      }
    } else if (event.key === "Escape") {
      close();
      input.value = selectedItem()?.label ?? "";
    }
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (menuPointerActive) return;
      close();
      input.value = selectedItem()?.label ?? "";
    }, 100);
  });
  const releaseMenuPointer = () => {
    window.setTimeout(() => {
      menuPointerActive = false;
    }, 150);
  };
  menu.addEventListener("pointerdown", (event) => {
    menuPointerActive = true;
    const pointerId = event.pointerId;
    const release = (releaseEvent) => {
      if (releaseEvent.pointerId !== pointerId) return;
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      releaseMenuPointer();
    };
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
  });
  // The outside-press closer (see the document pointerdown listener) asks
  // the combo to put the selected label back after it hides the menu.
  input.closest(".combo").addEventListener("combo-restore", () => {
    input.value = selectedItem()?.label ?? "";
  });

  choose(selectedItem(), false);
  close();

  return {
    open,
    close,
    setItems(nextItems) {
      allItems = nextItems;
      render();
    },
    setValue(value) {
      selected = value;
      choose(selectedItem(), false);
    },
  };
}

// Momentum for continuous touch panning: the track keeps gliding with the
// finger's release velocity (px per ms) and decays.
let panelGlideFrame = 0;
const TOUCH_PANEL_FLICK_VELOCITY = 0.55;
const TOUCH_PANEL_FLICK_DISTANCE = 24;

function cancelPanelGlide() {
  cancelAnimationFrame(panelGlideFrame);
  panelGlideFrame = 0;
}

function startPanelGlide(velocity) {
  cancelPanelGlide();
  if (!Number.isFinite(velocity) || Math.abs(velocity) < 0.08 || reducedMotion.matches) return;
  let speed = Math.max(-4, Math.min(velocity, 4));
  let previous = performance.now();
  const step = (now) => {
    panelGlideFrame = 0;
    const elapsed = Math.min(now - previous, 40);
    previous = now;
    panelTrack.scrollLeft += speed * elapsed;
    speed *= 0.95 ** (elapsed / 16);
    const maxScroll = Math.max(0, panelTrack.scrollWidth - panelTrack.clientWidth);
    if (Math.abs(speed) < 0.04 || panelTrack.scrollLeft <= 0 || panelTrack.scrollLeft >= maxScroll) return;
    panelGlideFrame = requestAnimationFrame(step);
  };
  panelGlideFrame = requestAnimationFrame(step);
}

function snapTouchPanelsAfterSwipe({ velocityX = 0, startIndex = null, totalDeltaX = 0 } = {}) {
  if (!mobileLayout.matches) return false;
  if (!phonePortraitLayout.matches && (!touchPanelToggleLayout.matches || !state?.desktopPanelMode)) {
    return false;
  }
  cancelPanelGlide();
  let targetIndex = panelIndexAtViewportStart();
  const isFlick = Math.abs(velocityX) >= TOUCH_PANEL_FLICK_VELOCITY
    && Math.abs(totalDeltaX) >= TOUCH_PANEL_FLICK_DISTANCE;
  if (isFlick) {
    const baseIndex = Number.isInteger(startIndex) ? startIndex : targetIndex;
    const direction = velocityX < 0 ? 1 : -1;
    targetIndex = Math.max(0, Math.min(baseIndex + direction, state.panels.length - 1));
  }
  animateTrackScroll(panelScrollLeft(targetIndex), 220);
  return true;
}

function setPanelChromeHidden(panelOrState, hidden) {
  const panel = panelOrState instanceof Element
    ? panelOrState
    : panelElements.get(panelOrState?.id)?.panel;
  if (!panel) return;
  if (hidden && panel._chromeRevealUntil && performance.now() < panel._chromeRevealUntil) return;
  const content = panel.querySelector(".panel-content");
  const canHide = !panel.classList.contains("selection-active")
    && (!content || content.scrollTop > 1);
  panel.classList.toggle("touch-chrome-hidden", Boolean(hidden && canHide));
}

// The panel header/chapter-jump reveal animates over 180ms (see the
// touch-chrome-hidden transition in styles.css), which continuously resizes
// the content row as it plays. Correcting the scroll anchor at only a few
// fixed checkpoints let the verses drift between corrections and snap back,
// reading as a vertical wobble. Re-anchoring every animation frame for the
// full transition keeps the verses visually still while only the chrome
// grows in above them.
const CHROME_REVEAL_TRACK_MS = 220;

function revealPanelChrome(panel, preserveContent = false) {
  if (!panel?.classList.contains("touch-chrome-hidden")) return;
  const content = panel.querySelector(".panel-content");
  const anchor = preserveContent ? captureContentAnchor(content) : null;
  panel._chromeRevealUntil = performance.now() + CHROME_REVEAL_TRACK_MS + 80;
  setPanelChromeHidden(panel, false);
  if (!anchor) return;
  const start = performance.now();
  const track = (now) => {
    restoreContentAnchor(content, anchor);
    if (now - start < CHROME_REVEAL_TRACK_MS) requestAnimationFrame(track);
  };
  requestAnimationFrame(track);
}

function captureContentAnchor(content) {
  if (!content) return null;
  const contentRect = content.getBoundingClientRect();
  const verse = [...content.querySelectorAll(".verse-group")]
    .find((group) => group.getBoundingClientRect().bottom > contentRect.top + 1);
  if (!verse) return { element: content, top: contentRect.top };
  return { element: verse, top: verse.getBoundingClientRect().top };
}

function restoreContentAnchor(content, anchor) {
  if (!content || !anchor?.element?.isConnected) return;
  const drift = anchor.element.getBoundingClientRect().top - anchor.top;
  if (Math.abs(drift) > 0.5) content.scrollTop += drift;
}

// Horizontal touch drags on a panel pan the track by hand, following the
// finger position directly with momentum on release.
function setupPanelSwipe(panel) {
  let gesture = null;
  let suppressClick = false;
  const findTouch = (touches, id) => {
    for (let index = 0; index < touches.length; index += 1) {
      if (touches[index].identifier === id) return touches[index];
    }
    return null;
  };
  const shouldIgnoreSwipeStart = (target) => (
    target.closest("button, input, textarea, select, .combo-menu, .panel-resize-handle")
  );
  // A touch that lands while the content is still coasting from momentum
  // scrolling is meant to arrest that motion, not to ask for the chrome
  // back — suppress the reveal-on-tap click that would otherwise follow.
  const CHROME_REVEAL_SCROLL_SETTLE_MS = 150;
  const isContentCoasting = (content) => (
    Boolean(content) && performance.now() - (content._lastScrollAt ?? 0) < CHROME_REVEAL_SCROLL_SETTLE_MS
  );
  // Chrome-reveal-on-tap is decided at touchend/click, never at touchstart:
  // deciding immediately would mean preventDefault-ing every touch that
  // lands on hidden chrome, which cancels native scrolling for the whole
  // gesture and makes it impossible to start a fresh drag from a stopped,
  // chrome-hidden panel.
  const suppressRevealIfCoasting = (event) => {
    if (!panel.classList.contains("touch-chrome-hidden")) return;
    if (shouldIgnoreSwipeStart(event.target)) return;
    if (!isContentCoasting(panel.querySelector(".panel-content"))) return;
    suppressClick = true;
    window.setTimeout(() => {
      suppressClick = false;
    }, 350);
  };

  panel.addEventListener("click", (event) => {
    if (suppressClick) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!panel.classList.contains("touch-chrome-hidden")) return;
    if (shouldIgnoreSwipeStart(event.target)) return;
    revealPanelChrome(panel, true);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  panel.addEventListener("touchstart", (event) => {
    suppressRevealIfCoasting(event);
    cancelPanelGlide();
    if (event.touches.length !== 1) {
      gesture = null;
      document.body.classList.remove("swiping-panels");
      return;
    }
    if (!mobileLayout.matches) return;
    if (shouldIgnoreSwipeStart(event.target)) return;
    const touch = event.touches[0];
    gesture = {
      touchId: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      startScrollLeft: panelTrack.scrollLeft,
      startIndex: panelIndexAtViewportStart(),
      axis: null,
      samples: [{ time: performance.now(), x: touch.clientX }],
    };
  }, { passive: true });

  panel.addEventListener("touchmove", (event) => {
    if (!gesture) return;
    if (event.touches.length !== 1) {
      gesture = null;
      document.body.classList.remove("swiping-panels");
      return;
    }
    if (panelTrack.classList.contains("panel-reorder-active")) {
      gesture = null;
      return;
    }
    const touch = findTouch(event.touches, gesture.touchId);
    if (!touch) return;
    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    const distanceX = Math.abs(deltaX);
    const distanceY = Math.abs(deltaY);

    if (!gesture.axis && Math.max(distanceX, distanceY) >= 3) {
      gesture.axis = distanceX > distanceY ? "horizontal" : "vertical";
      setPanelChromeHidden(panel, true);
    }
    if (gesture.axis !== "horizontal") return;
    if (state.panels.length < 2) return;

    event.preventDefault();
    document.body.classList.add("swiping-panels");
    panelTrack.scrollLeft = gesture.startScrollLeft - deltaX;
    const now = performance.now();
    gesture.samples.push({ time: now, x: touch.clientX });
    while (gesture.samples.length > 8 || now - gesture.samples[0].time > 160) {
      gesture.samples.shift();
    }
  }, { passive: false });

  const finish = (event, cancelled = false) => {
    if (!gesture) return;
    const touch = findTouch(event.changedTouches, gesture.touchId);
    if (!touch) return;
    const hadDrag = Boolean(gesture.axis);
    if (gesture.axis === "horizontal") {
      const samples = gesture.samples;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const velocityX = first && last && last.time > first.time
        ? (last.x - first.x) / (last.time - first.time)
        : 0;
      if (snapTouchPanelsAfterSwipe({
        velocityX: cancelled ? 0 : velocityX,
        startIndex: gesture.startIndex,
        totalDeltaX: touch.clientX - gesture.startX,
      })) {
        // The one/two-panel touch presets always land on a panel edge.
      } else if (!cancelled && first && last && last.time > first.time) {
        startPanelGlide(-velocityX);
      }

      suppressClick = true;
      window.setTimeout(() => {
        suppressClick = false;
      }, 400);
    } else if (hadDrag) {
      suppressClick = true;
      window.setTimeout(() => {
        suppressClick = false;
      }, 300);
    }
    document.body.classList.remove("swiping-panels");
    gesture = null;
  };

  panel.addEventListener("touchend", (event) => finish(event));
  panel.addEventListener("touchcancel", (event) => finish(event, true));
}

function chapterItems(bookIndex) {
  return Array.from({ length: manifest.books[bookIndex].chapters }, (_, index) => ({
    value: index + 1,
    label: String(index + 1),
  }));
}

function verseItems(panelState) {
  const verses = panelState.data?.v?.map(([verse]) => Number(verse)).filter(Number.isFinite) ?? [1];
  return verses.map((verse) => ({ value: verse, label: String(verse) }));
}

function verseItemsFromChapterData(data) {
  const verses = data?.v?.map(([verse]) => Number(verse)).filter(Number.isFinite) ?? [1];
  return verses.map((verse) => ({ value: verse, label: String(verse) }));
}

function normalizePassage(book, chapter, verse = 1) {
  const normalizedBook = Math.max(0, Math.min(Number(book) || 0, manifest.books.length - 1));
  const normalizedChapter = Math.max(
    1,
    Math.min(Number(chapter) || 1, manifest.books[normalizedBook].chapters),
  );
  return {
    book: normalizedBook,
    chapter: normalizedChapter,
    verse: Math.max(1, Number(verse) || 1),
  };
}

function samePassage(a, b) {
  return Boolean(a && b && a.book === b.book && a.chapter === b.chapter && a.verse === b.verse);
}

function currentPassage(panelState) {
  return normalizePassage(panelState.book, panelState.chapter, panelState.verse);
}

function ensurePanelHistory(panelState) {
  if (!Array.isArray(panelState.history) || !panelState.history.length) {
    panelState.history = [currentPassage(panelState)];
    panelState.historyIndex = 0;
  }
  panelState.historyIndex = Math.max(
    0,
    Math.min(Number(panelState.historyIndex) || 0, panelState.history.length - 1),
  );
}

function recordPanelHistory(panelState, passage = currentPassage(panelState)) {
  ensurePanelHistory(panelState);
  if (samePassage(panelState.history[panelState.historyIndex], passage)) return;
  panelState.history = panelState.history.slice(0, panelState.historyIndex + 1);
  panelState.history.push(passage);
  if (panelState.history.length > 100) panelState.history.shift();
  panelState.historyIndex = panelState.history.length - 1;
}

function maximumPanelWidth() {
  return Math.max(320, panelAvailableWidth());
}

function setupPanelResize(panel, handle, panelState) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    document.body.classList.add("resizing-panel");
    handle.setPointerCapture(event.pointerId);

    const resize = (moveEvent) => {
      const width = Math.max(320, Math.min(startWidth + moveEvent.clientX - startX, maximumPanelWidth()));
      panelState.width = Math.round(width);
      applyPanelWidth(panel, panelState.width);
      clearDesktopPanelMode();
    };
    const finish = () => {
      document.body.classList.remove("resizing-panel");
      handle.removeEventListener("pointermove", resize);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      saveState();
    };

    handle.addEventListener("pointermove", resize);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });

  handle.addEventListener("dblclick", () => {
    panelState.width = null;
    panel.style.removeProperty("flex-basis");
    panel.style.removeProperty("width");
    clearDesktopPanelMode();
    saveState();
  });
}

function setupPanelMoveReveal(panel, moveLeft, moveRight) {
  const clear = () => {
    moveLeft.classList.remove("revealed");
    moveRight.classList.remove("revealed");
  };

  panel.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    const rect = panel.getBoundingClientRect();
    const nearMiddle = Math.abs(event.clientY - (rect.top + rect.height / 2)) <= 82;
    moveLeft.classList.toggle("revealed", nearMiddle && event.clientX - rect.left <= 64);
    moveRight.classList.toggle("revealed", nearMiddle && rect.right - event.clientX <= 64);
  });
  panel.addEventListener("pointerleave", clear);
}

function createPanelElement(panelState, shouldScroll = false) {
  const id = `panel-${++panelIdCounter}`;
  panelState.id = id;
  const fragment = panelTemplate.content.cloneNode(true);
  const panel = fragment.querySelector(".bible-panel");
  const header = fragment.querySelector(".panel-header");
  const bookInput = fragment.querySelector(".book-input");
  const chapterInput = fragment.querySelector(".chapter-input");
  const verseInput = fragment.querySelector(".verse-input");
  const content = fragment.querySelector(".panel-content");
  const translationPickerEl = fragment.querySelector(".panel-translation-picker");
  const translationPickerToggleEl = fragment.querySelector(".panel-translation-picker-toggle");
  const translationPickerMenuEl = fragment.querySelector(".panel-translation-picker-menu");
  const translationListEl = fragment.querySelector(".panel-translation-list");
  const verseLayoutStackedEl = fragment.querySelector(".panel-verse-layout-stacked");
  const verseLayoutColumnsEl = fragment.querySelector(".panel-verse-layout-columns");
  const copy = fragment.querySelector(".copy-selection");
  const selectionModeControl = fragment.querySelector(".selection-mode-control");
  const selectionModeRange = fragment.querySelector(".selection-mode-range");
  const selectionModeIndividual = fragment.querySelector(".selection-mode-individual");
  const cancelSelection = fragment.querySelector(".cancel-selection");
  const remove = fragment.querySelector(".remove-panel");
  const historyBack = fragment.querySelector(".panel-history-back");
  const historyForward = fragment.querySelector(".panel-history-forward");
  const moveLeft = fragment.querySelector(".panel-move-left");
  const moveRight = fragment.querySelector(".panel-move-right");
  const previous = fragment.querySelector(".previous-chapter");
  const next = fragment.querySelector(".next-chapter");
  const resizeHandle = fragment.querySelector(".panel-resize-handle");

  panel.dataset.panelId = id;
  panelState.selectionAnchor = null;
  panelState.selectionEnd = null;
  panelState.selectedVerses = new Set();
  panelState.selectionMode = state.copySelectionMode;
  panelState.verse = Number(panelState.verse) || 1;
  ensurePanelHistory(panelState);
  if (panelState.width) {
    const renderedWidth = desktopLikePanels()
      ? Math.min(panelState.width, maximumPanelWidth())
      : panelState.width;
    applyPanelWidth(panel, renderedWidth, mobileLayout.matches && !desktopLikePanels());
  }
  panel.addEventListener("pointerdown", () => setActivePanel(id));
  panel.addEventListener("focusin", () => setActivePanel(id));
  content.addEventListener("scroll", () => {
    content._lastScrollAt = performance.now();
    if (content.scrollTop <= 1) setPanelChromeHidden(panel, false);
    else setPanelChromeHidden(panel, true);
  }, { passive: true });

  const bookItems = manifest.books.map((book, index) => ({
    value: index,
    label: `${book.en} ${book.ko}`,
    ko: book.ko,
    en: book.en,
    testament: index < 39 ? "old" : "new",
  }));
  let chapterCombo;
  let verseCombo;
  const openComboSoon = (combo) => {
    requestAnimationFrame(() => combo.open(true, !mobileLayout.matches));
  };
  const ensureDraft = () => {
    if (!panelState.pendingPassage) panelState.pendingPassage = currentPassage(panelState);
    return panelState.pendingPassage;
  };
  const openVerseOptionsForDraft = async () => {
    const draft = ensureDraft();
    try {
      const data = await getChapter(draft.book, draft.chapter);
      const items = verseItemsFromChapterData(data);
      draft.verse = Math.max(1, Math.min(Number(draft.verse) || 1, items.at(-1)?.value ?? 1));
      verseCombo.setItems(items);
      verseCombo.setValue(draft.verse);
      openComboSoon(verseCombo);
    } catch {
      verseCombo.setItems([{ value: 1, label: "1" }]);
      verseCombo.setValue(1);
      openComboSoon(verseCombo);
    }
  };
  const bookCombo = setupCombobox({
    input: bookInput,
    menu: fragment.querySelector(".book-combo .combo-menu"),
    items: bookItems,
    selectedValue: panelState.book,
    matches: matchesBook,
    onSelect: (book) => {
      const draft = ensureDraft();
      draft.book = book;
      draft.chapter = 1;
      draft.verse = 1;
      chapterCombo.setItems(chapterItems(book));
      chapterCombo.setValue(1);
      verseCombo.setItems([{ value: 1, label: "1" }]);
      verseCombo.setValue(1);
      openComboSoon(chapterCombo);
    },
  });
  chapterCombo = setupCombobox({
    input: chapterInput,
    menu: fragment.querySelector(".chapter-combo .combo-menu"),
    items: chapterItems(panelState.book),
    selectedValue: panelState.chapter,
    matches: (item, query) => !query.trim() || item.label.startsWith(query.trim()),
    onSelect: (chapter) => {
      const draft = ensureDraft();
      draft.chapter = chapter;
      draft.verse = 1;
      verseCombo.setItems([{ value: 1, label: "1" }]);
      verseCombo.setValue(1);
      openVerseOptionsForDraft();
    },
  });
  verseCombo = setupCombobox({
    input: verseInput,
    menu: fragment.querySelector(".verse-combo .combo-menu"),
    items: [{ value: panelState.verse, label: String(panelState.verse) }],
    selectedValue: panelState.verse,
    matches: (item, query) => !query.trim() || item.label.startsWith(query.trim()),
    onSelect: (verse) => {
      const draft = panelState.pendingPassage ?? currentPassage(panelState);
      panelState.pendingPassage = null;
      goToPassage(panelState, { ...draft, verse }, { record: true });
    },
  });
  const translationControl = setupDialogTranslationControl({
    picker: translationPickerEl,
    toggle: translationPickerToggleEl,
    menu: translationPickerMenuEl,
    list: translationListEl,
    getOrder: () => panelState.enabledTranslations,
    setOrder: (order) => {
      panelState.enabledTranslations = order;
    },
    onChange: () => {
      saveState();
      renderPanelBody(panelState);
    },
  });
  verseLayoutStackedEl.addEventListener("click", () => setPanelVerseLayout(panelState, "stacked"));
  verseLayoutColumnsEl.addEventListener("click", () => setPanelVerseLayout(panelState, "columns"));
  copy.addEventListener("click", () => openCopyDialog(panelState));
  selectionModeRange.addEventListener("click", () => setPanelSelectionMode(panelState, "range"));
  selectionModeIndividual.addEventListener("click", () => setPanelSelectionMode(panelState, "individual"));
  cancelSelection.addEventListener("click", () => clearPanelSelection(panelState));
  remove.addEventListener("click", () => removePanel(id));
  historyBack.addEventListener("click", () => navigatePanelHistory(panelState, -1));
  historyForward.addEventListener("click", () => navigatePanelHistory(panelState, 1));
  moveLeft.addEventListener("click", (event) => {
    event.stopPropagation();
    movePanelBy(panelState, -1);
  });
  moveRight.addEventListener("click", (event) => {
    event.stopPropagation();
    movePanelBy(panelState, 1);
  });
  previous.addEventListener("click", () => navigateChapter(panelState, -1));
  next.addEventListener("click", () => navigateChapter(panelState, 1));
  setupPanelResize(panel, resizeHandle, panelState);
  setupPanelMoveReveal(panel, moveLeft, moveRight);
  setupPanelSwipe(panel);

  panelElements.set(id, {
    panel,
    header,
    bookCombo,
    chapterCombo,
    verseCombo,
    content,
    copy,
    selectionModeControl,
    selectionModeRange,
    selectionModeIndividual,
    cancelSelection,
    remove,
    historyBack,
    historyForward,
    moveLeft,
    moveRight,
    previous,
    next,
    translationControl,
    verseLayoutStacked: verseLayoutStackedEl,
    verseLayoutColumns: verseLayoutColumnsEl,
  });
  panelTrack.append(fragment);
  translationControl.render();
  applyPanelVerseLayout(panelState);
  updatePanelNumbers();
  updatePanelMoveButtons();
  updateRemoveButtons();
  updatePanelCountControls();
  setActivePanel(id);
  loadPanel(panelState);

  if (shouldScroll) {
    requestAnimationFrame(() => panel.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" }));
  }
  return panel;
}

function setActivePanel(id) {
  activePanelId = id;
  for (const [panelId, elements] of panelElements) {
    elements.panel.classList.toggle("active", panelId === id);
  }
}

function addPanel() {
  if (panelMutationInProgress) return;
  const previousCount = state.panels.length;
  const viewportStart = panelIndexAtViewportStart();
  const source = state.panels.find((panel) => panel.id === activePanelId) ?? state.panels.at(-1);
  const panelState = {
    book: source?.book ?? 0,
    chapter: source?.chapter ?? 1,
    width: source?.width ?? null,
    enabledTranslations: source?.enabledTranslations ? [...source.enabledTranslations] : [...DEFAULT_ENABLED_TRANSLATIONS],
    verseLayout: source?.verseLayout ?? "stacked",
  };
  state.panels.push(panelState);
  saveState();
  const twoPanelTouchMode = isTwoPanelTouchMode();
  const panel = createPanelElement(panelState, !twoPanelTouchMode);
  if (twoPanelTouchMode) {
    panel.animate(
      [
        { opacity: 0, transform: "translateX(24px)" },
        { opacity: 1, transform: "translateX(0)" },
      ],
      { duration: reducedMotion.matches ? 0 : 280, easing: "cubic-bezier(.2,.75,.25,1)" },
    );
    const targetIndex = previousCount < 2 ? 0 : Math.min(viewportStart + 1, state.panels.length - 1);
    requestAnimationFrame(() => scrollToPanelIndex(targetIndex, "smooth", false));
  }
}

function removePanel(id) {
  if (state.panels.length === 1 || panelMutationInProgress) return;
  const index = state.panels.findIndex((panel) => panel.id === id);
  if (index < 0) return;
  panelMutationInProgress = true;
  const isLast = index === state.panels.length - 1;
  const wasViewingRemoved = panelIndexAtViewportStart() === index;
  const removedElements = panelElements.get(id);
  const removedPanel = removedElements?.panel;
  removedElements?.translationControl.destroy();

  state.panels.splice(index, 1);
  panelElements.delete(id);
  if (activePanelId === id) setActivePanel(state.panels[Math.min(index, state.panels.length - 1)].id);
  saveState();
  updatePanelNumbers();
  updateRemoveButtons();
  updatePanelMoveButtons();
  updatePanelCountControls();

  if (!removedPanel || reducedMotion.matches) {
    removedPanel?.remove();
    panelMutationInProgress = false;
    return;
  }

  try {
    removedPanel.style.pointerEvents = "none";
    const collapse = () =>
      collapsePanel(removedPanel, () => {
        panelMutationInProgress = false;
      });

    if (isLast && mobileLayout.matches && wasViewingRemoved) {
      // The rightmost panel fills the phone screen, so collapsing it in
      // place would swap the view with no motion at all: glide to the
      // neighbor first, then collapse the leaving panel off-screen.
      // Mandatory snap would fight the glide, so disable it for the
      // duration (collapsePanel's finish restores it).
      panelTrack.classList.add("removing-panel");
      const target = isTwoPanelTouchMode() ? state.panels.length - 2 : state.panels.length - 1;
      animateTrackScroll(panelScrollLeft(Math.max(0, target)), 320, collapse);
    } else {
      collapse();
    }
  } catch {
    removedPanel.remove();
    panelMutationInProgress = false;
  }
}

// Native scrollTo({behavior: "smooth"}) is unreliable mid-removal — snap
// containers can cut it short and some browsers finish it instantly — so
// the glide is driven by hand, which also lets the collapse chain exactly
// when the scroll lands.
function animateTrackScroll(targetLeft, duration, done) {
  const startLeft = panelTrack.scrollLeft;
  const distance = targetLeft - startLeft;
  if (!distance || reducedMotion.matches) {
    panelTrack.scrollLeft = targetLeft;
    done?.();
    return;
  }
  const startTime = performance.now();
  const easeOutCubic = (t) => 1 - (1 - t) ** 3;
  const step = (now) => {
    const progress = Math.min((now - startTime) / duration, 1);
    panelTrack.scrollLeft = startLeft + distance * easeOutCubic(progress);
    if (progress < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}

function collapsePanel(panel, done) {
  const width = panel.getBoundingClientRect().width;
  const gap = Number.parseFloat(getComputedStyle(panelTrack).columnGap) || 0;
  // Inline styles with the "important" priority beat the mobile stylesheet's
  // !important flex-basis, and pinning the start size in px keeps the
  // shrink-to-zero transition animatable.
  panel.style.setProperty("flex-basis", `${width}px`, "important");
  panel.style.setProperty("width", `${width}px`, "important");
  panel.style.setProperty("--removed-gap", `${gap}px`);
  panel.style.setProperty("--removed-width", `${width}px`);
  panelTrack.classList.add("removing-panel");
  panel.getBoundingClientRect();
  panel.classList.add("panel-removing");
  panel.style.setProperty("flex-basis", "0px", "important");
  panel.style.setProperty("width", "0px", "important");

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    panel.remove();
    if (!panelTrack.querySelector(".panel-removing")) panelTrack.classList.remove("removing-panel");
    done?.();
  };
  panel.addEventListener("transitionend", (event) => {
    if (event.target === panel && event.propertyName === "flex-basis") finish();
  });
  window.setTimeout(finish, 460);
}

function movePanel(from, to, { animate = true } = {}) {
  if (from === to || from < 0 || to < 0 || to >= state.panels.length) return;
  const previousLefts = new Map(
    state.panels.map((panelState) => [
      panelState.id,
      panelElements.get(panelState.id).panel.getBoundingClientRect().left,
    ]),
  );
  const [moved] = state.panels.splice(from, 1);
  state.panels.splice(to, 0, moved);
  const movedPanel = panelElements.get(moved.id).panel;
  const nextState = state.panels[to + 1];
  // Reordering must swap panels in place: browsers otherwise scroll to follow
  // the moved node (scroll anchoring / snap), dragging the whole view along.
  const savedScrollLeft = panelTrack.scrollLeft;
  panelTrack.classList.add("panel-count-changing");
  panelTrack.insertBefore(movedPanel, nextState ? panelElements.get(nextState.id).panel : null);
  panelTrack.scrollLeft = savedScrollLeft;
  requestAnimationFrame(() => {
    panelTrack.scrollLeft = savedScrollLeft;
    panelTrack.classList.remove("panel-count-changing");
    panelTrack.scrollLeft = savedScrollLeft;
  });
  saveState();
  updatePanelNumbers();
  updatePanelMoveButtons();
  if (!animate || reducedMotion.matches) return;
  for (const [panelId, oldLeft] of previousLefts) {
    const panel = panelElements.get(panelId)?.panel;
    if (!panel) continue;
    const delta = oldLeft - panel.getBoundingClientRect().left;
    if (Math.abs(delta) < 1) continue;
    panel.animate(
      [{ transform: `translateX(${delta}px)` }, { transform: "translateX(0)" }],
      { duration: 260, easing: "cubic-bezier(.2,.75,.25,1)" },
    );
  }
}

function movePanelBy(panelState, direction) {
  if (panelMutationInProgress) return;
  const from = state.panels.findIndex((item) => item.id === panelState.id);
  movePanel(from, from + direction);
}

function updatePanelNumbers() {
}

function updatePanelMoveButtons() {
  state.panels.forEach((panelState, index) => {
    const elements = panelElements.get(panelState.id);
    if (!elements) return;
    elements.moveLeft.disabled = index === 0;
    elements.moveRight.disabled = index === state.panels.length - 1;
  });
}

function updateRemoveButtons() {
  const disabled = state.panels.length === 1;
  for (const { remove } of panelElements.values()) {
    remove.disabled = disabled;
  }
}

function chapterPath(bookIndex, chapter) {
  return `./data/chapters/${manifest.books[bookIndex].slug}/${chapter}.json?v=${ASSET_VERSION}`;
}

async function getChapter(bookIndex, chapter) {
  const key = `${bookIndex}:${chapter}`;
  if (chapterCache.has(key)) return chapterCache.get(key);
  const response = await fetch(chapterPath(bookIndex, chapter), { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load this chapter (${response.status})`);
  const data = await response.json();
  chapterCache.set(key, data);
  if (chapterCache.size > 40) chapterCache.delete(chapterCache.keys().next().value);
  return data;
}

function selectionBounds(panelState) {
  if (panelState.selectionAnchor == null || panelState.selectionEnd == null) return null;
  return [
    Math.min(panelState.selectionAnchor, panelState.selectionEnd),
    Math.max(panelState.selectionAnchor, panelState.selectionEnd),
  ];
}

function selectedVerseNumbers(panelState) {
  if (panelState.selectionMode === "individual") {
    return [...(panelState.selectedVerses ?? new Set())].sort((a, b) => a - b);
  }
  const bounds = selectionBounds(panelState);
  if (!bounds) return [];
  const [start, end] = bounds;
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function hasVerseSelection(panelState) {
  return selectedVerseNumbers(panelState).length > 0;
}

function syncSelectedVersesFromRange(panelState) {
  panelState.selectedVerses = new Set(selectedVerseNumbers(panelState));
}

function selectionModeButtonState(elements, mode) {
  elements.selectionModeRange.classList.toggle("selected", mode === "range");
  elements.selectionModeIndividual.classList.toggle("selected", mode === "individual");
  elements.selectionModeRange.setAttribute("aria-pressed", String(mode === "range"));
  elements.selectionModeIndividual.setAttribute("aria-pressed", String(mode === "individual"));
}

function updatePanelSelection(panelState) {
  const elements = panelElements.get(panelState.id);
  if (!elements) return;
  const selected = new Set(selectedVerseNumbers(panelState));
  const hasSelection = selected.size > 0;
  elements.content.querySelectorAll(".verse-group").forEach((group) => {
    const verse = Number(group.dataset.verse);
    group.classList.toggle("selected", selected.has(verse));
  });
  elements.panel.classList.toggle("selection-active", hasSelection);
  if (hasSelection) setPanelChromeHidden(elements.panel, false);
  elements.copy.hidden = !hasSelection;
  elements.selectionModeControl.hidden = !hasSelection;
  elements.cancelSelection.hidden = !hasSelection;
  selectionModeButtonState(elements, panelState.selectionMode);
}

// The floating copy/cancel buttons overlap the bottom edge of the reading
// area, so a verse tapped near the bottom is nudged up just far enough to
// clear them (.verse-group's scroll-margin-bottom sets the clearance).
function revealVerseAboveActions(panelState, verse) {
  const elements = panelElements.get(panelState.id);
  const group = elements?.content.querySelector(`.verse-group[data-verse="${verse}"]`);
  if (!group) return;
  const contentRect = elements.content.getBoundingClientRect();
  const groupRect = group.getBoundingClientRect();
  const clearance = Number.parseFloat(getComputedStyle(group).scrollMarginBottom) || 0;
  const overlap = groupRect.bottom - (contentRect.bottom - clearance);
  if (overlap <= 0) return;
  // A verse taller than the panel keeps its start in view instead.
  const maxUpward = Math.max(0, groupRect.top - contentRect.top - 8);
  elements.content.scrollBy({
    top: Math.min(overlap, maxUpward),
    behavior: reducedMotion.matches ? "auto" : "smooth",
  });
}

function clearPanelSelection(panelState) {
  panelState.selectionAnchor = null;
  panelState.selectionEnd = null;
  panelState.selectedVerses = new Set();
  updatePanelSelection(panelState);
}

function setPanelSelectionMode(panelState, mode) {
  if (mode !== "range" && mode !== "individual") return;
  const previous = panelState.selectionMode;
  panelState.selectionMode = mode;
  state.copySelectionMode = mode;
  if (mode === "individual" && previous !== "individual") {
    syncSelectedVersesFromRange(panelState);
  } else if (mode === "range" && previous !== "range") {
    const verses = selectedVerseNumbers(panelState);
    if (verses.length) {
      panelState.selectionAnchor = verses[0];
      panelState.selectionEnd = verses[verses.length - 1];
    }
    syncSelectedVersesFromRange(panelState);
  }
  saveState();
  updatePanelSelection(panelState);
}

function selectVerse(panelState, verse) {
  if (!hasVerseSelection(panelState)) {
    panelState.selectionMode = state.copySelectionMode;
  }
  if (panelState.selectionMode === "individual") {
    if (!panelState.selectedVerses) panelState.selectedVerses = new Set();
    if (panelState.selectedVerses.has(verse)) panelState.selectedVerses.delete(verse);
    else panelState.selectedVerses.add(verse);
    if (panelState.selectedVerses.size) {
      const verses = selectedVerseNumbers(panelState);
      panelState.selectionAnchor = verses[0];
      panelState.selectionEnd = verses[verses.length - 1];
    } else {
      panelState.selectionAnchor = null;
      panelState.selectionEnd = null;
    }
    updatePanelSelection(panelState);
    if (hasVerseSelection(panelState)) revealVerseAboveActions(panelState, verse);
    return;
  }
  const bounds = selectionBounds(panelState);
  if (!bounds) {
    panelState.selectionAnchor = verse;
    panelState.selectionEnd = verse;
  } else if (panelState.selectionAnchor === panelState.selectionEnd) {
    if (panelState.selectionAnchor === verse) {
      panelState.selectionAnchor = null;
      panelState.selectionEnd = null;
    } else {
      panelState.selectionEnd = verse;
    }
  } else {
    panelState.selectionAnchor = verse;
    panelState.selectionEnd = verse;
  }
  syncSelectedVersesFromRange(panelState);
  updatePanelSelection(panelState);
  if (hasVerseSelection(panelState)) revealVerseAboveActions(panelState, verse);
}

function scrollVerseToTop(panelState, verse, behavior = "smooth") {
  const elements = panelElements.get(panelState.id);
  const group = elements?.content.querySelector(`.verse-group[data-verse="${verse}"]`);
  if (!group) return;
  group.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : behavior, block: "start" });
}

async function loadPanel(panelState, targetVerse = null) {
  const elements = panelElements.get(panelState.id);
  if (!elements) return false;
  const requestKey = `${panelState.book}:${panelState.chapter}:${Date.now()}`;
  elements.panel.dataset.requestKey = requestKey;
  clearPanelSelection(panelState);
  elements.content.innerHTML = '<div class="panel-message">Loading…</div>';
  updatePanelControls(panelState);

  try {
    const data = await getChapter(panelState.book, panelState.chapter);
    if (elements.panel.dataset.requestKey !== requestKey) return false;
    panelState.data = data;
    panelState.verse = targetVerse || 1;
    renderPanelBody(panelState);
    if (targetVerse) {
      requestAnimationFrame(() => scrollVerseToTop(panelState, targetVerse));
    } else {
      elements.content.scrollTop = 0;
    }
    return true;
  } catch (error) {
    elements.content.innerHTML = `<div class="panel-message error">${escapeHtml(error.message)}<br />Use a local HTTP server when previewing.</div>`;
    return false;
  }
}

async function goToPassage(panelState, passage, { record = true } = {}) {
  setPanelChromeHidden(panelState, false);
  const target = normalizePassage(passage.book, passage.chapter, passage.verse);
  const chapterChanged = panelState.book !== target.book || panelState.chapter !== target.chapter || !panelState.data;
  panelState.book = target.book;
  panelState.chapter = target.chapter;
  panelState.verse = target.verse;
  saveState();
  let loaded = true;
  if (chapterChanged) {
    loaded = await loadPanel(panelState, target.verse);
  } else {
    updatePanelControls(panelState);
    scrollVerseToTop(panelState, target.verse);
  }
  if (!loaded) return false;
  if (record) recordPanelHistory(panelState, target);
  updatePanelControls(panelState);
  saveState();
  return true;
}

function navigatePanelHistory(panelState, direction) {
  ensurePanelHistory(panelState);
  const nextIndex = panelState.historyIndex + direction;
  if (nextIndex < 0 || nextIndex >= panelState.history.length) return;
  panelState.historyIndex = nextIndex;
  goToPassage(panelState, panelState.history[nextIndex], { record: false });
}

// Re-rendering replaces the verse nodes while scrollTop stays put, so when
// row heights change (enabling another translation, switching layouts) the
// reader loses their place. Anchor on a visible selected verse when there is
// one, else the verse nearest the panel's vertical center, and restore its
// on-screen position after the swap.
function captureVerseAnchor(content, panelState) {
  const contentRect = content.getBoundingClientRect();
  if (!contentRect.height) return null;
  const selected = new Set(selectedVerseNumbers(panelState));
  const middle = contentRect.top + contentRect.height / 2;
  let anchor = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const group of content.querySelectorAll(".verse-group")) {
    const rect = group.getBoundingClientRect();
    if (rect.bottom <= contentRect.top || rect.top >= contentRect.bottom) continue;
    const verse = Number(group.dataset.verse);
    if (selected.has(verse)) {
      return { verse, offset: rect.top - contentRect.top };
    }
    const distance = Math.abs((rect.top + rect.bottom) / 2 - middle);
    if (distance < bestDistance) {
      bestDistance = distance;
      anchor = { verse, offset: rect.top - contentRect.top };
    }
  }
  return anchor;
}

function restoreVerseAnchor(content, anchor) {
  if (!anchor) return;
  const group = content.querySelector(`.verse-group[data-verse="${anchor.verse}"]`);
  if (!group) return;
  const drift = group.getBoundingClientRect().top - content.getBoundingClientRect().top - anchor.offset;
  if (Math.abs(drift) > 1) content.scrollTop += drift;
}

function renderPanelBody(panelState) {
  const elements = panelElements.get(panelState.id);
  if (!elements || !panelState.data) return;
  const enabled = enabledTranslationIds(panelState);
  const columnLayout = effectiveVerseLayout(panelState) === "columns";
  const fragment = document.createDocumentFragment();

  if (columnLayout && enabled.length) {
    const columnHeader = document.createElement("div");
    columnHeader.className = "column-translation-header";
    columnHeader.style.setProperty("--translation-count", String(enabled.length));
    for (const translation of enabled) {
      const heading = document.createElement("span");
      heading.className = "column-translation-heading";
      heading.lang = translationLanguage(translation);
      heading.textContent = translationMeta(translation).label;
      heading.style.setProperty("--translation-color", TRANSLATION_COLORS[translation]);
      columnHeader.append(heading);
    }
    fragment.append(columnHeader);
  }

  for (const [verseNumber, texts] of panelState.data.v) {
    const group = document.createElement("section");
    group.className = "verse-group";
    group.dataset.verse = String(verseNumber);
    group.addEventListener("click", () => selectVerse(panelState, verseNumber));
    const number = document.createElement("span");
    number.className = "verse-number";
    number.textContent = String(verseNumber);
    group.append(number);
    group.style.setProperty("--translation-count", String(Math.max(enabled.length, 1)));

    let rendered = 0;
    enabled.forEach((translation, index) => {
      const translationText = texts[translation];
      if (!translationText && !columnLayout) return;
      if (translationText) rendered += 1;
      const line = document.createElement("div");
      line.className = "translation-line";
      line.lang = translationLanguage(translation);
      line.style.setProperty("--translation-color", TRANSLATION_COLORS[translation]);
      if (columnLayout) line.style.gridColumn = String(index + 1);
      const label = document.createElement("span");
      label.className = "translation-label";
      label.textContent = translationMeta(translation).label;
      const text = document.createElement("p");
      text.className = "translation-text";
      text.textContent = translationText || "";
      line.append(label, text);
      group.append(line);
    });

    if (!rendered) {
      const empty = document.createElement("p");
      empty.className = "empty-translation";
      empty.textContent = "Select at least one translation.";
      group.append(empty);
    }
    fragment.append(group);
  }

  const anchor = captureVerseAnchor(elements.content, panelState);
  elements.content.replaceChildren(fragment);
  restoreVerseAnchor(elements.content, anchor);
  updatePanelSelection(panelState);
  updatePanelControls(panelState);
}

function refreshPanelBodies() {
  for (const panel of state.panels) renderPanelBody(panel);
}

function updatePanelControls(panelState) {
  const elements = panelElements.get(panelState.id);
  if (!elements) return;
  elements.bookCombo.setValue(panelState.book);
  elements.chapterCombo.setItems(chapterItems(panelState.book));
  elements.chapterCombo.setValue(panelState.chapter);
  const verses = verseItems(panelState);
  const maxVerse = verses.at(-1)?.value ?? 1;
  panelState.verse = Math.max(1, Math.min(Number(panelState.verse) || 1, maxVerse));
  elements.verseCombo.setItems(verses);
  elements.verseCombo.setValue(panelState.verse);
  ensurePanelHistory(panelState);
  elements.historyBack.disabled = panelState.historyIndex <= 0;
  elements.historyForward.disabled = panelState.historyIndex >= panelState.history.length - 1;
  elements.previous.disabled = panelState.book === 0 && panelState.chapter === 1;
  const finalBook = manifest.books.length - 1;
  elements.next.disabled =
    panelState.book === finalBook && panelState.chapter === manifest.books[finalBook].chapters;
}

function navigateChapter(panelState, direction) {
  let { book, chapter } = panelState;
  chapter += direction;
  if (chapter < 1 && book > 0) {
    book -= 1;
    chapter = manifest.books[book].chapters;
  } else if (chapter > manifest.books[book].chapters && book < manifest.books.length - 1) {
    book += 1;
    chapter = 1;
  }
  if (book === panelState.book && chapter === panelState.chapter) return;
  goToPassage(panelState, { book, chapter, verse: 1 }, { record: true });
}

function applyFontSize() {
  document.documentElement.style.setProperty("--verse-font-size", `${state.fontSize}px`);
  fontSizeValue.value = String(state.fontSize);
  fontSizeValue.textContent = String(state.fontSize);
  fontSizeDownButton.disabled = state.fontSize <= 10;
  fontSizeUpButton.disabled = state.fontSize >= 22;
}

function changeFontSize(delta) {
  state.fontSize = Math.max(10, Math.min(state.fontSize + delta, 22));
  applyFontSize();
  saveState();
}

function formatVerseReference(chapter, verses) {
  if (!verses.length) return `${chapter}:`;
  const parts = [];
  for (let index = 0; index < verses.length; index += 1) {
    const start = verses[index];
    let end = start;
    while (index + 1 < verses.length && verses[index + 1] === end + 1) {
      index += 1;
      end = verses[index];
    }
    parts.push(start === end ? String(start) : `${start}-${end}`);
  }
  return `${chapter}:${parts.join(", ")}`;
}

function openCopyDialog(panelState) {
  const selectedVerses = selectedVerseNumbers(panelState);
  if (!selectedVerses.length || !panelState.data) return;
  copyPanelState = panelState;
  copyStatus.textContent = "";
  const book = manifest.books[panelState.book];
  const reference = formatVerseReference(panelState.chapter, selectedVerses);
  copyReference.textContent = `${book.en} ${book.ko} ${reference}`;
  // Offer only the translations currently shown in this panel, in their reading order.
  copyTranslationOrder = [...enabledTranslationIds(panelState)];
  copyTranslationControl?.render();
  copyDialog.showModal();
}

function closeCopyDialog() {
  copyTranslationControl?.close();
  copyDialog.close();
  copyPanelState = null;
}

function buildCopyText(panelState, translations, order) {
  const selectedVerses = selectedVerseNumbers(panelState);
  const selected = new Set(selectedVerses);
  const book = manifest.books[panelState.book];
  const verses = panelState.data.v.filter(([verse]) => selected.has(verse));
  const lines = [];
  const bookNameFor = (translation) =>
    translationLanguage(translation) === "en" ? book.en : book.ko;
  const range = formatVerseReference(panelState.chapter, selectedVerses);

  if (order === "translation") {
    for (const translation of translations) {
      lines.push(`${bookNameFor(translation)} ${range}, ${translationMeta(translation).label}`);
      for (const [verse, texts] of verses) {
        if (texts[translation]) lines.push(`${verse} ${texts[translation]}`);
      }
      lines.push("");
    }
  } else {
    const bookName = bookNameFor(translations[0]);
    const translationNames = translations.map((translation) => translationMeta(translation).label).join("-");
    lines.push(`${bookName} ${range}, ${translationNames}`);
    for (const [verse, texts] of verses) {
      for (const translation of translations) {
        if (texts[translation]) lines.push(`${verse} ${texts[translation]}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n").trim();
}

async function writeClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard access was denied.");
}

async function copySelectedVerses() {
  if (!copyPanelState) return;
  const translations = [...copyTranslationOrder];
  if (!translations.length) {
    copyStatus.textContent = "Select a version.";
    return;
  }
  const order = copyDialog.querySelector('input[name="copy-order"]:checked').value;
  const text = buildCopyText(copyPanelState, translations, order);
  try {
    await writeClipboard(text);
    copyStatus.textContent = "Copied";
    const copiedPanelState = copyPanelState;
    if (copiedPanelState) clearPanelSelection(copiedPanelState);
    window.setTimeout(closeCopyDialog, 450);
  } catch (error) {
    copyStatus.textContent = error.message;
  }
}

function openSearch() {
  // Search isn't tied to a single panel, so default it to whatever the
  // currently active panel is showing.
  const activePanel = state.panels.find((panel) => panel.id === activePanelId);
  searchTranslationOrder = [...enabledTranslationIds(activePanel)];
  searchTranslationControl?.render();
  searchDialog.showModal();
  requestAnimationFrame(() => searchInput.focus());
}

function closeSearch() {
  searchTranslationControl?.close();
  searchDialog.close();
}

function runSearch(query) {
  const translations = [...searchTranslationOrder];
  searchBookList.replaceChildren();
  searchResults.replaceChildren();
  if (!translations.length) {
    searchMeta.textContent = "Select at least one translation.";
    return;
  }
  searchRequestId += 1;
  searchMeta.textContent = "";
  searchWorker.postMessage({ type: "search", requestId: searchRequestId, query, translations });
}

searchWorker.addEventListener("message", (event) => {
  const message = event.data;
  if (message.requestId !== searchRequestId) return;
  if (message.type === "progress") {
    searchMeta.textContent = "";
  } else if (message.type === "result") {
    renderSearchResults(
      message.query,
      message.matches,
      message.bookCounts,
      message.totalTranslationMatches,
      message.truncated,
      message.elapsedMs,
    );
  } else if (message.type === "error") {
    searchMeta.textContent = `Search failed: ${message.error}`;
  }
});

function renderSearchResults(query, matches, bookCounts, totalTranslationMatches, truncated, elapsedMs) {
  searchBookList.replaceChildren();
  searchResults.replaceChildren();
  const grouped = new Map();
  for (const [translation, book, chapter, verse, text] of matches) {
    const key = `${book}:${chapter}:${verse}`;
    if (!grouped.has(key)) grouped.set(key, { book, chapter, verse, lines: [] });
    grouped.get(key).lines.push({ translation, text });
  }
  const groups = [...grouped.values()].sort(
    (a, b) => a.book - b.book || a.chapter - b.chapter || a.verse - b.verse,
  );

  searchMeta.textContent = "";

  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "panel-message";
    empty.textContent = "No results. Try another word or a shorter form.";
    searchResults.append(empty);
    return;
  }

  for (const [bookIndex, count] of bookCounts) {
    const book = manifest.books[bookIndex];
    const link = document.createElement("button");
    link.className = "search-book-link";
    link.type = "button";
    link.textContent = `${book.en} ${book.ko} (${count.toLocaleString()})`;
    link.addEventListener("click", () => {
      searchBookList.querySelectorAll(".search-book-link").forEach((item) => {
        item.toggleAttribute("aria-current", item === link);
      });
      const target = searchResults.querySelector(`.search-result[data-book="${bookIndex}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    searchBookList.append(link);
  }

  for (const result of groups) {
    const item = document.createElement("article");
    item.className = "search-result";
    item.dataset.book = String(result.book);
    const content = document.createElement("div");
    content.className = "search-result-content";
    const reference = document.createElement("div");
    reference.className = "search-reference";
    const referenceText = document.createElement("span");
    const resultLanguages = new Set(result.lines.map((line) => translationLanguage(line.translation)));
    const book = manifest.books[result.book];
    if (resultLanguages.size === 1 && resultLanguages.has("ko")) {
      referenceText.lang = "ko";
      referenceText.textContent = `${book.ko} ${result.chapter}:${result.verse}`;
    } else if (resultLanguages.size === 1 && resultLanguages.has("en")) {
      referenceText.lang = "en";
      referenceText.textContent = `${book.en} ${result.chapter}:${result.verse}`;
    } else {
      referenceText.textContent = `${book.en} ${book.ko} ${result.chapter}:${result.verse}`;
    }
    reference.append(referenceText);
    content.append(reference);

    const translationOrder = searchTranslationOrder;
    result.lines.sort(
      (a, b) => translationOrder.indexOf(a.translation) - translationOrder.indexOf(b.translation),
    );
    for (const line of result.lines) {
      const row = document.createElement("div");
      row.className = "search-match-line";
      row.style.setProperty("--translation-color", TRANSLATION_COLORS[line.translation]);
      const label = document.createElement("span");
      label.className = "search-match-label";
      label.lang = translationLanguage(line.translation);
      label.textContent = translationMeta(line.translation).label;
      const text = document.createElement("span");
      appendHighlighted(text, line.text, query);
      row.append(label, text);
      content.append(row);
    }
    const actions = document.createElement("div");
    actions.className = "search-result-actions";
    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.className = "button button-primary icon-only-button search-result-action";
    viewButton.setAttribute("aria-label", `View ${searchResultReferenceText(result)}`);
    viewButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12h14"></path>
        <path d="m13 6 6 6-6 6"></path>
      </svg>
    `;
    viewButton.addEventListener("click", () => openSearchResult(result));
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "button button-secondary icon-only-button search-result-action";
    copyButton.setAttribute("aria-label", `Copy ${searchResultReferenceText(result)}`);
    copyButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="8" width="11" height="11" rx="2"></rect>
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>
      </svg>
    `;
    copyButton.addEventListener("click", () => copySearchResult(result));
    actions.append(viewButton, copyButton);
    item.append(content, actions);
    searchResults.append(item);
  }
}

function appendHighlighted(element, text, query) {
  const normalizedText = text.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  let cursor = 0;
  while (cursor < text.length) {
    const index = normalizedText.indexOf(normalizedQuery, cursor);
    if (index < 0) {
      element.append(document.createTextNode(text.slice(cursor)));
      break;
    }
    if (index > cursor) element.append(document.createTextNode(text.slice(cursor, index)));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(index, index + query.length);
    element.append(mark);
    cursor = index + query.length;
  }
}

function searchResultReferenceText(result) {
  const book = manifest.books[result.book];
  const resultLanguages = new Set((result.lines ?? []).map((line) => translationLanguage(line.translation)));
  if (resultLanguages.size === 1 && resultLanguages.has("ko")) {
    return `${book.ko} ${result.chapter}:${result.verse}`;
  }
  if (resultLanguages.size === 1 && resultLanguages.has("en")) {
    return `${book.en} ${result.chapter}:${result.verse}`;
  }
  return `${book.en} ${book.ko} ${result.chapter}:${result.verse}`;
}

function openSearchResult(result) {
  const panelState = state.panels.find((panel) => panel.id === activePanelId) ?? state.panels[0];
  closeSearch();
  const elements = panelElements.get(panelState.id);
  elements.panel.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  goToPassage(panelState, { book: result.book, chapter: result.chapter, verse: result.verse }, { record: true });
}

async function copySearchResult(result) {
  const panelState = state.panels.find((panel) => panel.id === activePanelId) ?? state.panels[0];
  const elements = panelElements.get(panelState.id);
  elements.panel.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  const loaded = await goToPassage(
    panelState,
    { book: result.book, chapter: result.chapter, verse: result.verse },
    { record: true },
  );
  if (!loaded) return;
  panelState.selectionMode = state.copySelectionMode;
  panelState.selectionAnchor = result.verse;
  panelState.selectionEnd = result.verse;
  panelState.selectedVerses = new Set([result.verse]);
  updatePanelSelection(panelState);
  openCopyDialog(panelState);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function init() {
  try {
    const response = await fetch(`./data/manifest.json?v=${ASSET_VERSION}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load site data (${response.status})`);
    manifest = await response.json();
    resetStoredStateForReload();
    state = loadState();
    sanitizeState();
    applyTouchPanelCount();
    applyFontSize();
    copyTranslationControl = setupDialogTranslationControl({
      picker: copyTranslationPicker,
      toggle: copyTranslationPickerToggle,
      menu: copyTranslationPickerMenu,
      list: copyTranslations,
      getOrder: () => copyTranslationOrder,
      setOrder: (order) => {
        copyTranslationOrder = order;
      },
      onChange: () => {
        copyStatus.textContent = "";
      },
    });
    searchTranslationOrder = [...DEFAULT_ENABLED_TRANSLATIONS];
    searchTranslationControl = setupDialogTranslationControl({
      picker: searchTranslationPicker,
      toggle: searchTranslationPickerToggle,
      menu: searchTranslationPickerMenu,
      list: searchTranslationList,
      getOrder: () => searchTranslationOrder,
      setOrder: (order) => {
        searchTranslationOrder = order;
      },
      onChange: () => {
        const query = searchInput.value.trim();
        if (searchDialog.open && query) runSearch(query);
      },
    });
    for (const panel of state.panels) createPanelElement(panel);
    if (desktopLikePanels()) applyDesktopPanelWidths();
    saveState();
  } catch (error) {
    panelTrack.innerHTML = `<div class="panel-message error">Could not start the site: ${escapeHtml(error.message)}<br />Use a local HTTP server when previewing.</div>`;
  }
}

siteBrand.addEventListener("click", resetSite);
siteBrand.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  resetSite();
});
addPanelButton.addEventListener("click", addPanel);
panelCountOneButton.addEventListener("click", () => {
  if (desktopLikePanels()) setDesktopPanelMode(1);
  else setTouchPanelCount(1);
});
panelCountTwoButton.addEventListener("click", () => {
  if (desktopLikePanels()) setDesktopPanelMode(2);
  else setTouchPanelCount(2);
});
fontSizeDownButton.addEventListener("click", () => changeFontSize(-1));
fontSizeUpButton.addEventListener("click", () => changeFontSize(1));
openSearchButton.addEventListener("click", openSearch);
closeSearchButton.addEventListener("click", closeSearch);
searchDialog.addEventListener("click", (event) => {
  if (event.target === searchDialog) closeSearch();
});
closeCopyButton.addEventListener("click", closeCopyDialog);
cancelCopyButton?.addEventListener("click", closeCopyDialog);
confirmCopyButton.addEventListener("click", copySelectedVerses);
copyDialog.addEventListener("click", (event) => {
  if (event.target === copyDialog) closeCopyDialog();
});
searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (query.length < 1) return;
  runSearch(query);
});
portraitLayout.addEventListener("change", schedulePanelLayoutAlignment);
phonePortraitLayout.addEventListener("change", schedulePanelLayoutAlignment);
touchPanelToggleLayout.addEventListener("change", schedulePanelLayoutAlignment);
touchPanelToggleLayout.addEventListener("change", syncTrackFreeScroll);

// ---- Offline install ----
// The service worker mirrors every successful same-origin response into the
// offline cache; the header install button additionally triggers the
// browser's "install app" prompt (Chrome/Edge on desktop and Android) and
// bulk-downloads the whole Bible (all chapters + search indexes) so the app
// keeps working with no network at all. iOS has no install prompt API, so a
// hint explains Share → Add to Home Screen while the download proceeds.
const OFFLINE_CACHE = "bible-offline-v1";
const OFFLINE_READY_KEY = "side-by-side-bible:offline-build";
let installPromptEvent = null;
let offlineDownloadInProgress = false;

const IOS_DEVICE = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function runningStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPromptEvent = event;
});

function offlineReady() {
  return localStorage.getItem(OFFLINE_READY_KEY) === ASSET_VERSION;
}

function updateDownloadButton() {
  if (offlineDownloadInProgress) return;
  const ready = offlineReady();
  downloadAppButton.disabled = ready;
  downloadAppButton.title = ready
    ? "Everything is already downloaded for offline use"
    : "Install as an app and download everything for offline use";
  downloadAppLabel.textContent = "Install";
}

function offlineUrls() {
  const urls = [
    "./",
    "./index.html",
    `./styles.css?v=${ASSET_VERSION}`,
    `./app.js?v=${ASSET_VERSION}`,
    `./search-worker.js?v=${ASSET_VERSION}`,
    "./manifest.webmanifest",
    "./icons/icon-180.png",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    `./data/manifest.json?v=${ASSET_VERSION}`,
  ];
  for (const translation of manifest.translations) {
    urls.push(`./data/search/${translation.id}.json?v=${ASSET_VERSION}`);
  }
  manifest.books.forEach((book, bookIndex) => {
    for (let chapter = 1; chapter <= book.chapters; chapter += 1) {
      urls.push(chapterPath(bookIndex, chapter));
    }
  });
  return urls;
}

async function cacheOfflineContent() {
  const cache = await caches.open(OFFLINE_CACHE);
  const urls = offlineUrls();
  let done = 0;
  let failed = 0;
  const queue = [...urls];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        // Data URLs are versioned by ?v=, so an existing exact match is
        // current and a re-download (or a retry pass) can skip it. The
        // small unversioned shell files are always refreshed.
        if (!url.includes("/data/") || !(await cache.match(url))) {
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) throw new Error(String(response.status));
          await cache.delete(url, { ignoreSearch: true });
          await cache.put(url, response);
        }
      } catch {
        failed += 1;
      }
      done += 1;
      if (done % 10 === 0 || done === urls.length) {
        downloadAppLabel.textContent = `${Math.round((done / urls.length) * 100)}%`;
      }
    }
  });
  await Promise.all(workers);
  return failed;
}

async function downloadOfflineApp() {
  if (offlineDownloadInProgress || !manifest) return;
  if (installPromptEvent) {
    const prompt = installPromptEvent;
    installPromptEvent = null;
    prompt.prompt();
    await prompt.userChoice.catch(() => {});
  } else if (IOS_DEVICE && !runningStandalone()) {
    installHint.hidden = false;
  }
  if (!("caches" in window)) {
    downloadAppLabel.textContent = "Unsupported";
    return;
  }
  offlineDownloadInProgress = true;
  downloadAppButton.disabled = true;
  downloadAppButton.classList.add("downloading");
  try {
    const failed = await cacheOfflineContent();
    if (failed) {
      downloadAppLabel.textContent = "Retry";
    } else {
      localStorage.setItem(OFFLINE_READY_KEY, ASSET_VERSION);
    }
  } catch {
    downloadAppLabel.textContent = "Retry";
  } finally {
    offlineDownloadInProgress = false;
    downloadAppButton.classList.remove("downloading");
    if (offlineReady()) {
      // Same icon as before the download; the button is simply disabled.
      updateDownloadButton();
    } else {
      downloadAppButton.disabled = false;
    }
  }
}

downloadAppButton.addEventListener("click", downloadOfflineApp);
installHintClose.addEventListener("click", () => {
  installHint.hidden = true;
});
updateDownloadButton();

init();

window.addEventListener("pagehide", () => {
  sessionStorage.setItem(RELOAD_RESET_KEY, "1");
});
