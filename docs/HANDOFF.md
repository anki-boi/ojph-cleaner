# HANDOFF — OJ.ph Cleaner (Chrome MV3 extension)

**Date:** 2026-09-18 · **Extension version:** 0.8.0 · **Branch:** `main`
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
   (green outline + `✓ kw` badge), never hide. Keywords match as case-insensitive **exact words or
   phrases** — `ai` never matches `email`.
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
| `127.0.0.1:9333` | **Chrome** 153 ✅ | `%LOCALAPPDATA%\agent-chrome-profile` | ✅ unpacked, ENABLED |
| `127.0.0.1:9222` | Edge 153 | `%LOCALAPPDATA%\agent-edge` | ❌ no |

**Since 2026-09-18 the automation profile is the user's daily browser** — the default profile is
retired. Two consequences, both helpful:

- The harness drives the browser the user is actually logged into, so pages are read as a real
  signed-in jobseeker. It opens its own tab and closes it, so open tabs are not disturbed.
- **No manual reload is needed any more.** `tools/verify-live.mjs` reloads the unpacked extension via
  `chrome.developerPrivate.reload` before every run, so the code under test is always the code in the
  repo. Outside a test run, `chrome://extensions` → Reload.

Port override: `OJC_CDP_PORT` (default `9333`).

**Historical note (still true, no longer limiting):** since Chromium 136, `--remote-debugging-port` is
silently ignored when the *default* user-data-dir is in use, which is why the drivable browser has
always been an automation profile and why the retired default profile never could be driven.

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --user-data-dir="C:/Users/PC/AppData/Local/agent-chrome-profile" \
  --remote-debugging-port=9333 --no-first-run --no-default-browser-check \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding about:blank &
```

**The last three flags matter** (added 2026-09-18): the rule pass is scheduled with
`requestAnimationFrame` and the loader's fetch resolves on the tab's own time, and Chrome pauses or
throttles both in a hidden/occluded tab. Because this profile is now the daily browser, a tab the
harness opens can sit behind whatever else is on screen — without these flags `verify-live` fails
with "the browser tab stayed hidden" instead of a real result. The harness activates its own tab and
waits for `visibilityState === 'visible'` before the two timing-sensitive checks; if the window is
occluded it fails loudly with that hint rather than reporting a false PASS.

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
10. **The ECB rate API deprecated v1.** `api.frankfurter.dev/v1/latest` still answers today but carries
    `deprecation: @1779103800` and a `link: …/v2/rates; rel="successor-version"` header — use **v2**
    (`?base=USD&quotes=PHP`), whose response shape is an array: `[{date, base, quote, rate}]`.
11. **The rate API is callable from the page without a host permission** because it sends
    `access-control-allow-origin: *`. That is why `host_permissions` is still `onlinejobs.ph` only. If
    that header ever disappears, the fix is to add `https://api.frankfurter.dev/*` to
    `host_permissions` (and to say so in `SECURITY.md`).
12. **`\busd\b` does not match `400USD/mo`** — no word boundary exists between a digit and a letter. A
    live card (`400USD/mo`) was shown as ₱400/mo, 62× wrong. Currency codes now match with a
    `(?<![a-z])` lookbehind, so a digit may precede them and "plus" still cannot read as USD.
13. **`3/Hours` broke the piece-rate guard:** `\bhr\b`/`\bour\b` fail on the plural, so an hourly rate
    was classified as a piece rate and lost its figure. The unit alternatives now allow a trailing `s`.
14. **A removed node has no parent.** `isOurs()` used to walk `parentNode` to decide whether a
    mutation was ours. A child removed from the chip is *already detached*, so the walk never reached
    `#ojc-chip` and every chip rebuild scheduled the next one — one external DOM mutation produced
    1 614 rebuilds in 4 s, forever. Judge the mutation's **target** (still attached); `verify-live`
    now asserts the count stays bounded.
11. **`core.autocrlf=true` is the Windows default, and git will not re-normalize a working tree that
    was checked out before `.gitattributes` existed.** The index held LF while the working copies of
    `gate.sh`, the hook and six other files were CRLF — and `git status` called the tree clean either
    way. `test-repo-hygiene.js` now fails on any CRLF in a tracked text file; the cure is
    `git checkout-index -f -a`, and the permanent fix is `.gitattributes` (`* text eol=lf`).
