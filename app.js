const STORAGE_KEY = "side-by-side-bible:v1";
const TRANSLATION_COLORS = {
  ESV: "#9b5c34",
  NIV: "#476f9b",
  GAE: "#2f7663",
  SAENEW: "#805692",
  WLB: "#a24f62",
};
const ASSET_VERSION = document.querySelector('meta[name="asset-version"]').content;
const MOBILE_LAYOUT_QUERY = "(max-width: 820px), (max-height: 500px) and (pointer: coarse)";
const mobileLayout = window.matchMedia(MOBILE_LAYOUT_QUERY);
const landscapeMobile = window.matchMedia("(orientation: landscape) and (max-height: 500px) and (pointer: coarse)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const panelTrack = document.querySelector("#panel-track");
const panelTemplate = document.querySelector("#panel-template");
const translationList = document.querySelector("#translation-list");
const addPanelButton = document.querySelector("#add-panel");
const searchDialog = document.querySelector("#search-dialog");
const openSearchButton = document.querySelector("#open-search");
const closeSearchButton = document.querySelector("#close-search");
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const searchMeta = document.querySelector("#search-meta");
const searchBookList = document.querySelector("#search-book-list");
const searchResults = document.querySelector("#search-results");
const fontSizeDownButton = document.querySelector("#font-size-down");
const fontSizeUpButton = document.querySelector("#font-size-up");
const fontSizeValue = document.querySelector("#font-size-value");
const copyDialog = document.querySelector("#copy-dialog");
const closeCopyButton = document.querySelector("#close-copy");
const cancelCopyButton = document.querySelector("#cancel-copy");
const confirmCopyButton = document.querySelector("#confirm-copy");
const copyReference = document.querySelector("#copy-reference");
const copyTranslations = document.querySelector("#copy-translations");
const copyStatus = document.querySelector("#copy-status");
const siteBrand = document.querySelector("#site-brand");
const updateBanner = document.querySelector("#update-banner");
const updateReloadButton = document.querySelector("#update-reload");

let manifest;
let state;
let activePanelId;
let panelIdCounter = 0;
let searchRequestId = 0;
let copyPanelState = null;
let copyTranslationOrder = [];
let panelMutationInProgress = false;
const chapterCache = new Map();
const panelElements = new Map();
const searchWorker = new Worker(`./search-worker.js?v=${ASSET_VERSION}`);

function freshState() {
  return {
    translationOrder: ["ESV", "NIV", "GAE", "SAENEW", "WLB"],
    enabledTranslations: ["ESV", "NIV", "GAE", "SAENEW", "WLB"],
    fontSize: 14,
    panels: [{ book: 0, chapter: 1 }],
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
  const order = state.translationOrder.filter((id) => validTranslations.has(id));
  for (const id of validTranslations) {
    if (!order.includes(id)) order.push(id);
  }
  state.translationOrder = order;
  state.enabledTranslations = state.enabledTranslations.filter((id) => validTranslations.has(id));
  state.fontSize = Math.max(10, Math.min(Number(state.fontSize) || 14, 22));
  state.panels = state.panels
    .map((panel) => {
      const book = Math.max(0, Math.min(Number(panel.book) || 0, manifest.books.length - 1));
      const chapter = Math.max(1, Math.min(Number(panel.chapter) || 1, manifest.books[book].chapters));
      const width = Number(panel.width);
      return { book, chapter, width: Number.isFinite(width) ? Math.max(320, Math.min(width, 1000)) : null };
    })
    .slice(0, 12);
  if (!state.panels.length) state.panels = [{ book: 0, chapter: 1 }];
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      translationOrder: state.translationOrder,
      enabledTranslations: state.enabledTranslations,
      fontSize: state.fontSize,
      panels: state.panels.map(({ book, chapter, width }) => ({ book, chapter, width })),
    }),
  );
}

function resetSite() {
  if (searchDialog.open) closeSearch();
  if (copyDialog.open) closeCopyDialog();
  localStorage.removeItem(STORAGE_KEY);

  for (const { panel } of panelElements.values()) panel.remove();
  panelElements.clear();
  state = freshState();
  sanitizeState();
  activePanelId = undefined;
  applyFontSize();
  renderTranslationControls();
  for (const panel of state.panels) createPanelElement(panel);
  saveState();

  searchInput.value = "";
  searchMeta.textContent = "Enter at least two characters.";
  searchBookList.replaceChildren();
  searchResults.replaceChildren();
  searchRequestId += 1;
}

