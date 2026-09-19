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

## The four problems it actually attacks

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

### 3. A careful filter is easy to build and easy to destroy

The first version matched keywords as substrings. On a live search, the keyword `AI` matched
**every single listing** on the page. Because a listing that also looks good is shown rather
than hidden, a loose match doesn't produce obvious breakage — it quietly turns keyword
hiding off altogether, and the user concludes the extension just doesn't work.

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

---

## What it replaced

| Before | After |
|---|---|
| Scroll → open → read → close, for every listing | Listings failing the rules never reach your eyes |
| Staleness invisible until page 5+ (measured 40–46 days deep) | Recency window applied first, on the card |
| Salary as incomparable free text, or a label like `TBD` reading as a number | Digit requirement + converted, disclosed figures |
| A substring keyword that silently matched everything | Exact word/phrase matching |
| Binary hide → sacrifice either coverage or relevance | Hide / highlight / reconsider, each badged |
| Eight clicks on *Next* per search | Perpetual scroll, one request per page |
| No idea what was filtered or whether it's working | Auditable panel with per-reason counts and a one-click reveal |

---

## Privacy, because a job hunt is private

A browser extension that reads your job search is a serious position of trust.

- **No request you didn't ask for.** With `autoLoad` off and no keywords configured, the
  extension talks to nothing at all.
- **One third-party call, on demand.** Foreign-currency conversion asks the ECB's reference
  rates (via `api.frankfurter.dev`) once per currency per 24 hours, and only when a card
  on screen actually pays in that currency. No amount, keyword or anything about you is
  sent — it's a plain request for a public exchange rate.
- **One site.** The content script is injected only on `onlinejobs.ph`.
- **Local state only.** Keywords, toggles and cached rates live in `chrome.storage.local`.
  No server, no account, no analytics.
- **No crawling.** It fetches result pages the site would have served you anyway, one per
  scroll. It never walks into job detail pages.

---

## How it's checked

Unit tests cannot see a missing permission or a renamed selector, so the repo doesn't rely
on them:

```bash
npm test         # rules, salary parser, pagination maths, manifest integrity — zero deps
sh tools/gate.sh # syntax + tests + hygiene + README truth + personal-path scan
```

`tools/verify-live.mjs` is the one that matters: it reloads the extension in a real Chrome
over CDP, loads the live site, recomputes the expected result from the DOM and compares —
asserting the panel's counts, that hidden cards are really `display:none`, the show-all /
re-hide toggle, and that saving settings repaints the list with no reload.

The salary parser is tested against a corpus sampled from the live board, because the
failures that matter here are format failures, and invented test data wouldn't contain them.

---

## Status and limits

- **Deep scan is not shipped.** `autoScan` exists in the option set but is disabled in the UI
  — it would mean fetching each listing's detail page, and the request budget for that is
  still being decided. The README does not claim it.
- **Current page and paginated results only.** No cross-search state, no resume.
- **Chromium-family browsers** (Manifest V3).
- **Not open source.** Public to read; no license is granted.
