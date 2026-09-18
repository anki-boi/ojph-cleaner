# Architecture

A Chrome MV3 extension, ~250 lines of source, no build step, no dependencies. Four moving parts and
one rule: **pure logic never touches the DOM**.

```
manifest.json          ── injects on onlinejobs.ph only
   │
   ├─ rules.js         pure: hasSalary(), matchKeywords()      ← test-rules.js
   └─ content.js       DOM + state
        ├─ rule pass    reads settings + page DOM → hidden/classes/badges
        ├─ chip         counts + Show all/Hide them + ⚙
        ├─ panel        in-page settings, Save applies synchronously
        └─ observer     re-runs the rule pass when the page changes
options.html/js        standalone settings page (same storage, same effect)
```

## Layers, and why the split is where it is

**`rules.js` is pure.** `hasSalary(text)` and `matchKeywords(text, keywords)` take strings and return
values. No DOM, no storage, no timers — so `test-rules.js` can assert the interesting cases
(`TBD`, `N/A`, `DOE`, `$1,000/month (DOE)`, case-insensitivity) in milliseconds, offline. The same
split exists upstream in the sibling project's `scraper/parsers.py`, for the same reason.

**`content.js` owns every coupling to the page.** The selectors live in one `SELECTORS` object at the
top so site drift is a one-line fix, and `tools/verify-live.mjs` replicates the same rules from the
live DOM to check the result independently.

**Storage is the only channel between contexts.** Settings live in `chrome.storage.local.settings`;
`chrome.storage.onChanged` is broadcast to the content script *and* the options page, so both UIs stay
in sync and neither needs a message protocol. (A background message proxy once existed here as a
workaround for what was actually a missing `storage` permission — see `docs/HANDOFF.md` §4. Do not
reintroduce it.)

## Rule order (observable, do not reorder)

```
noSalary → negative → positive → nothing
```

First match wins. This is not an implementation detail: with `noSalary` off, a no-salary card that
also matches a negative keyword is counted in the keyword bucket, so a predicted count computed by
adding the two buckets is wrong. Measured on a live page: 5 no-salary + 16 keyword = 21, but with
`noSalary` off the same page hides **20** as keywords. `tools/verify-live.mjs` recomputes that
expectation from the DOM in the same order (`negAnyExpected`) rather than by arithmetic.

Positive keywords **never** hide. A false positive costs a real job listing, which is the one mistake
this extension must not make.

## The injected UI contract

- Everything injected is namespaced: `#ojc-chip`, `#ojc-panel`, `.ojc-pos`, `.ojc-neg`,
  `.ojc-pos-badge`. The extension never restyles the site's own elements.
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

## Mutation handling

One `MutationObserver` on `document.body`: child list + subtree + character data. Mutations produced
by our own UI are ignored via `isOurs()`; everything else is coalesced into a single rule pass per
animation frame (`ticking` guard) so a burst of insertions costs one pass, not one per node.

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
