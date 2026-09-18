# Scraping, requests and politeness

This extension is a **reader**, not a crawler. It runs on the page the user already opened, and while
no keywords are configured it makes **zero additional requests** — the site's own page load is the
only traffic. That property is a feature, not an accident: it is what makes the extension safe to
leave installed.

## The page surface it reads

All coupling to OnlineJobs.ph markup lives in one `SELECTORS` object at the top of `content.js`.
If the site changes its markup, that object is the single place to fix, and
`node tools/verify-live.mjs` is the check that will tell you it changed.

| What | Selector | Notes |
|---|---|---|
| List card | `.jobpost-cat-box.latest-job-post` | 30 cards per page (observed 2026-09-18) |
| Card salary | `dd.col` | "has salary" = the text contains a digit |
| Detail description | `p#job-description` | ~2.9k chars on a typical job (W3) |
| Detail salary | `p` next sibling of the `h3.fs-12` matching `/WAGE\s*\/\s*SALARY/i` | label → next-sibling-value pattern (W3) |
| Detail page | `/jobseekers/job/{slug}-{id}` | (W3) |

List pages that work, all verified live: `/jobseekers/jobsearch?jobkeyword=…`,
`/jobseekers/jobsearch/{offset}?jobkeyword=…` and `/jobseekers/search/c/{slug}/{offset}`. Search
pages are readable without logging in.

## The deep scan (planned — `spec.md` W3)

Card text is thin: measured on a live `bookkeeper` search, `crypto` and `insurance` matched **0 of 30**
cards while the search term matched 16. The deep scan exists to read the full description, and it is
deliberately small:

- **Bounded to the current page.** It fetches the detail page of each card already on screen — never
  paginates, never follows links, never discovers new jobs. 30 cards on a page means at most 30
  requests, and only when the user has configured keywords.
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