12. **A gate that cannot fail is worse than no gate.** `verify-live` compared `hidden` to `expected`,
    so an empty page (0 vs 0) printed `PASS` — selector drift would have gone unnoticed forever. It
    now requires ≥1 parsed card and cross-checks the site's own "Displaying N out of M" line.

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
- `Settings` opens the panel; `full options ↗` in it opens the standalone page, which is kept as a fallback
- **Redesigned in 0.8.0** into a real settings sheet: a fixed head (`Settings` + `✕`), a scrolling body
  grouped as `Filters` / `Salary goals` / `Loading`, and a fixed foot with `Save changes`. Two things the
  first version got wrong and are worth keeping in mind:
  - **The panel was anchored `bottom: 60px`, tuned for a one-line chip.** Once the chip became a panel that
    grows with its rows (220px live), the settings panel opened *on top of it* and both were unreadable.
    `panel.js` now measures the chip and sets `bottom`/`max-height` from it — do not go back to a constant.
  - **Labels were whole sentences**, so every row wrapped onto two lines and the form read as a wall of
    text. Each row is now a short title plus a `.ojc-hint` line, which is also what lets the body scroll
    while the head and foot stay put: a form whose Save button is below the fold cannot be completed.
- **`scrollbar-width: thin` and `::-webkit-scrollbar` are mutually exclusive in Chrome.** Setting the
  former made Chrome ignore the latter and fall back to the default scrollbar — with arrow buttons — in a
  dark panel. Pick one; this uses the webkit pseudo-elements.
  and is what `verify-live` seeds test settings through.

### 4c. ✅ W2 — what the audit found, fixed (0.4.0)

`spec.md` §2 lists these with their evidence; this is the state after the fixes. Every one was proven
able to fail before it was trusted.

| Defect | Fix | Proof |
|---|---|---|
| P1 self-sustaining rule loop | `onMutate()` judges `m.target` (a removed node is already detached and never matched) | one external mutation → **2** chip rebuilds in 2 s, was ~807 |
| P0 the live gate passed on an empty page | parse watchdog: ≥1 parsed card required, and the parsed count must equal the site's own "Displaying N out of M" | the zero-result URL now FAILS (it used to print PASS) |
| P1 `autoScan` persisted and read by nothing | disabled + labelled "not built yet" in both UIs; the panel keeps the stored value rather than the disabled input's | live: the checkbox is disabled in the panel and the options page |
| P3 dead code | `dataset.why` deleted (4 writes, 0 reads); `ctxMap` marked `ponytail:` as the W3 seam | `grep dataset.why` → nothing |
| P3 static checks could miss files | `test-manifest.js` walks the tree and fails on an orphan source file; `gate.sh` checks **every** tracked `*.js` and caps any source file at 300 lines | proven red against a syntax error in `tools/check-readme.js`, a 301-line file, an orphan `detail-parser.js` |
| Page coupling spread over the file | one `SELECTORS` block at the top of `content.js` | documented in `docs/scraping.md` |

```
verify-live: cards 30 (site claims 30) · chip "21 hidden (5 no salary, 16 keywords, 1 highlighted)"
  hidden 21 = rule 21 · toggle reveals 21, re-hides 21 · panel Save 30→20→21 with no reload
  observer: new no-salary card hidden on arrival · 3 chip rebuilds in 1500 ms (bounded)
  pagination: idle 0 requests · one scroll → +30 cards, 1 request · parity over all 60 cards
  final page: 290+7=297 — idle and scrolled both spend 0 requests      verify-live: PASS
```

Two new gate checks (run by `npm test`, so CI inherits them): `test-repo-hygiene.js` — license stance,
required files, hook wiring, no CRLF in any tracked text file — and `tools/check-readme.js` — every
setting in `content.js`'s `DEFAULTS` must appear as a row in the README's settings table, and every
path the README points at must exist.

### 4d. ✅ W6 — perpetual pagination (0.5.0)

The user asked whether infinite scrolling would be a nice touch. It is, and it is built (D8 in
`spec.md`), but the guards *are* the feature — "load more" and "crawl" are one careless decision
apart.

- **`pagination.js` is a separate content script.** `content.js` hit 344 lines, over the gate's
  300-line cap, and the honest split was "the extension that filters" vs "the code that fetches":
  `content.js` now makes **no request of its own** and talks to the loader through one small API
  (`self.OJC`). The URL/offset maths is exported (`self.OJCPager`) and pinned by `test-pager.js`.
