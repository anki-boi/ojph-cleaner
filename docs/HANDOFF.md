# HANDOFF — OJ.ph Cleaner (Chrome MV3 extension)

**Date:** 2026-09-18 · **Extension version:** 0.3.0 · **Branch:** `main`
**Repo:** `C:\Users\PC\Desktop\ojph-cleaner` → https://github.com/anki-boi/ojph-cleaner (public)
**Author identity in this repo's history:** `Jeyson <jeyson@local>`

Read this before touching code. It carries the current state, the environment invariants, and the
traps that cost time last session. Everything marked ✅ was verified by running it, not assumed.

**Where the remaining work is planned:** `spec.md` (audit + decision-ready wave plan, mirroring the
sibling `onlinejobs.ph-suite`). This file stays the **runbook**: environment, resume commands, traps.

---

## 0. Resume in three commands

```bash
cd /c/Users/PC/Desktop/ojph-cleaner
sh tools/gate.sh                      # syntax check + unit tests + package integrity + no-personal-paths
node tools/verify-live.mjs            # reloads the extension in Chrome, asserts it works on the live site
node tools/verify-live.mjs --url="https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=bookkeeper" \
     --neg=bookkeeper --pos=quickbooks # same, with keyword rules seeded
```

If `verify-live` cannot reach a browser it says so and points back to §2.

---

## 1. What this repo is

A content-script extension that cleans up OnlineJobs.ph job-search pages:

1. **Instant, card-level:** hide every listing whose salary field contains no digit
   (`TBD` / `N/A` / `Negotiable` / `DOE` / empty all fail).
2. **Keyword rules:** negative keywords → hide; positive keywords → **highlight only**
   (green outline + `✓ kw` badge), never hide. Case-insensitive substring match.
3. **Chip** (bottom-right): live counts plus a `Show all` / `Hide them` toggle that reveals what
   was hidden and re-hides it.
4. **Options:** keyword lists and toggles in an in-page panel opened by the chip's ⚙ button. Save
   applies to the listing **immediately, with no reload**; the same fields also live on the
   standalone `options.html` page, and either surface updates the other live through
   `chrome.storage.onChanged`.

Everything is local: the extension talks only to onlinejobs.ph, keeps state on the device, and
makes **zero extra network requests while no keywords are configured**.

Files: `manifest.json`, `content.js`, `content.css`, `rules.js` (pure rules, UMD, unit-tested),
`options.html`, `options.js`, `icons/`, `plans/`, `tools/`, `docs/`.

---

## 2. Environment — which browser can actually be driven

| Endpoint | Browser | Profile | ojph-cleaner installed? |
|---|---|---|---|
| `127.0.0.1:9222` | **Edge** 153 | `%LOCALAPPDATA%\agent-edge` (automation clone of the real Edge) | ❌ no |
| `127.0.0.1:9333` | **Chrome** 153 ✅ | `%LOCALAPPDATA%\agent-chrome-profile` | ✅ unpacked, ENABLED |
| — | Chrome 153, **default** profile | `%LOCALAPPDATA%\Google\Chrome\User Data` | ✅ installed, but **not drivable** |

Three consequences, all verified:

- **`:9222` is Edge, not Chrome.** `agent-edge` is the automation browser used by earlier
  sessions; the selector verification recorded in `plans/2026-08-26_ojph-extension.md` was done
  there. Same engine and DOM, but that profile does not have this extension — so it cannot be used
  to test extension behaviour.
- **The user's real Chrome can never expose CDP.** Since Chromium 136, `--remote-debugging-port` is
  silently ignored when the default user-data-dir is in use. The port flag can be present on the
  command line while nothing ever binds.
- **Chrome's debug port therefore needs the automation profile**, where the extension is already
  installed (and stays installed — it is a real profile directory):

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --user-data-dir="C:/Users/PC/AppData/Local/agent-chrome-profile" \
  --remote-debugging-port=9333 --no-first-run --no-default-browser-check about:blank &
```

---

## 3. ✅ Traps and verified dead ends (each cost real time)

1. **`--load-extension` is a no-op on Chrome 153.** Worse, it is not silent: Chrome still writes
   the extension into the profile's `Secure Preferences`, so `chrome://extensions` lists it as
   installed while it is **not active** and no content script runs. It must be loaded once by hand
   via *Load unpacked* into the automation profile; after that it persists across launches, and
   `tools/verify-live.mjs` proves it is live.
