# OJ.ph Cleaner

A Chrome extension that cleans up [OnlineJobs.ph](https://www.onlinejobs.ph) job-search pages.
It hides listings that are a waste of your time — no salary listed, or a keyword you never want to
read again — and highlights the ones you do, without ever taking a listing away for a positive
match. Everything runs on your machine: no account, no server, no analytics.

![The chip counts what it hid, and the panel edits the rules in place](docs/img/list-chip.png)

No-salary jobs and negative keywords are gone; the chip in the bottom-right says exactly what it did
and offers one click to see everything it removed — a keyword-hidden card comes back with a red
dashed marker, so the decision stays yours:

![The in-page options panel](docs/img/options-panel.png)

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

Three rules, applied in this order to every listing on the page:

1. **No salary → hidden.** The salary field must contain a digit. `TBD`, `N/A`, `Negotiable`, `DOE`
   and an empty field all fail.
2. **Negative keyword → hidden.** Case-insensitive substring match against the whole card.
3. **Positive keyword → highlighted only.** Never hidden. The green outline and `✓ keyword` badge
   tell you why.

The first rule that matches wins, which matters when you read a count: with *no salary* turned off,
a no-salary card that also matches a negative keyword moves into the keyword bucket.

The chip reports `N hidden (x no salary, y keywords, z highlighted)` and toggles between hiding and
showing. Click `⚙` to open the settings panel **in the page** — saving applies to the listings
immediately, with no reload.

**Keep scrolling.** When you reach the bottom of the list the next result page is appended, so a
297-job search is one continuous scroll instead of eight clicks on *Next*. One page per scroll, one
request per page, and it stops at the end of the results — or the moment a page adds nothing new.

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

Click `⚙` on the chip, or use the standalone options page if you prefer a full tab. Both write the
same storage, and both take effect on every open tab immediately.

| Setting | Default | Meaning |
|---|---|---|
| `negative` | empty | One keyword per line. A listing whose text contains any of them is **hidden**. |
| `positive` | empty | One keyword per line. A listing whose text contains any of them is **highlighted**, never hidden. |
| `noSalary` | on | Hide listings whose salary field contains no digit (`TBD`, `N/A`, `Negotiable`, `DOE`, empty). |
| `showHidden` | off | Reveal what was hidden, with a red dashed marker. The chip's `Show all` writes this. |
| `autoLoad` | on | Append the next page of results when you scroll to the bottom of the list. One page per real scroll, one request per page, and it stops at the end of the results. |
| `goalSalary` | 0 (off) | A monthly PHP figure. Cards whose converted salary is **at least** this much get a green wash and a `★ at or above your monthly goal` line. Judged on the low end of a range — a "maybe" is not a yes. |
| `goalHourly` | 0 (off) | The same, per hour: for listings that post an hourly rate, which a monthly goal cannot judge. A card is brightened if **either** goal is met. |
| `autoScan` | off | Deep-scan this page's listings once the described feature ships — **disabled in the UI until then** (`spec.md` W3). |

Matching is plain case-insensitive substring, so `crypto` also matches `cryptocurrency`. Keep the
list short and specific.

## Privacy

- **No request you did not ask for.** With `autoLoad` off and no keywords configured, the extension
  talks to nothing at all. With it on, it fetches one result page only when *you* scroll to the bottom
  of the list on the page you are already reading — never in the background, never ahead of you, and
  never into the detail pages of jobs (that is the deep scan, `spec.md` W3, still to come).
- **One third-party call, on demand.** To convert a foreign-currency salary, the extension asks the
  European Central Bank's reference rates (via `api.frankfurter.dev`) once per currency per 24 hours,
  and only when a card on screen actually pays in that currency. No amount, no keyword and nothing
  about you is sent — it is a plain request for a public exchange rate. A page of ₱-only listings
  makes no such call.
- **One site.** The content script is injected only on `onlinejobs.ph`; the host permission exists to
  read that page's listing DOM. The rate request needs no permission of its own (the API allows it)
  and no other host is ever contacted.
- **Local state.** Keywords, toggles and the cached rates live in `chrome.storage.local` on your
  machine. There is no server, no account, and no analytics. See `SECURITY.md`.
- **No crawling.** The loader fetches *result pages* the site would have served you anyway, one per
  scroll. It never walks into job detail pages, and the deep scan (`spec.md` W3) will stay bounded to
  the cards already loaded — see `docs/scraping.md` for the request budget.

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
| `rules.js` | Pure rules — `hasSalary`, `matchKeywords`. No DOM, so it is unit-tested directly |
| `content.js` | The content script: chip, in-page settings panel, rule pass, DOM observer, storage sync. Makes no network request of its own |
| `pagination.js` | Perpetual pagination: the scroll trigger, the fetch and the stop conditions (W6) |
| `panel.js` | The in-page options form (the ⚙ in the chip). Owns no rule logic, so it cannot change what is hidden |
| `salary.js` | Free-text salary → monthly figure, currency and units (W7). Pure and unit-tested |
| `salary-cards.js` | Applies it: the live ECB rate, the figure on each card, the goal brighten |
| `content.css` | Styles for the chip, the panel and the highlight badge (all `#ojc-*` scoped) |
| `options.html` / `options.js` | Standalone options page (the in-page panel is the primary UI) |
| `test-rules.js` / `test-manifest.js` | Node tests, zero dependencies |
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
