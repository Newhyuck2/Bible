const STORAGE_KEY = "side-by-side-bible:v1";
const TRANSLATION_COLORS = {
  ESV: "#9b5c34",
  NIV: "#476f9b",
  GAE: "#2f7663",
  SAENEW: "#805692",
};

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
const searchResults = document.querySelector("#search-results");

let manifest;
let state;
let activePanelId;
let panelIdCounter = 0;
let searchRequestId = 0;
const chapterCache = new Map();
const panelElements = new Map();
const searchWorker = new Worker("./search-worker.js");

function freshState() {
  return {
    translationOrder: ["ESV", "NIV", "GAE", "SAENEW"],
    enabledTranslations: ["ESV", "NIV", "GAE", "SAENEW"],
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
  state.panels = state.panels
    .map((panel) => {
      const book = Math.max(0, Math.min(Number(panel.book) || 0, manifest.books.length - 1));
      const chapter = Math.max(1, Math.min(Number(panel.chapter) || 1, manifest.books[book].chapters));
      return { book, chapter };
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
      panels: state.panels.map(({ book, chapter }) => ({ book, chapter })),
    }),
  );
}

function translationMeta(id) {
  return manifest.translations.find((item) => item.id === id);
}

function renderTranslationControls() {
  translationList.replaceChildren();

  state.translationOrder.forEach((id, index) => {
    const meta = translationMeta(id);
    const chip = document.createElement("div");
    chip.className = "translation-chip";
    chip.draggable = true;
    chip.dataset.translation = id;

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";
    handle.setAttribute("aria-hidden", "true");

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.enabledTranslations.includes(id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.enabledTranslations.push(id);
      } else {
        state.enabledTranslations = state.enabledTranslations.filter((item) => item !== id);
      }
      saveState();
      refreshPanelBodies();
    });

    const dot = document.createElement("span");
    dot.className = "translation-dot";
    dot.style.setProperty("--translation-color", TRANSLATION_COLORS[id]);
    const name = document.createElement("span");
    name.textContent = meta.label;
    label.append(checkbox, dot, name);

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

    chip.append(handle, label, moveButtons);
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
      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        choose(item);
      });
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
    if (selectText) input.select();
  }

  input.addEventListener("focus", () => open(true));
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

function chapterItems(bookIndex) {
  return Array.from({ length: manifest.books[bookIndex].chapters }, (_, index) => ({
    value: index + 1,
    label: String(index + 1),
  }));
}

