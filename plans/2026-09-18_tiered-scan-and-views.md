# Plan — 2026-09-18 — Tiered scan (preliminary pagination + deep scan) and the two view states

**Status:** PROPOSED — awaiting approval · **Targets:** 0.9.0 · **Waves:** W12 (memory + tiers),
W13 (scan engine), W14 (views + UI) · **New source files:** `tiers.js`, `records.js`,
`records-cards.js`, `sample-cache.js`, `scan.js` (+ `test-tiers.js`, `test-records.js`)

## Request (user's words)

> 1. Preliminary scan:
> - Paginates until end of "Hide jobs older than"
> - Then we can have you do a deeper scan where it opens every job listing (two at a time) and actually
>   enhances the current filters.
> - Order of priority of scans must be the high yields first, the very green ones. And then the "worth
>   considering" jobs.
> - Once the deeper scan is done, reclassify the job listings accordingly so they can be demoted or
>   promoted between the two.
> - Once reclassification is done, show the true high yields first, and have button(s) for me to switch
>   states from viewing the High yields listings and the worth considering listings.
> - The deeper scan of the lower yield ones and inclusion into the workflow may be optional.
>
> I think it's best the extension remembers the states and stats for each job listing link and every
> time each listing is opened, it double checks if there are any changes.

## Evidence gathered before designing (live, 2026-09-18, CDP `:9333`)

| Fact | Measurement |
|---|---|
| **The board is sorted newest-first, strictly, across pages** | `/jobsearch?jobkeyword=bookkeeper`, offsets 0/30/60/90/120: newest card per page `09-18 23:40` → `09-17 03:22` → `09-15 19:14` → `09-13 22:25` → `09-10 02:11`, monotonic decreasing. This is what makes "paginate until the recency horizon" a **one-page-lookahead** stop rule |
| Total result count is real and large | `Displaying 30 out of 300` on every offset of that search → the 10-page cap covers a full 300-result search |
| **A deep-scan fetch works exactly as W3 assumed** | `fetch('/jobseekers/job/…-1733870', {credentials:'same-origin'})` → **200, 44 871 bytes**; `p#job-description` = **3 370 chars**; `dl.row.no-gutters dd` parsed cleanly to `TYPE OF WORK` = Part Time, `WAGE / SALARY` = `$10 USD an hour`, `HOURS PER WEEK` = `15`, `DATE UPDATED` = Sep 18 2026 |
| The cost per listing is not trivial | ~45 KB × 300 listings ≈ **13 MB** for a full capped run. This is the number that justifies the caps and the Stop button |
| Every card carries 3 links to the same job | `a[href*="/jobseekers/job/"]` ×3 per card, 30 unique per page → the job id is the only safe dedupe key |
| The board's own sort control is not in the markup | `sort` controls found: **none** → the order cannot be changed by the extension, so reordering the DOM was correctly rejected |

## Decisions

Answered by the user, 2026-09-18:

| # | Question | Answer |
|---|---|---|
| **D31** | What the two tiers are | **Reuse today's marks.** High yield = green today (*good* = a positive keyword match or a met salary goal, with no hide-keyword match and no off-platform flag). Worth considering = yellow today (*good*, but also matches a hide keyword or carries an off-platform flag). Everything else unchanged |
| **D32** | How the two buttons change the board | **Filter, never reorder.** The other tier and every unclassified card are hidden while a tier is selected; the site's DOM order is never touched |
| **D33** | Scan budget | **Button-triggered and capped.** A `Scan` button starts it; it auto-paginates to the recency horizon, then deep-scans **2 at a time, 400 ms between pairs**, with `Stop`, and hard caps of **10 pages / 300 listings / 600 s**. Nothing runs unprompted |
| **D34** | Default scan scope | **High yield first, then Worth considering,** in one run; an optional third pass over everything else, off by default |
| **D35** | What a re-check does | **Silent update + a change mark.** The record is re-derived and stamped; a card whose tier moved shows `↑` / `↓` until that listing is opened |
| **D36** | What a settings change does to a scan | **Re-derive from the cached description — zero requests.** Cached text older than the 7-day TTL falls back to card-level rules and is marked "stale scan" |
| **D37** | Closures learned by the scan | **Yes.** The scan already has the page; `This job has been closed` records the closure exactly as opening it would |
| **D38** | The landing view | **All, until you pick.** The view choice lasts for the tab, not across sessions |

