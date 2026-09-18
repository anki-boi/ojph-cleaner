# Plan — detail-page mode, closed-listing memory, no-salary rescue

Status: **proposed** (nothing implemented). Extends `spec.md` W4, adds W9–W11.
Evidence below was gathered live with CDP probes against the signed-in board, 2026-09-18.

## Why

Three requests, in the user's words:

1. *"when a job listing is opened, the extension still works … highlight green the keywords we like, then
   highlight red what we dont like. Also it should auto-highlight links and email addresses as red. This
   is unwanted because we are forced to submit applications outside of onlinejobs.ph."*
2. *"when we see that the job listing is already closed, it forever classifies that job listing as hidden
   in the job board … max history of 6 months is good."*
3. *"A listing with no salary mentioned might still be nice if there are matches to the positive keywords."*

## Evidence gathered (live, signed in)

**Detail page structure**

| What | Contract |
|---|---|
| Description | `p#job-description.job-description` inside `div.card-body < div.card.card-jobseeker`; 73 nodes, **only `#text` and `<br>`** — no nested markup, so highlighting is a text-node walk |
| Overview | `dl.row.no-gutters dd` → `dd > h3` = label, `dd > p` = value; labels `TYPE OF WORK`, `WAGE / SALARY`, `HOURS PER WEEK`, `DATE UPDATED` |
| Coverage | `#job-description` present on 18/20 sampled pages; 2 had none → the mode must degrade silently |
| Extension today | **completely inert** on detail pages (0 `.ojc-*` elements, no chip) — purely additive work |

**`HOURS PER WEEK` is real: 14/18 numeric, 4 `TBD`** (40, 40, 40, 40, 40, 35, 25, 20, 15, 15, 10, 10, 9, 5).
This is the number that makes a monthly rate honest, and it exists on the page.

**Off-platform pressure: 9/18 listings (50%)**

| Signal | Count | Real example |
|---|---|---|
| Application-ask phrase | 7 | `"👉 Apply here, fill out the form carefully: forms.gle/VL1hbhWz8FpRDNrFA"` |
| Bare URL in prose | 2 | `drive.google.com/drive/folders/1urU1wyGy713qFv_GEQFmY_j7PLUINWeB` (Instagram reel links too) |
| Email in prose | 2 | `hr@jumpermedia.co`, `lockanahi0203@gmail.com` |
| Redacted link | 3 | `"complete this short application form in English: ----------"` |

Links and emails appear as **plain text, not anchors** (`anchorsInDesc: 0` in 14/18) — a detector that only
reads `href`s finds almost nothing. OJ.ph also **redacts** application links as `----------`, and **this
happens even signed in** (3/18) — but the redaction is gone for other listings, so it is per-listing, not
per-session.

