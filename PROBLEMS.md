# Problems this solves

## The short version

**A job board without a filter turns a job hunt into a screening job.**

[OnlineJobs.ph](https://www.onlinejobs.ph) gives you a list and no way to narrow it. The
facts that decide whether a listing is worth your time — *does it pay, is it fresh, is it
the kind of work I want* — are not fields. They're free text inside a card, or inside a
description you have to open. So the hunt becomes: scroll, open, read, close, repeat.

That effort scales with **how much the market posted**, not with how good a match you are.
Worse, every screening decision you make is thrown away — nothing you learned yesterday is
remembered anywhere, so you pay for the same judgement again tomorrow.

This extension is the filter the board doesn't ship, built to solve my own hunt.

---

## The six problems it actually attacks

### 1. "Fresh" is a lie on page 1

The first result page of a search is always current. That's what makes the staleness
problem invisible — nothing looks wrong until you're several pages in. Measured on the live
board: **a 297-job search ran 40–46 days old** by the time you're deep in the results.

You cannot fix that by scrolling better. You have to know how old a listing is *before* you
read it.

→ **A recency window (7 days by default) applied before every other rule.** A listing older
than the window is gone before anything else looks at it, and a listing whose date can't be
parsed is never hidden by this rule — an unreadable date is not evidence of staleness.

### 2. Salary isn't a number, it's a sentence

The board doesn't give you a filterable salary field, and what's posted is free text:
`5.5$/hr`, `Php 1000/day`, `15-20 AUD per hour`, `PHP 49,000 - 55,000`, `TBD`, `Negotiable`.
Two of those can't be compared to each other, and two of them aren't amounts at all.

→ **"Has salary" requires a digit.** `TBD`, `N/A`, `Negotiable`, `DOE`, `to be discussed`
and an empty field all fail. A label is not a number.

→ **Every readable figure is converted and shown next to the site's own text** —
`≈ ₱34,500/mo` — with the original wording never replaced, and no figure at all when the
parser can't honestly read one.

### 3. The board can't express what you don't want

The board gives you a keyword box and no way to say *don't show me this kind of job again* —
no negative filter, no blocklist. And on this board the word-versus-substring line is
everything: the first version matched keywords as substrings, and on a live search, `AI`
as a substring matched **every single listing** on the page. Because a listing that also
looks good is shown rather than hidden, a loose match doesn't produce obvious breakage —
it quietly turns keyword hiding off altogether, and the user concludes the filter just
doesn't work.

→ **Keywords are matched as exact words or phrases**, case-insensitively. `ai` matches
`AI tools` and `AI-powered` but never `email` or `daily`. `video editor` doesn't match
`video editors` — the list is read literally, because predictable beats clever in something
you have to trust.

### 4. Hiding the right thing is not the same as hiding aggressively

Three genuinely different situations were being collapsed into "hide":

- a listing that is simply irrelevant,
- a listing that matches a keyword you hate **but looks like a good job**, and
- a listing you want to see more of.

A binary filter forces you to pick which of those to sacrifice.

→ **Three outcomes, not two.** Negative keywords hide. Positive keywords highlight and
**never hide**. And a listing matching a hated keyword *while also* matching a positive
keyword or paying at or above your goal is shown in **yellow** — the one state where a
listing is displayed *because* it's suspicious, so you can reconsider it without switching
the whole filter off.

→ **Every mark names its reason.** A green `✓ keyword` badge on highlighted cards, a red
`✗ keyword` badge on every card a negative keyword matched. Nothing on the page is marked
without saying why.

### 5. The card is not the listing

A search card carries a title and a salary line. **The rest of the truth is in the
description**: the keyword the card never mentions, the link that takes you off the board, the
`HOURS PER WEEK` that turns an assumed month into a real one, the pay that changes between
the overview and the body.

So the choice was: open every listing by hand (the thing you were trying to stop doing), or
judge on partial information and be wrong sometimes.

→ **`Scan` reads the listings themselves.** One button pages to the end of your recency
window, then opens each listing and re-decides it against its full description. Two at a
time, 400 ms apart, a `Stop` button throughout, and a hard stop at 10 pages / 300 listings.
The scan also prints the listing's own `HOURS PER WEEK` on the card and flags a week longer
than 40 hours.

→ **A second run costs nothing.** Everything read is cached for 7 days, so **changing a
keyword re-tiers the page without a single request** — measured, not aspirational. That
matters because tuning keywords is the thing you do most, and it should be free.

### 6. "More matches" is not "better matches"

A filter that ranks listings by keyword affinity stops being a filter. The earlier version
demoted off-platform listings (ones that ask you to apply by email, Telegram or a Google
Form) and, in one measured run, **moved 176 of 227 scanned listings out of High yield** — a
filter that had quietly stopped filtering.

The same trap sits in the obvious design: "a keyword you like" is not "a job worth taking".
A listing you like the sound of that pays below your goal is not high yield.

→ **Pay decides high yield. Keywords only ever decorate.** `High yield` means *it pays at or
above one of your goals* **and** no keyword you asked to hide matched. Matching a keyword is
a badge, never the reason.

→ **Off-platform asks are a tag, not a filter.** `⚠ off-platform` beside the keyword badge.
Never hidden for it, never demoted for it — you decide.

→ **The tiers are buttons, and choosing one isn't a reorder.** `High yield N` / `Worth N`
filters the board to that tier; `All` puts it back. The site's own list order and its
next-page behaviour are untouched. And picking a tier **scrolls to its first card** — because
hiding most of a long list leaves you staring at empty space: measured, the first high-yield
card sat **18 000 px above the viewport** after the document shrank from 92 000 px to 19 000.

→ **Movement is visible.** When a listing moves between tiers the card carries `↑ promoted`
or `↓ demoted` until you open it, so a changed verdict never happens silently.

---

## The place this could have quietly lied: monthly salary

Converting hourly rates into monthly figures is where a helpful-looking tool does real
damage. A part-time listing that posts `$5/hour` and doesn't state its hours has no honest
monthly equivalent — assuming a 40-hour week is how a ₱27,000 job becomes a ₱50,000 one.

So the conversions refuse to guess:

| Input | Output | Why |
|---|---|---|
| `PHP 49,000 - 55,000` | `≈ ₱49,000 - ₱55,000/mo` | Stated per month; direct conversion |
| `$5/hour`, *full time* | monthly figure **+ `assumes 40 h/week (full time) — verify with the employer`** | The assumption is disclosed on the card, not buried in a docstring |
| `$5/hour`, part time, hours unstated | stays `≈ ₱314/hr` | No month is claimed |
| `Php 1000/day` | stays per-day | Days per week is never stated |
| `$5 per entry` | **no figure** | There is no honest monthly equivalent for a piece rate |
| `1000` (no currency, no unit) | `≈ ₱62,732/mo` | Read by magnitude — on this board 5+ digits is a monthly peso figure, 3–4 is a monthly dollar figure, 1–2 is hourly. Only applies when no unit is stated |
| rate unavailable | no figure | A stale ₱ number is worse than none |

Measured on a live board: **12 of 60 cards quoted an hourly rate, and 7 of those were
part-time** — a majority. Guessing here would have misled on most of them.

Goals follow the same logic: **a monthly goal judges monthly figures, an hourly goal judges
hourly ones**, and a listing is judged on the **low end of a range** so a "maybe" isn't
scored as a yes.

---

## The part that makes it usable rather than merely clever

**Nothing disappears silently.** The panel reports the hidden total with a line per reason,
plus stats for keyword-hidden, highlighted and "worth a second look", and every line shares
the colour of the mark it refers to on the cards. `Show All` reveals everything, with
keyword-hidden cards returning under a red dashed marker.

**A filter you can't audit is a filter you stop trusting** — and an untrusted filter gets
turned off, which puts you back at problem one.

**One 297-job search is one continuous scroll.** Reaching the bottom appends the next result
page, one page per real scroll, one request per page, stopping at the end of the results — or
the moment a page adds nothing new. It replaces eight clicks on *Next*.

**It remembers each listing.** Every scanned or opened listing keeps its verdict, its figures
and its flags, keyed by the listing's own URL. Opening a listing re-checks it against the live
page, records what changed, and clears the mark — so the memory is a record, not a stale
opinion.

---

## What it replaced

| Before | After |
|---|---|
| Scroll → open → read → close, for every listing | Listings failing the rules never reach your eyes |
| Staleness invisible until page 5+ (measured 40–46 days deep) | Recency window applied first, on the card |
| Salary as incomparable free text, or a label like `TBD` reading as a number | Digit requirement + converted, disclosed figures |
| A substring keyword that silently matched everything | Exact word/phrase matching |
| Binary hide → sacrifice either coverage or relevance | Hide / highlight / reconsider, each badged |
| Judging a listing by its card, or opening all of them | `Scan` reads the listings themselves, two at a time, cached for 7 days |
| Keyword affinity promoted as if it were job quality | Pay decides `High yield`; keywords only decorate |
| Off-platform asks demoted (176 of 227 listings lost) | A `⚠` tag you decide on — never a demotion |
| Filtering to a tier and losing your place | Scrolls to the tier's first card |
| The same judgement re-paid every day | A per-listing memory keyed by URL |
| Eight clicks on *Next* per search | Perpetual scroll, one request per page |
| No idea what was filtered or whether it's working | Auditable panel with per-reason counts and a one-click reveal |

---

## Privacy, because a job hunt is private

A browser extension that reads your job search is a serious position of trust.

- **Bounded, and switchable.** With `autoLoad` and `autoScan` both off, no keywords and no
  scan running, the extension talks to nothing at all. A scan is automatic on search-page load
  by default (`autoScan`), but every run is bounded to the recency window, two at a time, with
  a Stop button and hard caps.
- **Every read of a job's own page is a scan read.** A scan runs automatically on search-page
  load by default, or on demand when you press `Scan`, and every run is bounded to listings
  inside your recency window, two at a time, with a Stop button and hard caps.
- **One third-party call, on demand.** Foreign-currency conversion asks the ECB's reference
  rates (via `api.frankfurter.dev`) once per currency per 24 hours, and only when a card
  on screen actually pays in that currency. No amount, keyword or anything about you is
  sent — it's a plain request for a public exchange rate.
- **One site.** The content script is injected only on `onlinejobs.ph`. No other host is
  contacted and there is no remote code.
- **Local state only.** Keywords, toggles, cached rates and per-listing verdicts live in
  `chrome.storage.local`; the listing pages a scan read are cached in IndexedDB on the
  site's own origin. No server, no account, no analytics.

---

## How it's checked

Unit tests cannot see a missing permission or a renamed selector, so the repo doesn't rely
on them:

```bash
npm test         # rules, tiers, records, salary, pagination, manifest integrity — zero deps
sh tools/gate.sh # syntax + tests + hygiene + README truth + personal-path scan
```

The pure logic is split out precisely so it *can* be asserted without a browser: `rules.js`
(hide/show decisions), `tiers.js` (the verdict table), `records.js` (the memory's pruning,
caps and tier moves), `salary.js` (the figure parser) and `pagination.js` (the URL/offset
maths) all have no DOM and are unit-tested directly.

`tools/verify-live.mjs` is the one that matters: it reloads the extension in a real Chrome
over CDP, loads the live site, recomputes the expected result from the DOM and compares —
asserting the panel's counts, that hidden cards are really `display:none`, the show-all /
re-hide toggle, and that saving settings repaints the list with no reload.

Two habits worth keeping: the salary parser is tested against a corpus **sampled from the
live board**, because the failures that matter here are format failures and invented test
data wouldn't contain them; and the README is machine-checked for truth (`tools/check-readme.js`
verifies every setting is documented), because documentation drifts exactly when it is most
needed.

---

## Status and limits

- **The scan is deliberately bounded.** 10 pages / 300 listings per run, two listings at a
  time, 400 ms apart. It is a courtesy budget for a site that isn't mine, not a limitation
  to be optimised away — see `docs/scraping.md`.
- **The cache has edges.** 7-day TTL, 1 000 entries. Past either, a listing is read again.
- **Paginated results only.** No cross-search state and no resume-across-sessions; the
  memory is per listing, not a saved search.
- **Chromium-family browsers** (Manifest V3).
- **Not open source.** Public to read; no license is granted.
