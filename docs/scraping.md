# Scraping, requests and politeness

This extension is a **reader**, not a crawler. It runs on the page the user already opened, and every
request it makes is one the user would otherwise have made by clicking. That is the property that
makes it safe to leave installed, and it is the property every change here must preserve.

## What it fetches, and when

| Trigger | Requests | Notes |
|---|---|---|
| Nothing configured, `autoLoad` off | **zero** | the site's own page load is the only traffic |
| Nothing configured, `autoLoad` on (default) | one per *scroll to the bottom* | the next result page, after a real wheel/keyboard gesture — never on an idle page, and never from a programmatic scroll |
| A foreign-currency salary on screen | one per currency per 24 h | European Central Bank reference rates via `api.frankfurter.dev` — a public exchange rate, no data about the user, and never a stale one (no rate → no converted figure) |
| Recency filtering (W8) | **none** | The posted instant is already in the card markup (`p[data-temp]`), so filtering on it costs nothing. Hide-scrolling to find older listings is the *user* scrolling, and the loader's budget is unchanged |
| Opening a job's own page (W4/W9) | **none** to OnlineJobs.ph | The description, `HOURS PER WEEK` and the closure notice are all in the page the user already loaded. The only request this can add is the same cached ECB rate call the board already makes, and only for a listing priced in a foreign currency |
| Deep scan (`spec.md` W3, not built) | one per loaded card, only when keywords are configured | 3 concurrent, 400 ms between waves, current view only |

Perpetual pagination (W6) is deliberately conservative: it needs a real scroll since the last page
(so a list shortened by keywords cannot pull the whole result set while the user sits still), one page
in flight at a time, a 600 ms minimum gap between pages, and it **stops** on the first sign of an end —
no new job links on the fetched page, every result already loaded, or a non-200 response. There is no
retry loop: a failed page stops the loader and says so in the chip.

## The page surface it reads

All coupling to OnlineJobs.ph markup lives in one `SELECTORS` object at the top of `content.js`.
If the site changes its markup, that object is the single place to fix, and
`node tools/verify-live.mjs` is the check that will tell you it changed.

| What | Selector | Notes |
|---|---|---|
| List card | `.jobpost-cat-box.latest-job-post` | 30 cards per page (observed 2026-09-18) |
| Card salary | `dd.col` | "has salary" = the text contains a digit |
| Card posted date | `p[data-temp]` → `data-temp-2` (UTC), fallback `data-temp` (+08:00) | W8: on 30/30 cards across a keyword search, a category page and two offset pages. Both attributes are the same instant — `2026-09-19 01:33:33` / `2026-09-18 17:33:33` on one live card — so the visible string is the site's own Asia/Manila clock, never the viewer's |
| Detail description | `p#job-description` | 37–4,220 chars observed (W4). Plain text with `<br>`s: 73 nodes on a sampled listing, all `#text` or `<br>`, and **no `<a>`** — so an application link appears as prose (`fill out the form: forms.gle/…`) and a detector reading only `href`s finds nothing |
| Detail overview | `dl.row.no-gutters dd` → `dd > h3` = label, `dd > p` = value | `TYPE OF WORK`, `WAGE / SALARY`, `HOURS PER WEEK`, `DATE UPDATED`. `HOURS PER WEEK` was a real number on **14 of 18** sampled listings (W4) |
| Closure notice | the text `This job has been closed`, above the description | **Login-gated**: a plain HTTP fetch of a listing known to be closed returns 0 hits, so only the signed-in browser can read it (W9) |
| Saved-jobs table | a React `<tr>` table, job link `a[href*="/jobseekers/job/"]` | Different frontend from the board — no `.jobpost-cat-box` — columns `Title / Description / Notes / Delete`, and **no status column** (W9) |
| Saved-jobs page | `/jobseekers/bookmarked_jobs` | Requires login; `v2.onlinejobs.ph` is a logged-out landing page that redirects back to `www` |
| Result page (next) | current URL with the offset segment = jobs already displayed | W6: `/jobseekers/jobsearch/30?jobkeyword=…`; `pagination.js`'s `nextPageUrl()` builds it, `test-pager.js` pins all four shapes |

List pages that work, all verified live: `/jobseekers/jobsearch?jobkeyword=…`,
`/jobseekers/jobsearch/{offset}?jobkeyword=…` and `/jobseekers/search/c/{slug}/{offset}`. Search
pages are readable without logging in.

**A detail page is not the same page signed out.** OnlineJobs.ph removes application links from a
description for a logged-out visitor, leaving `----------` where the URL was, and it hides the closure
notice entirely — measured 2026-09-18: every sampled listing redacted its link when signed out, while
signed in only **3 of 18** did. The redaction is per listing, not per session: some listings show the real
link to a signed-in visitor. A logged-out reader therefore sees neither the off-platform signal nor the
closed state, which is why both features require the browser the user is actually signed into.

## The deep scan (planned — `spec.md` W3)

Card text is thin: measured on a live `bookkeeper` search, `crypto` and `insurance` matched **0 of 30**
cards while the search term matched 16. The deep scan exists to read the full description, and it is
deliberately small:

- **Bounded to what is loaded.** It fetches the detail page of each card on screen — never follows
  links, never discovers new jobs, never paginates. 30 cards means at most 30 requests, and only when
  the user has configured keywords. Combined with W6's loader the pool grows as the user scrolls, so
  the scan is always bounded by what the user has actually asked to see.
- **3 concurrent, 400 ms between waves.** A wave is at most 3 in flight; nothing is fetched while a
  wave is settling. No retries beyond the site's own response.
- **Stops on 429.** Rate limiting or a network error leaves that card unscanned and stops the fleet.
  The extension degrades to what it already knows from card text; it never pushes harder.
- **IndexedDB cache**, keyed on the job URL, 7-day TTL, 1 000 entries, oldest evicted (`spec.md` D3).
  Re-visiting a search page costs nothing.
- **Never automatic by default.** `autoScan` ships off and is disabled in the UI until the scan is
  proven cheap on a live page (`spec.md` D4).

## Terms of service and consent

The extension fetches pages a logged-out user could fetch by clicking. It does not submit forms,
apply to jobs, log in, or authenticate — no account is ever touched, so nothing here can put a user's
account at risk. That is also why "auto-apply" is rejected outright in `spec.md` §8.

If you ever raise the concurrency, shorten the delay between waves, or scan anything other than the
current page, you are changing the extension's relationship with the site, and this document is the
thing that must be updated with it.

## What cannot be tested offline

`tools/verify-live.mjs` needs a real browser and the live site. CI runs `npm test` and
`tools/gate.sh`, which are offline by design — no test may hit the network. Consequence, stated
plainly: **markup drift is caught locally, not in CI.** Run the harness after any change to
`SELECTORS`, and after any report of "it stopped working".

Offline tests use no HTML fixtures; the rule layer is pure string logic, so it needs none. When the
detail parser lands (W3), that changes: it gets real saved HTML fixtures, because a parser without
fixtures is untestable — and the live harness gets a matching assertion so the fixtures cannot drift
away from the site silently.
