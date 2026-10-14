# Working with the owner of this repo

Read this first, every session. These are the owner's standing preferences.

## How to talk to them

- **They do not read code.** Explain every change in plain language: what they will see on the board, and what
  it does for them. No code snippets, file internals or jargon in a report unless they ask.
- Show results the way they would see them: the card text, the label, the number, a screenshot.

## How to ship

- **Push as soon as possible.** When a change is done and `sh tools/gate.sh` passes, commit and push straight to
  `main`. **No pull requests**, and no need to ask first.
- **Bump the version with every change** (`manifest.json` and `package.json`, they must match): patch for a fix
  (0.17.0 → 0.17.1), minor for new behaviour (0.17.x → 0.18.0). Say the new version in your report. It shows in the
  ⚙ panel footer and in the ⚙ button's hover text, which is how they tell a reload took.
- **Reload their browser after a change.** Their debug Edge listens on CDP port **9222** and loads the extension
  unpacked from this folder. Reload it through `edge://extensions` (`chrome.developerPrivate.reload`), then check the
  version it reports. It is their everyday browser with other work open: touch only OnlineJobs.ph tabs you opened,
  and never leave test settings behind in its storage.
- Test in the throwaway Chrome (`OJC_SANDBOX_PORT=9454 node tools/sandbox.mjs`) rather than their Edge where you can.
  Port 9444 may be held by an old sandbox.
- Finish what you start in the background: stop test browsers and wait-loops when you are done with them.

## What the product must do (their rules)

- **The hourly rate is the one measure.** It is the first and biggest figure on every card, what the minimum pay
  is judged by, and what "sort by pay" ranks by. A month is shown small beside it.
- **Never assume a 40-hour week.** Hourly = salary ÷ the post's own stated hours (its HOURS PER WEEK, or hours
  written in the post). "Full Time" is not a number. If the hours are not known, show `? /hr` and go read the post
  for them; never fill the gap with a guess.
- **Gigs:** a gig with no stated hours is hidden. Lowball never judges gigs or whole-job prices.
- **Lowball** (default $2/hr or below, configurable): a black ⚫ tier. Reporting a listing as "Salary too low"
  is always ONE listing at a time that they can see: the card's tag asks first, and the bar's review shows each
  listing and waits for "Report this one". Never a bulk send — a false positive must be catchable.
- **Presets** for each kind of online worker and each experience level fill the keyword lists in setup. They are
  written in the matching syntax so they teach it: `word` (plurals and hyphens count), `word*` (broad), `=word`
  (exact).

The why behind every rule, with the owner's own words, is in `spec.md` (decisions D67–D73).
