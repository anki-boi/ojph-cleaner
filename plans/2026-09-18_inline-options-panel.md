# Plan — 2026-09-18 — In-page options panel + live re-apply

**Status:** implemented in 0.3.0 · **Supersedes nothing** · relates to Task 7 in
`plans/2026-08-26_ojph-extension.md`.

## Request (user's words)

> I prefer that options are within the current page itself as part of the existing floating panel.
> It's annoying having to right-click the extension just to click options and edit the options on the
> new tab.
>
> I also prefer that the hiding and showing of job listings are dynamic upon each time the options
> are saved. It's annoying having to reload just to implement new changes.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Panel contents | Everything — both keyword lists and all three toggles | One place to edit; the options page is no longer on the path |
| Commit model | Explicit **Save** button | Matches the request; avoids the page reshuffling mid-keystroke |
| Standalone options page | **Kept**, linked as `full options ↗` | `tools/verify-live.mjs` seeds settings through it; removing it buys nothing |
| Panel placement | Sibling `#ojc-panel`, anchored above `#ojc-chip` | `renderChip()` wipes the chip's innerHTML every rule pass — a child panel dies mid-edit |

## Measurement first

Claim: "a reload is needed to apply a new setting." Measured on the live site before writing code —
settings saved from `options.html` while the page stayed open re-hid it **5 → 0 → 21** with no
reload. The complaint was a leftover of the dead-extension bug fixed in `fb233e6` (missing
`storage` permission). No fix needed; the behaviour is now pinned by a test so it cannot regress.

## Tasks

1. `content.js` — build `#ojc-panel` (two textareas, three checkboxes, Save, `full options ↗`);
   `⚙` button in the chip toggles it; `savePanel()` applies settings synchronously then persists.
2. `content.js` — keep the panel out of the mutation-storm: `isOurs()` covers `#ojc-panel`;
   `syncPanel()` mirrors external changes without clobbering a focused textarea.
3. `content.css` — panel styling; no `display` on the container so `[hidden]` keeps working.
4. `tools/verify-live.mjs` — assert the panel opens from the chip, is *not* nested in the chip,
   loads the saved settings, survives a Save, and changes the hidden count **within one tab session**.
   Also assert every `[hidden]` card is really `display: none`. Select the toggle by `#ojc-toggle`
   instead of "the first button in the chip".
5. Version 0.3.0, HANDOFF updated.

## Verify

```bash
sh tools/gate.sh
node tools/verify-live.mjs
node tools/verify-live.mjs --url="https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=bookkeeper" \
     --neg=bookkeeper --pos=quickbooks
```

All three pass (2026-09-18, automation Chrome, live site, search + category list pages).

## Known ceiling

`#ojc-panel` is positioned `fixed` above the chip; if the chip ever grows or the page sets a
`transform` on `body`, the anchor needs revisiting. `ponytail:` worth noting, not worth solving
before it happens.
