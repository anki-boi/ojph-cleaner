# OJ.ph Cleaner

A Chrome extension that cleans up [OnlineJobs.ph](https://www.onlinejobs.ph) job-search pages.
It hides listings that are a waste of your time — no pay listed, too old, or a word you never want to
read again — and marks the ones you'd like, without ever taking a listing away because you liked it.
Everything runs on your machine: no account, no server, no analytics.

**What it addresses.** The board gives you a list and no way to narrow it. The facts that
decide whether a listing is worth your time — *does it pay, is it fresh, is it the kind of
work you want* — are free text inside the card, or inside a description you have to open.
Salaries aren't comparable (`5.5$/hr` next to `Php 1000/day` next to `TBD`), staleness is
invisible until you're pages deep (a 297-job search measured **40–46 days old**), and the
board remembers nothing — so the same judgement gets paid for again tomorrow.

This is the filter the board doesn't ship: hide what's too old, has no pay listed, or mentions a word you
block; mark what you're into, never by hiding; convert salaries into comparable figures; let `Read posts`
re-decide each listing against its full description; and keep your own calls — saved, applied, passed —
so tomorrow's board starts where today's left off.

**→ [Why this exists: the six problems it attacks, and the place it refuses to guess](PROBLEMS.md)**

![The bar counts what it hid, and the drawer edits the rules in place](docs/img/list-chip.png)

Jobs with no pay listed and jobs that mention a blocked word are gone; the bar at the top of the results
says exactly what it did, and `🙈 N hidden ▾` opens the reasons with one click to `Peek at hidden` — a card
hidden for a blocked word comes back with a red dashed marker, so the decision stays yours:

![The settings drawer: Basics up front, Advanced folded, Save always in reach](docs/img/options-panel.png)

Words you're into never hide anything. They mark the card with a green outline and a `✓ word` badge, so a
job you want floats to the top of your attention instead of disappearing by mistake:

![A card that mentions a word you're into](docs/img/highlight.png)

## Install

There is no store listing yet (`spec.md` D2). Load it unpacked:

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Open a search on OnlineJobs.ph — a slim bar appears at the top of the results. On a fresh install, a
   three-screen setup comes first (see *First-run setup* below); every screen can be skipped.

Chrome remembers an unpacked extension after a restart. After editing files, press **Reload** on the
extension card to pick the changes up.

## The words it uses

Version 0.16.0 renamed everything a person reads (D43) — the old names were private terms you had to learn
before the panel made sense. Only the display changed: setting keys, tier keys (`high`, `worth`, `pos`),
classes and ids are the same as before (D44), so saved settings and the remembered listings keep working.
Every word lives in one table, `labels.js`.

| You see | What it means |
|---|---|
| **⭐ Top picks** | Meets your minimum pay, and mentions no word you block (or it does, but pays 50 %+ over your minimum — see below). Called *High yield* before 0.16 |
| **🤔 Maybe** | Mentions a word you block, but meets your minimum pay — your call |
| **💚 Liked** | Mentions a word you're into, but pays below your minimum |
| **🙈 N hidden** | Why the rest are gone: *Too old*, *No pay listed*, *Blocked words*, *Closed*, *You passed* |

## What it does

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

## Settings

Press ⚙ on the bar, or use the standalone options page if you prefer a full tab. Both show the same groups:
**Basics** up front — *Never show me jobs that mention*, *I'm into*, *My minimum pay* (with the currency
picker), *Too old after N days* — and everything else folded under **Advanced** (D47). Both write the same
storage, and both take effect on every open tab immediately. Save applies at once and shows a toast with
one step of Undo (D48).

| Setting | Default | Meaning |
|---|---|---|
| `negative` | a starter list | *Never show me jobs that mention*: one word or phrase per line. A listing whose text contains any of them **as an exact word or phrase** is **hidden** (*Blocked words*), unless it meets your minimum pay (then it is a Maybe). |
| `positive` | a starter list | *I'm into*: one word or phrase per line. A listing whose text contains any of them **as an exact word or phrase** is **marked** (*Liked*), never hidden. |
| `noSalary` | on | *Hide jobs with no pay listed*: the salary field contains no digit (`TBD`, `N/A`, `Negotiable`, `DOE`, empty). |
| `rescueNoSalary` | on | With `noSalary` on: *…unless I'd like it* — a listing with no figure that mentions a word you're into, or meets your minimum, is **shown** instead of hidden. On by default (D42). |
| `rescueNegotiable` | on | With `noSalary` on: a listing that says **Negotiable** or **DOE** and mentions a word you're into is shown with a `⚠ negotiable` tag, instead of hidden. On by default (D42). |
| `maxAgeDays` | 60 | *Too old after* this many days: hide listings posted longer ago. `0` turns it off, `7` the last week, `30` the last month (default: the last two months). Applied **before** every other rule, and a listing whose date cannot be read is never hidden by it. |
| `showHidden` | off | *Peek at hidden*: reveal what was hidden, with a red dashed marker. The bar's `Peek at hidden` / `Hide them again` writes this. |
| `autoLoad` | on | Append the next page of results when you scroll to the bottom of the list. One page per real scroll, one request per page, and it stops at the end of the results. |
| `goalSalary` | 60000 | *My minimum pay*, per month (stored in PHP, shown in your `currency`). Cards whose converted salary is **at least** this much get a green wash and a `★ meets your monthly minimum` line. Judged on the low end of a range — a "maybe" is not a yes. `0` turns it off. |
| `goalHourly` | 1000 | The same, per hour: for listings that post an hourly rate, which a monthly minimum cannot judge. A card is brightened if **either** minimum is met. |
| `autoScan` | on | *Read full posts automatically* as soon as a search page loads. On by default (D42): every run is bounded to the recency window, two listings at a time, with hard caps — the `Read posts` button does the same thing on demand. |
| `scanWorth` | on | *…then the Maybes*: after the Top picks, keep reading into the Maybe listings. Off means a run stops after the Top picks. |
| `scanAll` | off | *…then everything else (slowest — can find hidden gems)*. This is the only pass that can lift a listing that matches no word and no minimum, and it is the most expensive one. |
| `sortByPay` | on | *…then sort by pay, best first*: when a run ends, rank the board by the figure on each card: the highest **monthly** figure first, then listings that post only a rate (per hour or per day), then the ones with no figure at all, which keep the site's own order. A month and an hourly rate are never converted into each other — that would assume a work week — so a ₱5,000/mo listing outranks a ₱500/hr one. The order stays as you scroll more pages in, and only after a run: until then the board is in the site's own newest-first order. |
| `dashboardUrl` | `http://127.0.0.1:8371` | The local dashboard from the sibling repo (`onlinejobs.ph-suite`). Each card gets **fits your resume N/M** — that dashboard's score for your resume against this listing — and the badge is a link that opens the job in the dashboard. Empty turns the bridge off; if nothing is listening there the extension stays silent. The score is the dashboard's, never this extension's: it has no resume and no scorer. |
| `currency` | `PHP` | Which currency every figure and your minimum pay are shown in: `PHP` or `USD` (D66). Only the display changes — every comparison is still made in pesos. The minimums are typed in this currency, and switching it in Settings converts them on the spot at the ECB reference rate (refreshed daily; under $100 keeps cents, larger rounds to whole dollars), so the floor means the same in either; a toast says so. If the dollar rate cannot be fetched, figures stay in pesos and the minimums are not judged rather than judged at a guessed rate. |
| `weeklyApplyGoal` | `0` | How many applications a week you aim for (D64). Above 0, the bar shows your streak (days in a row with an application) and this week's count against the goal; My jobs shows it too. Counted from your own ✓ Applied marks — nothing is sent anywhere. `0` turns it off. |
| `myHours` | empty | Your working hours in your own time zone, like `08:00-18:00` (D59). A post that states its schedule with a time zone (`6:00 AM to 9:00 AM Philippine Time`, `9-5 EST`) gets a tag with those hours converted to your zone — daylight saving included — and ✅ all inside / ⚠ partly / ✗ outside your hours. Without it, the tag still appears whenever the post's zone differs from yours. A range with no zone is never converted. |
| `searches` | empty | Your saved searches (D63), as keywords or search links. ☆ on the bar saves the search you are on; 🔎 adds the new listings from your OTHER saved searches to the board you are on — de-duplicated, each tagged with the search it came from — so several searches read as one list. Only on a button press, one request at a time, ≥ 600 ms apart, at most 10 pages and 300 listings across all of them, stopping at your recency window and at the first HTTP 429. |

Every word is an **exact word or phrase**, case-insensitively: `ai` matches `AI tools` and
`AI-powered` but never `email` or `daily`, and `video editor` does not match `video editors`. Add the
forms you want — the list is read literally, so `editor` and `editors` are two entries. That precision
is deliberate: `AI` as a substring matched **every** listing on a live search, and because a listing
that also looks good is shown as a Maybe rather than hidden, a loose match quietly turns blocking off
altogether.

The two lists can be moved out and back: `Copy lists` puts both on the clipboard in a plain, readable
format (a `# hide` section and a `# highlight` section), and `Paste lists` reads that format back — the
door for keeping the same lists on two machines, or for a backup in a notes app.

## Privacy

- **Bounded, and switchable.** With `autoLoad` off, `autoScan` off, no words and no reading, the
  extension talks to nothing at all. With `autoLoad` on it fetches one result page only when *you* scroll
  to the bottom of the list you are already reading. `Read posts` — which does open each listing's own
  page — runs on each search-page load when `autoScan` is on (the default), or on demand when you press
  it; either way two listings at a time, with `Stop` and hard caps, and everything it reads is cached so
  that a re-run asks for nothing. Saved searches (`🔎`) fetch only when you press the button.
- **One third-party call, on demand.** To convert a foreign-currency salary, or to show pay in dollars, the
  extension asks the European Central Bank's reference rates (via `api.frankfurter.dev`) once per currency
  per 24 hours, and only when it actually needs that rate. No amount, no word and nothing about you is
  sent — it is a plain request for a public exchange rate. A page of ₱-only listings, shown in pesos,
  makes no such call.
- **One site.** The content script is injected only on `onlinejobs.ph`; the host permission exists to
  read that page's listing DOM. The rate request needs no permission of its own (the API allows it)
  and no other host is ever contacted — the optional resume-fit bridge talks only to your own machine
  (`dashboardUrl`).
- **Local state.** Settings, the cached rates, the remembered verdict for each listing, your own calls
  (`myJobs`), the visit times and the re-post sightings live in `chrome.storage.local`; compare pins live in
  the tab's `sessionStorage`; the listing pages a run read are cached in IndexedDB, in the site's own
  origin. Pay insights, suggestions, risk scores and *At a glance* are computed from that, on this device.
  There is no server, no account, and no analytics. See `SECURITY.md`.
- **No unbounded crawling.** The loader fetches *result pages* the site would have served you anyway, one
  per scroll. `Read posts` — automatic on search-page load by default (`autoScan`), or on demand — is
  bounded to the listings inside your recency window, two at a time, with hard caps; saved searches share
  the same caps across all of them — see `docs/scraping.md` for the request budget.

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

Or, without touching your own browser: `node tools/sandbox.mjs` starts a throwaway Chrome with this folder's
extension loaded (CDP `Extensions.loadUnpacked` over `--remote-debugging-pipe`) and serves a reload endpoint
on its port + 1, so the harness runs against it with:

```bash
OJC_CDP_PORT=9444 OJC_RELOAD_URL=http://127.0.0.1:9445/reload node tools/verify-live.mjs
```

`tools/reload.mjs` reloads the extension in a browser you already have running (Edge on :9222 by default),
and `tools/shot.mjs` takes screenshots for checking UI changes by eye.

Unit tests cannot see a missing permission or a renamed selector; that harness can, and it asserts
the bar's counts, the `[hidden]` cards really being `display:none`, the peek/hide-again toggle, the
tier pills (each one, and the click back to Everything), and that saving settings repaints the list
without a reload. Its label checks read `labels.js`, so a rename cannot drift from the harness.

## Files

| Path | Purpose |
|---|---|
| `manifest.json` | MV3 manifest: `storage` permission, `onlinejobs.ph` host permissions, content script |
| `rules.js` | Pure rules — `hasSalary`, `matchKeywords`, `parsePosted`/`isStale`. No DOM, so it is unit-tested directly |
| `tiers.js` | The verdict table (W12): closed → too old → no pay listed → **Top pick (pay)** → Liked → Maybe → blocked. Pure and unit-tested |
| `records.js` | The job memory's state machine — pruning, tier moves, the `↑`/`↓` mark. Pure and unit-tested |
| `records-store.js` | The memory's state and persistence: loading, hydrating, flushing, absorbing a fetched listing. The only writer — it writes only when something changed |
| `records-cards.js` | Applies it to the board: the synchronous copy for the rule pass, the change marks (split from the row above at the sync/persistence boundary) |
| `detail-cache.js` | IndexedDB: the listing pages `Read posts` has read, 7-day TTL, 1 000-entry cap, so a word edit costs nothing |
| `detail-parse.js` | What a listing's own page says — one reader for the description, the overview fields and the job id |
| `scan.js` | `Read posts` (W13): page to the recency window, then 2 listings at a time, in tier order, with caps and Stop |
| `pay-sort.js` | Ranking the board by pay (`sortByPay`, D41): the three blocks, and the reorder that only writes when the order actually changed |
| `observer.js` | The one MutationObserver, and the `isOurs()` check that stops it eating itself |
| `closed.js` / `closed-cards.js` | The closed-listing memory (pure maths + the storage applier) |
| `detail-text.js` / `detail.js` | What to highlight on a listing's page, and the figures bar that applies it (W4) |
| `detail-actions.js` | `💾 Save` / `✓ I applied` / `✕ Not for me` / `📋 My jobs` under the figures bar on a listing's own page (W21.2) |
| `chip.js` | The status bar at the top of the results: the filter pills, the hidden breakdown with *Peek at hidden*, *Read posts* and ⚙ (D45/D46) |
| `labels.js` | Every word the extension shows, in one table (D43). `test-labels.js` fails if a retired word is shown anywhere |
| `toast.js` | The one-at-a-time notice at the bottom of the page, with Undo (D48) and the currency note (D66) |
| `export.js` | The CSV door's applier: asks the memory for its rows, asks the cache for the URLs, downloads the CSV |
| `page.js` | Every coupling to the site's list markup: the card selectors, the card's own text, its salary and its posted date |
| `content.js` | The hub: settings, the rule pass, the counts, the tier delegation, the views. Makes no request |
| `pagination.js` | Perpetual pagination: the scroll trigger, the fetch and the stop conditions (W6), plus `Read posts`' `loadOne` |
| `panel.js` | The settings drawer (the bar's ⚙): Basics, then Advanced; Save applies at once and offers Undo. Owns no rule logic |
| `setup.js` | The first-run setup (D49/D50): three skippable screens, fresh installs only, `Run setup again` |
| `myjobs.js` | Your own calls (D51/D56): the pure `myJobs` reducer — saved, applied, interview, offer, passed — kept apart from settings and the job memory |
| `triage.js` / `triage.css` | The card buttons (`💾 Save`, `✕ Not for me`), *You passed*, new since last visit, the suggested block word, and the bar's 🃏 / 📋 buttons |
| `swipe.js` | Swipe mode (D52): one card at a time, keyboard first |
| `suggest.js` | `Block "word"?` (D53): deterministic per-listing counting over what you passed and kept. Pure |
| `visits.js` | New since your last visit (D54): the per-search key and the visit cutoff. Pure |
| `jobs.html` / `jobs.js` | My jobs (D56/D64): the Saved → Applied → Interview → Offer board, notes, follow-up nudge, Passed list, streak |
| `insights.js` | Pay insights (D61): percentiles, histograms and *your minimum is above X %*, from the job memory on this device |
| `risk.js` | `⚠ risky N` (D58): the fixed signal table and the 0–100 score. Pure, never a gate |
| `schedule.js` | A post's hours in your time (D59): the zoned-range parser and the `Intl` conversion. Pure |
| `trust.js` | Paints the three trust tags on a card: risky, `🔁 posted N× in 30 days` (the `sightings` store), and the hours in your time |
| `glance.js` / `glance-cards.js` | At a glance (D60): the word-for-word extraction from the post's own sections, and the folded block on the card |
| `compare.js` | Pin up to 3 cards per tab and compare them side by side (D62) |
| `searches.js` | Saved searches (D63): ☆ Save, and 🔎 checking the others into this board inside the shared caps |
| `salary.js` | Free-text salary → monthly figure, currency and units (W7). Pure and unit-tested |
| `salary-cards.js` | Applies it: the live ECB rate, the figure on each card, the minimum-pay brighten, the display currency |
| `dashboard-fit.js` | The pure half of the bridge to `onlinejobs.ph-suite`: request shape, 50-per-request batching, the badge, the deep link |
| `dashboard-cards.js` | Applies it: one localhost call per page of cards, the **fits your resume** badge, the link back to the dashboard |
| `ui.css` / `content.css` | The extension's own UI (bar, drawer, toast, overlays) vs what is painted on the site (marks, borders, badges) |
| `options.html` / `options.js` | Standalone options page, mirroring the drawer's Basics / Advanced groups |
| `test-rules.js` / `test-tiers.js` / `test-records.js` / `test-detail.js` / `test-closed.js` / `test-manifest.js` | Node tests, zero dependencies |
| `test-labels.js` / `test-setup.js` / `test-myjobs.js` / `test-triage.js` | Node tests for the words, the first-run setup, the `myJobs` reducer and triage (suggestions, visits) |
| `test-insights.js` / `test-trust.js` / `test-glance.js` | Node tests for pay insights, the trust tags (risk, re-posts, schedule) and At a glance |
| `test-paysort.js` / `test-dashboard.js` | Node tests for the pay sort and the resume-fit bridge |
| `test-pager.js` | Node tests for the pagination URL/offset maths and the stop conditions |
| `test-salary.js` | Node tests for the salary parser — the suite's real-data corpus plus formats sampled from the live board |
| `test-repo-hygiene.js` | Repo invariants (license stance, required files, hook wiring, no CRLF) |
| `tools/gate.sh` | One command: syntax + tests + hygiene + README truth + personal-path scan |
| `tools/check-readme.js` | Keeps this file true: every setting documented, no stale counts |
| `tools/verify-live.mjs`, `tools/cdp.mjs` | Live end-to-end check against the real site over CDP |
| `tools/sandbox.mjs` | A throwaway Chrome with this folder's extension loaded (over the debugging pipe), for testing without touching your own browser |
| `tools/reload.mjs` | Presses the extension's Reload button in a running browser (Edge on :9222 by default) |
| `tools/shot.mjs` | Screenshots a page in a CDP browser after an optional script — for checking UI changes by eye |
| `docs/architecture.md` | How the pieces fit; the invariants that must not regress |
| `docs/scraping.md` | What it fetches, when, and the politeness budget |
| `docs/HANDOFF.md` | Runbook: environment, traps, resume commands |
| `spec.md` | Audit, verified defects, decisions and the wave plan |
| `plans/2026-10-04_revamp.md` | The revamp plan: plain words, one bar, setup, triage (D43–D66) |

## License

Copyright (c) 2026 Jeyson Anki. **All rights reserved.** This repository is public to read, but no
open-source license is granted: the absence of a `LICENSE` file is deliberate, and no reuse is
permitted without written permission.
