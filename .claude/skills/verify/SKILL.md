---
name: verify
description: Build/launch/drive recipe for verifying changes to this static Bible PWA in a real browser.
---

# Verifying this app

Static site; no build step. Serve over HTTP (file:// fails on JSON fetches):

```powershell
python -m http.server 8123    # from the repo root
```

Drive it headlessly with Python Playwright (`pip install playwright; python -m playwright install chromium`):

- Desktop: `browser.new_page(viewport 1500x900)`.
- Phone portrait: `browser.new_context(viewport 390x844, has_touch=True, is_mobile=True)`.
- Touch drag gestures (press-drag pick in the translation picker and book/chapter
  combos, chip reorder) need real touch input: use a CDP session and
  `Input.dispatchTouchEvent` (touchStart → several touchMove steps ~40 ms apart →
  touchEnd with empty touchPoints). Playwright's `tap()` covers plain taps.
- App state persists in localStorage key `side-by-side-bible:v1`; each fresh
  context starts clean. `#site-brand` click resets to defaults.
- Wait for `.verse-group` after navigation before interacting.

Gotchas:
- The translation picker menu and combo menus are tall; any "tap/click outside
  to close" (or verse-tap) test point must be computed to land clear of the
  open menu's bounding box, or use Escape. An outside press while a menu is
  open is intentionally swallowed (it only closes the menu), so expect the
  first tap after opening a menu to have no other effect.
- After changing data.db run `python scripts/export_data.py`, and bump the
  asset version in index.html + search-worker.js + version.json together
  (mismatch shows a permanent refresh banner).
