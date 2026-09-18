# Plan — 2026-09-18 — Recency filter + "reconsider" (yellow outline)

**Status:** PROPOSED — awaiting approval · **Targets:** 0.7.0 · **Files:** `rules.js`, `content.js`,
`content.css`, `panel.js`, `options.html`, `options.js`, `tools/verify-live.mjs`, `README.md`,
`spec.md`, `docs/*`, `manifest.json` · **No new source file.**

## Request (user's words)

> If a job listing has good pay or positive keywords AND has negative keywords in it, it should have
> yellow outline. That way I can reconsider those listings.
>
> Now we need a new feature. Recency. Basically the job listings have to be recent. The filter can be
> until last week, month, and then custom number of days. That way stale listings are automatically
> filtered out. This one should be the primary filter out of everything.

> Also please dont overwrite my current settings.

## Evidence gathered before designing (live, 2026-09-18, CDP `:9333`)

| Fact | Measurement |
|---|---|
| The posted date is on every card | `p[data-temp]` — 30/30 cards, on a keyword search, a category page, and two `/offset/` pages |
| Its shape | `<p class="fs-13 mb-0" data-temp="2026-09-19 01:33:33" data-temp-2="2026-09-18 17:33:33"><em>Posted on 2026-09-19 01:33:33</em></p>` |
| `data-temp-2` is **UTC** | At 17:54 UTC the newest card read `17:33:33` (21 min old); `data-temp` is the same instant at **UTC+8 (Asia/Manila)** |
| Why that matters here | This machine is `America/Denver` (UTC−6). Parsing the *visible* string as local time would mis-date every card by **14 hours** |
| The filter has real teeth | Page 1 is always fresh (keyword search max 1.24 d; category max 0.03 d), but a deep page is not: `jobsearch/270?jobkeyword=bookkeeper` → **40–46 days old**, 26 cards |
| The extension is already `autoLoad: true` | So the user does reach those deep pages today |

Not a single request is added by this feature: the date is in the markup the page already served.

## Decisions

Answered by the user:

| # | Question | Answer |
|---|---|---|
| **D15** | A negative-keyword card that also looks good | **Shown**, with a solid **yellow** outline — not hidden. Reconsidering it must not require toggling `Show all` |
| **D16** | What "good pay" means | The **existing salary goals** (`goalSalary` / `goalHourly`), one goal per card (D13). Goals off ⇒ only positive keywords rescue a card |
| **D17** | Default window | **7 days** (last week) |

Derived, and stated so they can be overridden:

| # | Decision | Why |
|---|---|---|
| **D18** | Recency is the **first** rule, and first in the chip: `stale → noSalary → negative → positive` | "Primary filter out of everything." A stale listing is hidden even if it would otherwise be yellow |
| **D19** | A card whose date cannot be read is **never hidden**, and is counted in the chip | §7 "never hide a listing by accident" — a broken date parse must not cost a fresh job |
| **D20** | Timestamps are read from **`data-temp-2` as UTC**, falling back to `data-temp` as **+08:00** — never as the machine's local time | The one thing a naive implementation gets wrong on this machine (14 h) and on any non-PH machine |
| **D21** | **One number field** (`maxAgeDays`, days, `0 = off`) covers all three asked-for presets: 7 = last week, 30 = last month, any N = custom | Three settings stores for one threshold is the over-build; the presets are named in the label |
| **D22** | `tools/verify-live.mjs` must **snapshot and restore** `chrome.storage.local` around every run | It seeds settings into the user's daily-driver profile and today never puts them back — a real data-loss bug, not a nicety |
| **D23** | Thresholds are strict (`age > maxAgeDays`), so "7" means *within the last 7 days* | Rolling window, not a calendar week; the boundary is pinned by a test |

## Design

**Rule pass order** (`content.js`), first match wins:

```
stale → noSalary → negative∧good → negative → positive → nothing
                   └ yellow, shown
```

