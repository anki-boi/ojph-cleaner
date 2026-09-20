# Store submission — Chrome Web Store

Everything the listing needs, and where it comes from. Regenerate the assets after any UI
change; the copy below is drop-in.

## 1. Assets

| Asset | Requirement | File | Status |
|---|---|---|---|
| Extension icon | art at **96×96** inside a **128×128** PNG, 16px transparent padding | `icons/128.png` (+ `48`, `16`) | ✅ generated |
| Screenshot 1 | **1280×800** (or 640×400), square corners, full bleed | `docs/img/store/01-list-1280x800.png` | ✅ |
| Screenshot 2 | same | `docs/img/store/02-settings-1280x800.png` | ✅ |
| Screenshot 3 | same | `docs/img/store/03-card-1280x800.png` | ✅ |
| Small promo tile | **440×280** — **required** | `docs/img/store/promo-440x280.png` | ✅ |
| Marquee promo tile | 1400×560 — optional, front page | `docs/img/store/marquee-1400x560.png` | ✅ |

At least 1 screenshot is required; 5 is the maximum, so there is room for two more later.
Slot 1 is the list in context, slot 2 is the settings panel open over the live list, and slot 3
is a single card up close (letterboxed onto the 1280×800 canvas — a result card is ~1608×584,
so no 1.6:1 crop of one shows it whole without slicing the description mid-sentence).

**Retake the captures, then cut them to size:**

```bash
node tools/capture-screens.js        # drives the live site → docs/img/*.png
node tools/make-store-images.js      # → icons/ + docs/img/store/
```

`capture-screens.js` drives the automation Chrome on :9333 (see `docs/HANDOFF.md` §2), opens its
own tab and closes it, seeds a known set of keywords and goals, and restores the previous
settings afterwards — including on failure. It does not touch the user's own tabs or leave their
browser reconfigured. `--scan` makes it press `Scan` first, which reads listing pages for real and
is therefore off by default.

Do not hand-crop these. The store rejects any screenshot that is not exactly 1280×800 or 640×400,
so a hand-made file that looks right on screen can still fail at upload — and it silently goes
stale the next time the UI changes.

## 2. Listing copy

**Name** (`manifest.json` → `name`, limit 75 chars; keep the store display name identical):

```
OJ.ph Cleaner
```

The name is deliberately our own compound. `OnlineJobs.ph` appears **only in the
description**, as a statement of compatibility — never in the name, and never as a claim of
association. See §5.

**Summary** (`manifest.json` → `description`, **hard limit 132 chars** — currently 126):

```
Hides stale, no-salary and keyword-matching jobs on OnlineJobs.ph, highlights the ones you want, and re-reads listings in full
```

**Detailed description** (paste into the listing):

```
Stop reading dead listings.

OnlineJobs.ph gives you a list and no way to narrow it. The two facts that decide whether a
listing is worth your time — does it pay, is it fresh — are not fields you can filter on.
So the hunt becomes: scroll, open, read, close, repeat.

OJ.ph Cleaner is the filter the board doesn't ship.

WHAT IT DOES

• Hides stale listings. A recency window (7 days by default) is applied before anything
  else. Shortcut: 0 = off, 7 = last week, 30 = last month.

• Hides listings with no salary. The salary field must contain a digit. "TBD", "N/A",
  "Negotiable", "DOE" and an empty field all fail — a label is not a number.

• Hides the keywords you never want to read again. Matched as exact words or phrases, so
  "ai" matches "AI tools" but never "email".

• Highlights the ones you want, and never hides them for it. A green outline and a badge
  telling you which keyword matched.

• Shows what a listing actually pays. "5.5$/hr", "Php 1000/day" and "15-20 AUD per hour"
  are not comparable, so each card gets a converted monthly figure at live ECB rates, next
  to the site's own wording — which is never replaced.

• Does not guess. A part-time hourly rate that doesn't state its hours keeps its hourly
  figure instead of inventing a month, and when a month is assumed from "full time" the
  card says so.

• Sets salary goals. A monthly goal and an hourly one; listings at or above either get a
  green wash. Ranges are judged on the low end, so a "maybe" is not a yes.

• Scans the whole window when you ask. One button pages to the end of your recency window
  and opens each listing to re-decide it against its full description — two at a time, with
  a Stop button and hard caps. Results are cached for 7 days, so changing a keyword costs
  no requests at all.

• Keeps scrolling. The next page of results is appended when you reach the bottom, so a
  297-job search is one continuous scroll instead of eight clicks on Next.

• Tells you what it did, and shows you. A panel reports the counts per reason, and one
  click reveals everything it hid. Nothing disappears silently.

PRIVACY

• No account, no server, no analytics. Everything runs on your machine.
• No request you didn't ask for: with auto-load off, no keywords and no scan, the
  extension talks to nothing at all.
• The only third-party call is a public exchange rate (ECB, via frankfurter.dev), asked
  once per currency per 24 hours and only when a listing on screen pays in that currency.
  No amount, keyword, or anything about you is sent.
• Keywords, toggles, cached rates and per-listing verdicts stay in local storage. Listing
  pages a scan read are cached in IndexedDB, on the site's own origin.
• The content script runs only on onlinejobs.ph and contacts no other host.

DISCLAIMER

Not affiliated with, endorsed by, or produced by OnlineJobs.ph. This is an independent
browser extension that reads the job-search pages you are already viewing.

MIT licensed. Source: https://github.com/anki-boi/ojph-cleaner
```