2. **The CDP `Extensions` domain is unavailable.** `Extensions.loadUnpacked`,
   `Extensions.getExtensions` etc. are listed in `/json/protocol` but every call returns
   `Method not available.` — headed Chrome, `--headless=new`, and with
   `--enable-unsafe-extension-debugging`. Do not plan around it.
3. **Reload an unpacked extension without UI clicks:** open a `chrome://extensions` tab and
   evaluate `chrome.developerPrivate.reload(EXT_ID, { failQuietly: true })`. That page's context has
   the internal `chrome.developerPrivate` API; `getExtensionsInfo({ includeDisabled: true })`
   returns `{ id, version, state, path, runtimeErrors }`.
4. **`runtimeErrors` are historical.** They survive reloads and can even name files that no longer
   exist, so they are useless as a pass/fail signal — assert behaviour instead. The list currently
   shows 3 stale entries, one of them from the deleted `background.js`.
5. **The extension ID is derived from the folder path:** `hagfdmaocdlncbfbbbgpmgodoeedpgbk` while
   the repo sits at `Desktop\ojph-cleaner`. Renaming or moving that folder changes the ID, and
   `tools/verify-live.mjs` looks the extension up **by name**, not by ID.
6. **Node WebSocket hygiene** (this bit the harness): create tabs over the **browser-level**
   WebSocket from `/json/version`, never "some page target" — the latter hangs as soon as a
   just-closed tab is still listed in `/json/list`. Give every socket open a timeout, and close tabs
   through the JSON HTTP endpoint. `tools/cdp.mjs` already does all of this.
7. **CDP `send()` must resolve with the result object, not the raw envelope** (and reject on
   `m.error`). `Runtime.evaluate` then reads `.result?.value`.
8. **Selectors still hold** ✅ (checked live 2026-09-18): list card = `.jobpost-cat-box.latest-job-post`,
   salary = `dd.col`, 30 cards per page.
9. **URL variants that work:** `/jobseekers/jobsearch?jobkeyword=…` (bare) and
   `/jobseekers/jobsearch/{offset}?jobkeyword=…`; category pages use
   `/jobseekers/search/c/{slug}/{offset}`. Both list variants tested. Search pages are readable
   **without login** in the automation profile.

---

## 4. State of the code

The extension was generated 2026-08-26 from the approved plan
(`plans/2026-08-26_ojph-extension.md`, Tasks 1–8) and **never worked**. `manifest.json` did not
declare `"permissions": ["storage"]`, so `chrome.storage` was `undefined` in every context:

```
content.js    Uncaught TypeError: Cannot read properties of undefined (reading 'local')      → no chip, no rules
options.js    (same failure on open)
background.js Uncaught TypeError: Cannot read properties of undefined (reading 'onChanged')
```

**Fixed by root cause, not symptom** ✅

The one-line fix — declaring `"permissions": ["storage"]` — landed on `main` as **`fb233e6`**
(`fix: declare storage permission so the content script can run`), diagnosed the same way and
verified live (30 cards → 3 hidden). The commit on top of it adds the guards that make this class
of bug non-recurring and the extension provable:

- **`test-manifest.js`** — every `chrome.*` namespace used in the tracked source must be granted by
  `manifest.json`, and every file the manifest references must exist. Dropping the permission now
  fails loudly at gate time: `chrome.storage is used in content.js, options.js, rules.js but manifest
  declares none of: storage`. It also rejects a re-added but unregistered `background.js`.
- **`tools/verify-live.mjs`** — the real end-to-end check (unit tests cannot see a missing permission
  or a drifted selector): reloads the extension, seeds settings through the options page, loads the
  live site, recomputes the rules from the DOM, asserts equality, then exercises the chip toggle.
- **`tools/gate.sh` + `.githooks/pre-push`** — a red gate blocks a push.
- **`background.js` removed** (and the `"background"` key dropped from the manifest). It was an
  **untracked local file, never in the repo** — only the local working copy's manifest referenced it,
  which is what produced the third runtime error above. It existed as a workaround for a
  misdiagnosis recorded in its own comment — "in some environments (notably this machine's Edge
  build) `chrome.storage` is NOT exposed in content-script worlds" — when the real cause was the
  missing declaration. Its whole message protocol was dead code: nothing sent `ojc-ping` /
  `ojc-get-settings` / `ojc-set-settings` and nothing listened for `ojc-settings-changed`, because
  `chrome.storage.onChanged` is already broadcast to every extension context. If a message proxy ever
  looks necessary again, suspect a missing declaration first.
