# Security

- **Report a vulnerability:** open a GitHub issue labeled `security` on
  `anki-boi/ojph-cleaner`. There is no public disclosure process or bug-bounty program — this is a
  single-maintainer personal tool.
- **Surface area:** a content script plus one standalone options page. There is no server, no
  background service worker, and no code that runs outside `onlinejobs.ph`.
- **Permissions:** `storage` (settings and the deep-scan cache) and host permissions on
  `onlinejobs.ph` only. The host permission exists so the content script can read the listing DOM
  on that site; the extension requests nothing else and injects nowhere else.
- **Data:** keyword lists and toggles live in `chrome.storage.local`; the deep-scan description
  cache (when it ships, see `spec.md` W3) lives in IndexedDB. Nothing is uploaded anywhere: no
  analytics, no telemetry, no third-party calls. Deleted by removing the extension.
- **Network:** the extension makes **zero** requests while no keywords are configured. When the
  optional deep scan runs it fetches job-detail pages on `onlinejobs.ph` only, for the cards on the
  current page, at 3 concurrent / 400 ms between waves, and it stops on HTTP 429 instead of
  retrying harder. See `docs/scraping.md`.
- **Untrusted input:** the page's text is treated as text. No page-supplied string is ever written
  with `innerHTML`, and the injected panel's markup is a fixed template.
- **Dependencies:** none at runtime and none at build time. `tools/` and the tests use Node's
  standard library only (Node ≥ 18 for `fetch` and `WebSocket`).