### Decisions this plan must overturn (explicitly, in `spec.md`)

| Old | New | Why |
|---|---|---|
| **D5** "3 concurrent, 400 ms between waves, current page's cards only — never paginate" | **2 concurrent, 400 ms between pairs, current page's cards plus pages fetched by the scan's own preliminary pass** (D33) | The user asked for exactly this, and the caps + Stop button are the replacement guarantee |
| **D8** "nothing without a real scroll gesture" | Paging without a gesture is allowed **only inside a run the user started by pressing Scan** (D33). Outside a run, the old rule is untouched: idle = 0 requests | One exception, one trigger, one place to audit |
| **§8 rejected** "Paginating *inside the deep scan*" | Rejected table becomes "**paginating without a button press**" | The property worth protecting is *no unprompted traffic*, not *no pagination* |
| **D29** "closure memory learned only when you open a listing" | The scan may also record a closure it passes (D37) | If we are fetching the page anyway, refusing to read its own notice would be superstition, not politeness |

## Design

### 1. The two tiers — one pure function, one decision table

`tiers.js` is pure (UMD, no DOM, no storage), unit-tested by `test-tiers.js`, and is the **only** place
a tier is decided. `content.js`'s rule pass calls it; `detail.js` calls it; the live harness calls it to
recompute the expected verdict from the DOM, exactly as it does for the current rules.

Inputs (all booleans/arrays, no settings object):

```
card   : { pos: [], neg: [], stale, noSalary, goal }     // what the card's own text says
detail : { pos: [], neg: [], flags: [], scannedAt }      // what a scan/cached description adds (or null)
good   : card.pos ∪ detail.pos  non-empty,  or  card.goal
bad    : card.neg ∪ detail.neg  non-empty
risky  : detail present and detail.flags non-empty
```

Verdict, **in this order** (the existing order is preserved, the new part replaces only the last two
branches, so an unscanned page behaves exactly as it does today):

| # | Condition | Verdict | Card |
|---|---|---|---|
| 1 | `closed` (unchanged slot, from `closed-cards.js`) | `closed` | hidden |
| 2 | `stale` | `stale` | hidden |
| 3 | `noSalary` and not rescued (unchanged, W10) | `nosal` | hidden |
| 4 | `good && !bad && !risky` | **`high`** | green outline + `✓ kw` badge |
| 5 | `good && (bad \|\| risky)` | **`worth`** | yellow outline + `✗ kw` / `⚠ off-platform` badge |
| 6 | `bad` | `kw` | hidden (or red when *Show all*) |
| 7 | `risky` | `flag` | white, with a `⚠ apply off-platform` badge |
| 8 | otherwise | `none` | untouched |

**Unscanned parity is a hard requirement.** With no record (or a TTL-expired one) rows 4 and 5 reduce
to `good && !bad` and `good && bad` — byte-for-byte the behaviour shipped in 0.8.0, which is what keeps
`verify-live`'s existing `ruleEval` parity section passing unchanged.

**How cards actually move once the description lands** (the reclassification the user asked for):

| Movement | Path |
|---|---|
| **Promote** white → high | the description matches a positive keyword the card's short text never had (the common case: the title says "Bookkeeper", the description says "QuickBooks") |
| **Promote** hidden → worth | a description positive rescues a hide-keyword card (row 5 instead of row 6) |
| **Promote** white → high, second path | `HOURS PER WEEK` from the listing replaces the 40 h/week *assumption*, the monthly figure becomes honest, and the card can then meet the monthly goal (see W13.5) |
| **Demote** high → worth | the description matches a hide keyword the card text did not have |
| **Demote** high → worth | the description asks you to apply off-platform (`forms.gle`, "email your resume", a redacted `----------`) |
| **Demote** high → flag | nothing to demote to when the card was never *good*: an off-platform ask on a plain card is shown, not hidden (row 7) — row 7 exists so the tool never silently drops that fact |

Badges are prefixed `⚠`, `↑`, `↓` and added to a small `.ojc-tier-badge` — **and to `OUR_CLASSES` in
`content.js`**, or the observer schedules itself forever (`spec.md` §2.2).

### 2. What is remembered per listing (D35)