**Closed listings (W9's evidence)**

- Closure marker, verbatim and login-gated: **`This job has been closed`**. The Apply button is still
  present, so text is the only reliable signal. A plain HTTP fetch of a known-closed listing returned
  **0 hits** — only the signed-in browser can see it.
- **Board: 1/30 closed** on the deepest page (`/jobsearch/240`, postings 20 days old) — and cards carry
  no closure marker at all, so it can only be learned by opening the listing.
- **Saved Jobs: 4/16 closed** — the real concentration.
- The board is shallow: `/jobsearch/240` is the last page for this filter, `/jobsearch/1000` is empty.
- `chrome.storage.local` quota is 10 MB. `{jobId: timestamp}` ≈ 30 bytes; six months at 10 opens/day ≈
  **54 KB**. The 6-month cap is tidiness, not survival.

## Decisions

| ID | Decision | Rationale |
|---|---|---|
| **D25** | On a detail page: **green** = positive keyword, **red** = negative keyword, external link, email address, application-ask phrase, or redacted link. Where two rules overlap, **red wins** | A warning must never be hidden by an endorsement. Keyword matching stays D24 (exact word/phrase) |
| **D26** | Off-platform phrases mean **application asks only** — `apply here/via`, `fill out the form`, `complete this application form`, `send your resume/CV`, `email your…`, `submit…`, `DM me`. Messaging/booking tools (WhatsApp, Telegram, Viber, Calendly) count **only in the same sentence as an ask** | Measured: 3 of 7 phrase hits were Telegram as *job content* ("Help monitor Telegram accounts"). Flagging those is a false alarm on a normal listing |
| **D27** | The `----------` redaction is itself a red signal | 3/18 listings; in at least one it is the only surviving trace of an off-platform apply |
| **D28** | A month is claimed **only when honest** (extends W7's rule): monthly pay → exact; hourly pay + listed hours → exact; hourly pay + `TBD` hours → 40 h/week **with the disclaimer**, unless `TYPE OF WORK` is Part Time/Gig, where no month is claimed; piece rates → never | Reuses `salary.js` unchanged. The part-time guard is existing behaviour that a naive "assume 40" would silently break (a $6/hr part-timer becomes ₱60k/mo) |
| **D29** | Closed-listing memory is **opportunistic**: learned when you open a listing that says it is closed, pruned after **180 days**, and never used to fetch anything | A crawler that tested every card would fetch every listing — the exact property `docs/scraping.md` protects. Consequence: a saved job you have never opened cannot be known to be closed (the Saved Jobs table has no status column: `Title / Description / Notes / Delete`) |
| **D30** | The no-salary rescue is **opt-in** (`rescueNoSalary`, default off) and reuses the existing `good` predicate | The user asked for it optional. One predicate, not a second definition of "looks good" |

## W4 — Detail-page mode (reserved workstream, does **not** depend on W3)

`content.js` is at 283 of the gate's 300-line cap, so this is a new file.

| ID | Task | Files |
|---|---|---|
| W4.1 | Pure extraction + highlight planning: keyword matches, bare URLs (not `e.g.`, not `onlinejobs.ph`), emails (must not match `hr@jumpermedia.co. ps`), application-ask phrases with the D26 tool guard, the `----------` redaction, and overlap resolution (red beats green; leftmost-longest within a category) | `detail-text.js` (new), `test-detail.js` (new) |
| W4.2 | The applier: one text-node walk over `p#job-description`, wrapping matches in `span.ojc-hl-pos` / `span.ojc-hl-neg`. Idempotent — a re-run must not wrap our own spans | `detail.js` (new), `content.css` |
| W4.3 | The info bar above the description: `40 h/wk · ≈ ₱56,459/mo · above your ₱70,000 goal`, or `TBD h/wk · rate only`; plus `⚠ applies off-platform` when any red signal fired | `detail.js`, `content.css` |
| W4.4 | Wire the new files into the manifest and every `OUR_CLASSES`/injected-class list | `manifest.json`, `content.js`, `test-manifest.js` |

Reuse, not rebuild: `rules.matchKeywords` (D24 semantics), `salary.parseSalary(text, hours)` /
`toPhp` / `formatNote` / `meetsGoal`, and the existing cached FX loader — exposed from `salary-cards.js`
as one shared accessor instead of a second copy of the TTL logic.

**Request budget:** zero requests to onlinejobs.ph (the date and the description are already in the
markup). The ₱ figure may trigger the same one-off ECB rate fetch the board already does when the cache
is cold; if the rate is unknown, the bar shows the posted rate and **no** ₱ figure.

## W9 — Closed-listing memory

| ID | Task | Files |
|---|---|---|
| W9.1 | Pure `jobIdFrom(href)`, `isClosedText(text)`, and `pruneClosed(map, now, 180)` | `closed.js` (new), `test-closed.js` (new) |
| W9.2 | Record on the detail page when the closure marker is present; prune on every write | `detail.js` |
| W9.3 | On the board: a card whose id is remembered-closed is **hidden**, counted as `closed` in the chip, and revealed by `Show all` with a grey `⊘ closed` badge (not the yellow reconsider one) | `content.js`, `content.css` |
| W9.4 | On `/jobseekers/bookmarked_jobs` (new React/tailwind table, `<tr>` rows): a row whose job link id is remembered-closed gets a grey wash and a `⊘ closed` label — the row stays visible so it can still be deleted | `closed.js` |

Storage: `chrome.storage.local.closedJobs = { "<id>": <epoch ms> }`. Snapshot/restore discipline applies:
this is a new key the live harness must preserve alongside `settings` and `fx`.

## W10 — No-salary rescue

| ID | Task | Files |
|---|---|---|
| W10.1 | `rescueNoSalary: false` in `DEFAULTS`; the `noSalary` branch hides **unless** the setting is on and the card is `good`, in which case it falls through to the negative/positive rules | `content.js` (≈4 lines) |
| W10.2 | Toggle in both UIs; README row (the gate requires every `DEFAULTS` key documented) | `panel.js`, `options.html`, `options.js`, `README.md` |

Rule order stays `stale → noSalary → negative → positive`. A rescued card ends up **green** when it is a
positive match, and still **hidden** when a negative keyword applies — the rescue removes a hide, it does
not bypass a later rule.

## W11 — Harness honesty (found while probing)

`tools/cdp.mjs`'s `evaluate` returns `undefined` when the page-side expression throws, so a broken probe
looks identical to a missing element. It cost three debugging rounds during this recon and it can make a
`verify-live` assertion silently meaningless. Fix: rethrow on `exceptionDetails`.

## Tests

Pure, no browser, wired into `npm test` the way `test-rules.js` is:

- **highlight planning** — `ai` matches "AI tools" but not "email"; a bare `forms.gle/xxx` is a URL;
  `e.g.` and `onlinejobs.ph` are not; `hr@jumpermedia.co. ps` yields `hr@jumpermedia.co`;
  "help monitor Telegram accounts" fires **nothing**; "complete this application form: ----------" fires
  two signals; red beats green on overlap; every match range is non-overlapping and in document order.
- **rate honesty** — `$8 / hour` + 40 h → a month; `$2.75/hr` + `TBD` → no month when Part Time;
  `5$ per thumbnail` → never a month; `$900/month` → exact regardless of hours.
- **closed memory** — id extracted from both slug forms (board's lowercase, bookmarks' Title-Case);
  `prune` drops 181-day entries and keeps 179-day ones; an empty/absent map is not an error.

## Verification

1. `sh tools/gate.sh` green (syntax, 300-line cap, tests, manifest wiring, README truth, path scan).
2. Live probe on a real listing: highlights render, the bar's ₱ figure equals `salary.js`'s own output,
   and a known-closed URL (`Medical-Assistant-1570005`) records + then hides on the board.
3. The user's `chrome.storage.local` byte-identical afterwards (`settings`, `fx`, plus `closedJobs`).
4. Only after the above: extend `tools/verify-live.mjs` with a detail-page section and a closed-memory
   round trip.

## Excluded, deliberately

- No per-card or per-listing fetching. The extension never becomes a crawler, and never tests a saved job
  it has not opened.
- No marking of `v2.onlinejobs.ph` — it is a logged-out landing page that redirects to `www`.
- No reuse of the detail page's real `HOURS PER WEEK` on the *board* cards (that would need a visit per
  card). The board keeps its stated-or-40 h basis and its disclaimer.

## Risk notes

- `content.js` is 17 lines from the cap; the W9/W10 changes to it are small on purpose. If it crosses 300,
  the chip/panel seam is the next thing to split out.
- `package.json` still says `0.6.0` while `manifest.json` says `0.7.0` — worth aligning in this pass.
- The description is plain text today; if OJ.ph ever renders real `<a>` elements there, the detector must
  still work, so link detection reads **both** `href` values and text.
