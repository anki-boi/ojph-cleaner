# spec.md — OJ.ph Cleaner (`ojph-cleaner`)

**Type:** audit + improvement spec + delegated build plan
**Date:** 2026-09-18
**Baseline commit:** `d759ffe` (0.3.0) · **Earlier plan:** `plans/2026-08-26_ojph-extension.md`
**State (2026-09-23):** 5 895 source lines (js/css/html, 37 tracked files, 9 of them tests) · zero
dependencies · 1 live CDP harness · Chrome 153, unpacked, enabled in the automation profile

**Status after the audit:** ✅ W1 (public face, hygiene, gates) and ✅ W2 (every defect in §2) landed
in 0.4.0 — see `docs/HANDOFF.md` §4c for the measured before/after. ✅ W6 (perpetual pagination) landed
in 0.5.0. ✅ W7 (salary figures + goal) landed in 0.6.0. ✅ W8 (recency + the yellow reconsider state)
landed in 0.7.0. ✅ W4 (the job's own page), ✅ W9 (closed-listing memory), ✅ W10 (the no-salary rescue)
and ✅ W11 (the harness's silent-exception bug) landed in 0.8.0. ✅ W3 (deep scan), ✅ W12 (the job
memory), ✅ W13 (the tiered scan + panel) and ✅ W14 (the tier views) landed in 0.9.0. 0.10.0 adds
the three open feature doors — the CSV export of the job memory, the tier marks on the saved-jobs
table, and copy/paste for the two keyword lists — and closes the defects the audit left measured:
the FX path now rejects non-finite rates and the fresh-rate rows no longer reach the rate map as
objects (measured live as a board-wide `₱NaN`), the detail bar's D13 contradiction is gone, and the
paginate retry is bounded. 0.11.0 adds the **super green** verdict: a yellow card that matches more
positive keywords than negative ones and pays at least 50 % above the goal is High yield, and any
card that matched keywords on both sides carries both badges so the trade-off is visible. 0.12.0 adds
the board's noise rules: the **premium bands** (the goal mark steps with the margin — `★★` at 25 %+,
`★★★` at 50 %+ above the goal), the **fresh mark** (a high-yield card posted in the last 24 h), the
**duplicate re-post marking** (the older copy per title+company carries the tag), and the
**negotiable rescue** (an opt-in setting that keeps a no-figure listing that says Negotiable/DOE when it
otherwise looks good, tagged `⚠ negotiable`). D2 (distribution) is still open; D3 was answered by
construction (IndexedDB, as planned) and D4/D5 closed with W13. 0.12.1 fixes the standalone options page,
which had no field for `rescueNegotiable` and silently dropped it on save, and removes the dead `warns`
field the overtime signal left behind once `salary-cards.js` took over printing the over-40-hours badge.
It also closes two holes the 0.12.0 work left in the checks themselves: the settings-surface parity test
now covers the in-page panel as well as the options page, on all three legs (defaults, load, save), and
the live harness's view check establishes its starting view instead of assuming the board is on All — a
run that found the board already on High yield read a *correct* toggle-off as a click that never landed.
0.13.0 makes the goal a **hard filter** (D40): *Worth considering* needs a salary goal met, not merely a
keyword you like, and the keyword-hide branch is now evaluated before the highlighted one — so a listing
that matched both a keyword you like and one you asked to hide while below a goal is **hidden** instead of
yellow, unscanned and after a scan alike. A keyword you like below the goal with no hide keyword is
untouched: still *Highlighted*, the green outline this extension has always drawn. It also fixes the two
things that stopped that change being provable: the job memory's own change check could not converge — a
record whose `card` omitted a fact that every live card carries (`goalBy`) compared as *changed* on every
pass, so the page wrote storage and the write's echo re-ran the pass, **45 passes/second forever on an idle
page** (§2.8) — and the live harness assumed a virgin job memory when it asserted the scan had remembered
something, which is false on any board you have scanned before.

0.14.0 adds **`sortByPay`** (D41): when a deep scan run ends, the board is ranked by the figure on each card
— the highest monthly figure first, then listings that post only a rate, then the ones with no figure, which
keep the site's own order. Off by default, and it waits for the scan on purpose: a card's figure is an
*assumption* until the listing's own `HOURS PER WEEK` is known, so a pay order taken before the scan would
rank guesses. Sorting never converts a month into an hourly rate or the reverse — that needs a work week,
which `salary.js` refuses to assume anywhere else (D13) — so a ₱5,000/mo listing outranks a ₱500/hr one,
and the card resting on the 40 h/week assumption keeps its own ⚠ label. The order is sticky: pages the
loader appends afterwards are re-ranked, so the board stays in one piece as you read down it.

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

Snapshot at the 0.3.0 baseline commit — line counts below are from that date, before the W4–W14
splits. The wave-by-wave inventory is Appendix A; the current tree is `git ls-files`.

| Layer | Files | Notes |
|---|---|---|
| Manifest | `manifest.json` | MV3, `permissions: ["storage"]` (load-bearing — see §1.2), host permissions on `onlinejobs.ph` only |
| Content script | `content.js` (271 lines) | rule pass, mutation observer, storage sync, the counts the panel shows — **no network code**. At 299 lines the status panel was split into `chip.js` |
| Status panel | `chip.js` (138 lines) | the bottom-right panel: the hidden total with a line per reason, the matching stats, and the two buttons (`ui.css` styles it). Foldable from its header |
| Loader | `pagination.js` (126 lines) | perpetual pagination: sentinel, one fetch per user scroll, stop conditions (W6) |
| Rules | `rules.js` (105 lines) | pure `hasSalary` / `matchKeywords` / `keywordRegex` (the one place the exact-word pattern is built), `parsePosted` / `isStale`, UMD, no DOM |
| Styles | `content.css` (206 lines), `ui.css` (222 lines) | `content.css` paints the site (card marks, salary notes, detail highlights); `ui.css` floats over it (the status panel and the options panel) |
| Detail page | `detail-text.js` (146 lines), `detail.js` (214 lines) | the highlight planner (pure, tested) and the applier + figures bar (W4) |
| Closed memory | `closed.js` (63 lines), `closed-cards.js` (152 lines) | the pure map/prune/lookup and its applier: learn a closure, mark cards and saved rows (W9) |
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

