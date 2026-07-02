const cache = new Map();
const MAX_MATCHES_PER_TRANSLATION = 250;

async function loadTranslation(translation) {
  if (cache.has(translation)) return cache.get(translation);
  const response = await fetch(`./data/search/${translation}.json`);
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
    let truncated = false;

    for (const [translation, rows] of datasets) {
      let translationMatches = 0;
      for (const [book, chapter, verse, text] of rows) {
        if (text.normalize("NFKC").toLocaleLowerCase().includes(needle)) {
          matches.push([translation, book, chapter, verse, text]);
          translationMatches += 1;
          if (translationMatches >= MAX_MATCHES_PER_TRANSLATION) {
            truncated = true;
            break;
          }
        }
      }
    }

    self.postMessage({
      type: "result",
      requestId,
      query,
      matches,
      truncated,
      elapsedMs: performance.now() - started,
    });
  } catch (error) {
    self.postMessage({ type: "error", requestId, error: error.message });
  }
});
