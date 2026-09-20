# OJ.ph Cleaner

A Chrome extension that cleans up [OnlineJobs.ph](https://www.onlinejobs.ph) job-search pages.
It hides listings that are a waste of your time — no salary listed, or a keyword you never want to
read again — and highlights the ones you do, without ever taking a listing away for a positive
match. Everything runs on your machine: no account, no server, no analytics.

**→ [Why this exists: the four problems it attacks, and the place it refuses to guess](PROBLEMS.md)**

![The chip counts what it hid, and the panel edits the rules in place](docs/img/list-chip.png)

No-salary jobs and negative keywords are gone; the chip in the bottom-right says exactly what it did
and offers one click to see everything it removed — a keyword-hidden card comes back with a red
dashed marker, so the decision stays yours:

![The in-page options panel: Filters, Salary goals and Loading, with Save always in reach](docs/img/options-panel.png)

Positive keywords never hide anything. They mark the card with a green outline and a `✓ keyword`
badge, so a job you want floats to the top of your attention instead of disappearing by mistake:

![A positive-keyword card](docs/img/highlight.png)

## Install

There is no store listing yet (`spec.md` D2). Load it unpacked:

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Open a search on OnlineJobs.ph — a chip appears in the bottom-right corner.

Chrome remembers an unpacked extension after a restart. After editing files, press **Reload** on the
extension card to pick the changes up.

## What it does

Four rules, applied in this order to every listing on the page:

1. **Posted too long ago → hidden.** Every card carries its posted instant, and a listing older than
   your window (7 days by default) is gone before any other rule looks at it. On the live board the
   first page of a search is always fresh — this filter earns its keep on the pages behind it, where a
   297-job search was measured at **40-46 days old**.
2. **No salary → hidden.** The salary field must contain a digit. `TBD`, `N/A`, `Negotiable`, `DOE`
   and an empty field all fail.
3. **Negative keyword → hidden.** Matched as an **exact word or phrase**, case-insensitively — unless
   the listing also looks good, in which case see below.
4. **Positive keyword → highlighted only.** Never hidden. The green outline and `✓ keyword` badge
   tell you why.

The first rule that matches wins, which matters when you read a count: with *no salary* turned off,
a no-salary card that also matches a negative keyword moves into the keyword bucket.

A keyword you like is a **highlight, not a promotion**: it never hides a listing, and it never makes one
high-yield either — only pay does that (see *High yield* below).

**A keyword you hate, on a job you'd want, gets a yellow outline instead of disappearing.** If a
listing matches a negative keyword *and* either matches a positive keyword or pays at or above one of
your goals, it stays on the page in yellow — the one state where a listing is shown *because* it is
suspicious, so you can reconsider it without turning the whole filter off. Nothing else changes about
it: the salary figure, the posted date and the listing itself are the site's.

**Both badges name the keyword.** A green `✓ keyword` badge sits top-right on a highlighted card, and a
red `✗ keyword` badge sits in the same place on every card a negative keyword matched — the yellow ones,
and the hidden ones when you turn *Show all* on. So nothing on the page is marked without saying why.

The panel in the bottom-right corner says what it did, in two groups: the **Hidden** total with a line per
reason, then **Stats** — how many listings matched a keyword you asked to hide, how many you highlighted,
and how many are worth a second look (the yellow ones). Each line's dot and number share the colour of the
mark it refers to on the cards, and the header explains the total on hover. Click the header to fold the
lists away and leave the two buttons.

`Show All` reveals everything it hid, `Settings` opens the rules **in the page** — saving applies to the
listings immediately, with no reload.

**Keep scrolling.** When you reach the bottom of the list the next result page is appended, so a
297-job search is one continuous scroll instead of eight clicks on *Next*. One page per scroll, one
request per page, and it stops at the end of the results — or the moment a page adds nothing new.

**Scan the whole window, then let every listing speak for itself.** The `Scan` button in the panel does
two things in one run, and nothing until you press it:

1. **Loads every result inside your recency window.** The board is sorted newest-first, so it pages until a
   page's newest listing is already older than your window and stops there — no scrolling needed, and it
   stops early rather than walking the whole result set.
2. **Opens each listing and re-decides it with its full description.** A card carries only a title and a
   salary line; the description is where the rest of the truth is — the keyword the card never mentioned,
   the link that takes you off OnlineJobs.ph, the `HOURS PER WEEK` that turns an assumed month into a real
   one. **Two at a time, 400 ms apart**, with a `Stop` button throughout and a hard stop at 10 pages /
   300 listings. Everything it reads is cached for 7 days, so a second run costs nothing — and changing a
   keyword re-tiers the page **without a single request**.

**Two tiers, and a button for each.** Once listings have been read, the panel shows `High yield N` and
`Worth N`:

- **High yield** — **it pays at or above one of your goals**, and no keyword you asked to hide matched.
  Matching a keyword you like is a bonus badge, never the reason: a listing you like the sound of that pays
  below your goal is *not* high yield.
- **Worth considering** — a hide keyword matched, but the listing still looks good (it pays enough, or it
  matches a keyword you like). These are the yellow cards, shown rather than hidden.
- **Highlighted** — a keyword you like on a listing that pays below your goal: the green outline and `✓`
  badge, exactly as before. Visible, never hidden, and deliberately not counted as high yield.

Pressing one filters the board to that tier; `All` puts it back. **Nothing is reordered** — the site's own
list order and its next-page behaviour are untouched — and the board **scrolls to the first card of the tier
you picked**, because hiding most of a long list otherwise leaves you looking at empty space (measured: the
first high-yield card sat 18 000 px above the viewport after the document shrank from 92 000 px to 19 000).
When a listing moves between tiers the card carries `↑ promoted` or `↓ demoted` until you open it.

**Off-platform asks are a tag, not a filter.** A listing that asks you to apply by email, Telegram or a Google
Form gets a `⚠ off-platform` tag beside its keyword badge. It is never hidden for it and never demoted for it
— the tag is there so you can decide. (An earlier version demoted them, which moved 176 of 227 scanned
listings out of High yield: a filter that had stopped filtering.) The scan also prints the listing's own
`HOURS PER WEEK` on the card, and flags a week longer than 40 hours.

**It remembers each listing.** Every scanned or opened listing keeps its verdict, its figures and its
flags, keyed by the listing's own URL — so opening a listing re-checks it against the live page, records
what changed, and clears the mark.

**See what it actually pays.** `5.5$/hr`, `Php 1000/day`, `15-20 AUD per hour` and `PHP 49,000 - 55,000`
are not comparable at a glance, so each card gets the converted figure above the site's own posted text —
`≈ ₱34,500/mo`, `≈ ₱150,600 - ₱200,800/mo`. The posted wording is never replaced, and a string the parser
cannot read gets no number rather than a guess.

**A month is only claimed when the listing supports one.** A per-month, per-week or per-year figure
converts directly. An hourly rate converts only when the listing states its hours, or says *full time*
(40 h/week) — a part-time listing that does not state its hours keeps its rate (`≈ ₱314/hr`), because
assuming a work week is how a ₱27,000 job becomes a ₱50,000 one. Measured on the live board: 12 of 60
cards quoted an hourly rate and 7 of those were part-time. Per-day rates never become months (days per
week is never stated), and a piece rate like `$5 per entry` gets no figure at all — there is no honest
monthly equivalent.

**A month built on the 40 h/week assumption says so.** Full time is what makes an hourly rate
convertible, so those cards carry `assumes 40 h/week (full time) — verify with the employer` under the
figure. Do not trust the monthly number blindly.

**A bare number is read by its size**, because on this board the size is the tell: 1-2 digits are an
hourly rate, 3-4 digits a monthly rate in dollars, 5+ digits a monthly peso figure. That is how `1000`
becomes `≈ ₱62,732/mo` (a U.S. listing quoting `$1,000 per month`) instead of ₱1,000. It only applies
when the listing states no currency and no unit — `Php 1000/day` stays pesos, `140-175/per hour` stays
pesos.

Foreign currencies use the ECB's live reference rate, and if that rate cannot be fetched the card is
left unconverted rather than showing a stale ₱ figure.

Set a monthly goal and/or an hourly one and every job **at or above it brightens up** — a green wash,
the figure in stronger green, and a `★ at or above your monthly/hourly goal` line. One goal judges each
card: **Full Time is judged monthly, Part Time and everything else by the hour**, and a listing that
quotes only a month is judged monthly because there is no rate to compare. Both are judged on the low
end of a range, so a "maybe" is not a yes. The hourly goal exists because a listing that only posts
`$5/hour` has no month to compare against — and converting one would mean assuming a work week.

## Settings

Click `Settings` on the panel, or use the standalone options page if you prefer a full tab. Both write the
same storage, and both take effect on every open tab immediately.

| Setting | Default | Meaning |
|---|---|---|
| `negative` | empty | One keyword per line. A listing whose text contains any of them **as an exact word or phrase** is **hidden**. |
| `positive` | empty | One keyword per line. A listing whose text contains any of them **as an exact word or phrase** is **highlighted**, never hidden. |
| `noSalary` | on | Hide listings whose salary field contains no digit (`TBD`, `N/A`, `Negotiable`, `DOE`, empty). |
| `rescueNoSalary` | off | With `noSalary` on: a listing with no figure that matches a keyword you like, or pays at or above one of your goals, is **shown** instead of hidden. Off by default — a listing that states no pay at all is usually one you did not want to read. |
| `maxAgeDays` | 7 | Hide listings posted longer ago than this many days. `0` turns it off, `7` is the last week, `30` the last month. Applied **before** every other rule, and a listing whose date cannot be read is never hidden by it. |
| `showHidden` | off | Reveal what was hidden, with a red dashed marker. The panel's `Show All` writes this. |
| `autoLoad` | on | Append the next page of results when you scroll to the bottom of the list. One page per real scroll, one request per page, and it stops at the end of the results. |
| `goalSalary` | 0 (off) | A monthly PHP figure. Cards whose converted salary is **at least** this much get a green wash and a `★ at or above your monthly goal` line. Judged on the low end of a range — a "maybe" is not a yes. |
| `goalHourly` | 0 (off) | The same, per hour: for listings that post an hourly rate, which a monthly goal cannot judge. A card is brightened if **either** goal is met. |
| `autoScan` | off | Deep-scan a search page automatically as soon as it loads. Off by default: the `Scan` button does the same thing on demand, and the extension's promise is that the site sees no traffic you did not ask for. |
| `scanWorth` | on | After the High yield listings, continue a scan into the Worth considering (yellow) ones. Off means a scan stops after the green ones. |
| `scanAll` | off | …and then the unclassified listings as well. This is the only pass that can promote a listing that matches no keyword and no goal, and it is the most expensive one. |

Every keyword is an **exact word or phrase**, case-insensitively: `ai` matches `AI tools` and
`AI-powered` but never `email` or `daily`, and `video editor` does not match `video editors`. Add the
forms you want — the list is read literally, so `editor` and `editors` are two keywords. That precision
is deliberate: `AI` as a substring matched **every** listing on a live search, and because a listing
that also looks good is shown in yellow rather than hidden, a loose match quietly turns keyword hiding
off altogether.

## Privacy

- **No request you did not ask for.** With `autoLoad` off, no keywords and no scan, the extension talks
  to nothing at all. With `autoLoad` on it fetches one result page only when *you* scroll to the bottom of
  the list you are already reading. The deep scan — which does open each listing's own page — runs **only**
  when you press `Scan`, two listings at a time, with a Stop button and hard caps, and everything it reads
  is cached so that a re-run asks for nothing.
- **One third-party call, on demand.** To convert a foreign-currency salary, the extension asks the
  European Central Bank's reference rates (via `api.frankfurter.dev`) once per currency per 24 hours,
  and only when a card on screen actually pays in that currency. No amount, no keyword and nothing
  about you is sent — it is a plain request for a public exchange rate. A page of ₱-only listings
  makes no such call.
- **One site.** The content script is injected only on `onlinejobs.ph`; the host permission exists to
  read that page's listing DOM. The rate request needs no permission of its own (the API allows it)
  and no other host is ever contacted.
- **Local state.** Keywords, toggles, the cached rates and the remembered verdict for each listing live in
  `chrome.storage.local`; the listing pages a scan read are cached in IndexedDB, in the site's own origin.
  There is no server, no account, and no analytics. See `SECURITY.md`.
- **No crawling on its own.** The loader fetches *result pages* the site would have served you anyway, one
  per scroll. Nothing walks into a job's own page unless you press `Scan` or turn `autoScan` on, and even
  then it is bounded to the listings inside your recency window, two at a time, with hard caps — see
  `docs/scraping.md` for the request budget.

## Development

No dependencies, no build step. Node ≥ 18 is only needed for the checks.

```bash
npm test                      # rules + manifest integrity (zero dependencies)
sh tools/gate.sh              # the full gate: syntax, tests, hygiene, README truth, path scan
```

`tools/verify-live.mjs` is the check that actually matters — it reloads the extension in a real
Chrome over CDP, loads the live site, recomputes the expected result from the DOM and compares:

```bash
# bring up the automation Chrome once (see docs/HANDOFF.md §2)
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --user-data-dir="C:/Users/PC/AppData/Local/agent-chrome-profile" \
  --remote-debugging-port=9333 --no-first-run --no-default-browser-check about:blank &

node tools/verify-live.mjs
node tools/verify-live.mjs --url="https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=bookkeeper" \
     --neg=bookkeeper --pos=quickbooks
```

Unit tests cannot see a missing permission or a renamed selector; that harness can, and it asserts
the chip's counts, the `[hidden]` cards really being `display:none`, the show-all/re-hide toggle, and
that saving settings repaints the list without a reload.

## Files

| Path | Purpose |
|---|---|
| `manifest.json` | MV3 manifest: `storage` permission, `onlinejobs.ph` host permissions, content script |
| `rules.js` | Pure rules — `hasSalary`, `matchKeywords`, `parsePosted`/`isStale`. No DOM, so it is unit-tested directly |
| `tiers.js` | The verdict table (W12): closed → stale → no salary → **high yield (pay)** → highlighted → worth considering → keyword-hide. Pure and unit-tested |
| `records.js` | The job memory's state machine — pruning, tier moves, the `↑`/`↓` mark. Pure and unit-tested |
| `records-cards.js` | Applies it: loads the memory, keeps a synchronous copy for the rule pass, writes only on change |
| `detail-cache.js` | IndexedDB: the listing pages a scan has read, 7-day TTL, 1 000-entry cap, so a keyword edit costs nothing |
| `detail-parse.js` | What a listing's own page says — one reader for the description, the overview fields and the job id |
| `scan.js` | The deep scan (W13): page to the recency window, then 2 listings at a time, in tier order, with caps and Stop |
| `observer.js` | The one MutationObserver, and the `isOurs()` check that stops it eating itself |
| `closed.js` / `closed-cards.js` | The closed-listing memory (pure maths + the storage applier) |
| `detail-text.js` / `detail.js` | What to highlight on a listing's page, and the bar that applies it (W4) |
| `chip.js` | The status panel: counts, tiers, views, and the Scan / Show All / Settings buttons |
| `page.js` | Every coupling to the site's list markup: the card selectors, the card's own text, its salary and its posted date |
| `content.js` | The hub: settings, the rule pass, the counts, the tier delegation, the views. Makes no request |
| `pagination.js` | Perpetual pagination: the scroll trigger, the fetch and the stop conditions (W6), plus the scan's `loadOne` |
| `panel.js` | The in-page options form (the ⚙ in the chip). Owns no rule logic, so it cannot change what is hidden |
| `salary.js` | Free-text salary → monthly figure, currency and units (W7). Pure and unit-tested |
| `salary-cards.js` | Applies it: the live ECB rate, the figure on each card, the goal brighten |
| `ui.css` / `content.css` | Floating UI (panel, chip) vs what is painted on the site (marks, borders, badges) |
| `options.html` / `options.js` | Standalone options page (the in-page panel is the primary UI) |
| `test-rules.js` / `test-tiers.js` / `test-records.js` / `test-manifest.js` | Node tests, zero dependencies |
| `test-pager.js` | Node tests for the pagination URL/offset maths and the stop conditions |
| `test-salary.js` | Node tests for the salary parser — the suite's real-data corpus plus formats sampled from the live board |
| `test-repo-hygiene.js` | Repo invariants (license stance, required files, hook wiring, no CRLF) |
| `tools/gate.sh` | One command: syntax + tests + hygiene + README truth + personal-path scan |
| `tools/check-readme.js` | Keeps this file true: every setting documented, no stale counts |
| `tools/verify-live.mjs`, `tools/cdp.mjs` | Live end-to-end check against the real site over CDP |
| `docs/architecture.md` | How the pieces fit; the invariants that must not regress |
| `docs/scraping.md` | What it fetches, when, and the politeness budget |
| `docs/HANDOFF.md` | Runbook: environment, traps, resume commands |
| `spec.md` | Audit, verified defects, decisions and the wave plan |

## License

Copyright (c) 2026 Jeyson Anki. **All rights reserved.** This repository is public to read, but no
open-source license is granted: the absence of a `LICENSE` file is deliberate, and no reuse is
permitted without written permission.
