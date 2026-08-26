# Plan: OJ.ph Cleaner — browser extension (no-salary hide + current-page deep scan with highlight/hide)

> **Status:** DRAFT — rev 3 (2026-08-26): own **public** GitHub repo `anki-boi/ojph-cleaner` (code at repo root); confirmed **positive = highlight-only**; confirmed **deep scan covers only the jobs on the current page**. Rev 2 added the deep scan; rev 1 was card-text-only.

**Goal:** On OnlineJobs.ph in Edge/Chrome: (1) instantly hide cards with no salary; (2) on a "Deep scan" button click, fetch detail pages **for the jobs on the current page only** to get full descriptions, then **hide** negative-keyword matches and **highlight** positive-keyword matches — with progress, stop button, and a local 7-day cache.

**Context:** User insight: the value lives in the browsing experience, and card-level text is too thin for keyword matching — the full description is what you actually filter on (same as the suite's post-enrichment rules). Key enabler: a content script fetches same-origin detail pages from the user's own browser — no CORS, residential IP (unlike the Python scraper's datacenter 429s), everything local (IndexedDB cache; the extension's only network access is OJ.ph). The suite repo (`anki-boi/onlinejobs.ph-suite`, private) remains the tracking CRM; this extension is a standalone companion, in its own public repo.

**Key decisions:**
- **Rules (same semantics as the suite):** "has salary" = salary text contains a digit (TBD/N/A/Negotiable/DOE/empty all fail) → **instant hide, card-level, zero fetches**. **Negative** keyword = case-insensitive substring of the *full context* (card text → full description after scan) → **hide**. **Positive** keyword → **highlight only** (green outline + "✓ <kws>" badge); non-matching cards are left alone (user-confirmed: no hiding for the positive rule).
- **Deep-scan scope is hard-bounded to the current page:** it enriches only the job cards visible after a keyword search or a pagination load — it never crawls other pages, and auto-scan (optional, default OFF) runs once per page load, bounded to that page. The 7-day cache means the same job seen on another page later is free.
- **Fetch pace:** 3 concurrent + 400 ms between waves; 429/network errors leave that card unscanned (graceful, never blocks the site). Scan button exists only when keywords are configured — otherwise the extension makes zero extra requests.
- **Cache:** IndexedDB, key = job URL → `{title, description, salary, ts}`; 7-day TTL (same as the suite); 1,000-entry cap, oldest evicted.
- **Detail page (user already on it):** full description is on the page — instant banner, no fetch: red "⚠ No salary listed / Matches your hide rules: …", green "✓ Matches: …".
- **Repo layout:** own public GitHub repo `anki-boi/ojph-cleaner` (`C:/Users/PC/Desktop/ojph-cleaner`); all files at the **repo root** — Chrome requires the manifest at the root of an unpacked extension.

**Selector baseline (from 2026-08-26 site survey — Task 1 re-verifies live):** list cards `.jobpost-cat-box.latest-job-post` (job link `a[href*="/jobseekers/job/"]`, salary text, skill tags); detail `h1.job__title`, `p#job-description`, WAGE/SALARY field.

---

## Task 1: Verify selectors against the live site (via CDP, port 9222)

**Files:** none (investigation; record confirmed selectors in this plan)

Via CDP: open a search page (`/jobseekers/jobsearch/0?jobkeyword=virtual+assistant`) and one detail page in the user's Edge; dump outerHTML of one card + detail title/description/salary field. Pin exact selectors (card link, card salary element, detail description, detail salary field) into this plan. **Expected:** confirmed selectors; adjust any that drifted.

---

## Task 2: Skeleton + rules + node tests

**Files:**
- Create: `manifest.json`, `content.js`, `rules.js`, `content.css`, `icons/{16,48,128}.png`
- Create: `test-rules.js`
- Create: `.gitignore` (`.DS_Store`, `Thumbs.db` only — keep the repo clean)

**Implementation:**

`manifest.json`:
```json
{
  "manifest_version": 3,
  "name": "OJ.ph Cleaner",
  "version": "0.1.0",
  "description": "Hides no-salary jobs and keyword-matching jobs on OnlineJobs.ph (deep scan of full descriptions, current page only)",
  "host_permissions": ["https://www.onlinejobs.ph/*", "https://onlinejobs.ph/*"],
  "content_scripts": [{
    "matches": ["https://www.onlinejobs.ph/*", "https://onlinejobs.ph/*"],
    "js": ["rules.js", "content.js"],
    "css": "content.css",
    "run_at": "document_idle"
  }],
  "options_page": "options.html",
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
}
```
(Only host permission is OJ.ph. No other network access exists in this extension by construction.)

`rules.js` — pure, shared by content script and node tests:
```js
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.OJRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // "has salary" = contains at least one digit (TBD/N/A/Negotiable/DOE/empty all fail)
  function hasSalary(text) { return /\d/.test(text || ''); }
  // keyword = case-insensitive substring; returns the matched keywords
  function matchKeywords(text, keywords) {
    const t = (text || '').toLowerCase();
    return (keywords || []).filter(k => k && k.trim() && t.includes(k.trim().toLowerCase()));
  }
  return { hasSalary, matchKeywords };
});
```

`content.js` (skeleton): boot log + settings load from `chrome.storage.local` (shape `{negative:[], positive:[], noSalary:true, showHidden:false, autoScan:false}`) + `chrome.storage.onChanged` listener.

`test-rules.js`:
```js
const { hasSalary, matchKeywords } = require('./rules.js');
const assert = require('assert');
assert.strictEqual(hasSalary('$500/month'), true);
assert.strictEqual(hasSalary('PHP 30,000 - PHP 40,000'), true);
for (const v of ['TBD', 'N/A', 'Negotiable', 'DOE', '', null]) assert.strictEqual(hasSalary(v), false);
assert.deepStrictEqual(matchKeywords('Data entry, insurance not needed', ['insurance']), ['insurance']);
assert.deepStrictEqual(matchKeywords('INSURANCE agent', ['insurance']), ['insurance']);
assert.deepStrictEqual(matchKeywords('Data Entry VA', ['crypto', 'insurance']), []);
assert.deepStrictEqual(matchKeywords('  REMOTE  work ', ['remote']), ['remote']);
console.log('rules: all assertions passed');
```

**Verify:**
```bash
node test-rules.js        # Expected: "rules: all assertions passed"
# edge://extensions → Load unpacked → repo root ; CDP console shows "[OJ Cleaner] active"
```

---

## Task 3: Instant no-salary hiding + chip

**Files:** Modify: `content.js`, `content.css`

- On search/list pages: for each card, read the card-level salary element (Task 1 selector); if `settings.noSalary && !hasSalary(salaryText)` → `card.hidden = true; card.dataset.why = 'no-salary'`.
- Chip (bottom-right, fixed): `<b>N hidden</b> (x no salary, y keywords) [Show all]` — count updates on any DOM mutation (MutationObserver) and settings change.

**Verify (live via CDP):** search page with mixed results → TBD/Negotiable cards gone, chip count correct, "Show all" reveals.

---

## Task 4: Deep scan engine — current-page-only fetch, parse, cache

**Files:** Modify: `content.js` (or new `scan.js` loaded before content.js if it grows)

**Implementation:**
```js
// ── IndexedDB cache: key = job URL → {ts, title, description, salary} ──
const TTL_MS = 7 * 24 * 3600 * 1000, MAX_ENTRIES = 1000;
const cache = {
  db: null,
  open() { /* indexedDB.open('oj-cleaner', 1); create objectStore 'ctx' keyPath 'url' */ },
  async get(url) { /* entry with ts > now-TTL_MS else null */ },
  async put(url, ctx) { /* set ts=Date.now(); evict oldest beyond MAX_ENTRIES */ },
};

// ── Parse a detail page's HTML in-browser (DOMParser, no execution) ──
function parseDetail(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = doc.querySelector('h1.job__title')?.textContent?.trim();      // Task 1 selector
  const desc = doc.querySelector('p#job-description')?.textContent?.trim();   // ditto
  const salary = doc.querySelector('/* Task 1 WAGE/SALARY field selector */')?.textContent?.trim();
  if (!desc && !salary) return null;  // unparseable/closed — treat as unscanned
  return { title, description: desc, salary };
}

// ── Deep scan: CURRENT PAGE ONLY. Cache-first, then fetch in waves of 3. ──
let scanning = { running: false, stop: false };
async function deepScan(cards, onProgress) {
  if (scanning.running) return;
  scanning = { running: true, stop: false };
  // Hard scope: only the job cards currently rendered on this page
  // (after a keyword search or a pagination load). Never other pages.
  const targets = [...cards]
    .filter(c => !c.dataset.why)
    .map(c => ({ card: c, url: c.querySelector('a[href*="/jobseekers/job/"]')?.href }))
    .filter(t => t.url);

  const fresh = [];
  for (const t of targets) {
    const hit = await cache.get(t.url);
    if (hit) { t.ctx = { ...hit }; applyContext(t); }
    else fresh.push(t);
  }

  let done = targets.length - fresh.length;
  for (let i = 0; i < fresh.length; i += 3) {
    if (scanning.stop) break;
    onProgress(done, targets.length);
    await Promise.all(fresh.slice(i, i + 3).map(async t => {
      try {
        const resp = await fetch(t.url, { credentials: 'include' });
        if (!resp.ok) return;                       // 429 etc. → stays unscanned
        const ctx = parseDetail(await resp.text(), t.url);
        if (!ctx) return;
        await cache.put(t.url, ctx);
        t.ctx = ctx; applyContext(t);
      } catch { /* network error → stays unscanned */ }
    }));
    done += 3;
    if (!scanning.stop) await new Promise(r => setTimeout(r, 400));
  }
  onProgress(targets.length, targets.length);
  scanning = { running: false, stop: false };
  refreshRules();
  renderChip();
}
```

`applyContext(t)` stores the fetched description on the card (WeakMap) and `fullText(card)` = card text + cached description, so any rule pass sees rich context.

**Chip control bar (replaces plain chip):** `[⚡ Deep scan (28)]  [Scanning 12/28… ■]  5 hidden (3 no salary, 2 keywords)  [Show all]` — scan button appears only when `positive` or `negative` keywords are set (otherwise the extension makes zero extra requests); progress + stop (■) while running; auto-run when `settings.autoScan` on a search page load (bounded to that page).

**Verify (live via CDP):** click scan on a search page → progress advances → cards re-classify; re-run scan on same page → instant (cache); paginate to the next page → scan button re-offers only that page's jobs; kill network (CDP `Network.emulateNetworkConditions`) mid-scan → remaining cards stay unscanned, no crash.

---

## Task 5: Keyword pass — hide negative / highlight positive

**Files:** Modify: `content.js`, `content.css`

```js
function refreshRules() {
  for (const c of visibleCards()) {
    const text = fullText(c);
    const neg = settings.showHidden ? [] : rules.matchKeywords(text, settings.negative);
    const pos = rules.matchKeywords(text, settings.positive);
    const noSal = !settings.showHidden && settings.noSalary && !rules.hasSalary(cardSalary(c));
    c.classList.remove('ojc-neg', 'ojc-pos');
    if (noSal) { c.hidden = true; c.dataset.why = 'no-salary'; }
    else if (neg.length) { c.hidden = !settings.showHidden; c.dataset.why = 'keywords:' + neg.join(','); c.classList.add('ojc-neg'); }
    else if (pos.length) { c.hidden = false; c.dataset.why = ''; c.classList.add('ojc-pos');
                           c.querySelector('.ojc-pos-badge')?.remove();
                           const b = document.createElement('span');
                           b.className = 'ojc-pos-badge'; b.textContent = '✓ ' + pos.join(', ');
                           c.prepend(b); }
    else { c.hidden = false; c.dataset.why = ''; }
  }
  renderChip();
}
```
**Positive = highlight only** (user-confirmed): green outline + badge; nothing is hidden by the positive rule. `content.css`: `.ojc-pos { outline: 2px solid #7d9b6d; }` `.ojc-pos-badge { position:absolute; top:6px; right:10px; background:rgba(125,155,109,.18); color:#7d9b6d; ... }` `.ojc-neg { ...red marker when revealed via "Show all"... }`

**Verify (live):** set negative `crypto` + positive `remote` → scan a search page → crypto jobs hidden (chip breakdown), remote jobs get green outline + badge (and are never hidden), "Show all" reveals hidden with the red marker.

---

## Task 6: Detail-page banner (instant, no fetch)

**Files:** Modify: `content.js`

On a detail page (`h1.job__title` present): read description + salary directly from the page; if no-salary or negative matches → red top banner `⚠ No salary listed. / Matches your hide rules: <kws>`; if positive matches (no negatives) → green banner `✓ Matches: <kws>`.

**Verify (live via CDP):** navigate to a no-salary job, a keyword-matching job, a positive-matching job, a clean job → correct banner each; clean job → none.

---

## Task 7: Options page

**Files:** Create: `options.html`, `options.js`

Fields: negative keywords (textarea, one per line), positive keywords (textarea), "Hide jobs with no salary" (default ON), "Show hidden" master toggle, "Auto deep-scan on search pages (current page only)" (default OFF). Saves to `chrome.storage.local.settings`; content script's `onChanged` re-runs rules live.

**Verify:** edit options → search page reflects changes without reload.

---

## Task 8: Live end-to-end + README + push

1. `node test-rules.js` → pass.
2. Via CDP in the user's Edge, walk: search page (instant no-salary) → deep scan (progress → results) → re-scan (cache) → pagination (fresh page scan) → each detail-banner case → options change → stop mid-scan.
3. `Page.captureScreenshot` each step for the record.
4. Create `README.md` (public-facing): what it does, the three rules, install (Load unpacked), privacy note (only talks to OJ.ph, everything else local), the current-page-only scan guarantee, and a note that it's a companion to the private suite repo.
5. Commit everything; repo is already on GitHub (`anki-boi/ojph-cleaner`, public).

---

## Risks & Open Questions

- **30 detail fetches per unseen page** = heavier traffic than normal browsing from the user's IP. Mitigations: 3 concurrent + 400 ms stagger, 7-day cache (repeat searches cost ~0), scan only runs when keywords are configured, stop button, and any 429/error simply leaves that card unscanned (never blocks the site). Current-page-only scope caps the worst case at one page of results per action. If OJ.ph pushes back, slow the pace / lengthen the TTL — one config value.
- **Selector drift** on the site → Task 1 pins reality today; the extension degrades to invisible, never breaks the page.
- **Privacy (public-repo audience):** the extension contacts only `*.onlinejobs.ph` (its only declared host permission) and stores everything locally (IndexedDB + storage.local). No analytics, no telemetry, nothing leaves the machine — this will be stated plainly in the README.
- **Open questions:** none outstanding — positive=highlight and current-page-only scan are both user-confirmed. (The suite's `enrich-visibility` plan is parked in the suite repo as ON HOLD, not dropped.)

## Out of Scope

- Crawl beyond the current page (explicitly, per user), closed-job detection, suite↔extension settings sync (future: pull keywords from the local suite API once it persists them), mobile, any request to hosts other than OJ.ph.
