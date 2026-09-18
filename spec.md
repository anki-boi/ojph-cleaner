# spec.md — OJ.ph Cleaner (`ojph-cleaner`)

**Type:** audit + improvement spec + delegated build plan
**Date:** 2026-09-18
**Baseline commit:** `d759ffe` (0.3.0) · **Earlier plan:** `plans/2026-08-26_ojph-extension.md`
**State:** 560 tracked source lines (js/css/html/json, 21 tracked files) · 2 node test files, zero
dependencies · 1 live CDP harness · Chrome 153, unpacked, enabled in the automation profile

---

## 0. How to use this document

This is a **decision-ready spec and an execution plan**, not code. It mirrors the structure of the
sibling repo's `spec.md` (`C:\Users\PC\Desktop\onlinejobs.ph-suite`) — same sections, same
discipline, sized to a ~250-line extension.

- **The user approves §3 (decision points) and §6 (wave plan).** Everything else is already decided.
- Each task has an ID, files, acceptance criteria, and a **runnable** verify command. One task = one
  commit = one reviewable diff on `main`.
- Tasks marked **‖** are parallel-safe (no shared files). Tasks marked **→** are serialized on the
  task before them.
- Every wave ends with a **gate**: `sh tools/gate.sh` green, `node tools/verify-live.mjs` PASS,
  docs updated. No wave starts before the previous gate passes.
- Rule: nothing may be built whose acceptance criterion cannot be run. "It works when I click it" is
  not a criterion.

---

## 1. Current state

### 1.1 What exists

| Layer | Files | Notes |
|---|---|---|
| Manifest | `manifest.json` | MV3, `permissions: ["storage"]` (load-bearing — see §1.2), host permissions on `onlinejobs.ph` only |
| Content script | `content.js` (234 lines) | chip, in-page options panel, rule pass, mutation observer, storage sync |
| Rules | `rules.js` (28 lines) | pure `hasSalary` / `matchKeywords`, UMD, no DOM |
| Styles | `content.css` (95 lines) | chip + panel + highlight styles, all `#ojc-*` scoped |
| Options page | `options.html` / `options.js` | standalone fallback; the panel is the primary UI |
| Tests | `test-rules.js`, `test-manifest.js` | 27 assertions, zero dependencies, `npm test` |
| Live harness | `tools/cdp.mjs`, `tools/verify-live.mjs` | drives real Chrome over CDP against the live site |
| Gate | `tools/gate.sh`, `.githooks/pre-push`, `.github/workflows/ci.yml` | one command, hooked, CI on Node 20 |
| Docs | `docs/HANDOFF.md` | runbook: environment, traps, resume commands |

### 1.2 What is genuinely good (do not regress)

- **The extension is dead without `"permissions": ["storage"]`.** It failed silently for three
  weeks; `fb233e6` fixed it and `test-manifest.js` now fails the gate if any `chrome.*` namespace
  used in source is not granted. Keep that test.
- **Positive keywords highlight, they never hide.** A wrong "positive" must not cost the user a job
  listing. This asymmetry is the whole design.
- **Everything is local.** No server, no analytics, no third-party calls; zero extra requests while
  no keywords are configured.
- **Rules are pure and unit-tested separately from the DOM** (`rules.js` + `test-rules.js`) — the
  same split the suite uses for its parsers, and the reason the live harness can replicate the rule
  from the DOM and compare.
- **`# ponytail:` comments mark known ceilings** instead of hiding them.
- **The live harness is the gate that matters.** Unit tests cannot see a missing permission or a
  drifted selector; `verify-live.mjs` reloads the extension, seeds settings, loads the real site,
  recomputes the expected result from the DOM, and compares.

### 1.3 What is weak

| Area | Verdict |
|---|---|
| Live gate sensitivity | **Broken** — a zero-card page reports PASS (§2.1) |
| Mutation handling | **Broken** — one external DOM change starts a 400/s rule loop that never stops (§2.2) |
| Control honesty | One persisted setting is read by nothing (§2.3) |
| Public face | **No README at all** — the package cannot be understood or installed from GitHub (§2.4) |
| Dead code | `dataset.why` write-only; `ctxMap` plumbed but never fed (§2.5) |
| Static analysis coverage | `test-manifest.js` and `gate.sh` only look at the repo root / 3 hardcoded files (§2.6) |
| Windows clone hygiene | No `.gitattributes`: `gate.sh` and the pre-push hook check out as CRLF (§2.7) |
| Local-only E2E | `verify-live.mjs` needs a browser + the live site, so CI cannot run it — it is the *only* check that can see selector drift |
| Deep scan | Not built (W3). Card text alone cannot match `crypto`/`insurance` — measured: 0 matches across 30 cards while the search term matched 16 |