function translationMeta(id) {
  return manifest.translations.find((item) => item.id === id);
}

function translationLanguage(id) {
  return id === "ESV" || id === "NIV" ? "en" : "ko";
}

function renderTranslationControls() {
  translationList.replaceChildren();

  state.translationOrder.forEach((id, index) => {
    const meta = translationMeta(id);
    const isEnabled = state.enabledTranslations.includes(id);
    const chip = document.createElement("div");
    chip.className = "translation-chip";
    chip.classList.toggle("selected", isEnabled);
    chip.draggable = true;
    chip.dataset.translation = id;
    chip.tabIndex = 0;
    chip.setAttribute("role", "checkbox");
    chip.setAttribute("aria-checked", String(isEnabled));
    chip.setAttribute("aria-label", `${meta.label} translation`);

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";
    handle.setAttribute("aria-hidden", "true");
    setupTouchReorder({
      item: chip,
      handle,
      container: translationList,
      itemClass: "translation-chip",
      id,
      getOrder: () => state.translationOrder,
      onReorder: moveTranslation,
    });

    const toggleTranslation = () => {
      const shouldEnable = !state.enabledTranslations.includes(id);
      if (shouldEnable) {
        state.enabledTranslations.push(id);
      } else {
        state.enabledTranslations = state.enabledTranslations.filter((item) => item !== id);
      }
      saveState();
      chip.classList.toggle("selected", shouldEnable);
      chip.setAttribute("aria-checked", String(shouldEnable));
      refreshPanelBodies();
    };

    const name = document.createElement("span");
    name.className = "translation-name";
    name.lang = translationLanguage(id);
    name.textContent = meta.label;
    name.style.setProperty("--translation-color", TRANSLATION_COLORS[id]);

    const moveButtons = document.createElement("span");
    moveButtons.className = "move-buttons";
    const left = document.createElement("button");
    left.className = "move-translation";
    left.type = "button";
    left.textContent = "‹";
    left.disabled = index === 0;
    left.setAttribute("aria-label", `Move ${meta.label} left`);
    left.addEventListener("click", () => moveTranslation(index, index - 1));
    const right = document.createElement("button");
    right.className = "move-translation";
    right.type = "button";
    right.textContent = "›";
    right.disabled = index === state.translationOrder.length - 1;
    right.setAttribute("aria-label", `Move ${meta.label} right`);
    right.addEventListener("click", () => moveTranslation(index, index + 1));
    moveButtons.append(left, right);

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
      const from = state.translationOrder.indexOf(draggedId);
      const to = state.translationOrder.indexOf(id);
      if (from >= 0 && to >= 0 && from !== to) moveTranslation(from, to);
    });
    chip.addEventListener("click", (event) => {
      if (event.target.closest("button, .drag-handle")) return;
      toggleTranslation();
    });
    chip.addEventListener("keydown", (event) => {
      if (event.target !== chip) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleTranslation();
    });

    chip.append(handle, name, moveButtons);
    translationList.append(chip);
  });
}

function moveTranslation(from, to) {
  if (to < 0 || to >= state.translationOrder.length) return;
  const [item] = state.translationOrder.splice(from, 1);
  state.translationOrder.splice(to, 0, item);
  saveState();
  renderTranslationControls();
  refreshPanelBodies();
}

// Native HTML5 drag-and-drop (dragstart/dragover/drop) does not fire on touch
// input, so touch reordering is driven by Pointer Events instead: the dragged
// item is lifted with a transform, elementFromPoint finds the item underneath
// the finger, and the swap only happens once on release (mirroring the mouse
// drop handler above).
function setupTouchReorder({ item, handle, container, itemClass, id, getOrder, onReorder }) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let hoverTarget = null;

    handle.setPointerCapture(pointerId);
    item.classList.add("dragging");
    item.style.position = "relative";
    item.style.zIndex = "5";
    item.style.pointerEvents = "none";
    document.body.classList.add("reordering-chip");

    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      item.style.transform = `translate(${dx}px, ${dy}px)`;
      const target = document
        .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
        ?.closest(`.${itemClass}`);
      const next = target && target !== item && target.parentElement === container ? target : null;
      if (hoverTarget && hoverTarget !== next) hoverTarget.classList.remove("drag-over");
      hoverTarget = next;
      hoverTarget?.classList.add("drag-over");
    };

    const finish = () => {
      handle.releasePointerCapture(pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      item.classList.remove("dragging");
      item.style.position = "";
      item.style.zIndex = "";
      item.style.pointerEvents = "";
      item.style.transform = "";
      document.body.classList.remove("reordering-chip");
      hoverTarget?.classList.remove("drag-over");
      if (hoverTarget) {
        const order = getOrder();
        const from = order.indexOf(id);
        const to = order.indexOf(hoverTarget.dataset.translation);
        if (from >= 0 && to >= 0 && from !== to) onReorder(from, to);
      }
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });
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

