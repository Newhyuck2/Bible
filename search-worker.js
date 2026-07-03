const cache = new Map();
const MAX_MATCHES_PER_TRANSLATION_PER_BOOK = 25;
const ASSET_VERSION = "20260703-2";

async function loadTranslation(translation) {
  if (cache.has(translation)) return cache.get(translation);
  const response = await fetch(`./data/search/${translation}.json?v=${ASSET_VERSION}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${translation} search data (${response.status})`);
  const data = await response.json();
  cache.set(translation, data);
  return data;
}

self.addEventListener("message", async (event) => {
  const { type, requestId, query, translations } = event.data;
  if (type !== "search") return;

  const started = performance.now();
  try {
    const datasets = [];
    for (let index = 0; index < translations.length; index += 1) {
      const translation = translations[index];
      self.postMessage({
        type: "progress",
        requestId,
        text: `Preparing ${translation} search data · ${index + 1}/${translations.length}`,
      });
      datasets.push([translation, await loadTranslation(translation)]);
    }

    const needle = query.normalize("NFKC").toLocaleLowerCase();
    const matches = [];
    const verseKeysByBook = new Map();
    let totalTranslationMatches = 0;
    let truncated = false;

    for (const [translation, rows] of datasets) {
      const displayedByBook = new Map();
      for (const [book, chapter, verse, text] of rows) {
        if (text.normalize("NFKC").toLocaleLowerCase().includes(needle)) {
          totalTranslationMatches += 1;
          if (!verseKeysByBook.has(book)) verseKeysByBook.set(book, new Set());
          verseKeysByBook.get(book).add(`${chapter}:${verse}`);

          const displayed = displayedByBook.get(book) ?? 0;
          if (displayed < MAX_MATCHES_PER_TRANSLATION_PER_BOOK) {
            matches.push([translation, book, chapter, verse, text]);
            displayedByBook.set(book, displayed + 1);
          } else {
            truncated = true;
          }
        }
      }
    }

    const bookCounts = [...verseKeysByBook]
      .map(([book, verses]) => [book, verses.size])
      .sort((a, b) => a[0] - b[0]);

    self.postMessage({
      type: "result",
      requestId,
      query,
      matches,
      bookCounts,
      totalTranslationMatches,
      truncated,
      elapsedMs: performance.now() - started,
    });
  } catch (error) {
    self.postMessage({ type: "error", requestId, error: error.message });
  }
});
