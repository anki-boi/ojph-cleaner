# Architecture

A Chrome MV3 extension, ~250 lines of source, no build step, no dependencies. Four moving parts and
one rule: **pure logic never touches the DOM**.

```
manifest.json          ── injects on onlinejobs.ph only
   │
   ├─ rules.js         pure: hasSalary(), matchKeywords()      ← test-rules.js
   ├─ tiers.js         pure: the verdict table (W12)            ← test-tiers.js
   ├─ records.js       pure: the job memory's state machine     ← test-records.js
   ├─ page.js          the site's list markup, in one place
   ├─ content.js       the hub: settings, rule pass, counts, views (no network)
   ├─ observer.js      the MutationObserver, and isOurs()
   ├─ salary.js        money: the parser and formatters (pure)    ← test-salary.js
   ├─ salary-cards.js  applies it: ECB rate, card figures, hours, goals
   ├─ detail-parse.js  one reader for a listing's own page
   ├─ detail-cache.js  IndexedDB: the listing's own words (7-day TTL)
   ├─ records-cards.js applies the memory: verdicts, change marks
   ├─ scan.js          the deep scan (W13)
   ├─ pagination.js    loading: the sentinel + the scan's loadOne  ← test-pager.js
   ├─ closed.js/.cards.js  the closed-listing memory
   ├─ detail-text.js   pure: the highlight planner               ← test-detail.js
   ├─ detail.js        the listing's own page
   ├─ chip.js          the status panel (persistent buttons)
   └─ panel.js         the in-page options form (no rule logic at all)
options.html/js        standalone settings page (same storage, same effect)
```

## The verdict table (W12–W14)

One pure function decides what every card is (`tiers.js`), and the order is the product:

```
closed → stale → no salary (unless rescued) → HIGH YIELD → worth considering → highlighted → keyword-hide → nothing
```

- **HIGH YIELD is about pay.** `money && !neg` — a goal met, and no keyword you asked to hide. A keyword you
  like is a bonus badge, never the reason: the user's correction, after a version where it was the reason,
  was *"having matched positive keywords does not make the job listing high-yield. It's either passing salary
  or passing salary with positive keywords"*.
- **Worth considering** is `good && neg`: a hide keyword on a listing that still looks good (pay, or a keyword
  you like). Shown in yellow, never hidden.
- **Highlighted** is `pos` with no goal met — the green outline this extension has always drawn, in its own
  bucket so the chip can count it and the High yield view can exclude it.
- **Off-platform asks and over-40-hour weeks are tags**, not inputs: `detail.flags` and `detail.warns`, shown
  on the card and recorded in the listing's stats, and they never move a card between tiers.

With no `detail` — a page the scan has never touched — the table reduces to 0.8.0's verdicts exactly, which is
what makes the whole feature additive: an unscanned page behaves as it always did.

The memory (`records.js` + `records-cards.js`) holds one record per listing: its tier, the facts behind it,
its own `HOURS PER WEEK` and WAGE, when it was last derived (`at`), last looked at (`checkedAt`), and whether
it has moved since you saw it (`prev`/`seen`). The raw description lives in IndexedDB for 7 days, so a keyword
edit re-derives the whole page with zero requests. **`canon()` is load-bearing**: `chrome.storage` hands keys
back in its own order, so every comparison of a record against itself after a round trip sorts its keys first.

## Layers, and why the split is where it is

**`rules.js` is pure.** `hasSalary(text)` and `matchKeywords(text, keywords)` take strings and return
values. No DOM, no storage, no timers — so `test-rules.js` can assert the interesting cases
(`TBD`, `N/A`, `DOE`, `$1,000/month (DOE)`, case-insensitivity) in milliseconds, offline. The same
split exists upstream in the sibling project's `scraper/parsers.py`, for the same reason.

**`content.js` owns every coupling to the page, and makes no request.** The selectors live in one
`SELECTORS` object at the top so site drift is a one-line fix, and `tools/verify-live.mjs` replicates
the same rules from the live DOM to check the result independently. All network code lives in
`pagination.js`, which is also the only file that can grow the page's card list.