function syncComboboxInputMode(input) {
  if (!input.dataset.desktopInputMode) {
    input.dataset.desktopInputMode = input.getAttribute("inputmode") || "default";
  }
  input.readOnly = mobileLayout.matches;
  if (mobileLayout.matches) {
    input.setAttribute("inputmode", "none");
  } else if (input.dataset.desktopInputMode === "default") {
    input.removeAttribute("inputmode");
  } else {
    input.setAttribute("inputmode", input.dataset.desktopInputMode);
  }
}

mobileLayout.addEventListener("change", () => {
  document.querySelectorAll(".combo-input").forEach(syncComboboxInputMode);
});

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

function setupCombobox({ input, toggle, menu, items, selectedValue, matches, onSelect }) {
  let allItems = items;
  let selected = selectedValue;
  let filtered = [];
  let highlighted = 0;

  function selectedItem() {
    return allItems.find((item) => item.value === selected);
  }

  function close() {
    menu.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }

  function choose(item, notify = true) {
    if (!item) return;
    selected = item.value;
    input.value = item.label;
    close();
    if (notify) onSelect(item.value);
  }

  function render(query = "") {
    filtered = allItems.filter((item) => matches(item, query));
    highlighted = 0;
    menu.replaceChildren();
    for (const [index, item] of filtered.entries()) {
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
  }

  function updateHighlight(nextIndex) {
    if (!filtered.length) return;
    highlighted = (nextIndex + filtered.length) % filtered.length;
    menu.querySelectorAll(".combo-option").forEach((option, index) => {
      option.classList.toggle("highlighted", index === highlighted);
    });
    menu.querySelectorAll(".combo-option")[highlighted]?.scrollIntoView({ block: "nearest" });
  }

  function open(selectText = false) {
    render(selectText ? "" : input.value === selectedItem()?.label ? "" : input.value);
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (selectText && !input.readOnly) input.select();
  }

  input.addEventListener("focus", () => open(true));
  input.addEventListener("click", () => {
    if (input.readOnly) open(true);
  });
  input.addEventListener("input", () => {
    render(input.value);
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
  });
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (menu.hidden) open();
      updateHighlight(highlighted + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      if (!menu.hidden && filtered.length) {
        event.preventDefault();
        choose(filtered[highlighted]);
      }
    } else if (event.key === "Escape") {
      close();
      input.value = selectedItem()?.label ?? "";
      input.select();
    }
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      close();
      input.value = selectedItem()?.label ?? "";
    }, 100);
  });
  toggle.addEventListener("click", () => {
    input.focus();
    open(true);
  });

  syncComboboxInputMode(input);
  choose(selectedItem(), false);
  close();

  return {
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

function setupPanelSwipe(panel, content) {
  let gesture = null;
  let suppressClick = false;

  content.addEventListener("click", (event) => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  content.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" || !mobileLayout.matches || state.panels.length < 2) return;
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: panelTrack.scrollLeft,
      startIndex: panelIndexAtViewportStart(),
      axis: null,
    };
  });

  content.addEventListener("pointermove", (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const distanceX = Math.abs(deltaX);
    const distanceY = Math.abs(deltaY);

    if (!gesture.axis && Math.max(distanceX, distanceY) >= 8) {
      gesture.axis = distanceX > distanceY * 1.15 ? "horizontal" : "vertical";
    }
    if (gesture.axis !== "horizontal") return;

    event.preventDefault();
    document.body.classList.add("swiping-panels");
    panelTrack.scrollLeft = gesture.startScrollLeft - deltaX;
  }, { passive: false });

  const finish = (event, cancelled = false) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.axis === "horizontal") {
      const deltaX = event.clientX - gesture.startX;
      const threshold = Math.min(70, panel.clientWidth * 0.18);
      let targetIndex = gesture.startIndex;
      if (!cancelled && Math.abs(deltaX) >= threshold) {
        targetIndex += deltaX < 0 ? 1 : -1;
      }
      targetIndex = Math.max(0, Math.min(targetIndex, state.panels.length - 1));
      scrollToPanelIndex(targetIndex);

      suppressClick = true;
      window.setTimeout(() => {
        suppressClick = false;
      }, 400);
    }
    document.body.classList.remove("swiping-panels");
    gesture = null;
  };

  content.addEventListener("pointerup", (event) => finish(event));
  content.addEventListener("pointercancel", (event) => finish(event, true));
}

