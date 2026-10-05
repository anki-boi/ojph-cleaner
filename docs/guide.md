# OJ.ph Cleaner: the full guide

Every rule, mark and feature in detail. The [README](../README.md) is the tour; this is the manual.
Settings are documented in the README's [settings table](../README.md#settings).

## How it decides

Four rules, applied in this order to every listing on the page:

1. **Posted too long ago → hidden (*Too old*).** Every card carries its posted instant, and a listing older
   than your window (60 days by default) is gone before any other rule looks at it. On the live board the
   first page of a search is always fresh — this filter earns its keep on the pages behind it, where a
   297-job search was measured at **40-46 days old**.
2. **No pay → hidden (*No pay listed*).** The salary field must contain a digit. `TBD`, `N/A`, `Negotiable`,
   `DOE` and an empty field all fail.
3. **A word you block → hidden (*Blocked words*).** Matched as an **exact word or phrase**,
   case-insensitively — unless the listing also looks good, in which case see below.
4. **A word you're into → marked only (*Liked*).** Never hidden. The green outline and `✓ word` badge
   tell you why.

The first rule that matches wins, which matters when you read a count: with *no pay listed* turned off,
a no-pay card that also mentions a blocked word moves into the *Blocked words* bucket.

A word you're into is a **mark, not a promotion**: it never hides a listing, and it never makes one a top
pick either — only pay does that (see *Top picks* below).

**A word you block, on a job you'd want, makes it a Maybe instead of disappearing.** If a listing mentions
a blocked word *and* either mentions a word you're into or pays at or above one of your minimums, it stays
on the page with a yellow outline — the one state where a listing is shown *because* it is suspicious, so
you can reconsider it without turning the whole filter off. The exception: if the listing mentions *more
words you're into than words you block* and the pay clears your minimum by more than half again (50 % or
more above it), it is a Top pick, not a Maybe — Maybe is for the keepers you are not sure about, not the
ones you are. (This is our tier decision, and has nothing to do with the site's own promoted or featured
listings, which are judged exactly like every other card.) Nothing else changes about a Maybe: the salary
figure, the posted date and the listing itself are the site's.

**Both badges name the word.** A green `✓ word` badge sits top-right on a card that mentions a word you're
into, and a red `✗ word` badge sits in the same place on every card a blocked word matched — the Maybes,
and the hidden ones while you *Peek at hidden*. **When a listing matches words on both sides, it carries
both badges** — green and red side by side — so you see the whole trade-off and re-evaluate it yourself
instead of trusting the colour alone. So nothing on the page is marked without saying why.

**The bar (D45/D46).** A slim sticky bar at the top of the site's own results column — it scrolls with the
board and never covers a card. From left to right:

- **Filter pills**: `Everything` · `⭐ Top picks N` · `🤔 Maybe N` · `💚 Liked N`. An empty pill hides
  unless it is the one you are on.
- **`🙈 N hidden ▾`** — a separate control, deliberately: it opens the breakdown by reason, with a
  `Peek at hidden (N)` button (`Hide them again` while peeking). No two controls share a word, so "show me
  a tier" and "show me what you hid" can no longer be confused.
- **`● N new`** — listings posted since your last visit to this search.
- Buttons that appear when they have something to do: `📌 Compare N`, `🔥` streak, `🃏 Swipe`,
  `📋 My jobs`, `☆ Save` / `★ Saved` (this search), `🔎 N` (your other saved searches), and a suggested
  `Block "word"?`.
- **`Read posts`** (`Stop` while it runs, with a progress strip under the bar), and **⚙** for settings —
  saving applies to the listings immediately, with no reload.

Pressing a pill filters the board to that tier; `Everything` puts it back. **Nothing is reordered** — the
site's own list order and its next-page behaviour are untouched — and the board **scrolls to the first
card of the tier you picked**, because hiding most of a long list otherwise leaves you looking at empty
space (measured: the first top pick sat 18 000 px above the viewport after the document shrank from
92 000 px to 19 000).