- `good` = a positive-keyword match **or** the card carries `.ojc-goal` (set by `salary-cards.js`).
- `.ojc-goal` is owned by `salary-cards.js`; the rule pass only *reads* it.
- The pass stays idempotent: `ojc-neg`, `ojc-pos`, `ojc-recon` and the `✓` badge are stripped first.
- Counting follows the order, as today: with `noSalary` off, a no-salary card re-files into the
  keyword bucket — a predicted count must never be computed by adding buckets.

**The ordering trap, and its fix.** `refreshRules()` calls `OJCSalaryUI.annotate()`, which is async
(it awaits live ECB rates) and is what sets `.ojc-goal`. On the first pass of a page the marks do not
exist yet, so a good-pay negative match would be hidden — and nothing would re-run the pass, because
`annotate()`'s own DOM writes are recognised as ours and never schedule anything. Fix: `annotate()`
reports whether any goal mark *changed*, and only then calls `api.refreshRules()` once. The re-entrant
`annotate()` returns immediately on its `running` guard, so it is exactly one extra pass and cannot
loop. Without this the feature is off by one pass on every page load.

**CSS.** `.ojc-recon` must beat `.ojc-goal` (a yellow card *is* above goal, so it carries both
classes): declared **after** the goal block, with the same `.card-hover-default.ojc-recon, .ojc-recon`
specificity, and overriding the background wash too — otherwise a "reconsider" card keeps the goal's
green outline and the yellow never shows. The card also gets a `title` explaining itself (silence is a
bug), cleared only while our own class is still present so the site's own attributes are never touched.

**Chip:** `N hidden (a stale, x no salary, y keywords, z highlighted, w to reconsider)`.

## Tasks

Each task: test first (RED), then implement (GREEN). One commit each. `sh tools/gate.sh` before each.

### R1 — pure recency maths in `rules.js` (+ `test-rules.js`) ‖

`parsePosted(value, utc)` → epoch ms | `null`; `isStale(postedMs, nowMs, maxAgeDays)` → bool.
Kept in `rules.js` rather than a new module: it is a pure rule that decides hiding, needs no DOM and
no network, and a ninth file would only cost a manifest entry and a gate change.

Tests (all must fail before the code exists):
- `2026-09-19 01:33:33` UTC vs the Manila fallback: exactly 8 h apart; the Denver-local reading of the
  same string differs by 14 h — the assertion that pins D20.
- `null` / `''` / `"Posted on today"` / `"2026-13-45 99:99:99"` (rollover must be rejected, not
  silently accepted as a different date) → `null`, and `isStale(null, …) === false` (D19).
- Boundary: age exactly `7.000` days is **not** stale, `7.001` is (D23); `maxAgeDays = 0` is off; a
  future timestamp is never stale.

**Verify:** `node test-rules.js`

### R2 — the rule pass, the selector, the chip (`content.js`, `content.css`) ‖

`SELECTORS.cardPosted = 'p[data-temp]'`, `POSTED_ATTR = 'data-temp-2'`, and the fallback offset as a
named constant; `maxAgeDays: 7` in `DEFAULTS`; one `Date.now()` per pass so every card is judged
against the same instant; the reordered branch chain; `chipCounts.recon`.

**Verify:** `node test-manifest.js && node tools/check-readme.js` (the new key must be documented —
the README row lands in R6, so this check is expected to be RED until then), and `sh tools/gate.sh`.

### R3 — the goal-mark seam (`content.js`, `salary-cards.js`) → R2

`annotate()` returns/reports "goal marks changed", `refreshRules()` re-enters once. Comment the guard
where it is, because the next reader will otherwise "simplify" it away.

**Verify:** live — a page whose first paint has a good-pay negative match must end up yellow, not
hidden, **without** any further DOM activity.

### R4 — styles (`content.css`) ‖

`.ojc-recon`, after `.ojc-goal`.

**Verify:** live — a recon card's computed `outline-color` is the yellow, not `#5d8a46`.

### R5 — both UIs (`panel.js`, `options.html`, `options.js`) ‖

One number input each, placed **first** in the panel (it is the primary filter): "Hide jobs posted
more than this many days ago (0 = off · 7 = last week · 30 = last month)".

**Verify:** live — panel field loads the stored value; Save reaches the listing with no reload.