---

## 2. Verified defects

Every entry below was reproduced on the live site or by reading the tracked source, not inferred.
Each gets a permanent regression check in the wave that fixes it.

### 2.1 P0 — the live gate passes when it should be screaming

`tools/verify-live.mjs` compares `hidden` against `expected`, and on a page with no cards **both are
zero**, so every assertion holds and the run ends in `PASS`:

```
$ node tools/verify-live.mjs --url="...jobsearch?jobkeyword=zzzqqqxxyywwvvuu"
  cards   : 0 (0 with a salary field)
  hidden  : 0   (expected by rule: 0)
verify-live: PASS
```

If the site renames `.jobpost-cat-box.latest-job-post`, the single check that exists to catch
selector drift reports success. The suite's answer to this exact class is its parse watchdog
(`check_fixtures.py`: "0 boxes parsed while the site claims N results" → loud failure); the extension
inherits it in W2.1.

**Fix:** require `cards >= 1`, and if the page reports a result count larger than the cards parsed,
fail loudly naming the selector. **Proof it was broken:** the command above must FAIL after the fix.

### 2.2 P1 — one external mutation starts a rule loop that never stops

`renderChip()` sets `chip.innerHTML = ''` on every pass. Those removed children are **detached**, so
`isOurs()` walks `parentNode` to `null`, never reaches `#ojc-chip`, and returns `false` — which
schedules the next pass. The loop is self-sustaining for the life of the page.

Measured live (automation Chrome, real search page, after 5 s of quiet, then one `div` appended to
`<body>` by the page world):

```
{"rendersAfterOneExternalMutation":1614,"windowMs":4000}      # ~400 rule passes/second, forever
```

**Fix:** judge the mutation's **target** (which survives detachment — it is the chip itself) before
inspecting added/removed nodes. **Proof:** after the fix, the same nudge must produce a bounded
number of passes (~1), asserted by the live harness.

### 2.3 P1 — a setting that lies

`autoScan` is defined in `DEFAULTS`, written by both UIs, persisted in `chrome.storage.local`, and
read by **nothing** (`ctxMap` is fed by no code path; the deep scan is W3). A user who ticks it gets
no behaviour and no explanation. **Decision D4:** keep it visible but **disabled and labelled**
"needs the deep scan (not built yet)" until W3 lands.

### 2.4 P2 — no README, so the repo is unreadable from the outside

The extension is public on GitHub with no `README.md`: no install steps, no screenshots, no
documented settings, no privacy statement, no license stance. `docs/HANDOFF.md` is a runbook for a
returning maintainer, not an entry point. Fixed in W1.3, and kept true by the gate in W2.3.

### 2.5 P3 — dead code in a public repo

- `c.dataset.why` is written in 4 places and read in 0. Delete it, or read it (the chip could explain
  *why* a card is hidden).
- `ctxMap` has no `.set()`: `fullText()` is exactly `c.textContent`. It is a deliberate seam for W3;
  mark it `# ponytail: dead until the deep scan (W3) feeds it` rather than deleting it, so the seam
  is not rebuilt from scratch.

### 2.6 P3 — static checks that can miss files

- `test-manifest.js` scans `readdirSync(root)` — a source file in a subdirectory is invisible to the
  permission check.
- `tools/gate.sh` syntax-checks the hardcoded list `rules.js content.js options.js` — a new file
  (W3 adds one) is silently unchecked, and a stale name is silently skipped.

**Fix:** walk the tree; check every tracked `*.js`.

### 2.7 P3 — line endings are unprotected

There is no `.gitattributes`, so a fresh Windows clone checks out `tools/gate.sh` and
`.githooks/pre-push` as CRLF. `sh tools/gate.sh` is then at the mercy of the shell, and the hook is
the only thing standing between a red gate and `main`. The suite treats this as load-bearing
(`*.sh text eol=lf`) — fixed in W1.1.