**Keep scrolling.** When you reach the bottom of the list the next result page is appended, so a
297-job search is one continuous scroll instead of eight clicks on *Next*. One page per scroll, one
request per page, and it stops at the end of the results — or the moment a page adds nothing new.

**Read the whole window, then let every listing speak for itself.** `Read posts` does two things in
one pass — automatically when a search page loads (`autoScan`), or on demand when you press it:

1. **Loads every result inside your recency window.** The board is sorted newest-first, so it pages until a
   page's newest listing is already older than your window and stops there — no scrolling needed, and it
   stops early rather than walking the whole result set.
2. **Opens each listing and re-decides it with its full description.** A card carries only a title and a
   salary line; the description is where the rest of the truth is — the word the card never mentioned,
   the link that takes you off OnlineJobs.ph, the `HOURS PER WEEK` that turns an assumed month into a real
   one. **Two at a time, 400 ms apart**, Top picks first, with `Stop` throughout and a hard stop at 10 pages /
   300 listings. Everything it reads is cached for 7 days, so a second run costs nothing — and changing a
   word re-sorts the page **without a single request**.

**With `sortByPay` on (it is, by default), that run ends by ranking the board, best-paying first.** Sorting
waits for the reading for the same reason the reading exists: a card's figure is an *assumption* until the
listing's own `HOURS PER WEEK` is known, and a pay order built on assumptions would rank guesses. The order
persists as the loader appends later pages, so the board stays in one piece as you read down it.

**The three tiers in full.**

- **⭐ Top picks** — **it pays at or above one of your minimums**, and no word you block matched — or a
  blocked word matched, but it mentions more words you're into than words you block and the pay is at
  least 50 % above your minimum. Mentioning a word you're into is a bonus badge, never the reason: a
  listing you like the sound of that pays below your minimum is *not* a top pick. A top pick posted within
  the last 24 h also carries `● posted today` — the competition window is still open.
- **🤔 Maybe** — a blocked word matched and **the listing pays at or above one of your minimums**, but it
  is not clearly a keeper. These are the yellow cards, shown rather than hidden, and they badge both sides
  when both matched. Pay is the only thing that earns this tier: a listing that mentions a blocked word and
  a word you're into while paying below your minimum is **hidden**, not a Maybe — the minimum is a hard
  filter, so a word you're into can mark a listing and never rescue one.
- **💚 Liked** — a word you're into on a listing that pays below your minimum: the green outline and `✓`
  badge. Visible, never hidden, and deliberately not counted as a top pick.

Two marks annotate a card without changing its tier: `● posted today` on a top pick posted in the last
24 hours, and `⚠ reposted` on the OLDER copy when the board re-posts the same title and company. When a
listing moves between tiers after its post is read, the card carries `↑ better than it looked` or
`↓ worse than it looked` until you open it. The saved-jobs table carries the same verdicts inline: a row
whose listing has been read shows `★ top pick`, `maybe`, or `✓ liked` beside it, and the marks follow a
re-read in another tab.

**Off-platform asks are a tag, not a filter.** A listing that asks you to apply by email, Telegram or a Google
Form gets a `⚠ wants you off OLJ` tag beside its badge. It is never hidden for it and never demoted for it
— the tag is there so you can decide. (An earlier version demoted them, which moved 176 of 227 read
listings out of the top tier: a filter that had stopped filtering.) Reading a post also prints its own
`HOURS PER WEEK` on the card, and flags a week longer than 40 hours.

**It remembers each listing.** Every read or opened listing keeps its verdict, its figures and its
flags, keyed by the listing's own URL — so opening a listing re-checks it against the live page, records
what changed, and clears the mark.

**Take the memory out.** `Download CSV`, in the footer of the settings drawer, downloads it — one row per
remembered listing: tier, the words that matched, hours, pay, flags, and when it was last checked, with
the listing's URL filled in from the cache (a blank URL when the cache has already let one go). The button
is disabled while the memory is empty: there is nothing to export.

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
convertible, so those cards carry `if full-time (40 h/wk) — confirm the hours` under the figure. Do not
trust the monthly number blindly.