function chapterItems(bookIndex) {
  return Array.from({ length: manifest.books[bookIndex].chapters }, (_, index) => ({
    value: index + 1,
    label: String(index + 1),
  }));
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
      const width = Math.max(320, Math.min(startWidth + moveEvent.clientX - startX, 1000));
      panelState.width = Math.round(width);
      panel.style.flexBasis = `${panelState.width}px`;
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
    saveState();
  });
}

function createPanelElement(panelState, shouldScroll = false) {
  const id = `panel-${++panelIdCounter}`;
  panelState.id = id;
  const fragment = panelTemplate.content.cloneNode(true);
  const panel = fragment.querySelector(".bible-panel");
  const bookInput = fragment.querySelector(".book-input");
  const chapterInput = fragment.querySelector(".chapter-input");
  const content = fragment.querySelector(".panel-content");
  const copy = fragment.querySelector(".copy-selection");
  const remove = fragment.querySelector(".remove-panel");
  const panelNumber = fragment.querySelector(".panel-number");
  const previous = fragment.querySelector(".previous-chapter");
  const next = fragment.querySelector(".next-chapter");
  const resizeHandle = fragment.querySelector(".panel-resize-handle");

  panel.dataset.panelId = id;
  panelState.selectionAnchor = null;
  panelState.selectionEnd = null;
  if (panelState.width) panel.style.flexBasis = `${panelState.width}px`;
  panel.addEventListener("pointerdown", () => setActivePanel(id));
  panel.addEventListener("focusin", () => setActivePanel(id));

  const bookItems = manifest.books.map((book, index) => ({
    value: index,
    label: `${book.en}, ${book.ko}`,
    ko: book.ko,
    en: book.en,
  }));
  let chapterCombo;
  const bookCombo = setupCombobox({
    input: bookInput,
    toggle: fragment.querySelector(".book-combo .combo-toggle"),
    menu: fragment.querySelector(".book-combo .combo-menu"),
    items: bookItems,
    selectedValue: panelState.book,
    matches: matchesBook,
    onSelect: (book) => {
      panelState.book = book;
      panelState.chapter = 1;
      chapterCombo.setItems(chapterItems(book));
      chapterCombo.setValue(1);
      saveState();
      loadPanel(panelState);
    },
  });
  chapterCombo = setupCombobox({
    input: chapterInput,
    toggle: fragment.querySelector(".chapter-combo .combo-toggle"),
    menu: fragment.querySelector(".chapter-combo .combo-menu"),
    items: chapterItems(panelState.book),
    selectedValue: panelState.chapter,
    matches: (item, query) => !query.trim() || item.label.startsWith(query.trim()),
    onSelect: (chapter) => {
      panelState.chapter = chapter;
      saveState();
      loadPanel(panelState);
    },
  });
  copy.addEventListener("click", () => openCopyDialog(panelState));
  remove.addEventListener("click", () => removePanel(id));
  previous.addEventListener("click", () => navigateChapter(panelState, -1));
  next.addEventListener("click", () => navigateChapter(panelState, 1));
  setupPanelResize(panel, resizeHandle, panelState);
  setupPanelSwipe(panel, content);

  panelElements.set(id, { panel, bookCombo, chapterCombo, content, copy, remove, panelNumber, previous, next });
  panelTrack.append(fragment);
  updatePanelNumbers();
  updateRemoveButtons();
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
  const panelState = { book: source?.book ?? 0, chapter: source?.chapter ?? 1, width: source?.width ?? null };
  state.panels.push(panelState);
  saveState();
  const panel = createPanelElement(panelState, !landscapeMobile.matches);
  if (landscapeMobile.matches) {
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
  const removedPanel = panelElements.get(id)?.panel;

  state.panels.splice(index, 1);
  panelElements.delete(id);
  if (activePanelId === id) setActivePanel(state.panels[Math.min(index, state.panels.length - 1)].id);
  saveState();
  updatePanelNumbers();
  updateRemoveButtons();

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
      const target = landscapeMobile.matches ? state.panels.length - 2 : state.panels.length - 1;
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

function updatePanelNumbers() {
  state.panels.forEach((panelState, index) => {
    const panelNumber = panelElements.get(panelState.id)?.panelNumber;
    if (!panelNumber) return;
    const number = index + 1;
    panelNumber.textContent = number;
    panelNumber.setAttribute("aria-label", `Panel ${number}`);
    panelNumber.title = `Panel ${number}`;
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

function updatePanelSelection(panelState) {
  const elements = panelElements.get(panelState.id);
  if (!elements) return;
  const bounds = selectionBounds(panelState);
  elements.content.querySelectorAll(".verse-group").forEach((group) => {
    const verse = Number(group.dataset.verse);
    group.classList.toggle("selected", Boolean(bounds && verse >= bounds[0] && verse <= bounds[1]));
  });
  elements.copy.hidden = !bounds;
}

function clearPanelSelection(panelState) {
  panelState.selectionAnchor = null;
  panelState.selectionEnd = null;
  updatePanelSelection(panelState);
}

function selectVerse(panelState, verse) {
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
  updatePanelSelection(panelState);
}

async function loadPanel(panelState, targetVerse = null) {
  const elements = panelElements.get(panelState.id);
  if (!elements) return;
  const requestKey = `${panelState.book}:${panelState.chapter}:${Date.now()}`;
  elements.panel.dataset.requestKey = requestKey;
  clearPanelSelection(panelState);
  elements.content.innerHTML = '<div class="panel-message">Loading…</div>';
  updatePanelControls(panelState);

  try {
    const data = await getChapter(panelState.book, panelState.chapter);
    if (elements.panel.dataset.requestKey !== requestKey) return;
    panelState.data = data;
    renderPanelBody(panelState);
    if (targetVerse) {
      requestAnimationFrame(() => {
        const verse = elements.content.querySelector(`[data-verse="${targetVerse}"]`);
        verse?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } else {
      elements.content.scrollTop = 0;
    }
  } catch (error) {
    elements.content.innerHTML = `<div class="panel-message error">${escapeHtml(error.message)}<br />Use a local HTTP server when previewing.</div>`;
  }
}

function renderPanelBody(panelState) {
  const elements = panelElements.get(panelState.id);
  if (!elements || !panelState.data) return;
  const enabled = state.translationOrder.filter((id) => state.enabledTranslations.includes(id));
  const fragment = document.createDocumentFragment();

  for (const [verseNumber, texts] of panelState.data.v) {
    const group = document.createElement("section");
    group.className = "verse-group";
    group.dataset.verse = String(verseNumber);
    group.addEventListener("click", () => selectVerse(panelState, verseNumber));
    const number = document.createElement("span");
    number.className = "verse-number";
    number.textContent = String(verseNumber);
    group.append(number);

    let rendered = 0;
    for (const translation of enabled) {
      if (!texts[translation]) continue;
      rendered += 1;
      const line = document.createElement("div");
      line.className = "translation-line";
      line.lang = translationLanguage(translation);
      line.style.setProperty("--translation-color", TRANSLATION_COLORS[translation]);
      const label = document.createElement("span");
      label.className = "translation-label";
      label.textContent = translationMeta(translation).label;
      const text = document.createElement("p");
      text.className = "translation-text";
      text.textContent = texts[translation];
      line.append(label, text);
      group.append(line);
    }

    if (!rendered) {
      const empty = document.createElement("p");
      empty.className = "empty-translation";
      empty.textContent = "Select at least one translation.";
      group.append(empty);
    }
    fragment.append(group);
  }

  elements.content.replaceChildren(fragment);
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
  panelState.book = book;
  panelState.chapter = chapter;
  saveState();
  loadPanel(panelState);
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

function renderCopyTranslationOptions(checkedTranslations = null) {
  const checked = checkedTranslations ?? new Set(
    [...copyTranslations.querySelectorAll(".copy-translation-option.selected")]
      .map((item) => item.dataset.translation),
  );
  copyTranslations.replaceChildren();

  copyTranslationOrder.forEach((translation, index) => {
    const item = document.createElement("div");
    item.className = "copy-translation-option";
    item.classList.toggle("selected", checked.has(translation));
    item.draggable = true;
    item.dataset.translation = translation;
    item.tabIndex = 0;
    item.setAttribute("role", "checkbox");
    item.setAttribute("aria-checked", String(checked.has(translation)));
    item.setAttribute("aria-label", `${translationMeta(translation).label} translation`);

    const handle = document.createElement("span");
    handle.className = "copy-drag-handle";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";
    setupTouchReorder({
      item,
      handle,
      container: copyTranslations,
      itemClass: "copy-translation-option",
      id: translation,
      getOrder: () => copyTranslationOrder,
      onReorder: moveCopyTranslation,
    });

    const text = document.createElement("span");
    text.className = "copy-translation-name";
    text.lang = translationLanguage(translation);
    text.textContent = translationMeta(translation).label;
    text.style.setProperty("--translation-color", TRANSLATION_COLORS[translation]);

    const moves = document.createElement("span");
    moves.className = "copy-move-buttons";
    const left = document.createElement("button");
    left.type = "button";
    left.textContent = "‹";
    left.disabled = index === 0;
    left.setAttribute("aria-label", `Move ${translationMeta(translation).label} left`);
    left.addEventListener("click", () => moveCopyTranslation(index, index - 1));
    const right = document.createElement("button");
    right.type = "button";
    right.textContent = "›";
    right.disabled = index === copyTranslationOrder.length - 1;
    right.setAttribute("aria-label", `Move ${translationMeta(translation).label} right`);
    right.addEventListener("click", () => moveCopyTranslation(index, index + 1));
    moves.append(left, right);

    item.addEventListener("dragstart", (event) => {
      item.classList.add("dragging");
      event.dataTransfer.setData("text/plain", translation);
      event.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragend", () => item.classList.remove("dragging"));
    item.addEventListener("dragover", (event) => event.preventDefault());
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const dragged = event.dataTransfer.getData("text/plain");
      const from = copyTranslationOrder.indexOf(dragged);
      const to = copyTranslationOrder.indexOf(translation);
      if (from >= 0 && to >= 0 && from !== to) moveCopyTranslation(from, to);
    });
    const toggleCopyTranslation = () => {
      const selected = !item.classList.contains("selected");
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-checked", String(selected));
    };
    item.addEventListener("click", (event) => {
      if (event.target.closest("button, .copy-drag-handle")) return;
      toggleCopyTranslation();
    });
    item.addEventListener("keydown", (event) => {
      if (event.target !== item) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleCopyTranslation();
    });

    item.append(handle, text, moves);
    copyTranslations.append(item);
  });
}

function moveCopyTranslation(from, to) {
  if (to < 0 || to >= copyTranslationOrder.length) return;
  const checked = new Set(
    [...copyTranslations.querySelectorAll(".copy-translation-option.selected")]
      .map((item) => item.dataset.translation),
  );
  const [translation] = copyTranslationOrder.splice(from, 1);
  copyTranslationOrder.splice(to, 0, translation);
  renderCopyTranslationOptions(checked);
}

function openCopyDialog(panelState) {
  const bounds = selectionBounds(panelState);
  if (!bounds || !panelState.data) return;
  copyPanelState = panelState;
  copyStatus.textContent = "";
  confirmCopyButton.textContent = "Copy";
  const book = manifest.books[panelState.book];
  const reference = bounds[0] === bounds[1]
    ? `${panelState.chapter}:${bounds[0]}`
    : `${panelState.chapter}:${bounds[0]}-${bounds[1]}`;
  copyReference.textContent = `${book.en} ${book.ko} ${reference}`;
  const defaultTranslations = state.enabledTranslations.length
    ? new Set(state.enabledTranslations)
    : new Set(state.translationOrder);
  copyTranslationOrder = [...state.translationOrder];
  renderCopyTranslationOptions(defaultTranslations);
  copyDialog.showModal();
}

function closeCopyDialog() {
  copyDialog.close();
  copyPanelState = null;
}

function buildCopyText(panelState, translations, order) {
  const [start, end] = selectionBounds(panelState);
  const book = manifest.books[panelState.book];
  const verses = panelState.data.v.filter(([verse]) => verse >= start && verse <= end);
  const lines = [];
  const bookNameFor = (translation) =>
    translationLanguage(translation) === "en" ? book.en : book.ko;
  const range = start === end
    ? `${panelState.chapter}:${start}`
    : `${panelState.chapter}:${start}-${end}`;

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
    for (const [verse, texts] of verses) {
      lines.push(`${bookName} ${panelState.chapter}:${verse}, ${translationNames}`);
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
  const translations = [...copyTranslations.querySelectorAll(".copy-translation-option.selected")]
    .map((item) => item.dataset.translation);
  if (!translations.length) {
    copyStatus.textContent = "Select a translation.";
    return;
  }
  const order = copyDialog.querySelector('input[name="copy-order"]:checked').value;
  const text = buildCopyText(copyPanelState, translations, order);
  try {
    await writeClipboard(text);
    copyStatus.textContent = "Copied";
    confirmCopyButton.textContent = "Copied";
    window.setTimeout(closeCopyDialog, 450);
  } catch (error) {
    copyStatus.textContent = error.message;
  }
}

function openSearch() {
  searchDialog.showModal();
  requestAnimationFrame(() => searchInput.focus());
}

function closeSearch() {
  searchDialog.close();
}

function runSearch(query) {
  const translations = state.translationOrder.filter((id) => state.enabledTranslations.includes(id));
  searchBookList.replaceChildren();
  searchResults.replaceChildren();
  if (!translations.length) {
    searchMeta.textContent = "Select at least one translation.";
    return;
  }
  searchRequestId += 1;
  searchMeta.textContent = `Preparing search data for “${query}”…`;
  searchWorker.postMessage({ type: "search", requestId: searchRequestId, query, translations });
}

searchWorker.addEventListener("message", (event) => {
  const message = event.data;
  if (message.requestId !== searchRequestId) return;
  if (message.type === "progress") {
    searchMeta.textContent = message.text;
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

  const totalVerses = bookCounts.reduce((sum, [, count]) => sum + count, 0);
  searchMeta.textContent = `${totalVerses.toLocaleString()} verses · ${totalTranslationMatches.toLocaleString()} translation matches · ${(elapsedMs / 1000).toFixed(1)}s${truncated ? " · Top results shown" : ""}`;

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
    const button = document.createElement("button");
    button.className = "search-result";
    button.type = "button";
    button.dataset.book = String(result.book);
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
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    reference.append(referenceText, arrow);
    button.append(reference);

    result.lines.sort(
      (a, b) => state.translationOrder.indexOf(a.translation) - state.translationOrder.indexOf(b.translation),
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
      button.append(row);
    }
    button.addEventListener("click", () => openSearchResult(result));
    searchResults.append(button);
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

function openSearchResult(result) {
  const panelState = state.panels.find((panel) => panel.id === activePanelId) ?? state.panels[0];
  panelState.book = result.book;
  panelState.chapter = result.chapter;
  saveState();
  closeSearch();
  const elements = panelElements.get(panelState.id);
  elements.panel.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  loadPanel(panelState, result.verse);
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
    state = loadState();
    sanitizeState();
    applyFontSize();
    renderTranslationControls();
    for (const panel of state.panels) createPanelElement(panel);
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
fontSizeDownButton.addEventListener("click", () => changeFontSize(-1));
fontSizeUpButton.addEventListener("click", () => changeFontSize(1));
openSearchButton.addEventListener("click", openSearch);
closeSearchButton.addEventListener("click", closeSearch);
searchDialog.addEventListener("click", (event) => {
  if (event.target === searchDialog) closeSearch();
});
closeCopyButton.addEventListener("click", closeCopyDialog);
cancelCopyButton.addEventListener("click", closeCopyDialog);
confirmCopyButton.addEventListener("click", copySelectedVerses);
copyDialog.addEventListener("click", (event) => {
  if (event.target === copyDialog) closeCopyDialog();
});
searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (query.length < 2) return;
  runSearch(query);
});

// GitHub Pages' CDN can keep serving a stale index.html/app.js for a while
// after a deploy, and an already-open tab never re-fetches it on its own.
// Poll a tiny no-store JSON file so both cases surface a manual refresh
// prompt instead of silently showing outdated content.
async function checkForUpdate() {
  try {
    const response = await fetch(`./version.json?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (data.build && data.build !== ASSET_VERSION) updateBanner.hidden = false;
  } catch {
    // Offline or blocked request; the next scheduled check will retry.
  }
}

updateReloadButton.addEventListener("click", () => window.location.reload());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkForUpdate();
});
window.setInterval(checkForUpdate, 5 * 60 * 1000);
checkForUpdate();

init();