- **A real scroll arms it.** The sentinel sits after the last card, and hidden cards make the list
  short enough that the sentinel can be on screen without the user doing anything — so visibility
  alone must never be the trigger. Verified live: 0 requests while idle, exactly 1 after a scroll.
- **It knows when it is done.** `pageOffset(url) + cards >= total` stops *before* spending a request.
  The "Displaying N out of M" counter is a page's **size**, not its position: on the final partial
  page (offset 290, 7 cards of 297) using it would send the loader back to page 1.
- **A page with no new job links ends it**, whatever the counter says. No retry loop.
- **Two bugs the live check found, both now fixed and both worth remembering:**
  1. The IntersectionObserver callback and the scroll event can arrive in *either* order, so arming
     "the other one's" flag lost the trigger until the sentinel left and re-entered view. Both paths
     now call one `maybeLoad()` that requires (visible AND scrolled).
  2. The sentinel was inserted once and left there — after appending 30 cards it was stranded
     *mid-list*, marking a bottom that was no longer the bottom. `placeSentinel()` moves it after the
     new last card on every load.

```
full list : idle 0 requests · one scroll → +30 cards, 1 request (/jobseekers/jobsearch/30?…)
            · rule parity over all 60 loaded cards
last page : 290+7=297 — idle and scrolled both spent 0 requests, nothing to load
```

### 4f. ✅ W8 — recency and the yellow reconsider state (0.7.0)