function createPanelElement(panelState, shouldScroll = false) {
  const id = `panel-${++panelIdCounter}`;
  panelState.id = id;
  const fragment = panelTemplate.content.cloneNode(true);
  const panel = fragment.querySelector(".bible-panel");
  const bookInput = fragment.querySelector(".book-input");
  const chapterInput = fragment.querySelector(".chapter-input");
  const content = fragment.querySelector(".panel-content");
  const remove = fragment.querySelector(".remove-panel");
  const previous = fragment.querySelector(".previous-chapter");
  const next = fragment.querySelector(".next-chapter");

  panel.dataset.panelId = id;
  panel.addEventListener("pointerdown", () => setActivePanel(id));
  panel.addEventListener("focusin", () => setActivePanel(id));

  const bookItems = manifest.books.map((book, index) => ({
    value: index,
    label: `${book.ko} · ${book.en}`,
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
  remove.addEventListener("click", () => removePanel(id));
  previous.addEventListener("click", () => navigateChapter(panelState, -1));
  next.addEventListener("click", () => navigateChapter(panelState, 1));

  panelElements.set(id, { panel, bookCombo, chapterCombo, content, remove, previous, next });
  panelTrack.append(fragment);
  updateRemoveButtons();
  setActivePanel(id);
  loadPanel(panelState);

  if (shouldScroll) {
    requestAnimationFrame(() => panel.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" }));
  }
}

function setActivePanel(id) {
  activePanelId = id;
  for (const [panelId, elements] of panelElements) {
    elements.panel.classList.toggle("active", panelId === id);
  }
}

function addPanel() {
  const source = state.panels.find((panel) => panel.id === activePanelId) ?? state.panels.at(-1);
  const panelState = { book: source?.book ?? 0, chapter: source?.chapter ?? 1 };
  state.panels.push(panelState);
  saveState();
  createPanelElement(panelState, true);
}

function removePanel(id) {
  if (state.panels.length === 1) return;
  const index = state.panels.findIndex((panel) => panel.id === id);
  if (index < 0) return;
  state.panels.splice(index, 1);
  panelElements.get(id)?.panel.remove();
  panelElements.delete(id);
  if (activePanelId === id) setActivePanel(state.panels[Math.max(0, index - 1)].id);
  saveState();
  updateRemoveButtons();
}

function updateRemoveButtons() {
  const disabled = state.panels.length === 1;
  for (const { remove } of panelElements.values()) {
    remove.hidden = disabled;
  }
}

function chapterPath(bookIndex, chapter) {
  return `./data/chapters/${manifest.books[bookIndex].slug}/${chapter}.json`;
}

async function getChapter(bookIndex, chapter) {
  const key = `${bookIndex}:${chapter}`;
  if (chapterCache.has(key)) return chapterCache.get(key);
  const response = await fetch(chapterPath(bookIndex, chapter));
  if (!response.ok) throw new Error(`Could not load this chapter (${response.status})`);
  const data = await response.json();
  chapterCache.set(key, data);
  if (chapterCache.size > 40) chapterCache.delete(chapterCache.keys().next().value);
  return data;
}

async function loadPanel(panelState, targetVerse = null) {
  const elements = panelElements.get(panelState.id);
  if (!elements) return;
  const requestKey = `${panelState.book}:${panelState.chapter}:${Date.now()}`;
  elements.panel.dataset.requestKey = requestKey;
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
      line.lang = translation === "GAE" || translation === "SAENEW" ? "ko" : "en";
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

function openSearch() {
  searchDialog.showModal();
  requestAnimationFrame(() => searchInput.focus());
}

function closeSearch() {
  searchDialog.close();
}

function runSearch(query) {
  const translations = state.translationOrder.filter((id) => state.enabledTranslations.includes(id));
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
    renderSearchResults(message.query, message.matches, message.truncated, message.elapsedMs);
  } else if (message.type === "error") {
    searchMeta.textContent = `Search failed: ${message.error}`;
  }
});

function renderSearchResults(query, matches, truncated, elapsedMs) {
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

  searchMeta.textContent = `${groups.length.toLocaleString()} verses · ${matches.length.toLocaleString()} translation matches · ${(elapsedMs / 1000).toFixed(1)}s${truncated ? " · Top results shown" : ""}`;

  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "panel-message";
    empty.textContent = "No results. Try another word or a shorter form.";
    searchResults.append(empty);
    return;
  }

  for (const result of groups) {
    const button = document.createElement("button");
    button.className = "search-result";
    button.type = "button";
    const reference = document.createElement("div");
    reference.className = "search-reference";
    reference.innerHTML = `<span>${escapeHtml(manifest.books[result.book].en)} ${result.chapter}:${result.verse}</span><span aria-hidden="true">→</span>`;
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
    const response = await fetch("./data/manifest.json");
    if (!response.ok) throw new Error(`Could not load site data (${response.status})`);
    manifest = await response.json();
    state = loadState();
    sanitizeState();
    renderTranslationControls();
    for (const panel of state.panels) createPanelElement(panel);
    saveState();
  } catch (error) {
    panelTrack.innerHTML = `<div class="panel-message error">Could not start the site: ${escapeHtml(error.message)}<br />Use a local HTTP server when previewing.</div>`;
  }
}

addPanelButton.addEventListener("click", addPanel);
openSearchButton.addEventListener("click", openSearch);
closeSearchButton.addEventListener("click", closeSearch);
searchDialog.addEventListener("click", (event) => {
  if (event.target === searchDialog) closeSearch();
});
searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (query.length < 2) return;
  runSearch(query);
});

init();