---

## 3. Decision points (approve or override)

| # | Question | Answer | Status |
|---|---|---|---|
| **D1** | License | No `LICENSE` file; README states **all rights reserved** explicitly, noting the repo is public to read but grants no reuse. Asserted by the hygiene test. | ✅ decided 2026-09-18 |
| **D2** | Distribution | Unpacked only until W3+W1 land; a Web Store listing needs a privacy justification for `host_permissions` on `onlinejobs.ph` and a stable version story | ⬜ **needs you** |
| **D3** | Deep-scan cache store | **IndexedDB** as planned (1 000 entries × ~3 KB, 7-day TTL, oldest evicted). `chrome.storage.local` is simpler but shares its quota with settings and rewrites the whole blob | ⬜ **needs you** |
| **D4** | `autoScan` until W3 | Visible, **disabled**, labelled "needs the deep scan (not built yet)" | ✅ decided 2026-09-18 |
| **D5** | Deep-scan politeness budget | 3 concurrent, 400 ms between waves, **current page's cards only** — never paginate. A 429 or a network error leaves that card unscanned and **stops the fleet**, never retries harder. | ⬜ **needs you** |
| **D6** | Positive keywords | Highlight only, never hide | ✅ do not regress (§1.2) |
| **D7** | `# ponytail:` ceilings | Keep marking deliberate shortcuts with a named ceiling | ✅ do not regress |

---

## 4. Target architecture

### 4.1 Layout

```
manifest.json          MV3 entry; storage permission + onlinejobs.ph host permissions only
rules.js               pure rules (no DOM): hasSalary, matchKeywords        ← unit-tested
content.js             DOM + state: chip, panel, rule pass, observer, storage sync
content.css            #ojc-* scoped styles only
options.html/.js       standalone fallback page (the panel is primary)
detail-parser.js       (W3) pure detail-page parser                        ← unit-tested
test-*.js              node tests, zero dependencies
tools/gate.sh          one command: syntax + tests + hygiene + README truth + path scan
tools/verify-live.mjs  the real end-to-end check over CDP against the live site
docs/                  architecture, scraping, HANDOFF (runbook)
spec.md                this file
```

### 4.2 Layering rules

- **Pure logic never touches the DOM**, so it can be unit-tested offline: `rules.js` today,
  `detail-parser.js` in W3. Same split as the suite's `scraper/parsers.py`.
- **The content script never trusts the page.** Text is read and matched; nothing from the page is
  interpreted as markup, and no page-supplied string is written with `innerHTML`. The panel's markup
  is a fixed template.
- **All injected UI lives under `#ojc-` ids**, and `isOurs()` must recognise every one of them. The
  panel is a **sibling** of the chip, never a child: `renderChip()` wipes the chip's children, so a
  child panel would be destroyed mid-edit. Asserted live.
- **Rule order is `noSalary → negative → positive`** and it is observable: with `noSalary` off, the
  no-salary cards fall through to the keyword rule (measured: 16 keyword hides become 20). Any test
  that predicts a count must replicate the order, not add up the buckets.
- **One file, one job.** No file over 300 lines (gate-enforced, W2.4) — the analogue of the suite's
  250-line route-module cap.

### 4.3 DOM contract (the whole external surface)

All page coupling lives in one `SELECTORS` block at the top of `content.js` (W2.2), so site drift is
a one-line fix and the harness can name the selector that broke:

| What | Selector | Used by |
|---|---|---|
| List card | `.jobpost-cat-box.latest-job-post` | rule pass, harness |
| Card salary | `dd.col` (text must contain a digit) | rule pass, harness |
| Detail description | `p#job-description` | W3 |
| Detail salary | `p` next sibling of the `h3.fs-12` matching `/WAGE\s*\/\s*SALARY/i` | W3 |
| List pages | `/jobseekers/jobsearch` (bare or `/offset/`), `/jobseekers/search/c/{slug}/{offset}` | content script |

---

## 5. Workstreams

### W1 — Foundation, public face, OSS hygiene