One record per job id, in `chrome.storage.local.jobRecords` — the same shape and lifecycle as the
existing `closedJobs` map, because that pattern already works, is pruned, and is unit-tested:

```js
"1733870": {
  tier: "high",                    // the latest verdict (a string from the table above)
  prev: "worth",                   // the tier before the last move → drives ↑/↓
  seen: false,                     // has the change mark been viewed yet
  changedAt: 1758240000000,
  checkedAt: 1758240000000,        // last re-derivation (board pass or the listing's own page)
  at: 1758240000000,               // when the description was fetched
  card:   { pos: ["quickbooks"], neg: [], goal: true },
  detail: { pos: [], neg: ["crypto"], flags: ["offplatform"], hours: 15, php: 56230, type: "Part Time", closed: false }
}
```

Pruned at **180 days** and capped like `closedJobs` (one entry ≈ 250 B; 1 000 listings ≈ 250 KB). The
map is loaded once at boot into an in-memory copy the rule pass reads **synchronously**, exactly as
`closed-cards.js` does — the rules must never wait on a promise.

### 3. Where the description text lives

| Store | Holds | Why not the other one |
|---|---|---|
| **IndexedDB** `ojc` v1, store `details`, keyPath `id` | `{ id, url, at, desc, fields: { typeOfWork, wage, hoursPerWeek, dateUpdated }, closed }` — ~3.5 KB/listing | 1 000 listings ≈ 3.5 MB: too close to `chrome.storage.local`'s 10 MB shared quota, and every write there rewrites the whole blob (this is exactly what D3 already decided) |
| **`chrome.storage.local.jobRecords`** | the 250-byte verdict + stats above | It must be readable synchronously during a rule pass and cheap to load at boot; pulling 3.5 MB out of IDB on every page load is not |

TTL **7 days**, cap **1 000 entries**, oldest evicted on write. Re-derivation (D36) reads the text from
IDB for the ids on the current page only (≤300), so a keyword edit re-tiers the page with **zero
requests** and one bounded IDB read.

Two stores is one more than is comfortable; the alternative — verdicts *and* text in one place — either
puts 3.5 MB in the shared settings quota or makes every rule pass async. Both are worse, and this is
marked with a `# ponytail:` comment naming the ceiling.

### 4. The scan (D33/D34/D37)

```
press [ Scan ]
  │
  ├─ Phase 0  guard: a list page, and at least one of {negative, positive, goalSalary, goalHourly} set.
  │            (nothing to scan for otherwise → the note says so; the button does nothing else)
  │
  ├─ Phase 1  PRELIMINARY, pages, one at a time, ≥600 ms apart (reuses MIN_GAP_MS):
  │            fetch the next result page → import new cards → refreshRules()
  │            STOP when any of:
  │              • the newest card on the page just fetched is older than maxAgeDays   ← the horizon
  │                (valid only while the board stays newest-first: see the watchdog below)
  │              • a page contributes no new job ids        (the existing loader's rule)
  │              • the "Displaying N out of M" count is reached
  │              • 10 pages fetched this run               (hard cap, 300 cards)
  │              • Stop pressed / a non-200 / the watchdog fires
  │
  ├─ Phase 2  DEEP SCAN, 2 fetches at a time, 400 ms between pairs:
  │            queue = every card not hidden by rules 1-3, deduped by job id,
  │                    skipping ids whose cached detail is < 7 days old
  │            order = HIGH tier first, then WORTH, then (only if scanAll) the rest of `none`
  │            each result: IDB write → record update → closure learned if the page says so
  │                         → one refreshRules() per wave, so cards re-tier as results land
  │            STOP when any of:
  │              • the queue is empty
  │              • Stop pressed
  │              • a 429 or a network error (leaves the rest unscanned, never retries harder)
  │              • 300 listings fetched this run / 600 s elapsed       (hard caps)
  │
  └─ Done     note: "168 scanned · 9 promoted · 4 demoted · 1 closed · 22 cached · 0 failed"
```

- **The priority order is recomputed as the run proceeds**: after each wave the board re-tiers, so a
  card promoted by a description is never scanned twice, and the "high first" order self-corrects.
- **`Stop` keeps everything finished so far.** Pressing `Scan` again re-enters at the uncached ids —
  that is what makes a capped run resumable rather than restartable.