**A bare number is read by its size**, because on this board the size is the tell: 1-2 digits are an
hourly rate, 3-4 digits a monthly rate in dollars, 5+ digits a monthly peso figure. That is how `1000`
becomes `≈ ₱62,732/mo` (a U.S. listing quoting `$1,000 per month`) instead of ₱1,000. It only applies
when the listing states no currency and no unit — `Php 1000/day` stays pesos, `140-175/per hour` stays
pesos.

Foreign currencies use the ECB's live reference rate, and if that rate cannot be fetched the card is
left unconverted rather than showing a stale ₱ figure.

Set *My minimum pay* per month and/or per hour and every job **at or above it brightens up** — a green
wash, the figure in stronger green, and a `★ meets your monthly minimum` (or `hourly`) line. The more the
pay beats the minimum, the stronger the mark: `★★ 25 %+ over` it, `★★★ 50 %+ over` it (the same line that
lets a top pick survive a blocked word). One minimum judges each card: **Full Time is judged monthly,
Part Time and everything else by the hour**, and a listing that quotes only a month is judged monthly
because there is no rate to compare. Both are judged on the low end of a range, so a "maybe" is not a
yes. The hourly minimum exists because a listing that only posts `$5/hour` has no month to compare
against — and converting one would mean assuming a work week.

**Pay in pesos or dollars (D66).** `currency` picks `PHP` or `USD`. Figures and your minimums display in
it; every comparison is still made in pesos, so switching changes no verdict. Switching converts your
minimums on the spot at the ECB reference rate — an amount under $100 keeps its cents ($5.50/hr is a real
minimum), a larger one rounds to whole dollars — and a toast says the rates are the ECB's reference rates,
refreshed daily. If the dollar rate cannot be fetched, figures stay in pesos and the minimums are not
judged, rather than judged at a guessed rate.

## Your own calls: triage, My jobs, and the rest

The rules above are the extension's judgement. These features keep **yours** — and none of them changes
why a listing got its tier.

**First-run setup (D49/D50).** A fresh install — no saved settings at all — gets three screens, each
skippable: *What are you hunting?* (becomes *I'm into*), *What's the least you'd take?* (per month; the
hourly is suggested as monthly ÷ 173.3 — 40 h × 52 weeks ÷ 12 — shown and editable, so ₱50,000 suggests
₱288), and *Instant no?* (toggleable chips — `crypto`, `cold calling`, `commission only`,
`appointment setter`, `unpaid trial`, `sales` — plus free text, into the block list). Skip keeps the
shipped defaults; Finish replaces only what you answered, and offers Undo. An existing install is marked
onboarded silently and never sees it. `⚙ → Advanced → Run setup again` reopens it.

**Triage on every card (D51).** Each card gets `💾 Save`, `✕ Not for me` and `📌`. *Not for me* hides that
listing for good, counted under the bar's *You passed*, with Undo; while peeking, the card offers
`↶ Show again`. Your decisions live in their own `chrome.storage.local` key, `myJobs` — never in
`settings` (a settings Save writes the whole object) and never in the job memory (which is re-derived and
rewritten), so nothing the extension recomputes can overwrite a call you made.

**Swipe (D52).** `🃏 Swipe` walks the cards the board is showing, in its order, one at a time: `←` not for
me, `→` save, `↑` applied, `Enter` open the post, `Z` undo, `Esc` close. A tier pill or the pay sort
decides what you swipe through, and *At a glance* is shown when the post has been read.

**Suggested block words (D53).** After at least 8 passes, a word or two-word phrase that appears in ≥ 50 %
of the listings you passed and ≤ 10 % of the ones you kept (saved or applied) is offered on the bar as
`Block "word"?`. Deterministic counting, per listing; the board's own boilerplate (`posted`, `see more`…)
and words already on your lists are excluded. It is never added for you — one click adds it, `✕` dismisses
that suggestion for good.