### 2.8 P1 — the memory's own change check could not converge, so the page wrote storage forever

Found 2026-09-23 while proving D40, by the live harness's loop bound (it is the same class as §2.2,
one layer down — that one is driven by the DOM, this one by storage).

`sameFacts` decides whether a rule pass writes a record. It compares the **card** facts with `canon`,
which is `JSON.stringify` and therefore **drops an absent key but keeps an explicit `null`**. A record
written before a fact existed omits it; every live card carries it:

```
stored:  "card":{"goal":true,"neg":[],"pos":[]}        # 48 of 221 records, missing goalBy
fresh:   "card":{"goal":true,"goalBy":null,"neg":[],"pos":[]}
```

So every pass saw a change, wrote `jobRecords`, and the write's `chrome.storage.onChanged` echo
re-ran the pass. The echo guard made it permanent rather than transient: it holds one
`lastWritten`, so a self-echo that arrives after the next write is in flight is mistaken for another
tab's, and the handler adopted that older snapshot wholesale — re-creating the difference it had
just removed.

Measured live (automation Chrome, 30-card search page, 1.6 s of quiet, no interaction):

```
45 rule passes / second, forever   ·   44 of 44 echoes treated as foreign   ·   48/221 records affected
```

**Fix:** `records.js` gains `cardShape` (complete a card's facts before comparing, so an absent key
and an explicit `null` mean the same thing) and `apply` writes the completed shape; `sameFacts` moves
into `records.js`, where it is pure and `test-records.js` can pin it. The echo handler adopts a disk
record only when it is **newer** (`checkedAt`), so a stale copy can never undo work this tab has
done. **Proof:** on the same page, the pass count over 2 s is now **0** where it was ~55, the live
harness's observer bound is back to `1 rule pass(es) in 812 ms`, and `test-records.js` pins the
exact regression.

---

## 3. Decision points (approve or override)