- **The board-order watchdog is a hard requirement, not a nicety.** The Phase-1 stop rule is *only*
  valid while the site sorts newest-first. Each fetched page's newest `data-temp-2` is compared with
  the previous page's; if it is newer, the scan stops and says `stopped: the board is no longer sorted
  by date`. Without this, a sort-order change on the site would silently turn "paginate to the horizon"
  into "skip half the results".
- **Concurrency is enforced in one place**: a tiny 2-slot worker over the queue with a single
  `await sleep(400)` per wave. There is no second fetch path anywhere in the extension.

### 5. Re-check on open (D35)

`detail.js` already reads `p#job-description`, `HOURS PER WEEK`, `WAGE / SALARY` and `TYPE OF WORK` for
the bar, and `closed-cards.js` already learns a closure there. W12 adds one step: run the *same*
`tiers.js` over the live page, compare with the stored record, and

- update `record.detail` + `checkedAt`;
- if the tier moved, set `prev`, `changedAt`, `seen = false`;
- if the listing is being opened, mark `seen = true` — **opening the listing is "viewing" it**, which is
  the simplest honest definition and needs no extra click target. The board's `↑`/`↓` mark therefore
  disappears on the next pass after you visit it.

The newly written description also refreshes the IDB entry, so a manually-visited listing is never
re-fetched by a later scan.

### 6. The views (D32/D38)

- One in-memory `view: 'all' | 'high' | 'worth'` in `content.js`, **session-only** (never persisted, so
  no new settings key and no cross-tab surprise).
- Applied at the **end** of the rule pass, after every hide/highlight decision: a card whose tier is not
  the active view is `hidden = true`. `Show all` does not override a view — the view has the last word,
  and the note line says which view is active so "why is my board empty" is answered on screen.
- The chip's counts stay **global** (they describe the page, not the view); each view button carries its
  own count so the two numbers cannot disagree.
- Buttons: `[ High yield 7 ] [ Worth considering 12 ] [ All ]`, the active one marked. Hidden cards
  count into neither tier, so the two view counts plus the hidden total reconcile with the card count.

### 7. UI changes (chip.js, ui.css)

```
┌──────────────────────────────────────────┐
│ 21 Hidden:                        ▾      │   (unchanged)
│   Hidden  ·  Stats                       │   (unchanged rows)
│ ─────────────────────────────────────────│
│  Views  [ High yield 7 ] [ Worth 12 ] …  │   NEW
│ ─────────────────────────────────────────│
│  168 scanned · 9 promoted · 4 demoted    │   NEW (note line, outside the fold)
│  [ Show All ] [ Scan ] [ Settings ]      │   NEW button, becomes [ Stop ] with a progress count
└──────────────────────────────────────────┘
```

- `Scan` is **disabled with a reason** when nothing is configured (the panel/README say why) — the same
  honesty rule W2 applied to `autoScan`, which is now **enabled** because W3 finally exists (D4's
  label "not built yet" comes off).
- Progress and outcome use the existing `#ojc-note` line, which already sits outside the collapsible body
  so folding the panel cannot hide it.

### 8. Settings

