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
    handle.title = "끌어서 순서 변경";
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
    left.setAttribute("aria-label", `${meta.label}을 앞으로 이동`);
    left.addEventListener("click", () => moveTranslation(index, index - 1));
    const right = document.createElement("button");
    right.className = "move-translation";
    right.type = "button";
    right.textContent = "›";
    right.disabled = index === state.translationOrder.length - 1;
    right.setAttribute("aria-label", `${meta.label}을 뒤로 이동`);
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

function createPanelElement(panelState, shouldScroll = false) {
  const id = `panel-${++panelIdCounter}`;
  panelState.id = id;
  const fragment = panelTemplate.content.cloneNode(true);
  const panel = fragment.querySelector(".bible-panel");
  const bookSelect = fragment.querySelector(".book-select");
  const chapterSelect = fragment.querySelector(".chapter-select");
  const content = fragment.querySelector(".panel-content");
  const remove = fragment.querySelector(".remove-panel");
  const previous = fragment.querySelector(".previous-chapter");
  const next = fragment.querySelector(".next-chapter");
  const position = fragment.querySelector(".chapter-position");

  panel.dataset.panelId = id;
  panel.addEventListener("pointerdown", () => setActivePanel(id));
  panel.addEventListener("focusin", () => setActivePanel(id));

  manifest.books.forEach((book, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${book.ko} · ${book.en}`;
    bookSelect.append(option);
  });
  bookSelect.value = String(panelState.book);
  fillChapterSelect(chapterSelect, panelState.book, panelState.chapter);

  bookSelect.addEventListener("change", () => {
    panelState.book = Number(bookSelect.value);
    panelState.chapter = 1;
    fillChapterSelect(chapterSelect, panelState.book, 1);
    saveState();
    loadPanel(panelState);
  });
  chapterSelect.addEventListener("change", () => {
    panelState.chapter = Number(chapterSelect.value);
    saveState();
    loadPanel(panelState);
  });
  remove.addEventListener("click", () => removePanel(id));
  previous.addEventListener("click", () => navigateChapter(panelState, -1));
  next.addEventListener("click", () => navigateChapter(panelState, 1));

  panelElements.set(id, { panel, bookSelect, chapterSelect, content, remove, previous, next, position });
  panelTrack.append(fragment);
  updateRemoveButtons();
  setActivePanel(id);
  loadPanel(panelState);

  if (shouldScroll) {
    requestAnimationFrame(() => panel.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" }));
  }
}

function fillChapterSelect(select, bookIndex, selectedChapter) {
  select.replaceChildren();
  const count = manifest.books[bookIndex].chapters;
  for (let chapter = 1; chapter <= count; chapter += 1) {
    const option = document.createElement("option");
    option.value = String(chapter);
    option.textContent = `${chapter}장`;
    select.append(option);
  }
  select.value = String(selectedChapter);
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
  if (!response.ok) throw new Error(`본문을 불러오지 못했습니다 (${response.status})`);
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
  elements.content.innerHTML = '<div class="panel-message">본문을 펼치는 중입니다…</div>';
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
    elements.content.innerHTML = `<div class="panel-message error">${escapeHtml(error.message)}<br />로컬에서는 HTTP 서버로 열어 주세요.</div>`;
  }
}

function renderPanelBody(panelState) {
  const elements = panelElements.get(panelState.id);
  if (!elements || !panelState.data) return;
  const enabled = state.translationOrder.filter((id) => state.enabledTranslations.includes(id));
  const fragment = document.createDocumentFragment();

  const heading = document.createElement("div");
  heading.className = "chapter-heading";
  const title = document.createElement("h2");
  title.textContent = `${manifest.books[panelState.book].ko} ${panelState.chapter}장`;
  const subtitle = document.createElement("p");
  subtitle.textContent = `${manifest.books[panelState.book].en} · ${panelState.data.v.length}개 절`;
  heading.append(title, subtitle);
  fragment.append(heading);

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
      empty.textContent = "표시할 역본을 위에서 선택해 주세요.";
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
  elements.bookSelect.value = String(panelState.book);
  if (elements.chapterSelect.value !== String(panelState.chapter)) {
    fillChapterSelect(elements.chapterSelect, panelState.book, panelState.chapter);
  }
  elements.position.textContent = `${manifest.books[panelState.book].ko} ${panelState.chapter}장`;
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
  const elements = panelElements.get(panelState.id);
  fillChapterSelect(elements.chapterSelect, book, chapter);
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
    searchMeta.textContent = "검색할 역본을 하나 이상 선택해 주세요.";
    return;
  }
  searchRequestId += 1;
  searchMeta.textContent = `“${query}” 검색 데이터를 준비하는 중입니다…`;
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
    searchMeta.textContent = `검색 중 오류가 발생했습니다: ${message.error}`;
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

  searchMeta.textContent = `${groups.length.toLocaleString()}개 구절 · ${matches.length.toLocaleString()}개 역본에서 찾음 · ${(elapsedMs / 1000).toFixed(1)}초${truncated ? " · 상위 결과만 표시" : ""}`;

  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "panel-message";
    empty.textContent = "검색 결과가 없습니다. 다른 단어나 짧은 형태로 검색해 보세요.";
    searchResults.append(empty);
    return;
  }

  for (const result of groups) {
    const button = document.createElement("button");
    button.className = "search-result";
    button.type = "button";
    const reference = document.createElement("div");
    reference.className = "search-reference";
    reference.innerHTML = `<span>${escapeHtml(manifest.books[result.book].ko)} ${result.chapter}:${result.verse}</span><span aria-hidden="true">→</span>`;
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
  const elements = panelElements.get(panelState.id);
  fillChapterSelect(elements.chapterSelect, result.book, result.chapter);
  saveState();
  closeSearch();
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
    if (!response.ok) throw new Error(`설정 데이터를 불러오지 못했습니다 (${response.status})`);
    manifest = await response.json();
    state = loadState();
    sanitizeState();
    renderTranslationControls();
    for (const panel of state.panels) createPanelElement(panel);
    saveState();
  } catch (error) {
    panelTrack.innerHTML = `<div class="panel-message error">사이트를 시작하지 못했습니다: ${escapeHtml(error.message)}<br />로컬에서는 HTTP 서버로 열어 주세요.</div>`;
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