**New since your last visit (D54).** Per search (the page offset is ignored), with zero requests: cards
posted after your previous visit carry `● new since last visit`, and the bar says `● N new`. A reload, or
coming back within 30 minutes, is the same visit, so the marks you were reading do not vanish under you;
the very first visit to a search marks nothing.

**My jobs (D56/D61/D64).** `jobs.html`, opened from `📋 My jobs` on the bar or from a listing's own page. A
board of Saved → Applied → Interview → Offer with `←`/`→` moves, a note per job, a `📨 Follow up?` nudge on a
job applied 5 days ago with no move since, and a folded Passed list with `↶ Show again`. On a listing's own
page, `💾 Save` / `✓ I applied` / `✕ Not for me` / `📋 My jobs` sit under the figures bar and write the same
`myJobs`, so the board, the page and My jobs always agree.

- **Streak.** With `weeklyApplyGoal` above 0, the bar and My jobs show `🔥 Nd · X/goal` — days in a row
  with an application, and this week's count — counted from your own *Applied* marks.
- **Pay insights.** Two histograms — full-time jobs per month, part-time and gigs per hour, never one axis
  pretending they compare — with p25 / median / p75, *your minimum is above X % of them*, and a table view.
  Built only from the job memory on this device. It says plainly that `Read posts` reads Top picks first, so
  the numbers lean high.

**Trust tags (D57–D59) — tags, never gates.** None of these hides a listing or moves its tier (D38).

- **`⚠ risky N`** — a deterministic 0–100 score, every reason on hover: a fee asked of the applicant 40
  (only when the sentence puts it on the applicant and the employer is not the one paying — bookkeeping
  posts are full of fees), an off-platform ask 25, a redaction by the site 25 when it is the only trace of
  one (+5 alongside an ask — it is the same fact), unpaid trial or free test 20, crypto / forex /
  "investment opportunity" 20, pay ≥ 3× the board's median monthly figure 15, no company name 5. Tagged at
  40 or more: one serious signal, or two smaller ones together.
- **`🔁 posted N× in 30 days`** — the same company and title seen under 3 or more job ids in 30 days. Kept in
  its own `sightings` store, pruned at 30 days, so a re-post is visible across visits.
- **The post's hours in your time.** A stated range with a zone (`6:00 AM to 9:00 AM Philippine Time`,
  `9-5 EST`) is converted with `Intl` to your browser's zone, daylight saving included. A range with no
  zone gets nothing — *9 to 5* could be anyone's 9 to 5. With `myHours` set, the tag adds ✅ all inside /
  ⚠ partly / ✗ outside your hours.

**At a glance (D60).** A folded *At a glance* on every card whose post has been read: up to 3 lines each of
*You'd do* and *They want*, lifted word for word from the post's own headed sections, with the risk
reasons as *Watch out*. A post with no such headings gets no glance rather than a guess, and it is never
an LLM summary (`spec.md` §8: that would send the post to a third party, and could say things the post
never did).

**Compare (D62).** `📌` pins a card — up to 3 per tab, kept in `sessionStorage` because a comparison is a
moment's work, not a preference. `📌 Compare N` opens them side by side: pay, your minimum, hours, when in
your time, warning signs, resume fit, posted, marks. A 4th pin is refused with a toast.

**Saved searches (D63).** `☆ Save` on the bar keeps the search you are on (the `searches` setting holds
keywords or links). `🔎 N` adds the new listings from your OTHER saved searches to the current board —
de-duplicated, each tagged `🔎 keyword`, judged like any other card, and re-ranked by the pay sort
afterwards. Only on a button press, one request at a time ≥ 600 ms apart, at most 10 pages / 300 listings
across all searches together, split fairly (pages left ÷ searches left), each stopping at your recency
window and everything stopping at the first HTTP 429.