- **Version note:** `fb233e6` bumped 0.1.0 → 0.1.1; this kept **0.2.0** (what is loaded in the
  automation Chrome, and the version that includes the options page). Don't "fix" it back down.
**Live proof** ✅ (automation Chrome, real site, 2026-09-18):

```
cards 30 (30 with a salary field) · chip "2 hidden (2 no salary, 0 keywords)" · hidden 2, rule says 2
toggle: Show all revealed 2, re-hide restored 2 · verify-live: PASS
--neg=bookkeeper --pos=quickbooks → 21 hidden (5 no-salary + 16 keyword), 1 highlighted · PASS
panel: opened from the chip, loaded the saved settings; Save 30→20→21 hidden with no reload · PASS
```

### 4b. ✅ In-page options panel (0.3.0)

The user does not want to right-click the extension and edit options on a separate tab, and does not
want to reload to see a settings change. Both were addressed in **0.3.0**:

- **The panel lives in the page.** `#ojc-panel` is a **sibling** of `#ojc-chip`, never a child:
  `renderChip()` does `el.innerHTML = ''` on every rule pass, so a child panel would be wiped while
  the user types. `tools/verify-live.mjs` asserts `inChip === false` for exactly this reason.
- **Save applies synchronously.** `savePanel()` assigns `settings`, calls `refreshRules()` (instant),
  then `persist()`. The storage write is durability only — the listing never waits for the round
  trip. The chip's `Show all` does the same.
- **Live-apply was already working** — the user believed a reload was needed, but the cause was the
  same dead extension as §4 (`chrome.storage` was `undefined`). Measured before touching the panel:
  settings saved from `options.html` while a search page sat open re-hid it 5 → 0 → 21 with no
  reload. `verify-live` now pins this inside a single tab session, so it cannot silently regress.
- **Trap found while writing the check:** the rule order is `noSalary → negative → positive`, so
  turning `noSalary` off re-files the no-salary cards through the keyword rule (4 extra hides in the
  `bookkeeper` run: 16 → 20). The harness computes that expectation separately
  (`negAnyExpected`); do not "fix" the code to match a naively-added count.
- **Also asserted:** every card carrying `[hidden]` is really `display: none` (the site CSS could
  win the cascade — it does not today), and the panel survives a Save (it is not rebuilt by
  `refreshRules()`).
- `⚙` opens the panel; `full options ↗` in it opens the standalone page, which is kept as a fallback
  and is what `verify-live` seeds test settings through.

---

## 5. What is left to build

| Task | Status |
|---|---|
| 1. Verify selectors against the live site | ✅ (Edge, 2026-08-26; re-checked 2026-09-18) |
| 2. Skeleton + rules + node tests | ✅ |
| 3. Instant no-salary hiding + chip | ✅ verified live |
| 5. Keyword pass (hide negative / highlight positive) | ✅ at card level — only becomes useful once Task 4 lands |
| 7. Options page | ✅ (works now that storage is granted) |
| 7b. In-page options panel + live re-apply on Save | ✅ 0.3.0, asserted live |
| **4. Deep scan engine** | ⬜ **next** |
| 6. Detail-page banner | ⬜ |
| 8. README + screenshots + push | ⬜ |

**Task 4 is the meaningful one.** Card-level text is too thin: in the live run above, negative
keywords only bit because the search term itself (`bookkeeper`) appears in every card, while
`crypto` and `insurance` matched **nothing** across 30 cards. The rules need the full description:

- fetch `/jobseekers/job/<slug>-<id>` for the **current page's cards only** (never paginate);
  3 concurrent + 400 ms between waves; 429 or a network error leaves that card unscanned, never
  blocks the site;
- description from `p#job-description`; salary = the `p` that is the **next sibling** of the
  `h3.fs-12` whose text matches `/WAGE\s*\/\s*SALARY/i`;
- IndexedDB cache keyed on job URL, 7-day TTL, 1 000-entry cap, oldest evicted;
- progress plus a stop button; the button exists **only when keywords are configured**;
- `content.js` already merges fetched text into `fullText()` through `ctxMap`, so the rules pass
  needs no change — it simply starts seeing more text.