| ID | Task | Files |
|---|---|---|
| W1.1 | `.gitattributes` (`*.sh` + `.githooks/*` = LF), `.editorconfig` | new |
| W1.2 | `SECURITY.md`: local-only, loopback-free (no server), single host permission, report via issue | new |
| W1.3 | `README.md`: what it does, demo screenshots, install, **every settings key documented**, workflow, files, privacy, license stance | new |
| W1.4 | Issue templates (bug / feature) | new |
| W1.5 | `docs/architecture.md`, `docs/scraping.md` (politeness budget + selectors + what cannot be tested offline) | new |
| W1.6 | `test-repo-hygiene.js`: no `LICENSE`, README says "All rights reserved", SECURITY/`.editorconfig`/templates present, pre-push wired to the gate | new |
| W1.7 | `tools/check-readme.js`: every key in `DEFAULTS` appears in the README table; no stale counts | new |

### W2 — Verified defects (§2)

| ID | Task | Files | Proof |
|---|---|---|---|
| W2.1 | Parse watchdog: require ≥1 card; fail loud when the page claims more results than we parsed | `tools/verify-live.mjs` | the §2.1 command now FAILS |
| W2.2 | `SELECTORS` block; rule pass + harness read from it | `content.js` | gate + live PASS unchanged |
| W2.3 | Mutation loop: judge `m.target` before added/removed nodes | `content.js` | live: one nudge → bounded passes |
| W2.4 | Gate covers every tracked `*.js`; 300-line-per-file cap | `tools/gate.sh` | inject a syntax error in any file → gate fails |
| W2.5 | `test-manifest.js` walks the tree; flags tracked `*.js` missing from the manifest | `test-manifest.js` | add an orphan file → test fails |
| W2.6 | `dataset.why` deleted; `ctxMap` marked `ponytail:` | `content.js` | grep |
| W2.7 | `autoScan` disabled + labelled (D4) | `content.js`, `options.html`, `options.js` | live: checkbox disabled |

### W3 — Deep scan (the original Task 4) → depends on W2

| ID | Task | Files |
|---|---|---|
| W3.1 | `detail-parser.js` as a pure function + `test-detail-parser.js` (fixtures, no network) | new |
| W3.2 | Fetch layer: current page's cards only, 3 concurrent, 400 ms between waves, 429 stops the fleet | `content.js` |
| W3.3 | IndexedDB cache: job-URL key, 7-day TTL, 1 000-entry cap, oldest evicted (D3) | `content.js` |
| W3.4 | Progress + stop button, rendered **only** when keywords are configured; enable `autoScan` (D4/D5) | `content.js`, `content.css` |
| W3.5 | Live assertion: a detail page parses to non-empty description + a salary field | `tools/verify-live.mjs` |

### W4 — Detail-page banner (the original Task 6) → depends on W3

| ID | Task |
|---|---|
| W4.1 | On `/jobseekers/job/...`, show the same verdict for the job being viewed (salary status, matched keywords), no hiding |

### W5 — Distribution (the original Task 8) → depends on W1, W3

| ID | Task |
|---|---|
| W5.1 | Decide D2; if the Store: privacy justification, screenshots, version story, changelog |
| W5.2 | Release checklist: gate green, live PASS on both list variants, README screenshots current |

---

## 6. Execution plan

### 6.1 Wave plan

| Wave | Contents | Parallelism | Exit gate |
|---|---|---|---|
| **0. Decide** | This document, §3 approved | — | D2/D3/D5 answered |
| **1. Say what it is** | W1.1–W1.7 ‖ (W1.1/W1.2/W1.4 ‖, then W1.3 → W1.6/W1.7) | 2 agents | README exists, gate covers it, hygiene test green |
| **2. Fix what the audit found** | W2.1 → W2.3 ‖ W2.4/W2.5, then W2.2, W2.6, W2.7 | 2 agents | the two §2 proofs flip; live PASS unchanged |
| **3. Deep scan** | W3.1 → W3.2 → W3.3/W3.4 → W3.5 | 2 agents | fixture tests green; live scan bounded; 429 leaves cards unscanned |
| **4. Reach** | W4.1 → W5.* | 1 agent | banner live; distribution decision executed |
| **5. Continuous** | Keep the gate green on every push; re-run `verify-live` after any selector report | ongoing | — |

### 6.2 Hard sequencing constraints

- **W2.1 before any W3 work** — a gate that cannot fail will not catch a fetch layer that silently
  stops scanning.
