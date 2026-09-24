# Security

- **Report a vulnerability:** open a GitHub issue labeled `security` on
  `anki-boi/ojph-cleaner`. There is no public disclosure process or bug-bounty program — this is a
  single-maintainer personal tool.
- **Surface area:** two content scripts (`content.js` filters, `pagination.js` loads more) plus one
  standalone options page. There is no server, no background service worker, and no code that runs
  outside `onlinejobs.ph`.
- **Permissions:** `storage` (settings, the rate cache and the deep-scan cache) and host permissions on
  `onlinejobs.ph` only. The host permission exists so the content script can read the listing DOM
  on that site; the extension requests nothing else and injects nowhere else. Rate requests go to a
  public API that allows them without any permission, so no third-party host is granted.
- **Data:** keyword lists, toggles, the goal and the cached rates live in `chrome.storage.local`; the
  deep-scan description cache (when it ships, see `spec.md` W3) lives in IndexedDB. Nothing is uploaded
  anywhere: no analytics, no telemetry. Deleted by removing the extension.
- **Network:** the extension makes **zero** requests while nothing happens: no keywords configured,
  no scrolling and `autoScan` off means no traffic. Beyond that it makes exactly two kinds:
  the next result page of `onlinejobs.ph` (one per real scroll to the bottom of a list — never on an
  idle page, never from a page's own programmatic scroll), and, only when a foreign-currency salary is
  on screen, the European Central Bank reference rate from `api.frankfurter.dev` (one per currency per
  24 h; a public exchange rate, nothing about the user, and no rate means no converted figure rather
  than a stale one). The optional deep scan (when it ships) fetches job-detail pages for the cards
  already loaded, at 3 concurrent / 400 ms between waves, and stops on HTTP 429 instead of retrying
  harder. See `docs/scraping.md`.
- **Untrusted input:** the page's text is treated as text. No page-supplied string is ever written
  with `innerHTML`, and the injected panel's markup is a fixed template.
- **Dependencies:** none at runtime and none at build time. `tools/` and the tests use Node's
  standard library only (Node ≥ 18 for `fetch` and `WebSocket`).