**Suggested first move:** write the detail parser as a pure function in a new file with node tests
first (the same split as `rules.js` + `test-rules.js`), then wire the fetch layer, then add a
detail-page assertion to `tools/verify-live.mjs` so the parser has a live guard as well.

---

## 6. Conventions inherited from `onlinejobs.ph-suite`

The sibling repo (`C:\Users\PC\Desktop\onlinejobs.ph-suite`, private) is the reference for how this
work is done. Its spirit — **spec-driven, gated, provable, all data local** — is what this extension
should keep looking like.

| Suite artifact | Purpose there | State here |
|---|---|---|
| `spec.md` | decision-ready spec + wave plan; every task has acceptance criteria and a verify command | ✅ mirrored 2026-09-18 (`spec.md`) |
| `plans/YYYY-MM-DD_<slug>.md` | dated, approved workstreams | ✅ one plan |
| `tools/gate.sh` + `.githooks/pre-push` (`git config core.hooksPath .githooks`) | one command that must pass before a push | ✅ both, hooked in this clone |
| `.github/workflows/ci.yml` | matrix tests + a fresh-install smoke job | ✅ Node 20 `npm test` + package-integrity step (never run on GitHub yet — the first push triggers it) |
| `tests/` incl. `test_repo_hygiene.py` | unit tests + repo invariants | ✅ `test-rules.js`, `test-manifest.js` (node, zero deps); ⬜ `test-repo-hygiene.js` — **W1.6 in `spec.md`** |
| README with screenshots, config table, workflow narrative | public face; every config key documented | ⬜ Task 8 |
| `docs/{architecture,scraping,operations}.md` | durable design notes | ⬜ this file exists; add `docs/architecture.md` when Task 4 lands |
| "README truthfulness" check inside the gate | README cannot drift from the code | ⬜ `tools/check-readme.js` (W1.7 in `spec.md`) |
| `.editorconfig`, `.gitattributes`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/` | repo hygiene | ⬜ W1.1/W1.2/W1.4 of `spec.md` |
| `# ponytail:` comments marking known ceilings | flag deliberate shortcuts | ✅ keep doing it |
| one task = one commit, `W5.3 — …` / `fix(W6.1): …` | reviewable diffs | ✅ adopt |

Rules that follow: decide before building (plan → approval → implementation); every task carries a
**runnable** verify command; never let the gate stay red; keep the README true; keep personal machine
paths out of tracked source (the gate enforces this).

---

## 7. Do not regress

- `manifest.json` keeps `"permissions": ["storage"]` — without it the extension is dead, silently.
- No-salary rule = "the salary text contains a digit". `TBD` / `N/A` / `Negotiable` / `DOE` must fail.
- Positive keywords **highlight only**; they never hide.
- The deep scan stays **bounded to the current page** — no crawling, no pagination.
- With no keywords configured, the extension issues **zero extra requests**.
- The options panel stays a **sibling** of the chip — putting it back inside `#ojc-chip` means
  `renderChip()` destroys it mid-edit.
- Saving options (panel or page) **applies to the open listing immediately**; no reload is ever
  required now that `storage` is declared. `verify-live` asserts it in one tab session.
- Everything stays local: no server, no analytics, no third-party calls.
- The chip's counts stay truthful — asserted live by `tools/verify-live.mjs`.

---

## 8. Open decisions (need the user, not an agent)

1. **License.** The repo is public with no `LICENSE` file, so it is all-rights-reserved by default.
   The suite is deliberately in the same position. Decide before distributing further.
2. **Distribution.** Unpacked only (today), or publish to the Chrome Web Store? A store listing needs
   a privacy justification for the `host_permissions` on onlinejobs.ph.
3. **Deep-scan cache store.** The plan says IndexedDB (better for 1 000 × ~3 KB); `chrome.storage.local`
   is simpler but runs into quota pressure.
4. **`autoScan` default** is OFF in both plan and code. Keep it OFF until a scan is proven cheap,
   since it spends requests on every page load.

---

## 9. Leftovers

- The previous session's throwaway CDP scripts sit in `C:\Users\PC\tmp\` (`cdp.js`, `probe2.mjs`,
  `shots.js`, `patch.py`, …). Nothing there is needed any more — the repo carries its own harness in
  `tools/`.
- `npm test` installs nothing (zero dependencies; node ≥ 18 for `fetch` and `WebSocket`).
- `chrome://extensions` in the automation profile may still show the stale errors described in §3.4;
  clear them there if they get in the way.