- **W2.3 before W3.4** — the deep scan mutates the DOM (progress, badges); a live mutation loop
  would turn a 30-fetch scan into a 400-pass/second page.
- **W3.1 before W3.2** — the parser is pure and fixture-tested first, so the fetch layer has nothing
  to guess about.
- **W1.3 (README) before W5** — a Store listing without a README is a support queue.
- **D3 before W3.3** — the cache store decides the fetch layer's shape.

### 6.3 Definition of done (every task)

1. Test written first (RED), then implemented (GREEN).
2. `sh tools/gate.sh` green; warning count not increased.
3. `node tools/verify-live.mjs` PASS on the live site for anything that touches injection, rules, or
   the DOM (both a keyword-search URL and a category URL).
4. The acceptance check exists and **would have failed before the fix** — state the command.
5. Docs touched if behaviour changed (README settings table, `docs/architecture.md`, this file).
6. One commit, scoped message. Never commit or push a red gate — there is no merge step to catch it.
7. No new dependency without a one-line justification. Standard library first.
8. `# ponytail:` comment for every deliberate ceiling, naming it.

### 6.4 Delegation briefs

**Applies to every brief:** run `sh tools/gate.sh` before every commit; never push red. Read
`content.js` fully before editing — the chip, the panel, the rule pass and the observer share one
closure, and `renderChip()` wiping the chip is the trap that has already cost one bug (§2.2).

**Brief A — Harness agent** (W2.1, W2.4, W2.5, W3.5)
> Work in `tools/`, never in the extension source. Every assertion must fail loudly with the selector
> or URL that broke; no `PASS` is allowed to be reachable from an empty page. Keep `cdp.mjs`'s two
> rules: browser-level WebSocket, explicit open timeout. Report the command that proves each new
> check would fail on the pre-fix harness.

**Brief B — Content-script agent** (W2.2, W2.3, W2.6, W2.7, W3.2–W3.4)
> Minimal diffs; the observer and the rule pass are the risky area. After W2.3, assert in the live
> harness that a nudge produces a bounded number of passes. For W3: the politeness budget is a hard
> constraint — any change must be provably unable to exceed 3 concurrent / 400 ms, and the scan must
> be bounded to the cards on the current page.

**Brief C — Docs agent** (W1.1–W1.7, W4.1 docs)
> The README is the product's face: install steps that work from a fresh clone, screenshots that are
> real (captured from the live site, not mocked), and every settings key documented — `tools/check-readme.js`
> fails the gate if one is missing. Never claim something the code does not do.

---

## 7. Quality bar (non-negotiable)

- **A gate that cannot fail is worse than no gate.** Every check must be provably able to go red.
- **Never hide a listing by accident.** No-salary and negative keywords hide; positives only
  highlight. A false positive costs the user money.
- **Silence is a bug.** A setting that does nothing, a scan that stopped early, a mutation loop that
  keeps running — all must be visible or impossible.
- **The page belongs to the site.** Injected UI is namespaced, removable, and must never alter the
  site's own DOM beyond `hidden` + our own classes.
- **Politeness is a feature.** The deep scan spends the site's bandwidth: 3 concurrent, 400 ms
  between waves, current page only, and it stops on 429 instead of pushing harder.
- **Zero extra requests while nothing is configured.** With empty keyword lists and `noSalary` off,
  the extension must make no network request at all.
- **Everything stays local.** Local storage, no server, no analytics.

---

## 8. Explicitly rejected / deferred (do NOT build)

Recorded so nobody re-proposes them. Each has a trigger that would change the answer.

| Rejected | Why | Revisit if |
|---|---|---|
| Paginating / crawling beyond the current page | Multiplies requests for jobs the user is not looking at; the site's search already filters | never |
| A background service worker | Killed by MV3 semantics and unnecessary — storage changes already broadcast to every context | a task must outlive a tab |
| A build step / bundler / framework | 560 lines with no imports; a build step costs the "load unpacked and read the source" property | the extension passes ~5 000 lines or gains real modules |
| Hiding on positive keywords | See §1.2 | never |
| LLM-based relevance scoring | Non-deterministic, needs a key, and sends the user's job data to a third party | never |
| Auto-applying to jobs | ToS and account risk; an unreviewed application is unrecoverable | never |
| Telemetry / analytics | The privacy statement is "nothing leaves the machine" | never |
| A second options UI hidden behind the toolbar icon | The panel is the UI; the standalone page is a fallback | a setting that cannot fit in the panel |
| `chrome.storage.local` for the deep-scan cache | Shares quota with settings and rewrites the whole blob per write (D3) | IndexedDB proves unworkable on a real page |
| Making `tools/verify-live.mjs` run in CI | Needs a real browser and the live site; a mocked DOM would test the mock | a headless Chrome with the extension + a recorded fixture page |

