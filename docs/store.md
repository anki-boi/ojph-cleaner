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
| Screenshot 4 | same | `docs/img/store/04-lowball-1280x800.png` | ✅ |
| Screenshot 5 | same | `docs/img/store/05-setup-1280x800.png` | ✅ |
| Small promo tile | **440×280** — **required** | `docs/img/store/promo-440x280.png` | ✅ |
| Marquee promo tile | 1400×560 — optional, front page | `docs/img/store/marquee-1400x560.png` | ✅ |

At least 1 screenshot is required; 5 is the maximum, and all five are used. Every image is recorded
on a made-up board (`tools/fiction.mjs`), so no real employer appears.
Slot 1 is the list in context, slot 2 is the settings panel open over the live list, and slot 3
is a single card up close (letterboxed onto the 1280×800 canvas — a result card is ~1608×584,
so no 1.6:1 crop of one shows it whole without slicing the description mid-sentence).

**Retake the captures, then cut them to size:**

```bash
OJC_SANDBOX_PORT=9454 node tools/sandbox.mjs              # a throwaway Chrome with this checkout
node tools/capture-screens.js --port=9454                  # the made-up board → docs/img/*.png
node tools/record-gifs.mjs --port=9454                     # → docs/img/bar.gif, setup.gif
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node tools/make-store-images.js
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

**Summary** (`manifest.json` → `description`, **hard limit 132 chars** — currently 120):

```
See every OnlineJobs.ph job's real hourly rate, hide stale, unpaid and unwanted posts, and flag lowball offers to report
```

**Detailed description** (as live in the dashboard since 0.19.0 — the listing's own voice, updated):

```
Tired of scrolling past job posts with no salary, posts from three months ago, and "$2/hr, must know everything"?

OJ.ph Cleaner tidies up your OnlineJobs.ph search results so you only spend time on jobs worth applying to.

WHAT IT DOES

• Shows every job's real hourly rate, first. "$5/hr", "PHP 20,000 per month" and "15-20 AUD per hour" all become one hourly figure in pesos or dollars, worked out from the post's own stated hours. ₱20,000 a month for 45 hours a week reads ≈ $1.77/hr, so jobs with different hours finally compare.
• Never guesses. "Full Time" is not a number of hours: until a post's hours are known, the card shows "? /hr" and the extension reads the post to find them.
• Hides the junk: listings with no pay ("TBD", "Negotiable", "DOE"), listings that are too old, gigs that don't say their hours, and anything that mentions words you block, like "unpaid trial" or "commission only".
• Tells you why. One click shows what was hidden and the reason, and you can peek at them anytime.
• Highlights what you want. Jobs that meet your minimum pay become ⭐ Top picks, and jobs that mention words you like get a green badge.
• Flags lowball offers. Jobs that work out at $2/hr or less (you choose the line) get a black ⚫ outline, and you can report them to OnlineJobs.ph as "Salary too low", one listing at a time, each shown to you before anything is sent.
• Reads the full post for you, and flags red flags like a job that wants you to apply off the platform.
• Swipe through your shortlist with the arrow keys: save, pass, or mark as applied.
• My jobs keeps track of everything you saved and applied to, with notes and a reminder to follow up. Export your Top picks, Maybes or Liked jobs to a spreadsheet, sorted by hourly rate.

Setup takes a minute: pick your kind of work (15 presets, from General VA to Medical VA) and your experience level, and your keyword lists fill themselves in. Then the least you'd take, and your instant no's.

PRIVATE BY DESIGN

No account, no server, no tracking. Everything stays on your computer. The only outside request is a public exchange rate, so salaries in other currencies can be converted. The only thing ever sent to OnlineJobs.ph is a "Salary too low" report you choose to send, through the site's own report feature.

SOURCE CODE ON GITHUB

See how it works, report a bug, or suggest a feature:
https://github.com/anki-boi/ojph-cleaner

Not affiliated with or endorsed by OnlineJobs.ph.
```

## 3. Permission justifications

The review asks for a justification per permission. Keep these short and literal.

| Permission | Justification |
|---|---|
| `storage` | Stores the user's keyword lists, toggles, salary goals, cached exchange rates and per-listing verdicts locally, so settings survive a reload. Nothing is transmitted. |
| Host permission `https://www.onlinejobs.ph/*`, `https://onlinejobs.ph/*` | The extension's entire function is to read and annotate the job-search pages on onlinejobs.ph. It runs a content script there and nowhere else. The one request it sends to the site is OnlineJobs.ph's own "Salary too low" report for a listing, made only when the user presses Report on that listing and confirms, from the user's own signed-in tab. |
| Single purpose | Filters and annotates job listings on OnlineJobs.ph search pages: it hides listings that are too old, list no pay, or mention words the user blocks, highlights the ones the user wants, and converts posted salaries into one comparable hourly figure from each post's own stated hours. The user can also report a listing that pays too little to OnlineJobs.ph, one listing at a time, through the site's own "Salary too low" report. |
| `web_accessible_resources`: `jobs.html`, `options.html` | So the buttons on the job board can open the extension's own My jobs and settings pages in a new tab. No script or data is exposed to the site. |

The store build (`sh tools/make-store-zip.sh` → `dist/`) drops the `127.0.0.1` host permissions and
ships the resume-fit bridge off, so the localhost hosts in the unpacked `manifest.json` need no
justification here.

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
- **The one third-party request** is a plain `GET` for a public ECB exchange rate. It contains
  no user data — no amount, no keyword, nothing identifying.
- **The one write to OnlineJobs.ph** is its own "Salary too low" report (job id, reason 1, a
  short note), sent only when the user presses Report for that one listing, from their own
  signed-in tab. Nothing about the user is sent to us — there is no "us" to send it to.
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
- [ ] `sh tools/make-store-zip.sh` and upload `dist/ojph-cleaner-<version>.zip`
- [ ] Test the packaged ZIP by loading it unpacked from a clean profile once