| # | Question | Answer | Status |
|---|---|---|---|
| **D1** | License | No `LICENSE` file; README states **all rights reserved** explicitly, noting the repo is public to read but grants no reuse. Asserted by the hygiene test. | ✅ decided 2026-09-18 |
| **D2** | Distribution | Unpacked only until W3+W1 land; a Web Store listing needs a privacy justification for `host_permissions` on `onlinejobs.ph` and a stable version story | ⬜ **needs you** |
| **D3** | Deep-scan cache store | **IndexedDB** as planned (1 000 entries × ~3 KB, 7-day TTL, oldest evicted). `chrome.storage.local` is simpler but shares its quota with settings and rewrites the whole blob | ⬜ **needs you** |
| **D4** | `autoScan` until W3 | Visible, **disabled**, labelled "needs the deep scan (not built yet)" | ✅ decided 2026-09-18 |
| **D5** | Deep-scan politeness budget | **2 concurrent, 400 ms between pairs, and the scan paginates through the pages *it* loaded** (D33). It never walks the site for you: it stops at your recency horizon. A 429 or a network error leaves the rest unscanned and never retries harder. **Amended 2026-09-19** — the original said 3 concurrent and "current page's cards only", which the user's own feature request replaced | ✅ decided 2026-09-19 |
| **D6** | Positive keywords | Highlight only, never hide | ✅ do not regress (§1.2) |
| **D7** | `# ponytail:` ceilings | Keep marking deliberate shortcuts with a named ceiling | ✅ do not regress |
| **D8** | Perpetual pagination | **Yes, but scroll-driven.** The next *result* page is fetched when the user scrolls to the bottom — one page per real scroll gesture, one request per page, 600 ms apart, stopping on the first sign of an end. It is the same request the user would have made by clicking *Next*, so the politeness story survives; what stays rejected is the *deep scan* paginating, and any background prefetch on an idle page | ✅ decided 2026-09-18 |
| **D9** | Salary figures | Show the listing's own salary converted to a monthly ₱ figure above the posted text, using the ECB's live reference rate (one request per currency per 24 h; no rate → no figure). Ported from the suite's `scraper/salary.py`, with currency detection fixed for the formats this board actually uses | ✅ decided 2026-09-18 |
| **D10** | Hours policy | **A monthly figure is only shown when the listing states a period amount (month/week/year), or an hourly rate with stated hours, or a "Full Time" badge (40 h/week).** No fallback exists: not 40 h/week, and not 20 for "Part Time", which states no number at all. Otherwise the card keeps its rate (`≈ ₱314/hr`) or gets nothing, and the tooltip says which | ✅ decided 2026-09-18 |
| **D11** | Piece rates | A rate tied to a non-time unit (`$5 per entry`, `$2/article`) gets **no** figure — there is no monthly equivalent to compute, and the tiny-number hourly heuristic must never be applied to it | ✅ decided 2026-09-18 |
| **D12** | Bare numbers | When a listing states **neither a currency nor a unit**, its size is the tell: **1-2 digits → an hourly rate, 3-4 digits → a monthly rate, 5+ digits → a monthly peso figure**, and the currency follows the same reading. Sampled live: the 1-2 digit cards were foreign writing roles at $4-7/hr, the 3-4 digit ones monthly USD rates (`1000` on a listing whose own text said "$1,000 per month"), the 5+ digit ones pesos. A stated marker or unit always wins — `Php 1000/day` stays pesos, `140-175/per hour` stays pesos | ✅ decided 2026-09-18 |
| **D13** | Which goal judges a card | **One goal per card**: Full Time → the monthly goal (40 h/week is what full time means, so a month exists); Part Time or other → the hourly goal, using the posted rate; a listing quoting only a month → the monthly goal, as there is no rate to compare. Neither goal is ever derived from the other — deriving one would assume someone else's work week | ✅ decided 2026-09-18 |
| **D14** | The 40 h/week disclaimer | A month computed from an hourly rate under the full-time definition **says so on the card**: `assumes 40 h/week (full time) — verify with the employer`. Do not trust the monthly figure blindly | ✅ decided 2026-09-18 |
| **D15** | A negative-keyword card that also looks good | **Shown with a yellow outline**, never hidden. A marker you have to ask for is not a reconsideration | ✅ decided 2026-09-18 |
| **D16** | What "good" means for that state | A positive keyword match, **or** the card is at/above one of the goals. With both goals off, only a positive can rescue a card | ✅ decided 2026-09-18 |
| **D17** | The default recency window | **7 days** | ✅ decided 2026-09-18 |
| **D18** | Where recency sits in the order | **First**, and first in the chip: a stale listing is hidden even if it would otherwise be yellow | ✅ decided 2026-09-18 |
| **D19** | A card whose date cannot be read | **Never hidden**, and counted separately — the rule that runs before everything else must not be the rule that loses a listing | ✅ decided 2026-09-18 |
| **D20** | Which clock the posted date is read in | `data-temp-2` (UTC), falling back to `data-temp` at the site's **+08:00**. Never the viewer's local zone: on this machine that is 14 hours wrong | ✅ decided 2026-09-18 |
| **D21** | Representing last week / last month / custom | **One number**, `maxAgeDays`: `0` off, `7` last week, `30` last month, any N custom. Three settings for one threshold is the over-build | ✅ decided 2026-09-18 |
| **D22** | The live harness and the user's settings | It must snapshot and restore `chrome.storage.local` around every run — including on SIGINT/SIGTERM — because it seeds into the user's daily browser. **This was a live data-loss bug, not a nicety** | ✅ decided 2026-09-18 |
| **D23** | Window boundaries | Strict (`age > maxAgeDays`), so `7` means "posted within the last 7 days" — rolling, not a calendar week | ✅ decided 2026-09-18 |
| **D24** | Keyword matching | **Exact word or phrase**, case-insensitive: `ai` never matches `email`, and `video editor` never matches `video editors`. A leading `=` is accepted and ignored so a keyword saved by the opt-in release keeps working. Not a preference — a defect fix: substring `AI` matched 30 of 30 live cards, and with D15 that silently turned the user's entire negative list into a no-op | ✅ decided 2026-09-18 |
| **D25** | The job's own page | Green for a keyword you like, red for a keyword you asked to hide, and red for anything that takes you off OnlineJobs.ph. Where two rules overlap, **red wins** — a warning must never be hidden by an endorsement | ✅ decided 2026-09-18 |
| **D26** | "Off-platform" as a signal | **Application asks only** (`apply here/via`, `fill out the form`, `send your resume`, `email your…`, `DM me`). A messaging or booking tool counts only in the same sentence as an ask, because 3 of 7 phrase hits in a live 18-listing sample were Telegram as *job content* | ✅ decided 2026-09-18 |
| **D27** | The redacted link | OnlineJobs.ph replaces an application URL with `----------` **even when you are signed in** (3 of 18 listings). That dash run is itself a red signal: it is sometimes the only surviving trace of an off-platform apply | ✅ decided 2026-09-18 |
| **D28** | The monthly figure on a detail page | Computed from the listing's **own `HOURS PER WEEK`** when it states one (14 of 18 listings do). `TBD` falls back to 40 h/week **with the disclaimer**, and only for full-time/unstated listings: part-time with no stated hours claims no month at all, because that is a 2× error, not a rounding one. A per-unit rate never claims one | ✅ decided 2026-09-18 |
| **D29** | Closed-listing memory | Learned **only** when you open a listing whose page says it closed, **or when a deep scan you started passes one** (D37 — the page is fetched either way), kept 180 days, and never used to fetch anything on its own. A crawler that tested every card would fetch every listing — the property `docs/scraping.md` protects. Consequence: a saved job you have never opened cannot be known closed | ✅ amended 2026-09-19 |
| **D30** | The no-salary rescue | **Opt-in, off by default** (`rescueNoSalary`). When on, a no-salary listing that also looks good falls through to the keyword rules instead of being hidden — `good` being the same predicate the reconsider state already uses, so nothing new defines what "looks good" means | ✅ decided 2026-09-18 |
| **D31** | The two tiers | **High yield = passing salary** (a goal met), with or without a keyword you like. **Worth considering = a hide keyword matched, on a listing that still looks good.** A keyword you like on a listing below your goal is a third state, **Highlighted** — the green outline this extension always drew, counted and filtered separately. The user's correction, verbatim: *"having matched positive keywords does not make the job listing high-yield. It's either passing salary or passing salary with positive keywords"* | ✅ decided 2026-09-19, **amended 2026-09-23 by D40** |
| **D32** | How the tier buttons change the board | **Filter, never reorder** — and **scroll the first card of the chosen tier into view**, because hiding most of a 244-card list leaves the viewport pointing at empty space | ✅ decided 2026-09-19 |
| **D33** | The scan's budget | **Button-triggered, never automatic** (`autoScan` is off by default): pages to the recency horizon, then opens listings **2 at a time, 400 ms between pairs**, with `Stop` and hard caps of 10 pages / 300 listings / 10 minutes | ✅ decided 2026-09-19 |
| **D34** | What a scan covers | High yield first, then Worth considering (and Highlighted with them), then — only with `scanAll` — the unclassified and keyword-hidden cards. A second run of the same page reads the cache and spends nothing | ✅ decided 2026-09-19 |
| **D35** | What a re-check does | Silent update plus a change mark (`↑ promoted` / `↓ demoted`) that clears when you open the listing | ✅ decided 2026-09-19 |
| **D36** | A settings change after a scan | **Re-derive from the cached description — zero requests.** The record carries a signature of the keyword lists it was derived under, so stored facts are only trusted while they still match; otherwise the card falls back to its own text | ✅ decided 2026-09-19 |
| **D37** | Closures the scan passes | **Learned**, exactly as opening the listing would — the page is already fetched, and refusing to read its own notice would be superstition rather than politeness | ✅ decided 2026-09-19 |
| **D38** | Off-platform asks | A **tag**, not a gate: shown beside the keyword badge on every card that carries one, never hidden and never demoted for it. An earlier version demoted, which moved 176 of 227 scanned listings out of High yield | ✅ decided 2026-09-19 |
| **D39** | A week longer than 40 hours | **Flagged on the card** (`⚠ 45 h/week — over the 40 h full-time week`) and never demoted for | ✅ decided 2026-09-19 |
| **D40** | The goal is a hard filter | **Worth considering needs `money` (a goal met), not merely a keyword you like.** `good && neg` becomes `money && neg`, and the keyword-hide branch is evaluated **before** the highlighted one, so below a goal a hide keyword wins outright — a keyword you like can highlight a listing and never rescue one. The user, on finding the yellow tier reachable by keywords alone: *"you might have promoted a lot of listings to worth considering due to the presence of positive keywords being more than the negative keywords, but do not forget that the goal salary is a hard filter."* Consequence, accepted: a listing that matched a keyword you like **and** one you asked to hide while below a goal goes from yellow to **hidden**, both unscanned and after a scan. A keyword you like below the goal with no hide keyword is untouched — still **Highlighted**, the green outline | ✅ decided 2026-09-23 |
| **D41** | Ranking the board by pay | **Three blocks, and only after a scan run ends.** A month, then a posted rate, then no figure — each highest first, and the unranked cards keep the site's own order. Never one list: converting a month into an hourly rate (or back) needs a work week, which D13 refuses to assume anywhere else, so **a ₱5,000/mo listing outranks a ₱500/hr one** and the card resting on the 40 h/week assumption keeps its ⚠ label rather than being quietly promoted. The trigger is the **end of any scan run** — completed, stopped by you, or cut short by the site — and not the page load, because a card's figure is an assumption until the listing's own `HOURS PER WEEK` is read; the user: *"the sorting from highest to lowest salary should only happen after the deepscan is completely done. That's a lot cleaner."* The order is **sticky** (pages the loader appends later are re-ranked) and the whole feature is **off by default**, since reordering a board the user did not ask to reorder is the extension's one unpardonable move | ✅ decided 2026-09-23 |