| Key | Type | Default | Meaning |
|---|---|---|---|
| `autoScan` | boolean | `false` | **Unchanged default.** Runs a scan automatically when a list page loads. Now functional; still off, because D33's promise is "nothing runs unless you press it" |
| `scanWorth` | boolean | `true` | Continue into Worth considering after High yield (D34) |
| `scanAll` | boolean | `false` | Also scan the unclassified cards (D34's optional third pass) |

`maxAgeDays` (already exists) is the Phase-1 stop rule; the 10-page / 300-listing / 600 s / 7-day-TTL
numbers stay **constants**, not settings, until someone actually wants to tune them.

## Files

| File | Change |
|---|---|
| `tiers.js` | **new** — pure decision table (§1) |
| `test-tiers.js` | **new** — every row of the table + unscanned parity |
| `records.js` | **new** — pure: prune, record, tier-change detection, the `↑`/`↓` state machine |
| `test-records.js` | **new** — pruning, 180-day cap, change detection |
| `sample-cache.js` | **new** — the IndexedDB store (open/migrate/get-many/put/prune/TTL/cap) |
| `scan.js` | **new** — the orchestrator (§4): phases, the 2-slot worker, caps, Stop, notes |
| `records-cards.js` | **new** — the applier: load at boot, in-memory copy, batched change-only writes, change marks |
| `content.js` | rule pass delegates to `tiers.js`; `view` filter; `OUR_CLASSES` += the new badges; exports for the scanner; **shrink** to stay under 300 lines |
| `chip.js`, `ui.css` | the Views row, the Scan/Stop button, the progress/outcome note |
| `pagination.js` | expose `loadOne()` for the scanner (gesture guard bypassed *only* for a run that was pressed); the watchdog helper stays pure for `test-pager.js` |
| `detail.js` | re-derive + update the record on a listing page; clear the change mark |
| `closed-cards.js` | accept a closure learned by the scanner (`remember(id)` already takes an id — no new fetch path) |
| `salary-cards.js` | (W13.5, optional) use a scanned `HOURS PER WEEK` for the monthly figure + the goal |
| `panel.js`, `options.html`, `options.js`, `README.md` | the three settings + the scan/views narrative |
| `manifest.json` | register the new files; version 0.9.0 |
| `tools/verify-live.mjs` | the new live assertions (§Verification) |
| `spec.md`, `docs/architecture.md`, `docs/HANDOFF.md` | W12–W14, the D5/D8/D29 amendments, the store/scan/observer traps |

## Waves

### W12 — memory and the tier decision (pure, offline, no network)

| ID | Task | Acceptance (the command that proves it) |
|---|---|---|
| W12.1 | `tiers.js` + `test-tiers.js`: all 8 rows, unscanned parity, and the 6 realistic movements of §1 | `node test-tiers.js` — RED first: write the table as assertions, watch it fail |
| W12.2 | `records.js` + `test-records.js`: prune at 180 days, idempotent re-derivation (same inputs ⇒ no change), tier-move detection sets `prev`/`changedAt`/`seen: false` | `node test-records.js` |
| W12.3 | `sample-cache.js`: IDB open/upgrade, `getMany(ids)`, `put`, 7-day TTL, 1 000-entry cap with oldest eviction | a node test with a stub `indexedDB`, plus a live IDB assertion in `verify-live` |
| W12.4 | `content.js` delegates to `tiers.js`; `verify-live`'s `ruleEval` is rewritten to call the same module | `sh tools/gate.sh` + `node tools/verify-live.mjs` — must stay PASS with **no** records present |
| W12.5 | `records-cards.js`: boot load, synchronous in-memory copy, change-only batched writes, `↑`/`↓` marks; new classes in `OUR_CLASSES` | live: one external mutation still produces a **bounded** number of chip rebuilds (existing assertion) and the record write count stays 0 when nothing changed |

**Exit gate:** offline tier parity is proven against the current shipper, the live harness is still green,
and nothing has been fetched yet.

### W13 — the scan

| ID | Task | Acceptance |
|---|---|---|
| W13.1 | `pagination.js` exposes `loadOne()`; `test-pager.js` pins the new horizon helper (`stopReasonFor(pageDates, maxAgeDays, prevNewest)`) and the watchdog | `node test-pager.js`; live: idle = **0** requests (existing assertion unchanged) |
| W13.2 | `scan.js` Phases 0-1: the button, sequential paging, the five stop conditions, the outcome note | live: press Scan on a short search; assert the page count, that the note names the stop reason, and that Stop aborts mid-run |
| W13.3 | `scan.js` Phase 2: the 2-slot/400 ms worker, priority order, per-wave `refreshRules()`, IDB writes, record updates, caps | live: ≤2 concurrent detail requests measured over **CDP `Network.*` events** (a page-world patch cannot see the content script's fetches), 429 stops the fleet, `Stop` keeps finished work |
| W13.4 | Closures learned by the scan (D37) | live: a seeded closed listing the scan passes is recorded and hidden without you opening it |
| W13.5 | *(optional, cuttable)* honest hours → honest goal: a scanned `HOURS PER WEEK` replaces the 40 h/week assumption for the card's month and its goal | `node test-salary.js` + live: a Part Time card with `15 h/week` and `$10/hr` is judged on an honest month, not on the hourly goal |
| W13.6 | Settings + panel + README rows for `scanWorth` / `scanAll`, and `autoScan` finally enabled | `node tools/check-readme.js`; live: the panel renders and saves all three |

**Exit gate:** the live harness proves 0 requests while idle, ≤2 concurrent during a scan, a capped run
that resumes for free, and a demo of the real end-to-end flow (press Scan → tiers move → press again →
the second run spends the cache).

### W14 — the views and the re-check

| ID | Task | Acceptance |
|---|---|---|
| W14.1 | The view filter in the rule pass + the chip's Views row (counts, active state) | live: the High view shows exactly the high cards and their count; `All` restores the page; the view survives a settings change |
| W14.2 | `detail.js` re-check: re-derive, update `detail`/`checkedAt`, clear `seen`, refresh IDB | live: open a listing with a standing record, assert the record changed and the board's `↑`/`↓` cleared |
| W14.3 | The docs pass: `spec.md` W12-W14 + the D5/D8/D29 amendments + the rejected-table edit; `README`; `docs/architecture.md`; `HANDOFF` traps | `sh tools/gate.sh`; every command in the docs re-run and its real output pasted in |

## Verification (what gets proven, and how)

Offline, added to `npm test` so CI inherits it:

- `node test-tiers.js` — the decision table, including "no record ⇒ identical to 0.8.0".
- `node test-records.js` — pruning, the change state machine, idempotence.
- `node test-pager.js` — the horizon stop rule, the newest-first watchdog.
- `node tools/check-readme.js` — the three new keys documented (already enforced).

Live, added to `tools/verify-live.mjs`:

1. **Tier parity** — recompute every card's tier from the live DOM with the same `tiers.js` and compare
   with what is on screen (extends the existing `ruleEval` section).
2. **Idle discipline** — with nothing pressed: **0** detail requests, and the existing 0 page requests.
3. **A scripted scan** — press `Scan` on a page whose window keeps it small; assert the progress note,
   the ≤2 concurrency ceiling over CDP network events, that every fetched id landed in IDB and in
   `jobRecords`, and that a **second** press spends 0 detail requests.
4. **Reclassification is visible** — a seeded description containing a hide keyword demotes a green card
   to yellow; a seeded description containing a positive keyword promotes a white card to green.
5. **The views** — the High view's visible set equals the recomputed high set; `All` restores it.
6. **The change mark** — a seeded tier move renders `↑`/`↓`; visiting the listing clears it.
7. **The watchdog** — a synthetic "newer card on a later page" input makes the scan stop with the
   sorted-by-date message (offline, in `test-pager.js`).

Every one of these must be shown able to **fail** before it is trusted (`spec.md` §6.3.4): state the
command and paste the red output in the commit message.

## Risks and traps to write into `docs/HANDOFF.md`

| Risk | Mitigation |
|---|---|
| **A record write storm.** The board re-derives tiers on every rule pass; writing `jobRecords` per pass would hammer storage and re-trigger `onChanged` in a loop | Writes happen **only** when a tier actually moves, batched into one `set` per pass; the change-only check makes our own `onChanged` echo a no-op |
| **The observer eats the new badges** | every new class goes into `OUR_CLASSES` (`.ojc-tier-badge`, `.ojc-flag-badge`, the view buttons' ids are `ojc-`-prefixed and already covered) |
| **The 300-line cap forces splits mid-task** | planned up front: 5 new files, plus a shrink of `content.js`; a red gate is never committed |
| **The horizon rule depends on site behaviour** | the newest-first watchdog stops the run loudly instead of silently skipping results |
| **`hidden` is a site-owned attribute** | the view filter sets `hidden` only, never styles the site's nodes; attributes are not observed, so no observer loop |
| **IDB is async, the rules are sync** | one boot load into memory, then a `refreshRules()` — the exact pattern `closed-cards.js` already uses and W9 already proved |
| **First run is not cheap** | ~13 MB / 300 requests worst case, bounded by the caps, visible in the note, abortable with Stop, and free on every later run |

## Open items for the user (not blocking; defaults stated)

1. **Does the scan's first run on a broad search being ~150 requests / 7 MB feel acceptable?** The caps
   can be lowered without touching anything else (one constant).
2. **The `↑`/`↓` change mark clears when you open the listing** (D35 read literally). If you would
   rather it clear on *click* or on *viewing the card in a tier view*, that is a one-line change.
3. **`scanAll` (the third pass over unclassified cards)** ships off. Turning it on is the only way a
   listing with no keyword and no goal can ever be promoted — say the word and the default flips.