## 3. Permission justifications

The review asks for a justification per permission. Keep these short and literal.

| Permission | Justification |
|---|---|
| `storage` | Stores the user's keyword lists, toggles, salary goals, cached exchange rates and per-listing verdicts locally, so settings survive a reload. Nothing is transmitted. |
| Host permission `https://www.onlinejobs.ph/*`, `https://onlinejobs.ph/*` | The extension's entire function is to read and annotate the job-search result pages on this site. It runs a content script there and nowhere else. |

`permissions` is exactly `["storage"]` — one permission. `activeTab`, `tabs`, `scripting`,
`webRequest` and `<all_urls>` are all deliberately absent; if a future change adds one, it
needs a justification here and a second look at §4.

## 4. Data usage disclosures

Answer **no** to collecting or using any of the store's data categories (personally
identifiable information, health, financial, authentication, personal communications,
location, web history, user activity, website content).

The honest qualifications, if a field invites detail:

- **Website content is read but not collected.** The content script reads the listing text
  on the page in front of the user in order to decide what to hide or highlight. That text
  is processed locally and never leaves the device.
- **The one outbound request** is a plain `GET` for a public ECB exchange rate. It contains
  no user data — no amount, no keyword, nothing identifying.
- **`host_permissions` is one site.** No other host is contacted, and the extension has no
  remote code.

A privacy policy URL is optional here since nothing is collected, but linking one is cheap
insurance: the repo's `SECURITY.md` is a reasonable stand-in, or add a short
`docs/privacy.md` and use its GitHub Pages/raw URL.

## 5. Naming, and why it is worded this way

The Chrome Web Store's impersonation policy says: *"Don't pretend to be someone else, and
don't represent that your product is authorized by, endorsed by, or produced by another
company or organization, if that is not the case."* It also requires not infringing on
others' intellectual property, and warns that *"the visibility of your Product may be
impacted if we believe it potentially infringes on intellectual property rights."*

The pattern that gets extensions pulled is being named **after** someone else's mark with no
brand of your own — in a real removal case, an extension was taken down for using *"for
Instagram"* in its branding *"without any other branding that is distinctive to the app."*

So, for this listing:

1. **The name is our own compound** and carries no claim of association.
2. **The site name appears only in the description**, as a statement of what it works on —
   the descriptive use the policy tolerates.
3. **The disclaimer in §2 states plainly** that there is no affiliation or endorsement.
4. **Nothing implies we are an official client, or an improved version of the site.** Do not
   add "Better", "Official", "Pro", or similar to the name later — that is the exact
   framing the policy targets.
5. **No third-party logos or brand colours** in the icon, screenshots or promo tiles.

## 6. Pre-submission checklist

- [ ] `manifest.json` `description` is **≤ 132 chars** (a longer one is rejected at upload)
- [ ] `manifest.json` `version` bumped for the release
- [ ] `sh tools/gate.sh` passes
- [ ] `node tools/capture-screens.js` then `node tools/make-store-images.js`
- [ ] Screenshots are exactly 1280×800 and are not letterboxed or rounded
- [ ] 440×280 promo tile uploaded (required — submission fails without it)
- [ ] Permission justifications from §3 pasted
- [ ] Data disclosures from §4 completed
- [ ] The disclaimer sentence is in the detailed description
- [ ] Test the packaged ZIP by loading it unpacked from a clean profile once