**One job per file.** `content.js` is the hub — it owns the settings, the rule pass and the counts — and
publishes a small API (`self.OJC`). Everything else is loaded around it and talks to it only through that
API, or takes its data as arguments: `rules.js` (pure rules), `detail-text.js` (pure highlight planning),
`closed.js` (pure closed-memory maths), `chip.js` (the status panel), `salary.js` + `salary-cards.js`
(money), `closed-cards.js` (the memory's storage and marks), `pagination.js` (loading), `panel.js` (the
options form) and `detail.js` (the job's own page).

Each was split out when a file reached the gate's 300-line ceiling, and each split has a second
justification. The pure ones are unit-testable offline (the rules, the money maths, the pager's URLs, the
highlight planner, the memory's pruning). The appliers own one external system each: `pagination.js` is
the only file that can make a request, `closed-cards.js` is the only one that writes the memory, and
`panel.js` owns no rule logic, so a change to the form cannot alter which listings are hidden. `chip.js`
and `ui.css` were split out together when the panel outgrew a single line: the status UI is the part that
keeps growing, and none of it can change a verdict.

The styles follow the same line: `ui.css` is what floats over the page (the status panel and the options
panel), `content.css` is what is painted on the site's own elements (card marks, salary notes, the detail
page's highlights and bar).

**`pagination.js` is a second content script, not a module.** It needs the DOM, the settings and the
rule pass, so it talks to `content.js` through one small API (`self.OJC`: selectors, `cards()`,
`refreshRules()`, the note setter, the settings getter) and publishes `self.OJCLoader.arm()/stop()`.
Its pure URL and count maths is exported separately (`self.OJCPager`) so `test-pager.js` can pin it
without a browser — the same split as `rules.js`. The interface is deliberately tiny: it must not
grow into a second copy of the rule pass.

**Storage is the only channel between contexts.** Settings live in `chrome.storage.local.settings`;
`chrome.storage.onChanged` is broadcast to the content script *and* the options page, so both UIs stay
in sync and neither needs a message protocol. (A background message proxy once existed here as a
workaround for what was actually a missing `storage` permission — see `docs/HANDOFF.md` §4. Do not
reintroduce it.)

## Rule order (observable, do not reorder)

```
closed → stale → noSalary (unless good, if rescued) → negative (unless good) → positive → nothing
```

First match wins. This is not an implementation detail: with `noSalary` off, a no-salary card that
also matches a negative keyword is counted in the keyword bucket, so a predicted count computed by
adding the two buckets is wrong. Measured on a live page: 5 no-salary + 16 keyword = 21, but with
`noSalary` off the same page hides **20** as keywords. `tools/verify-live.mjs` recomputes that
expectation from the DOM in the same order (`ruleEval`) rather than by arithmetic — and it now takes the
remembered-closed ids as an argument, because a predicted total that ignores the first rule is wrong by
exactly the number of remembered listings.

**`closed` is first** (W9 / D29): a listing you have already seen close is hidden before anything else
looks at it. It is a fact about the listing, not a judgement about it, so it outranks the recency window
and every keyword. The ids come from `chrome.storage.local.closedJobs`, learned only from a listing's own
page, pruned at 180 days.

**Recency comes next**, and deliberately above the reconsider state: a stale listing is hidden even if it
matches a positive keyword or pays above the goal. Its timestamp comes from `data-temp-2` (UTC), falling
back to `data-temp` at the site's own +08:00 — never the machine's local zone. A card whose date cannot
be read is never stale, because the one rule that runs before everything else must not be the rule that
loses a listing.

**`good` is the reconsider signal** (spec.md D15/D16): a positive keyword match, or `.ojc-goal` — the
mark `salary-cards.js` puts on a listing at or above a goal. A negative match that is also `good` is
**shown** with a yellow outline and a `✗ keyword` badge instead of being hidden. `.ojc-goal` is owned by
`salary-cards.js`; the rule pass only reads it, and because those marks arrive a pass late (they wait on
the live ECB rate) `annotate()` asks for one extra pass when a mark moves. Without that, a listing that
is good only because it pays well stays hidden.

**The no-salary rescue reuses the same `good`** (W10 / D30) and is off by default: when `rescueNoSalary`
is on, the no-salary branch yields and the card falls through to the keyword rules, so it ends green (or
yellow) rather than gone. Nothing new decides what "looks good" means.

Positive keywords **never** hide. A false positive costs a real job listing, which is the one mistake
this extension must not make.

## The detail page (W4)

Two files, because the planner is worth testing without a browser:

- **`detail-text.js`** — pure. `plan(text, cfg)` returns sorted, non-overlapping `{start, end, kind, rule}`
ranges. It owns two judgements: **red beats green** (a warning is placed before negative and positive
keywords, so "send your AI portfolio" cannot hide its own warning), and **an ask is not a tool** (a
messaging tool counts only in the same sentence as an application ask — 3 of 7 live phrase hits were
Telegram as job content).
- **`detail.js`** — the applier. One `TreeWalker` over `p#job-description`, wrapping each range in
`.ojc-hl-pos` / `.ojc-hl-neg` / `.ojc-hl-warn` with a `title` naming the rule. **Idempotent by
construction**: our spans are unwrapped (and the node normalised) before every pass, because a settings
change re-runs it and re-wrapping would fragment the description. `verify-live` asserts the mark count is
stable across repeated passes.

`keywordRegex` lives in `rules.js` and is used by both the card matcher and the highlighter: the page must
highlight exactly what the board hides, and a second copy of the pattern is a second answer. The figures
bar reuses `salary.js`'s parser and `salary-cards.js`'s cached rate loader, so a peso listing still makes
zero requests, and `HOURS PER WEEK` from the overview replaces the 40 h/week assumption whenever the
listing states one (D28).

## The closed-listing memory (W9)

`chrome.storage.local.closedJobs = { "<jobId>": { at } }`, pruned to 180 days on every write, with
`closed.js` pure and `closed-cards.js` the applier (the same split as `salary.js` / `salary-cards.js`).

The rule pass reads an in-memory copy synchronously, so the memory is loaded once at boot and the rules
re-run after it arrives. **`remember()` is a read-modify-write, not a write of the in-memory copy**: two
tabs can each hold a map that predates the other's closure, and a blind write deletes the other's memory.
Measured live: five closings, one survivor. The remaining window is one get→set, and a lost update costs
one remembered listing that the next visit re-learns — a transaction would cost a background worker, so
this is the deliberate ceiling.

The saved-jobs page is a React table with different markup, and it renders in batches: a one-shot
rAF guard dropped the mutations that arrived mid-render and left rows unmarked (1 of 3). It re-marks on a
trailing debounce instead, and our own badge/class is ignored so it cannot loop.


## The injected UI contract

- Everything injected is namespaced: `#ojc-chip`, `#ojc-panel`, `#ojc-detail-bar`, `.ojc-pos`,
  `.ojc-neg`, `.ojc-recon`, `.ojc-closed`, `.ojc-pos-badge`, `.ojc-neg-badge`, `.ojc-closed-badge`,
  `.ojc-closed-row`, `.ojc-hl-pos`, `.ojc-hl-neg`, `.ojc-hl-warn`. The extension never restyles the
  site's own elements.
- **The status UI is a panel, and it can fold.** `chip.js` owns its DOM and rebuilds it wholesale on every
rule pass — the pass owns the numbers, and a number left behind by a partial update is the same class of
bug as an injected mark that `isOurs()` cannot recognise. It is a sibling of the options panel, not a
parent, and the loader's note (`#ojc-note`) sits outside the collapsible body so folding the panel away
cannot hide the line that says what just happened.
- **Every injected class must be in `isOurs()`'s `OUR_CLASSES`.** A badge added by the rule pass is a real
  DOM mutation, and if `isOurs()` cannot recognise it the pass schedules itself forever (§2.2). Adding a
  badge means adding it here too — `.ojc-neg-badge` cost one line in two places, and forgetting the
  second is a 400-pass/second page.
- **The panel is a sibling of the chip, never a child.** `renderChip()` sets `chip.innerHTML = ''` on
  every rule pass; a panel nested inside would be destroyed while the user is typing in it.
  `verify-live` asserts the panel is *not* inside the chip.
- **The rule pass must be idempotent.** It removes its own classes and badges from every card before
  re-applying them, so running it twice changes nothing.
- **`isOurs()` is what keeps the observer from eating itself.** It must recognise the chip, the panel
  and both badge classes. The subtle part: a *removed* node is already detached, so walking
  `parentNode` from it never reaches the chip. The mutation's **target** is the reliable signal —
  for a chip rebuild the target *is* `#ojc-chip`, still attached. Getting this wrong produced a
  self-sustaining loop measured at 1 614 chip rebuilds in 4 seconds (`spec.md` §2.2). The live
  harness now asserts that one external mutation causes a *bounded* number of passes.

## Settings flow

```
panel Save ─┐
chip toggle ─┼─→ settings = {...}  (synchronous)  ─→ refreshRules()  ─→ page repaints
options page ┘                  └─→ persist()  ─→ chrome.storage.local
                                                        │
                                        chrome.storage.onChanged (both contexts)
                                                        ↓
                                              applySettings() ─→ refreshRules() + syncPanel()
```

`refreshRules()` runs **before** the storage write on purpose: the write is durability, not the
trigger, so the listing repaints on click instead of after a round trip. The `onChanged` echo that
follows is a harmless no-op re-run. `syncPanel()` mirrors external changes into an open panel without
clobbering a field the user is typing in.

## Live loading (W6)

```
scroll (arms) ─→ sentinel visible? ─→ one fetch of the next result page
                                        │
              no new job links / non-200 / everything loaded → STOP (and say why)
              otherwise → importNode each card into the card container → refreshRules()
```

The sentinel sits after the last card. Two guards matter and both exist because of failure modes seen
in the wild rather than in theory:

- **Loading needs a real scroll since the last page** (`armed`). Hidden cards make the list short, so
the sentinel can be on screen without the user doing anything — without this guard the extension
would pull the entire result set on its own, which is precisely the behaviour the project refuses.
- **A page with no new job links ends the loader**, regardless of what the "Displaying N out of M"
  counter says. The counter is a hint, not a licence to keep fetching.

Injected cards are ordinary page nodes: the mutation observer sees the insertion, `refreshRules()`
re-runs over the larger set, and the chip's counts stay truthful because they are always recomputed
from the DOM rather than tracked incrementally.

One `MutationObserver` on `document.body`: child list + subtree + character data. Mutations produced
by our own UI are ignored via `isOurs()`; everything else is coalesced into a single rule pass per
animation frame (`ticking` guard) so a burst of insertions costs one pass, not one per node.

## Money figures (W7)

`salary.js` answers one question — *what does this listing actually pay per month?* — and its most
important output is an admission of when it cannot answer.

```
page DOM ─→ rawSalary()  (the site's text only: our own note is stripped from the clone)
              │
              ├─ parseSalary()          pure · test-salary.js
              │     currency (a 3-letter code beats a symbol) · unit · piece rate? · monthly?
              │
              └─ hoursPerWeekFrom(card text)   "20 hours per week" → 20 · "Full Time" → 40 · else null
                        │
                 toPhp() ── monthly figure      (only when parsed.monthly)
                 ratePhp() ─ the posted rate    (per hour / per day, when no month may be claimed)
                        │
                 ECB rate once per currency per 24 h → chrome.storage.local.fx
```

**The honesty flags are the design.** `parseSalary` returns `{ min, max, currency, unit, hours,
perUnit, monthly }`, and `monthly` is false whenever a month would have to be invented:

| Listing says | Result |
|---|---|
| `PHP 30,000`, `$800-$1200/mo`, `$150 weekly`, `US$6000 annual` | monthly figure — a period amount converts by arithmetic alone |
| `$5/hour` + "20 hours per week", or a Full Time badge | monthly figure — the hours are the listing's own |
| `$5/hour` on a Part Time card, or with hours unstated | **`≈ ₱314/hr`** — the rate, no month claimed |
| `Php 1000/day` | `≈ ₱1,000/day` — days per week is never stated |
| `$5 per entry`, `$2/article` | **nothing** — a piece rate has no monthly equivalent |

Two rules are load-bearing, and each was found by a live card rather than by reasoning:

- **"Part Time" states no number, so it must not become one** — and it is checked *before* "full time*,
  because a part-time card whose prose said "full time availability" was handed a 40-hour month
  (`$6/hour` → ₱60,223/mo, truly ₱376/hr).
- **No fallbacks.** There is no 40 h/week default anywhere in the module. `toPhp` returns `null` when
  `monthly` is false, and the caller shows the posted rate instead of a month.

Rates are cached per currency with their ECB date and a 24-hour horizon; an older rate is never used,
and a failed fetch writes a failure timestamp so the API is not hammered per card. No rate means **no
converted figure** — the tooltip says why.

Rendering: the figure is inserted as the first child of the site's own salary cell (above the posted
figures), is namespaced `.ojc-salary-note`, and is stripped by `cardSalary()` before the hide rule reads
the salary text — the annotation must never be able to change the no-salary verdict. An empty note
hides itself (`:empty`), which is how piece rates and rate-less cards read as "nothing added".

## Goal brighten (W7 / D13)

Two goals, and **one of them judges each card** — never a derived mix:

| Card | Judged by | Why |
|---|---|---|
| Full Time | the monthly goal, against the month | 40 h/week is what full time means, so a month exists |
| Part Time / Any / Gig | the hourly goal, against the posted rate | no hours are stated, so no month exists to compare |
| quotes only a month | the monthly goal | there is no rate to compare against |

Deriving one goal from the other is forbidden: turning a monthly figure into an hourly one needs an
assumed work week, which is the thing this module refuses to do. `ratePhp()` therefore returns the
posted per-unit amount from the parse result's `raw` figures even when a month was computed — the
comparison needs the number the listing actually printed.

When the month came from the full-time 40 h/week reading of an hourly rate, the card carries
`assumes 40 h/week (full time) — verify with the employer` (`.ojc-salary-warn`), and the tooltip repeats
it. A month from a stated period, or from stated hours, carries no warning — neither is an assumption.

## Deliberate ceilings

Marked in the source with `# ponytail:` and named here:

- `ctxMap` / `fullText()` are dead until the deep scan (W3 in `spec.md`) feeds them; the seam is kept
  rather than rebuilt later.
- The rule pass re-reads `textContent` for every card on every pass. At 30 cards per page this is
  free; if the site ever renders thousands, cache per card and invalidate on mutation.
- Counts are computed from the DOM order of the rules above, not tracked incrementally — correctness
  over bookkeeping.

## Testing shape

| Layer | How it is checked |
|---|---|
| Pure rules | `node test-rules.js` — offline, no fixture files needed |
| Package integrity | `node test-manifest.js` — every `chrome.*` namespace granted, referenced files exist |
| Repo invariants | `node test-repo-hygiene.js`, `node tools/check-readme.js` |
| Real behaviour | `node tools/verify-live.mjs` — reloads the extension in Chrome, drives the live site over CDP, recomputes the expected result from the DOM, and asserts the chip, the `[hidden]` cards, the toggle, and the panel |
| Everything offline | `sh tools/gate.sh` (+ CI on Node 20) |

The live harness is the only check that can see a renamed selector or a missing permission, and it is
also the only one that cannot run in CI. Its two rules for the CDP client: use the **browser-level**
WebSocket endpoint (a page target breaks as soon as a closed tab is still listed), and give every
socket an explicit open timeout so a failure is loud instead of a hang.