---

## Appendix A — Tracked file inventory

| Group | Files |
|---|---|
| W1 (new) | `README.md`, `SECURITY.md`, `.editorconfig`, `.gitattributes`, `.github/ISSUE_TEMPLATE/*`, `docs/architecture.md`, `docs/scraping.md`, `test-repo-hygiene.js`, `tools/check-readme.js` |
| W2 | `content.js`, `tools/verify-live.mjs`, `tools/gate.sh`, `test-manifest.js`, `options.html`, `options.js` |
| W3 (new) | `detail-parser.js`, `test-detail-parser.js` |
| Existing, unchanged | `manifest.json`, `rules.js`, `test-rules.js`, `content.css`, `options.html` |
| Reference | `spec.md` (this file), `docs/HANDOFF.md`, `plans/*` |

## Appendix B — DOM surface (see §4.3)

List card `.jobpost-cat-box.latest-job-post` · salary `dd.col` · description `p#job-description` ·
detail salary `h3.fs-12`(WAGE / SALARY) → next `p` · 30 cards per page (observed 2026-09-18).
List URLs: `/jobseekers/jobsearch?jobkeyword=…`, `/jobseekers/jobsearch/{offset}?jobkeyword=…`,
`/jobseekers/search/c/{slug}/{offset}`. Readable without login in the automation profile.

## Appendix C — Settings keys (`chrome.storage.local.settings`)

| Key | Type | Default | Meaning | Read by |
|---|---|---|---|---|
| `negative` | string[] | `[]` | Hide cards whose text contains any of these (case-insensitive substring) | rule pass |
| `positive` | string[] | `[]` | Highlight matching cards (never hide) | rule pass |
| `noSalary` | boolean | `true` | Hide cards whose salary text contains no digit | rule pass |
| `showHidden` | boolean | `false` | Reveal what was hidden (chip toggle writes this) | rule pass, chip |
| `autoScan` | boolean | `false` | Deep-scan this page's cards (W3). Disabled in the UI until then (D4) | nothing yet |

`tools/check-readme.js` fails the gate if a key here is missing from the README's table.

## Appendix D — Test matrix

| Check | Offline? | Covers | Command |
|---|---|---|---|
| `test-rules.js` | ✅ | salary parsing, keyword matching, case, duplicates | `node test-rules.js` |
| `test-manifest.js` | ✅ | every `chrome.*` namespace granted; referenced files exist; no orphan source | `node test-manifest.js` |
| `test-repo-hygiene.js` | ✅ | no LICENSE, README stance, SECURITY, templates, hook wiring | `node test-repo-hygiene.js` |
| `tools/check-readme.js` | ✅ | settings documented, no stale counts | `node tools/check-readme.js` |
| `tools/gate.sh` | ✅ | all of the above + syntax + path scan + size cap | `sh tools/gate.sh` |
| `tools/verify-live.mjs` | ❌ live site + browser | injection, selector drift, rule parity, `[hidden]`⇒`display:none`, chip toggle, panel open/save with no reload, bounded re-passes | `node tools/verify-live.mjs` |
| CI (Node 20) | ✅ | `npm test` + package integrity | `.github/workflows/ci.yml` |

## 9. What "done" looks like

A stranger opens the GitHub repo, reads a README that installs the extension in three clicks, sees a
screenshot of what it does, and finds every setting documented. They clone it, run one command
(`sh tools/gate.sh`) and everything passes. They load it unpacked on OnlineJobs.ph, and the no-salary
cards and their keywords are gone, with a chip that tells them the truth and a panel that edits the
rules in place. Nothing they type leaves their machine. No request is made until they ask for one.
Nothing in the repo claims something the code does not do.