### R6 — harness: stop clobbering, then assert (`tools/verify-live.mjs`) → R2, R3

1. **D22 first, on its own**, and prove it: read the user's settings, run the harness, read them again
   — identical. `fail()` must restore too, not only the happy path. `settings`/`fx` absent before the
   run ⇒ removed after it, not seeded with `{}`.
2. Inject `rules.js` into the page (`fs.readFileSync` + evaluate, as `salary.js` already is) so
   recency is recomputed with the **same** parser — a parity check, not a second opinion.
3. Watchdog, in the §2.1 spirit: **every** card must yield a readable timestamp, and `data-temp-2`
   must be present (falling back to the wall clock is a silent timezone dependency — say so loudly).
4. Section: recency parity — with `--max-age=N`, hidden-by-recency equals the recomputed stale count,
   and every stale card is the one hidden. **Proof this can fail:** today's harness has no such
   assertion, so a run on the stale deep page reports `hidden 0`.
5. Section: reconsider — own tab, own seeded settings (`negative:['the']` so the branch is reachable,
   `goalSalary:1, goalHourly:1` so every readable salary is "good pay", **`maxAgeDays:0`** so recency
   does not confound it). Assert per card: a negative match with a goal mark is **visible** and
   carries `.ojc-recon`; a negative match without one is hidden; counts match. Restore afterwards.

**Verify:** `node tools/verify-live.mjs --url="https://www.onlinejobs.ph/jobseekers/jobsearch/270?jobkeyword=bookkeeper"`
(RED before R2: 0 hidden by recency. GREEN after: ~26.) and the default keyword-search run.

### R7 — docs and the version (`README.md`, `spec.md`, `docs/*`, `manifest.json`) → all

- `README.md`: "Three rules" → four, recency first; the yellow-outline section; the `maxAgeDays` table
  row; the chip wording; the `rules.js` files-table row.
- `spec.md`: D15–D23 in §3, workstream **W8** table, rule order in §4.2, DOM contract in §4.3,
  Appendix B (the date attribute), Appendix C (`maxAgeDays`), Appendix D (the new assertions).
- `docs/architecture.md` — the rule-order section (`stale → noSalary → negative → positive`, first
  match wins, why the count re-files), the injected-UI contract (`.ojc-recon`).
- `docs/scraping.md` — the DOM table row, and one line stating the request budget is **unchanged**:
  the date is already in the page, so recency costs zero requests.
- `docs/HANDOFF.md` — version 0.7.0, the rule order, the `data-temp-2`-is-UTC trap (and that this
  machine is not Asia/Manila), the goal-mark ordering trap, and the harness's new restore behaviour.
- `manifest.json` — `0.7.0`, description mentions stale listings.

**Verify:** `sh tools/gate.sh` (README truth + hygiene) and `node tools/verify-live.mjs` on both a
keyword-search URL and a category URL.

## Risks

| Risk | Handling |
|---|---|
| Yellow never appears because `.ojc-goal` arrives one pass late | R3, and the live assertion in R6.5 fails loudly if the marks and the outline disagree |
| `.ojc-goal`'s green outline wins over the yellow | R4 declared after the goal block at equal specificity, asserted on the computed style |
| The new default (7 days) silently hides listings the user was already reading | Intended (D17/D18), but it surfaces in the chip as `N hidden (a stale, …)`, and `Show all` reveals them. Called out explicitly in the README |
| A live run wipes the user's keywords/goals | D22 — snapshot + restore, asserted by reading the settings before and after |
| A stale date parse hides a fresh job | D19 + rollover rejection + the "unreadable ⇒ not stale" test |

## Out of scope

W3 deep scan and W4 detail banner (unchanged). No new request of any kind. No new dependency, no new
source file, no build step.

## Definition of done

`sh tools/gate.sh` green; `node tools/verify-live.mjs` PASS on a keyword search **and** a category
page; the stale deep page shows ~26 recency hides; the yellow branch asserted live; the user's
settings byte-identical before and after; `spec.md`/README/docs updated; version 0.7.0.