---

## 4. Target architecture

### 4.1 Layout

```
manifest.json          MV3 entry; storage permission + onlinejobs.ph host permissions only
rules.js               pure rules (no DOM): hasSalary, matchKeywords        ← unit-tested
tiers.js               the verdict table: closed → stale → no salary → high yield (PAY) →
                       worth considering (PAY) → keyword-hide → highlighted → nothing  ← unit-tested
records.js             the job memory's state machine (prune, cap, change)  ← unit-tested
page.js                every coupling to the site's LIST markup (selectors, ownText, salary, date)
detail-parse.js        one reader for a listing's own page (description, overview, closed)
detail-cache.js        IndexedDB: the listing's own words, 7-day TTL, 1 000-entry cap
records-cards.js       applies the memory: sync copy for the rule pass, writes only on change
scan.js                the deep scan (W13): page to the horizon, then 2 listings at a time
pay-sort.js            the board in pay order after a scan ends (D41): the pure rank rule + the reorder
                       that only ever writes when the order changed                    ← rule unit-tested
content.js             DOM + state: chip counts, rule pass, views, storage sync (no network)
observer.js            the one MutationObserver, and the isOurs() check that stops it looping
pagination.js          the only network code: scroll-triggered result loading, and the scan's loadOne
content.css / ui.css   what is painted on the site 
options.html/.js       standalone fallback page (the panel is primary)
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
- **Rule order is `closed → stale → noSalary → negative (unless good) → positive`** and it is observable: with
  `noSalary` off, the no-salary cards fall through to the keyword rule (measured: 16 keyword hides become
  20). Any test that predicts a count must replicate the order, not add up the buckets. `good` — a
  positive match, or a goal mark — turns a negative match into the **yellow reconsider state** (D15/D16)
  instead of a hide. `closed` is first because a dead listing is a fact, not a judgement call (D29), and
  the three places that predict counts — `content.js`, and the harness's `ruleEval` — all replicate it.
- **One file, one job.** No file over 300 lines (gate-enforced, W2.4) — the analogue of the suite's
  250-line route-module cap.

### 4.3 DOM contract (the whole external surface)

All page coupling lives in one `SELECTORS` block at the top of `content.js` (W2.2), so site drift is
a one-line fix and the harness can name the selector that broke:

| What | Selector | Used by |
|---|---|---|
| List card | `.jobpost-cat-box.latest-job-post` | rule pass, harness |
| Card salary | `dd.col` (text must contain a digit) | rule pass, harness |
| Card posted date | `p[data-temp]` → `data-temp-2` (UTC), fallback `data-temp` (+08:00) | rule pass (W8), harness |
| Job description | `p#job-description` — 73 nodes, only `#text` and `<br>` (no `<a>`, so links are prose) | detail page (W4) |
| Job overview | `dl.row.no-gutters dd` → `dd > h3` label, `dd > p` value: `TYPE OF WORK`, `WAGE / SALARY`, `HOURS PER WEEK`, `DATE UPDATED` | detail page (W4) |
| Closure notice | the text `This job has been closed` **above the description** (login-gated: a logged-out fetch shows 0 hits) | detail page (W9) |
| Saved-jobs rows | a React `<tr>` table (no `.jobpost-cat-box`); the job link is `a[href*="/jobseekers/job/"]` | memory marks (W9) |
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

### W7 — Salary figures and the goal ✅ (0.6.0)

Asked for as "the salary estimator". It is a **normalizer**, not an estimator: it converts what the
listing states and refuses to invent the rest. Every rule below came from a live card.