Asked for as two things: stale listings filtered out automatically ("the primary filter out of
everything"), and a yellow outline for a listing that matches a hide keyword but also looks good
("that way I can reconsider those listings"). Decisions D15-D24 in `spec.md`.

- **The posted instant is already on every card.** `p[data-temp]` → `data-temp="2026-09-19 01:33:33"`,
  `data-temp-2="2026-09-18 17:33:33"` — the same moment, the first in the site's own Asia/Manila clock
  and the second in UTC. Verified on 30/30 cards across a keyword search, a category page and two offset
  pages. **Read `data-temp-2`, and never parse the visible string as local time**: this machine is
  America/Denver, where that is 14 hours wrong. The fallback applies `MANILA_OFFSET_MINUTES` (480).
- **Recency is the first rule**, above everything, and a card whose date cannot be read is never stale.
- **The filter earns its keep on the pages behind the first one.** Measured on the user's own skill
  search: page 1 was 0.03-1.2 days old (0 hidden), while `/jobsearch/240?…` was **20.6-23.7 days old and
  hidden 30/30**. A first page alone would have made the feature look like it did nothing.
- **One number covers all three presets** (`maxAgeDays`, 0 = off, 7 = last week, 30 = last month).
- **`.ojc-recon` must be declared after `.ojc-goal` at the same specificity.** A reconsider card usually
  carries `.ojc-goal` too — that is *why* it is good — so the goal's green outline wins the cascade
  otherwise, and the class check still passes while nothing yellow is on screen. The live harness
  asserts the **computed** `outlineColor`, not the class.
- **The goal mark is the reason for the extra rule pass.** `refreshRules()` reads `.ojc-goal`, and
  `salary-cards.js` sets it *after* the pass, because the monthly figure waits on the live ECB rate. A
  listing that is good only because it pays well was therefore hidden, and nothing re-ran the pass —
  our own nodes keep `isOurs()` quiet. `annotate()` now reports whether a mark moved and asks for one
  more pass. **Measured with the seam disabled**, on a freshly inserted card paying ₱56,459/mo and
  matching a hide keyword: `goal true, recon false, hidden true`. That is also the only form of the
  check that can fail — on a live page a stray mutation re-runs the pass for the existing cards and
  masks it, so the harness test inserts a fresh card and asserts on that.
- **`✗ keyword` badges**, mirroring the green `✓` ones, on every negative match: the yellow cards and
  the hidden ones when *Show all* is on. Any new badge class **must also be added to `OUR_CLASSES` in
  `content.js`**, or its insertion schedules the next rule pass forever (§2.2).
- **Keywords are exact words or phrases** (D24), case-insensitive, and the user's rule is explicit:
  "if I put AI, it only ever means AI and nothing else". No substring matching, no `=` marker to
  remember — a leading `=` is still accepted and ignored so a saved `=ai` keeps working. This came from a
  measured defect, and the measurement is the argument for it: their positive keyword `AI` matched **30 of
  30** cards as a substring (`daily`, `email`, `main`, `paid`, `thumbnail`, `management`), which — with
  the reconsider rule rescuing every negative match — silently turned their entire negative list into a
  no-op: 17 yellow, 0 hidden. Making every keyword exact turned that into 10 yellow and 7 hidden, without
  touching a single keyword in the list.

### 4e. ✅ W7 — salary figures and the goals (0.6.0)

Asked for as "the salary estimator"; built as a **normalizer** that refuses to invent numbers (D9–D14
in `spec.md`). A monthly figure requires a stated period amount, or an hourly rate with stated hours, or
a Full Time badge. `$5/hour` on a Part Time card keeps its rate (`≈ ₱314/hr`).

- **Measured before building it:** of 60 live cards, 12 quoted an hourly rate and **7 of those were
  part-time**, while only 2 stated hours/week. Assuming 40 h/week inflated a part-timer's month ~85%
  (`$5/hour` → ₱50,184 vs ₱27,160 at 20 h/week).
- **Bare numbers are read by size** (D12), because size is the tell on this board: `1000` on a listing
  whose own text said "$1,000 per month" was shown as ₱1,000/mo; it is now ₱62,732/mo. 1-2 digits →
  hourly, 3-4 → monthly, 5+ → monthly pesos. A stated marker or unit always wins (`140-175/per hour`
  stays pesos; `Php 1000/day` is never a piece rate).
- **Two goals, one per card** (D13): Full Time is judged monthly, Part Time/other by the hour, and a
  listing quoting only a month is judged monthly. Neither is derived from the other — that would assume
  a work week.
- **The 40 h/week assumption is on the card** (D14): `assumes 40 h/week (full time) — verify with the
  employer`, under the figure. A month from a stated period or stated hours carries no warning.
- **Piece rates are left alone** — `$5 per entry` was being shown as ₱50,186/mo by the tiny-number
  heuristic — and a per-day rate never becomes a month (days/week is never stated).
- The figure sits **above** the posted salary on its own line as a large green figure with a left rule.
  A first pass drew a pale pill *inline* with the posted text and looked like a highlighter blob; the
  `docs/img/` screenshots are re-shot from the live site, so the look stays reviewable.

**A fourth bug, of the same family, found by a probe rather than by the harness (2026-09-18):** our own
injected text was part of what the rules read. `fullText()` — the text keyword matching runs on — returned
`card.textContent`, which includes the salary note and the disclaimer, so a keyword that appears only in
our text highlighted cards: with `positive: ["assumes"]` (in 2 disclaimers, on 0 listings) **2 cards** got a
badge. Two siblings came out of the same sweep: the hours basis read `card.textContent`, so a later pass
read the "40 h/week" *we* had written as if the listing had stated it (it survived only because "40 h/week"
does not match the stated-hours pattern — one word of rewording from the disclaimer deleting itself), and
the pager's card key used raw text, so a note that changes (rate → month, once live rates land) could make
it re-import a card it already had. All three now go through one exported helper, `self.OJC.ownText()`.
Guard: harness section 9 takes the first word of the rendered disclaimer and uses it as a keyword; the
check fails if any card highlights. Proven red by reintroducing the bug (2 cards), green after the fix.

The money code is split: `salary.js` is the pure parser (unit-tested), `salary-cards.js` the applier
(there is a 300-line-per-file cap in the gate, and it has now forced three splits: pagination, the panel,
and this one).

**Three bugs this stretch found, all in the product (the harness and one screenshot caught them):**

1. **A part-time card whose prose said "full time availability" got a 40-hour month** (`$6/hour` →
   ₱60,223/mo). Part Time is now checked *before* Full Time.
2. **`400USD/mo` parsed as pesos** — `\busd\b` cannot match after a digit, so a $400/mo job showed
   ₱400/mo (62× wrong). Currency codes now use a `(?<![a-z])` lookbehind. A sibling case: `$5+/- per hour`
   was read as a piece rate because of the `/-`, so a slash only marks one when a unit word follows.
3. **The panel's Save silently did nothing** — `fillPanel` read `#ojc-goal-hourly`, which the panel
   markup never defined, so opening the panel threw and Save aborted before applying anything. Only the
   live harness caught it; `test-manifest.js` now asserts that every `$p('#id')` in `content.js` exists
   in the panel template.

```
salary    : 23 monthly figure(s), 3 posted-rate figure(s), 1 with no figure
            · 4 live rate request(s) for USD/AUD/CAD/GBP · 11 above ₱40000/mo, 3 above ₱300/hr
```

---

### 4h. ✅ W12–W14 — the job memory, the deep scan, the two views (0.9.0)

Asked for as: *"paginates until end of 'Hide jobs older than', then a deeper scan that opens every job listing
two at a time and enhances the current filters… reclassify so they can be demoted or promoted… show the true
high yields first, with buttons to switch between High yields and Worth considering… remembers the states and
stats for each job listing link"*. Every measured number below is from that work.

- **The scan is button-triggered and bounded**: pages to the recency horizon, then opens listings 2 at a time,
  400 ms between pairs, with a Stop button and caps of 10 pages / 300 listings / 10 minutes. `autoScan` exists
  and is off. Measured on a live 298-card search: 9 result pages, 225 listings in ~2 minutes, all cached.
- **The tiers are about PAY.** The user's correction mid-build: a positive keyword is a highlight, not a
  promotion. High yield = a goal met with no hide keyword; Worth considering = a hide keyword that still looks
  good; Highlighted = a keyword you like below your goal. Off-platform asks and over-40-hour weeks are tags.
- **What the scan buys**: the description's keywords, the off-platform tags, the listing's own `HOURS PER WEEK`
  (which makes a part-time month honest — `⏱ part-time month at 15 h/week` — and the goal still judged on the
  rate, because lower pay for fewer hours is the point of part-time), closures it passes, and a `↑`/`↓` mark
  when a listing moves.
- **The views filter and then SCROLL**: without scrolling the first card of the tier into view, hiding most of a
  244-card list leaves the viewport looking at empty space (18 000 px away, measured).

**Five traps, each of which cost real time, and each of which is now impossible to ship again:**

| Trap | Symptom | Fix |
|---|---|---|
| A **chip rebuilt wholesale** on every rule pass | A real click's `mousedown` lands on `<button id="ojc-gear">`, the pass replaces it, the `mouseup` lands on its replacement, and the browser dispatches the click on their **common ancestor** — so the handler never runs. Measured on an idle page: pointerdown/mousedown/mouseup all reported `ojc-gear`, no click event at all. The user reported it as "clicking the settings button is broken" | The chip's interactive nodes (head, 3 action buttons, 3 view buttons) are created **once** and only updated; the rows are still rebuilt. `verify-live` now clicks the gear and Save with **real hit-tested mouse events**, and pauses 250 ms in the middle so a pass can land between the halves |
| **`chrome.storage.local` reorders object keys** | `JSON.stringify(before) === JSON.stringify(after)` is false for an unchanged record — so the write-echo was adopted as another tab's write, the next pass compared the adopted record against the one it would write, found them different, and wrote again: **2 184 record writes and ~75 rule passes per second, forever, on an idle page** | `records.canon()`: a key-order-insensitive JSON used by both `sameFacts` (did anything change?) and the echo check (is this mine?). `test-records.js` pins it |
| **A guard that DROPS instead of coalescing** | `annotate()` is async (it awaits the live ECB rates) and every pass that arrived while it ran was discarded — including the one carrying the scan's `HOURS PER WEEK`. Ten cards kept a rate-only figure while both the record and the cache held their real hours | `if (running) { pending = true; return; }` and a `do { … } while (pending)` loop |
| **Hydration happened once, at boot** | `load()` read the cache for the cards in the DOM at that instant. The site's list can render after `document_idle`, and a page whose cards were not there yet hydrated **nothing** — so the whole scan result silently did not apply to any card on that load | `hydrateNew()`, called from the rule pass: one Set lookup per card, an IDB read only when a card's facts are genuinely missing |
| **A `\d` inside page-side code in a `tab.evaluate` template literal** | The backslash is eaten (an unknown escape drops it), so `\d` arrives as `d` and the page throws `SyntaxError: Unterminated group` — the backtick trap's sibling, fourth occurrence in this repo | No escapes in page-side code: use `[0-9]`, `[ \\t]`, `[/]`. `cdp.mjs` now appends the **tail of the failing expression** to the exception, because that is the only thing that makes it findable |

**And one data-loss trap the harness itself had:** the snapshot that protects the user's settings is written to
one rolling file, so a run the OS **SIGKILLs** (no handler can run) leaves its own seed in place, the next run
snapshots *that* as the user's state, and the real settings are gone with nothing to restore from. That is how
this session lost the profile's original 1 negative + 1 positive keyword list. `saveDatedSnapshot()` now keeps
the five most recent snapshots, and `verify-live --restore` can put any of them back.

### 4g. ✅ W4 / W9 / W10 / W11 — the job's own page, the closed memory, the rescue (0.8.0)

Four things landed together because the detail page is what made the others worth building. Full decision
list in `spec.md` D25–D30; the measured evidence:

- **The detail page has a structured `HOURS PER WEEK`** (`dl.row.no-gutters dd > h3` label, `> p` value), and
  14 of 18 sampled listings state a real number (40, 40, 35, 25, 20, 15, 10, 9, 5…). That is what makes a
  monthly figure honest instead of a 40 h/week guess (D28).
- **The description is plain text with `<br>`s** — 0 of 5 sampled descriptions carried an `<a>`. Application
  links appear as prose (`"fill out the form carefully: forms.gle/VL1hbhWz8FpRDNrFA"`), so a detector that
  reads only `href`s finds almost nothing.
- **OJ.ph redacts application links as `----------`, and it does so even when you are signed in** (3 of 18
  listings). Logged out it is worse: **every** sampled listing hid its link, and the closure notice
  `This job has been closed` is login-gated too — a plain HTTP fetch of a listing known to be closed returned
  0 hits. Anything that must read those two facts needs the signed-in browser.
- **Off-platform pressure is common: 9 of 18 listings** (7 by an application-ask phrase, 2 with a bare URL,
  2 with an email). But **3 of those 7 phrase hits were Telegram as job content** ("Help monitor Telegram
  accounts"), which is why a tool only counts inside a sentence that also asks you to apply (D26).
- **Dead listings do not accumulate on the board** — 1 of 30 on the deepest page (20 days old) — but they
  pile up in Saved Jobs: **4 of 16**. The board is shallow (`/jobsearch/240` is the last page for that
  filter, `/jobsearch/1000` is empty) and drops closed listings within about three weeks.
- **The saved-jobs page is a different frontend**: a React/tailwind `<tr>` table, no `.jobpost-cat-box`
  anywhere, columns `Title / Description / Notes / Delete` and **no status column** — so it cannot reveal a
  closure by itself (D29).

Traps this work added to section 3's list, each of which cost real time:

| Trap | Symptom | Fix |
|---|---|---|
| `Page.addScriptToEvaluateOnNewDocument` without `Page.enable` | The script is registered and never runs, which looks exactly like a listing that is not closed | Call `Page.enable` first |
| A no-op `chrome.storage.local.set` fires **no** `onChanged` | A harness trigger that writes the settings back unchanged asserts nothing, and reports an empty result as if the feature were broken | Write a value that actually changes |
| An uncaught exception bypasses `fail()` | The harness claimed "every exit path restores", but a crash skipped the restore and left the seed in the profile. Every later run then snapshotted the seeded state and dutifully restored *it*, so the damage silently became the baseline | `uncaughtException` / `unhandledRejection` handlers that restore, plus a snapshot log line that prints the keyword count it captured |
| A backtick inside page-side code in a `tab.evaluate` template literal | The literal ends early and the harness dies with a confusing syntax error — **third** occurrence in this repo | No backticks inside those literals, ever |
| React renders its table in batches | Rows that arrive while a one-shot rAF guard is pending are never marked (1 of 3 marked) | A trailing debounce, reset on every mutation |

## 5. What is left to build

| Task | Status |
|---|---|
| 1. Verify selectors against the live site | ✅ (Edge, 2026-08-26; re-checked 2026-09-18) |
| 2. Skeleton + rules + node tests | ✅ |
| 3. Instant no-salary hiding + chip | ✅ verified live |
| 5. Keyword pass (hide negative / highlight positive) | ✅ at card level — only becomes useful once Task 4 lands |
| 7. Options page | ✅ (works now that storage is granted) |
| 7b. In-page options panel + live re-apply on Save | ✅ 0.3.0, asserted live |
| 8. README + screenshots + docs + hygiene + gates (`spec.md` W1) | ✅ 0.4.0 — README, `SECURITY.md`, `.editorconfig`, `.gitattributes`, issue templates, `docs/architecture.md`, `docs/scraping.md`, `test-repo-hygiene.js`, `tools/check-readme.js` |
| `spec.md` audit + decision-ready wave plan | ✅ `spec.md` |
| `spec.md` W2 — the defects the audit found | ✅ 0.4.0, see §4c |
| `spec.md` W6 — perpetual pagination | ✅ 0.5.0, see §4d |
| `spec.md` W7 — salary figures + both goals | ✅ 0.6.0, see §4e |
| `spec.md` W8 — recency + the yellow reconsider state | ✅ 0.7.0, see §4f |
| `spec.md` W4 — the job's own page (highlights, figures, off-platform) | ✅ 0.8.0, see §4g |
| `spec.md` W9 — closed-listing memory (6-month cap) | ✅ 0.8.0, see §4g |
| `spec.md` W10 — the opt-in no-salary rescue | ✅ 0.8.0, see §4g |
| **`spec.md` W12–W14 — the job memory, the deep scan, the tiers and the views** | ✅ 0.9.0, see §4h |
| 6. Detail-page banner (`spec.md` W4) | ⬜ |
| Distribution (`spec.md` W5) | ⬜ unpacked for now (D2) |

The plan of record is now **`spec.md`** (waves, task IDs, acceptance criteria). This table is kept as
the original Task 1–8 numbering so older notes still line up.

**The deep scan is built** (§4h, W13): it fetches the pages inside your recency window (not just the current
page — the user asked for the horizon, and the button press is the gesture that pays for it), then opens each
listing 2 at a time with a Stop button and hard caps. It stayed close to this brief in every other respect:
description from `p#job-description`, the WAGE/SALARY `p` beside its `h3`, an IndexedDB cache with a 7-day TTL
and a 1 000-entry cap, and a progress line. `ctxMap` was the seam it was meant to feed, and it was replaced by
`records-cards.js` + `tiers.js` — the rules pass now sees the description's facts through the memory, which is
also what makes them survive a page reload.

**What is genuinely left:** distribution (W5, needs the D2 decision re-made now that the extension talks to
more of the site than a keyword search), and whatever the next real browsing session turns up.

---

## 6. Conventions inherited from `onlinejobs.ph-suite`

The sibling repo (`C:\Users\PC\Desktop\onlinejobs.ph-suite`, private) is the reference for how this
work is done. Its spirit — **spec-driven, gated, provable, all data local** — is what this extension
should keep looking like.

| Suite artifact | Purpose there | State here |
|---|---|---|
| `spec.md` | decision-ready spec + wave plan; every task has acceptance criteria and a verify command | ✅ mirrored 2026-09-18 (`spec.md`) |
| `plans/YYYY-MM-DD_<slug>.md` | dated, approved workstreams | ✅ two plans (`plans/`) |
| `tools/gate.sh` + `.githooks/pre-push` (`git config core.hooksPath .githooks`) | one command that must pass before a push | ✅ both, hooked in this clone |
| `.github/workflows/ci.yml` | matrix tests + a fresh-install smoke job | ✅ Node 20 `npm test` (now incl. hygiene + README truth) + package-integrity step |
| `tests/` incl. `test_repo_hygiene.py` | unit tests + repo invariants | ✅ `test-rules.js`, `test-manifest.js`, `test-repo-hygiene.js` (node, zero deps), `tools/check-readme.js` |
| README with screenshots, config table, workflow narrative | public face; every config key documented | ✅ `README.md` — 3 live screenshots, settings table, install, privacy |
| `docs/{architecture,scraping,operations}.md` | durable design notes | ✅ `docs/architecture.md` + `docs/scraping.md`; `docs/HANDOFF.md` **is** the operations runbook (a third doc would duplicate it) |
| "README truthfulness" check inside the gate | README cannot drift from the code | ✅ `tools/check-readme.js`, run by `npm test` |
| `.editorconfig`, `.gitattributes`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/` | repo hygiene | ✅ all four (`.gitattributes` is `* text eol=lf` — see §3.11) |
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
- With no keywords configured, the extension issues **zero extra requests** — unless `autoLoad` is on
  (the default) and you scroll to the bottom, which fetches the next *result* page: one page per real
  scroll, 600 ms apart, one in flight, stopping at the end or when a page adds nothing new. It never
  fetches a job detail page except in the deep scan.
- **Money is never approximate.** A monthly figure needs a stated period amount, or an hourly rate with
  stated hours (a Full Time badge counts; "Part Time" does not, because it states no number). No fallback
  exists for unstated hours. A piece rate gets no figure (D11). A bare number is read by its size only
  when the listing states no currency or unit (D12). A conversion uses a live rate or none at all.
  **A month that rests on the 40 h/week assumption is labelled on the card** (D14). Where a figure cannot
  be honest, the card shows the posted rate or nothing and the tooltip says why.
- **One goal judges each card** (D13): Full Time monthly, Part Time/other hourly. Never derive one from
  the other — that needs an assumed work week.
- **Nothing runs on an idle page.** No timers, no polling, no prefetch. If the user does nothing, so
  does the extension — `verify-live` asserts 0 loader requests before any scroll.
- **The rule pass must never schedule itself.** Judge the mutation's *target* (`isOurs`), not just the
  added/removed nodes; a detached node has no ancestors. `verify-live` asserts a bounded number of
  chip rebuilds after one external mutation.
- The options panel stays a **sibling** of the chip — putting it back inside `#ojc-chip` means
  `renderChip()` destroys it mid-edit.
- Saving options (panel or page) **applies to the open listing immediately**; no reload is ever
  required now that `storage` is declared. `verify-live` asserts it in one tab session.
- Everything stays local: no server, no analytics, no third-party calls.
- The chip's counts stay truthful — asserted live by `tools/verify-live.mjs`.
- **The chip's interactive nodes are persistent.** `render()` updates the head, the three action buttons and the
  three view buttons; only the non-clickable rows are rebuilt. Rebuilding a button between a real click's
  mousedown and mouseup means the browser never fires the click at all (measured: pointerdown/mousedown/mouseup
  on `ojc-gear`, no click event). `verify-live` clicks the gear and Save with real mouse events, with a pause in
  the middle.
- **Every record comparison goes through `records.canon()`.** `chrome.storage.local` reorders keys, and a plain
  `JSON.stringify` comparison of a record against itself after a round trip is false — which produced ~75 rule
  passes per second, forever, on an idle page. If you add a field to a record, it is compared in `sameFacts`.
- **`annotate()` coalesces, never drops.** It is async; a dropped re-run is a note left showing a figure from
  before the scan's hours arrived.
- **The scan is automatic by default, and bounded.** `autoScan` starts a run when a search page loads (D42); the `Scan` button starts the same run on demand, and nothing else may start it. Its
  budget is 2 listings at a time with ≥400 ms between pairs (asserted as a rate in `verify-live`: no three
  listing fetches inside 350 ms).
- **PAY decides High yield.** A keyword you like is a highlight; a positive match on a listing below your goal
  is its own `pos` verdict, not a high-yield one. Off-platform asks and over-40-hour weeks are tags and never
  demote.

---

## 8. Open decisions (need the user, not an agent)

1. **License.** **Decided 2026-09-18:** no `LICENSE` file, README states *all rights reserved* (the
   suite's stance, adapted because this repo is public). Asserted by `test-repo-hygiene.js`.
2. **Distribution.** **Decided 2026-09-18:** unpacked only for now; revisit after W3 lands, since a
   store listing needs a privacy justification for the `onlinejobs.ph` host permission and a stable
   version story.
3. **Deep-scan cache store.** **Decided 2026-09-18:** IndexedDB, 1 000 entries × ~3 KB, 7-day TTL,
   oldest evicted. `chrome.storage.local` would share the 10 MB quota with settings and rewrite the
   whole blob per write.
4. **`autoScan` default** is OFF in both plan and code, and the control is **disabled and labelled**
   until the deep scan ships. Keep it OFF until a scan is proven cheap, since it spends requests on
   every page load.

---

## 9. Leftovers

- The previous session's throwaway CDP scripts sit in `C:\Users\PC\tmp\` (`cdp.js`, `probe2.mjs`,
  `shots.js`, `patch.py`, …). Nothing there is needed any more — the repo carries its own harness in
  `tools/`.
- `npm test` installs nothing (zero dependencies; node ≥ 18 for `fetch` and `WebSocket`).
- `chrome://extensions` in the automation profile may still show the stale errors described in §3.4;
  clear them there if they get in the way.