| ID | Task | Files |
|---|---|---|
| W7.1 | `salary.js` pure part: currency detection (a 3-letter code beats a `$`), unit heuristics, piece-rate detection, the `monthly` honesty flag + `test-salary.js` (the suite's real-data corpus plus formats sampled live) | `salary.js`, `test-salary.js` |
| W7.2 | Hours policy (D10): stated hours → a month; Full Time → 40 h/week; Part Time or unstated → the rate only. Part Time is checked *before* Full Time, because a part-time card whose prose said "full time availability" was being handed a 40-hour month | `salary.js` |
| W7.3 | Live ECB rates (v2 endpoint — v1 is deprecated), cached per currency with a 24 h horizon in `chrome.storage.local.fx`, failure-stamped so the API is not hammered, never served stale | `salary.js` |
| W7.4 | Card annotation above the posted figures (`.ojc-salary-note`), stripped by `cardSalary()` so it can never affect the no-salary verdict; `:empty` hides itself | `salary.js`, `content.js`, `content.css` |
| W7.5 | `goalSalary` setting + the "at or above your goal" brighten, judged on the low end of a range | `content.js`, `options.*`, `content.css` |
| W7.6 | Live assertions: every readable card's figure recomputed with the same parser, the no-month-without-hours policy, piece rates left alone, one rate request per foreign currency, posted text intact, goal marks exactly matching | `tools/verify-live.mjs` |
| W7.7 | Bare numbers read by magnitude (D12): 1-2 digits hourly, 3-4 monthly, 5+ monthly pesos, with the currency inferred only when no marker exists and disclosed in the tooltip | `salary.js`, `test-salary.js` |
| W7.8 | The hourly goal and the one-goal-per-card rule (D13), plus the 40 h/week disclaimer on the card (D14) | `salary.js`, `content.js`, `content.css`, `options.*` |

### W8 — Recency and the reconsider state ✅ (0.7.0)

Asked for as: stale listings filtered out automatically, "the primary filter out of everything", plus a
yellow outline for a listing that matches a hide keyword *and* looks good, "so I can reconsider those
listings". Decisions D15–D24.

| ID | Task | Files |
|---|---|---|
| W8.1 | Pure `parsePosted` / `isStale`, with tests pinning the UTC-vs-Manila relationship, rollover rejection, the strict boundary, and that an unreadable date is never stale | `rules.js`, `test-rules.js` |
| W8.2 | Recency as the first rule, read from `data-temp-2` with the Manila fallback; chip gains `stale` and `reconsider`; `maxAgeDays` default 7 | `content.js` |
| W8.3 | The yellow reconsider state, `.ojc-recon` declared after `.ojc-goal` at equal specificity, and `✗ keyword` badges on every negative match | `content.js`, `content.css` |
| W8.4 | One extra rule pass when a goal mark moves — the mark arrives after the pass that reads it | `salary-cards.js` |
| W8.5 | The window in both UIs, first in the panel | `panel.js`, `options.html`, `options.js` |
| W8.6 | Live assertions: recency parity, a watchdog on the date attributes, the **computed** outline colour, badge parity, and an inserted card that must turn yellow — the only form of the seam check that can fail | `tools/verify-live.mjs` |
| W8.7 | The harness stops clobbering the user's settings, and stops opening a tab per `chrome.storage` read | `tools/verify-live.mjs`, `tools/cdp.mjs` |
| W8.8 | A section that seeds its own keywords and **requires each branch to fire**, so a bare run can no longer pass without exercising the negative, positive or reconsider rule | `tools/verify-live.mjs` |
| W8.9 | Keywords are matched as exact words or phrases (D24), with a leading `=` accepted and ignored for the one release that made it opt-in | `rules.js`, `test-rules.js`, `panel.js`, `options.html`, `README.md` |

### W4 — The job's own page ✅ (0.8.0)

Asked for as: *"when a job listing is opened, the extension still works … highlight green the keywords we
like, then highlight red what we dont like … auto-highlight links and email addresses as red. This is
unwanted because we are forced to submit applications outside of onlinejobs.ph."* Decisions D25–D28.

| ID | Task | Files |
|---|---|---|
| W4.1 | The pure planner: keyword ranges, bare domains in prose, emails (incl. obfuscated), application-ask phrases with the tool guard, the `----------` redaction, and overlap resolution where red beats green | `detail-text.js`, `test-detail.js` |
| W4.2 | The applier: one text-node walk, non-overlapping `span.ojc-hl-pos` / `-neg` / `-warn`, each titled with the rule that made it, and idempotent because our spans are unwrapped before every pass | `detail.js`, `content.css` |
| W4.3 | The figures bar: the listing's own `HOURS PER WEEK`, the month computed from it, the goal verdict, and `⚠ applies off-platform` | `detail.js`, `content.css` |
| W4.4 | A new content-script file wired into the manifest, and every new mark listed in `OUR_CLASSES` — a detail page can carry related-job cards that the board's rules read | `manifest.json`, `content.js` |
| W4.5 | Live assertions: the computed figure recomputed with the same parser and the same cached rate, and an **inserted** off-platform paragraph that must fire every detector | `tools/verify-live.mjs` |

`keywordRegex` moved into `rules.js` so the page highlights exactly what the board hides, and the rate
comes from `salary-cards.js`'s cached loader, so a peso listing still makes zero requests.

### W9 — Closed-listing memory ✅ (0.8.0)

Asked for as: *"when we see that the job listing is already closed, it forever classifies that job listing
as hidden in the job board … max history of 6 months is good."* Decision D29.

| ID | Task | Files |
|---|---|---|
| W9.1 | Pure `jobIdFrom` / `isClosedText` / `prune` / `record`, with tests pinning both slug spellings, a search page being *not* a job, and the 180-day boundary | `closed.js`, `test-closed.js` |
| W9.2 | Learn a closure from the listing's own page and persist it, pruning on every write | `closed-cards.js` |
| W9.3 | The closed rule **first** in the pass: hidden, counted in the chip, revealed by Show all with a grey `⊘ closed` badge | `content.js`, `content.css` |
| W9.4 | The saved-jobs table (React, different markup): dead rows greyed and labelled but kept, since deleting the row is the only way to clear it | `closed-cards.js`, `content.css` |
| W9.5 | A live round trip: inject the closure notice **before the extension boots**, then assert the id was recorded and the board hides that card | `tools/verify-live.mjs` |

### W10 — The no-salary rescue ✅ (0.8.0)

Asked for as: *"A listing with no salary mentioned might still be nice if there are matches to the positive
keywords."* Decision D30. One line of rule logic plus both UIs.

| ID | Task | Files |
|---|---|---|
| W10.1 | `rescueNoSalary` (off by default): the no-salary branch yields to the keyword rules when the setting is on and the card is `good` | `content.js` |
| W10.2 | Toggle in both UIs and a README row (the gate fails if a `DEFAULTS` key is undocumented) | `panel.js`, `options.html`, `options.js`, `README.md` |

### W11 — The harness's silent exception ✅ (0.8.0)

`tools/cdp.mjs`'s `evaluate` returned `undefined` when the page-side expression threw, which turns "my
probe threw" into "the page has no such element" — two opposite facts behind one value. It cost three
debugging rounds while W4 was being built, and it can make a live assertion stop checking anything. Now
rethrown. The same session exposed that an **uncaught exception skipped the storage restore**, so the
harness's "every exit path" claim was false and a crash left the user's settings replaced; `fail()` is
now backed by `uncaughtException` / `unhandledRejection` handlers.

### W12 — The job memory and the verdict table ✅ (0.9.0)

Asked for as: *"the extension remembers the states and stats for each job listing link and every time each
listing is opened, it double checks if there are any changes"*. Decisions D31–D36.

| ID | Task | Files |
|---|---|---|
| W12.1 | `tiers.js`: the verdict table as one pure function, with an unscanned page reproducing 0.8.0's counts exactly | `tiers.js`, `test-tiers.js` |
| W12.2 | `records.js`: the memory's state machine — 180-day prune, 1 000-entry cap, change detection, and the idempotence that keeps a re-derivation from rewriting storage | `records.js`, `test-records.js` |
| W12.3 | `detail-cache.js`: IndexedDB for the listing's own words, 7-day TTL, cap, oldest evicted | `detail-cache.js` |
| W12.4 | `records-cards.js`: the applier — a synchronous copy for the rule pass, writes only on change, the `↑`/`↓` mark | `records-cards.js` |
| W12.5 | `detail-parse.js`: one reader for a listing's own page, shared by the board's scan and the listing's page | `detail-parse.js`, `detail.js` |
| W12.6 | `page.js`: every coupling to the site's list markup, split out when `content.js` passed 300 lines | `page.js`, `content.js`, `observer.js` |

### W13 — The deep scan ✅ (0.9.0)

D33/D34/D37, and the two things the user added while it was being built: the listing's own hours must reach
the figure ("a part-time monthly rate at xx hours weekly"), and a week longer than 40 hours is flagged.

| ID | Task | Files |
|---|---|---|
| W13.1 | `loadOne()` in the pagination loader — the same fetch path, driven by a button instead of a scroll | `pagination.js`, `test-pager.js` |
| W13.2 | Phase 1: page to the recency horizon, with the newest-first watchdog | `scan.js` |
| W13.3 | Phase 2: 2 at a time, High yield first then Worth considering, per-wave re-tiering, Stop, caps | `scan.js` |
| W13.4 | The scan learns closures it passes (D37) | `scan.js`, `closed-cards.js` |
| W13.5 | The listing's own `HOURS PER WEEK` replaces the assumed month, labelled **part-time month at N h/week** — and the goal stays per D13, because lower pay for fewer hours is the point of part-time | `salary-cards.js`, `records-cards.js` |
| W13.6 | The hours badge on the card, and the over-40 warning (`⚠ 45 h/week — over the 40 h full-time week`) | `salary-cards.js`, `content.css` |
| W13.7 | `autoScan` enabled, `scanWorth`, `scanAll` | `panel.js`, `options.*`, `README.md` |

### W14 — The tiers, the views and the re-check ✅ (0.9.0)

| ID | Task | Files |
|---|---|---|
| W14.1 | The view filter and the chip's Views row; **scrolling the first card of the chosen tier into sight** (without it the view looks broken on a long list) | `content.js`, `chip.js` |
| W14.2 | `detail.js` re-checks a listing when you open it, records the move, and clears the mark | `detail.js`, `records-cards.js` |
| W14.3 | The chip's buttons became **persistent nodes**: a rebuild between mousedown and mouseup means the browser never fires the click | `chip.js` |
| W14.4 | Off-platform asks became a **tag** rather than a demotion (the user's call), and a positive keyword stopped making a listing high-yield — pay decides that | `tiers.js`, `content.js`, `chip.js`, `test-tiers.js` |
| W14.5 | The live harness: tier parity per bucket, the scan's rate bound, the cache re-run, the views, the change mark, the declared hours basis | `tools/verify-live.mjs`, `tools/cdp.mjs` |

### W15 — Rank the board by pay ✅ (0.14.0)

D41, and the two things the user decided while it was scoped: sort only once a **deep scan run has ended**
("That's a lot cleaner"), and never convert a month into an hourly rate to make one list of it.

| ID | Task | Files |
|---|---|---|
| W15.1 | `salary-cards.js` publishes the figure it already computes as `data-ojc-pay`/`data-ojc-pay-unit` — the **low end** of a range, the same end every goal is judged on | `salary-cards.js` |
| W15.2 | The rank rule, pure and unit-tested: a month, then a posted rate, then no figure, each highest first, ties and the unranked block in the site's own order | `pay-sort.js`, `test-paysort.js` |
| W15.3 | The reorder, at the end of a salary pass (the one moment the keys are current) and **only when the order actually changed** — a reorder inside the rule pass is a pass that schedules the next one | `pay-sort.js`, `salary-cards.js` |
| W15.4 | The trigger: **any** end of a scan run, and sticky — pages the loader appends later are re-ranked, so the board does not silently degrade as you scroll | `scan.js`, `pay-sort.js` |
| W15.5 | The setting on both surfaces, its README row and its spec row; the live harness asserts the DOM order it produces and quotes the extension's own exceptions if it ever regresses | `panel.js`, `options.*`, `README.md`, `tools/verify-live.mjs` |

### W5 — Distribution (the original Task 8) → depends on W1, W3

| ID | Task |
|---|---|
| W5.1 | Decide D2; if the Store: privacy justification, screenshots, version story, changelog |
| W5.2 | Release checklist: gate green, live PASS on both list variants, README screenshots current |

---

### W6 — Perpetual pagination ✅ (0.5.0)

Asked for by the user as a convenience; adopted under D8 with the guards below, because "load more"
and "crawl" are one careless decision apart.

| ID | Task | Files |
|---|---|---|
| W6.1 | `pagination.js` with pure URL/count helpers + `test-pager.js` (four URL shapes, count parsing) | `pagination.js`, `test-pager.js` |
| W6.2 | Sentinel after the last card; **a real scroll since the last load is required**, one page in flight, 600 ms minimum gap | `pagination.js` |
| W6.3 | Stop conditions: no new job links, every result loaded, non-200, offline — each says why in the console and stops the loader for good | `pagination.js` |
| W6.4 | `autoLoad` setting in the panel and the options page; README row; the request-budget table in `docs/scraping.md` | `content.js`, `options.*`, docs |
| W6.5 | Live assertion: no requests while idle, exactly one request per scroll, card count grows, counts stay truthful, sentinel removed once stopped | `tools/verify-live.mjs` |
| W6.6 | Live assertion that the observer is *alive*: a card inserted after boot must be filtered on arrival (this replaced a proxy that counted chip rebuilds, and immediately exposed both an observer-ordering race and a stranded sentinel — see `docs/HANDOFF.md` §4d) | `tools/verify-live.mjs`, `pagination.js` |

Splitting the file also settled a cap argument: `content.js` hit 344 lines (the gate caps at 300), and
the honest split is "the extension that filters" vs "the code that fetches" — which is why
`content.js` now makes no request of its own.

## 6. Execution plan

### 6.1 Wave plan

| Wave | Contents | Parallelism | Exit gate |
|---|---|---|---|
| **0. Decide** | This document, §3 approved | — | D2/D3/D5 answered |
| **1. Say what it is** | W1.1–W1.7 ‖ (W1.1/W1.2/W1.4 ‖, then W1.3 → W1.6/W1.7) | 2 agents | README exists, gate covers it, hygiene test green |
| **2. Fix what the audit found** | W2.1 → W2.3 ‖ W2.4/W2.5, then W2.2, W2.6, W2.7 | 2 agents | the two §2 proofs flip; live PASS unchanged |
| **2b. Perpetual pagination** | W6.1 → W6.2 → W6.3 → W6.4 → W6.5 | 1 agent | shipped in 0.5.0: zero requests while idle, one per scroll, stops at the end |
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
- **Money is never approximate.** A monthly figure requires the listing to state a period amount, or an
  hourly rate with stated hours (D10). No fallback exists for unstated hours. A piece rate gets no figure
  (D11). A conversion uses a live rate or none at all. Where a figure cannot be honest, the card shows
  the posted rate or nothing and says why.
- **Silence is a bug.** A setting that does nothing, a scan that stopped early, a mutation loop that
  keeps running — all must be visible or impossible. A figure that cannot be computed explains itself in
  its tooltip rather than disappearing.
- **The page belongs to the site.** Injected UI is namespaced, removable, and must never alter the
  site's own DOM beyond `hidden` + our own classes.
- **Politeness is a feature.** No request the user did not ask for: with `autoLoad` off and nothing
  configured, the extension makes **zero** requests. With it on, one result page per real scroll to the
  bottom, 600 ms apart, one in flight, stopping on the first sign of an end. The deep scan spends 3
  concurrent / 400 ms and only for cards already loaded.
- **Nothing runs on an idle page.** No timers, no polling, no prefetch, no background worker. If the
  user does nothing, so does the extension.
- **Everything stays local.** Local storage, no server, no analytics.

---

## 8. Explicitly rejected / deferred (do NOT build)

Recorded so nobody re-proposes them. Each has a trigger that would change the answer.

| Rejected | Why | Revisit if |
|---|---|---|
| Paginating *without a button press* — a prefetch, a timer, or a page the user did not ask for | Walking the site for them is a crawler. A scan the user starts is a different thing, and it is bounded (D33) | never |
| Assuming a 40-hour week for a listing that does not state one | It turns part-time jobs into full-time money — measured live at ~2× on 7 of 12 hourly cards | never (D10) |
| Inferring a monthly figure from a piece rate (`$5 per entry`) | There is no honest monthly equivalent; the tiny-number heuristic produced ₱50,186/mo for a per-entry gig | never (D11) |
| A default or fallback FX rate when the live one fails | A stale ₱ number is a wrong number, and money decisions get made on it | the ECB feed disappears entirely |
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
| W6 | `pagination.js` (new), `test-pager.js` (new), `content.js`, `content.css`, `options.*`, `tools/verify-live.mjs` |
| W7 | `salary.js` + `salary-cards.js` (new), `test-salary.js` (new), `panel.js` (new, split from `content.js`), `content.js`, `content.css`, `options.*`, `manifest.json`, `tools/verify-live.mjs` |
| W8 | `rules.js`, `test-rules.js`, `content.js`, `content.css`, `salary-cards.js`, `panel.js`, `options.*`, `tools/verify-live.mjs`, `tools/cdp.mjs`, `README.md`, `docs/*`, `manifest.json` |
| W4 | `detail-text.js` + `test-detail.js` (new), `detail.js` (new), `rules.js` (`keywordRegex`), `content.css`, `content.js` (OUR_CLASSES), `manifest.json`, `tools/verify-live.mjs` |
| W9 | `closed.js` + `test-closed.js` (new), `closed-cards.js` (new), `content.js`, `content.css`, `detail.js`, `manifest.json`, `tools/verify-live.mjs` |
| W10 | `content.js`, `panel.js`, `options.html`, `options.js`, `README.md` |
| W11 | `tools/cdp.mjs`, `tools/verify-live.mjs` |
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
| `negative` | string[] | `[]` | Hide cards whose text contains any of these as an exact word or phrase (case-insensitive) | rule pass |
| `positive` | string[] | `[]` | Highlight matching cards (never hide) | rule pass |
| `noSalary` | boolean | `true` | Hide cards whose salary text contains no digit | rule pass |
| `showHidden` | boolean | `false` | Reveal what was hidden (chip toggle writes this) | rule pass, chip |
| `autoScan` | boolean | `false` | Deep-scan a list page as soon as it loads (W13). Off by default: the `Scan` button does the same thing on demand, and the extension's promise is that the site sees no traffic you did not ask for | `scan.js` |
| `scanWorth` | boolean | `true` | After the High yield listings, continue the scan into Worth considering and Highlighted ones (W13, D34) | `scan.js` |
| `scanAll` | boolean | `false` | …and then the unclassified and keyword-hidden listings. The only pass that can promote a listing matching no keyword and no goal, and the most expensive one | `scan.js` |
| `autoLoad` | boolean | `true` | Append the next result page when the user scrolls to the bottom (W6) | `pagination.js` |
| `goalSalary` | number | `0` (off) | Monthly PHP goal; cards at or above it brighten (W7) | `salary.js` |
| `goalHourly` | number | `0` (off) | Hourly PHP goal; posted rates at or above it brighten the card (W13, D13) | `salary-cards.js` |
| `maxAgeDays` | number | `7` | Hide listings posted longer ago than this many days (`0` = off, `7` = last week, `30` = last month). Read **before** every other rule; an unreadable date is never stale (W8) | rule pass |
| `rescueNoSalary` | boolean | `false` | With `noSalary` on: a listing that states no pay but matches a keyword you like (or beats a goal) is shown instead of hidden (W10, D30) | rule pass |
| `rescueNegotiable` | boolean | `false` | With `noSalary` on: a listing that says **Negotiable** or **DOE** and matches a keyword you like is shown with a `⚠ negotiable` tag instead of hidden (0.12.0). Separate from `rescueNoSalary` on purpose — a stated-negotiable listing is a real posting with an unstated figure, not the same thing as a listing that simply never mentions pay | rule pass |
| `sortByPay` | boolean | `false` | Rank the board by the figure on each card when a scan run ends: highest **monthly** figure first, then posted rates (per hour or per day), then the cards with no figure, in the site's own order (0.14.0, D41). Never converts a month to a rate or back — that would assume a work week (D13) — and the order is re-applied to pages the loader appends later | `pay-sort.js` |

Not in `settings`: two maps the extension collects rather than preferences the user sets, and both in their own
keys because `options.js`'s Save writes the whole `settings` object — a key in there is a key a Save can
silently drop.

- `closedJobs` (`chrome.storage.local.closedJobs = { "<jobId>": { at } }`) — the closed-listing memory
  (W9, D29), pruned at 180 days.
- `jobRecords` (`chrome.storage.local.jobRecords = { "<jobId>": { tier, prev, seen, at, checkedAt, sk,
  card, detail, fields } }`) — what the deep scan and every later re-check decided about a listing (W12,
  D35): the tier, the facts behind it, its own `HOURS PER WEEK` and WAGE, when it was last looked at, and
  whether it has moved since you saw it. Pruned at 180 days, capped at 1 000 entries, and the raw
  description it was derived from lives in IndexedDB (`detail-cache.js`, 7-day TTL, 1 000 entries) so a
  keyword edit re-derives the whole page with **zero requests** (D36).

`tools/check-readme.js` fails the gate if a key here is missing from the README's table.

## Appendix D — Test matrix

| Check | Offline? | Covers | Command |
|---|---|---|---|
| `test-rules.js` | ✅ | salary parsing, keyword matching, case, duplicates | `node test-rules.js` |
| `test-tiers.js` | ✅ | every branch of the verdict table, the unscanned parity rule, the tier movements a scan can cause, and that off-platform / over-40 are tags and never demote | `node test-tiers.js` |
| `test-paysort.js` | ✅ | the three blocks (a month outranks a rate outranks no figure), highest first inside each, the site's own order kept inside a tie and inside the unranked block, that the input array is not mutated, and every string the site could put in the two dataset fields that is *not* a figure | `node test-paysort.js` |
| `test-records.js` | ✅ | the memory's prune, entry cap, change state machine, idempotence, `canon` (key order is not data) and `sameFacts` (a card stored before a fact existed is not a change, and a real margin still is) | `node test-records.js` |
| `test-pager.js` | ✅ | next-page URL for all four list-URL shapes; "Displaying N out of M" parsing and its nulls; the recency horizon that stops the loader before a wholly stale page | `node test-pager.js` |
| `test-salary.js` | ✅ | the suite's real-data corpus plus live formats; the hours policy (no month without stated hours), piece rates, day rates, currency codes after digits, and the thousands comma however the poster grouped it (`35,0000`) | `node test-salary.js` |
| `test-manifest.js` | ✅ | every `chrome.*` namespace granted; referenced files exist; no orphan source; every setting reached by **both** settings surfaces (panel and options page) on all three legs — defaults, load and save | `node test-manifest.js` |
| `test-repo-hygiene.js` | ✅ | no LICENSE, README stance, SECURITY, templates, hook wiring | `node test-repo-hygiene.js` |
| `tools/check-readme.js` | ✅ | settings documented, no stale counts | `node tools/check-readme.js` |
| `tools/gate.sh` | ✅ | all of the above + syntax + path scan + size cap | `sh tools/gate.sh` |
| `tools/verify-live.mjs` | ❌ live site + browser | injection, selector drift, rule parity, `[hidden]`⇒`display:none`, chip toggle, panel open/save with no reload, an inserted card filtered on arrival + bounded rebuilds, pagination (idle = no requests, one per scroll, stops at the end), salary figures (recomputed with the same parser, the hours policy, piece rates left alone, one rate request per currency, goal marks exact); **W8**: recency parity + a watchdog on the date attributes, the computed yellow outline, `✗` badge parity, every branch forced to fire, and an inserted card that must turn yellow; **W4**: the detail bar's figure recomputed from the DOM with the same parser and the same cached rate, plus an inserted off-platform paragraph that must fire the link, email, redaction and ask detectors; **W9**: a closure injected before the extension boots, then asserted recorded and hidden on the board (and removed again by hand *and* by the snapshot — it teaches the memory a listing that is not closed); **W12/W13/W14**: every card's tier against the same verdict table recomputed with the remembered records, a scripted scan (nothing fetched before the button, 2 fetches per 350 ms at most, a second run re-reading only what the first could not), the declared hours basis against the cache and the card's words, the two tier views filtering exactly, and a seeded tier that must show `↑ promoted` and lose it when the listing is opened. **Real, hit-tested clicks** for the panel's gear and Save: `element.click()` cannot see a button that is replaced between mousedown and mouseup, which is how "clicking the settings button is broken" shipped past every synthetic click in this file | `node tools/verify-live.mjs` |
| CI (Node 20) | ✅ | `sh tools/gate.sh` — the same gate the pre-push hook runs, so CI and the hook can no longer disagree | `.github/workflows/ci.yml` |

## 9. What "done" looks like

A stranger opens the GitHub repo, reads a README that installs the extension in three clicks, sees a
screenshot of what it does, and finds every setting documented. They clone it, run one command
(`sh tools/gate.sh`) and everything passes. They load it unpacked on OnlineJobs.ph, and the no-salary
cards and their keywords are gone, with a chip that tells them the truth and a panel that edits the
rules in place. Nothing they type leaves their machine. No request is made until they ask for one.
Nothing in the repo claims something the code does not do.
