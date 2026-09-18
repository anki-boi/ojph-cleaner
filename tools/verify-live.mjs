// tools/verify-live.mjs — reload the unpacked extension in the automation Chrome
// and assert it actually works on the live site. This is the real end-to-end check:
// unit tests cannot see a missing manifest permission or a drifted selector.
//
//   node tools/verify-live.mjs
//   node tools/verify-live.mjs --url="https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=bookkeeper"
//   node tools/verify-live.mjs --neg=crypto,insurance --pos=bookkeeper
//
// Env: OJC_CDP_PORT (default 9333), OJC_EXT_NAME (default "OJ.ph Cleaner").
import { connect, withTab, openTab } from './cdp.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};const PORT = +(process.env.OJC_CDP_PORT || 9333);
const EXT_NAME = process.env.OJC_EXT_NAME || 'OJ.ph Cleaner';
const URL_ = arg('url', 'https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=virtual%20assistant');
const neg = arg('neg', '').split(',').filter(Boolean);
const pos = arg('pos', '').split(',').filter(Boolean);
const GOAL = +(arg('goal', '40000'));      // monthly PHP goal
const GOAL_HOURLY = +(arg('goal-hourly', '300')); // hourly PHP goal
// The recency window this run asserts against. Exposed as a flag because the interesting proof needs a
// page that HAS stale listings: a keyword search's first page is always fresh (measured 0.03-1.2 days),
// while a deep offset page is 40-46 days old.
const MAX_AGE = +(arg('max-age', '7'));

// salary.js's pure factory, injected into the page so the harness can recompute every figure from
// the DOM with the SAME code the extension used — a parity check, not a second opinion.
const salarySrc = fs.readFileSync(new URL('../salary.js', import.meta.url), 'utf8');
// Same idea for the rules: `ruleEval` below injects this instead of re-implementing the date maths, so
// a parity check can never disagree with `parsePosted`/`isStale` about what "stale" means. rules.js is
// UMD, and the page has no `module`, so it lands on the page's own `self.OJRules` — a different world
// from the content script's copy, so nothing collides.
const RULES_SRC = fs.readFileSync(new URL('../rules.js', import.meta.url), 'utf8');
// And closed.js, for the same reason: the memory's job-id extraction has to agree with the extension's
// (`-1733463` at the end of two different slug spellings), and the closed rule now runs FIRST, so a
// predicted total that ignores it is wrong by exactly the number of remembered listings.
const CLOSED_SRC = fs.readFileSync(new URL('../closed.js', import.meta.url), 'utf8');

const fail = async msg => {
  console.error('verify-live: FAIL — ' + msg);
  await restoreStorage();   // a failing run must not leave the user's settings replaced either
  await new Promise(r => setTimeout(r, 250));
  process.exit(1);
};
const settle = ms => new Promise(r => setTimeout(r, ms));

/**
 * This harness writes settings into the profile it finds on `:${PORT}` — which is the user's daily
 * driver, not a throwaway (docs/HANDOFF §2). It therefore snapshots the whole of
 * `chrome.storage.local` BEFORE its first write and puts it back on every exit path, including a
 * failure. Without this, one run silently replaced the user's keyword lists and salary goals with the
 * harness's fixtures and left them there: data loss committed in the name of testing.
 *
 * Restoring is a `set` of the snapshot followed by a `remove` of the keys that did not exist before,
 * never a `clear()` — a crash between the two must not be able to leave the profile empty.
 *
 * The snapshot is also written to disk and restored on SIGINT/SIGTERM, because the first version of
 * this restore ran only on a normal exit — and the run that found that out was killed by a tool
 * timeout mid-flight, leaving the user's keywords and salary goals replaced by the harness's
 * fixtures. `node tools/verify-live.mjs --restore` recovers from that file by hand after a hard kill.
 */
const SNAP_FILE = path.join(os.tmpdir(), 'ojc-verify-live-snapshot.json');
const RESTORE_ONLY = process.argv.includes('--restore');
let SNAPSHOT = null, EXT = null, STORE = null, restoring = false;

/**
 * The run's single `chrome.storage` handle.
 *
 * `chrome.storage` is only reachable from an extension context, and the obvious way to get one —
 * `withTab(…options.html…)` — opens and closes a real tab in the user's browser on every call. Read the
 * storage ten times and that is ten tabs appearing and vanishing while they watch. This harness used to
 * do exactly that, twenty times over in one poll loop, before it had loaded the site at all. One tab,
 * opened once, is one tab: it is also why the seed no longer needs a poll loop, since `await`ing the
 * write in a live tab is the proof that it landed.
 */
const storeEval = (expression, settleMs = 400) => (STORE
  ? STORE.evaluate(expression)
  : withTab(PORT, `chrome-extension://${EXT}/options.html`, (tab) => tab.evaluate(expression), settleMs));
const readStorage = async () => JSON.parse(await storeEval(`chrome.storage.local.get(null).then(r => JSON.stringify(r))`));
const readSettings = async () => JSON.parse(await storeEval(`chrome.storage.local.get('settings').then(r => JSON.stringify(r.settings || {}))`));

async function applySnapshot(snap) {
  return JSON.parse(await storeEval(`(async () => {
    const snap = ${JSON.stringify(snap)};
    const now = await chrome.storage.local.get(null);
    await chrome.storage.local.set(snap);
    const extra = Object.keys(now).filter(k => !(k in snap));
    if (extra.length) await chrome.storage.local.remove(extra);
    return JSON.stringify({ kept: Object.keys(snap), removed: extra });
  })()`, 600));
}

async function restoreStorage() {
  if (restoring || !SNAPSHOT || !EXT) return;   // nothing was taken (the run died before step 2)
  restoring = true;
  try {
    const done = await applySnapshot(SNAPSHOT);
    console.log(`storage   : restored (kept ${done.kept.join(', ') || 'nothing'}` +
      `${done.removed.length ? `, removed ${done.removed.join(', ')}` : ''})`);
  } catch (e) {
    console.error(`verify-live: WARNING — could not restore the pre-run chrome.storage (${e.message}). ` +
      `The snapshot is at ${SNAP_FILE}; recover it with --restore.`);
  }
}

// A timeout, a ctrl-c or a closed terminal must not be able to leave the profile seeded.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    console.error(`verify-live: ${signal} — putting the storage back before exiting`);
    restoreStorage().then(() => STORE?.close()).finally(() => process.exit(130));
  });
}

// And neither must a BUG IN THIS HARNESS. `fail()` restores, but a thrown error does not go through it,
// and the comment above used to claim "every exit path" while a crash was not one. That is exactly how
// the user's keywords and salary goals were lost: a JSON.parse bug in a new section threw, the process
// died at once, the seed settings stayed, and every later run then snapshotted that seeded state and
// dutifully "restored" it — the damage quietly becoming the baseline. These two handlers are the
// difference between a gate that is safe to run and one that eats the profile it checks.
const crash = (what) => (err) => {
  console.error(`verify-live: ${what} — ${err && err.stack ? err.stack.split('\n')[0] : err}`);
  console.error('verify-live: the run died outside fail(); putting the storage back before exiting');
  restoreStorage().then(() => STORE?.close()).finally(() => process.exit(1));
};
process.on('uncaughtException', crash('uncaught exception'));
process.on('unhandledRejection', crash('unhandled rejection'));

/**
 * The rule pass is scheduled with requestAnimationFrame and the loader's fetch resolves on the tab's
 * own time. Chrome pauses both in a hidden tab — and because the debug profile is now the user's
 * daily browser, a tab this harness opens can sit behind their work. Activate it and wait until it
 * really reports visible, rather than measuring something a throttled tab cannot do.
 */
async function activate(tab) {
  await tab.send('Page.bringToFront').catch(() => {});
  for (let i = 0; i < 12; i++) {
    if (await tab.evaluate(`document.visibilityState`) === 'visible') return true;
    await settle(300);
  }
  return false;
}
const HIDDEN_HINT = 'the browser tab stayed hidden, so Chrome throttled it — bring the Chrome window ' +
  'to the front (or launch it with --disable-background-timer-throttling ' +
  '--disable-backgrounding-occluded-windows --disable-renderer-backgrounding, see docs/HANDOFF.md §2)';

/**
 * Poll for an effect instead of sleeping a fixed time and hoping. This browser is also the user's daily
 * driver, so a page can be slow (or briefly throttled) for reasons that have nothing to do with the
 * extension; asserting on a timer produced two unreproducible failures in one session. A timeout still
 * fails the gate — it just reports the state it last saw.
 */
async function waitFor(tab, expression, { timeout = 8000, every = 200 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await tab.evaluate(expression).catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) return null;
    await settle(every);
  }
}

// ── 1. browser + extension must be present ───────────────────────────────
let version;
try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); }
catch { await fail(`nothing listening on ${PORT} — start the automation Chrome (see docs/HANDOFF.md)`); }
if (!/Chrome\//.test(version.Browser)) await fail(`:${PORT} is ${version.Browser}, not Chrome`);

const extInfo = await withTab(PORT, 'chrome://extensions', async (tab) => JSON.parse(
  await tab.evaluate(`chrome.developerPrivate.getExtensionsInfo({includeDisabled:true})
    .then(xs => JSON.stringify(xs.filter(x => x.name === ${JSON.stringify(EXT_NAME)})
      .map(x => ({ id: x.id, version: x.version, state: x.state, path: x.path }))))`)));

if (!extInfo.length) await fail(`${EXT_NAME} is not installed in this browser profile — load unpacked first`);
const { id: EXT_ID, version: EXT_VERSION, state, path: EXT_PATH } = extInfo[0];
if (state !== 'ENABLED') await fail(`${EXT_NAME} is ${state}`);

// Take the user's storage before the first write below, so every exit path can put it back.
EXT = EXT_ID;
if (RESTORE_ONLY) {
  SNAPSHOT = JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8'));
  await restoreStorage();
  console.log(`verify-live: restored from ${SNAP_FILE}`);
  process.exit(0);
}
// Reload so edits on disk take effect. (runtimeErrors are historical and persist
// across reloads, so the pass/fail decision below is based on behaviour.)
await withTab(PORT, 'chrome://extensions', tab => tab.evaluate(
  `chrome.developerPrivate.reload(${JSON.stringify(EXT_ID)}, { failQuietly: true }).then(()=>1)`));
await settle(2500);
// After the reload: reloading the extension invalidates any extension page already open.
STORE = await openTab(PORT, `chrome-extension://${EXT_ID}/options.html`);
console.log(`extension : ${EXT_NAME} v${EXT_VERSION} ${state} (${EXT_PATH})`);

// The user's own storage, taken before the first write below, so every exit path can put it back.
SNAPSHOT = await readStorage();
fs.writeFileSync(SNAP_FILE, JSON.stringify(SNAPSHOT, null, 1));   // survives a hard kill
// Print what the snapshot actually CONTAINS, not just its keys: a snapshot of a profile a previous run
// had already seeded is indistinguishable from a good one by key name, and the run that discovered this
// reported "snapshot taken (closedJobs, fx, settings)" while holding the harness's own fixtures.
console.log(`storage   : snapshot taken (${Object.keys(SNAPSHOT).join(', ') || 'empty'}` +
  `${SNAPSHOT.settings ? `; settings: ${(SNAPSHOT.settings.negative || []).length} negative / ` +
    `${(SNAPSHOT.settings.positive || []).length} positive keyword(s), goal ${SNAPSHOT.settings.goalSalary || 0})` : ''}` +
  ' — restored when this run ends');

// ── 2. seed the settings this run asserts against ────────────────────────
// Seeded rather than inherited from whatever the browser had, so a run's outcome depends on the code
// under test and not on the keywords the user happened to have typed. The seeding is reversible (see
// `restoreStorage`), and every assertion below recomputes its expectation from the DOM, so it holds for
// any settings — the flags only decide which branches this run is guaranteed to reach.
const settings = { negative: neg, positive: pos, noSalary: true, showHidden: false, autoScan: false, goalSalary: GOAL, goalHourly: GOAL_HOURLY, maxAgeDays: MAX_AGE };
await storeEval(`chrome.storage.local.set({ settings: ${JSON.stringify(settings)} }).then(()=>1)`, 900);
// Drop the FX cache so the live ECB path is exercised on every run (otherwise a 24h-old rate from a
// previous run would silently satisfy it).
await storeEval(`chrome.storage.local.remove('fx').then(()=>1)`, 500);
// The write landed if every key matches — compared per key, not as one serialized string: Chrome
// reorders object keys on the way out, so a string compare fails on a perfectly good write.
const sameSettings = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const stored = await readSettings();
if (!sameSettings(stored, settings)) {
  await fail(`the seeded settings did not land: wrote ${JSON.stringify(settings)}, read back ${JSON.stringify(stored)}`);
}
console.log(`settings  : ${JSON.stringify(settings)}`);


/**
 * Count what the rule pass will do, with the rule's own order, recomputed from the DOM.
 *
 * ONE copy, used by every section that needs a count: this logic used to exist three times in this
 * file (a section-3 copy, a `ruleCounts` helper that nothing called any more, and a per-section
 * pick), and two copies that disagree report phantom failures (docs/HANDOFF §2.3). `rules.js` is
 * injected rather than re-implemented, so the date maths is the extension's own code.
 *
 * `negExpected` counts only cards the keyword rule actually hides: a no-salary card re-files into the
 * no-salary bucket, because noSalary is checked first — which is why a predicted total can never be
 * computed by adding the buckets up. `reconExpected` is the yellow state: a hide keyword on a listing
 * that also looks good (a positive match, or a goal mark the salary pass put on it).
 */
const ruleEval = (tab, { neg = [], pos = [], maxAgeDays = 0, noSalary = true, closedIds = [] } = {}) => tab.evaluate(`${RULES_SRC}
${CLOSED_SRC}
(() => {
  const neg = ${JSON.stringify(neg.map((k) => k.toLowerCase()))};
  const pos = ${JSON.stringify(pos.map((k) => k.toLowerCase()))};
  const maxAgeDays = ${JSON.stringify(Number(maxAgeDays) || 0)};
  const noSalary = ${JSON.stringify(noSalary !== false)};
  const closedIds = new Set(${JSON.stringify(closedIds.map(String))});
  const now = Date.now();
  const cards = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
  // Our own injected nodes are removed before any text is matched — the 40 h/week disclaimer says
  // "verify with the employer", so matching raw textContent lets our annotation feed the rules
  // (commit 97de155). This is the harness mirroring ownText(), not a second opinion on it.
  const ownText = (el) => {
    const o = el.cloneNode(true);
    for (const injected of o.querySelectorAll('[class^="ojc-"]')) injected.remove();
    return (o.textContent || '').toLowerCase();
  };
  const ownSal = (c) => {
    const d = c.querySelector('dd.col');
    if (!d) return '';
    const o = d.cloneNode(true);
    for (const injected of o.querySelectorAll('[class^="ojc-"]')) injected.remove();
    return o.textContent;
  };
  // The posted instant, parsed by the extension's own code (rules.js is injected above).
  const postedAt = (c) => {
    const p = c.querySelector('p[data-temp]');
    if (!p) return null;
    return OJRules.parsePosted(p.getAttribute('data-temp-2')) ??
      OJRules.parsePosted(p.getAttribute('data-temp'), OJRules.MANILA_OFFSET_MINUTES);
  };
  let staleExpected = 0, noSalExpected = 0, negExpected = 0, posExpected = 0, reconExpected = 0;
  let closedExpected = 0;
  let noDate = 0, noUtc = 0, negAnyExpected = 0;
  for (const c of cards) {
    const text = ownText(c);
    const p = c.querySelector('p[data-temp]');
    if (!p || !p.getAttribute('data-temp-2')) noUtc++;
    const at = postedAt(c);
    if (at == null) noDate++;
    // The closed rule is first in the real pass, so a remembered card is counted here and NOWHERE else —
    // the else-if chain is the whole point: the buckets can never be added up to predict the total.
    const link = c.querySelector('a[href*="/job/"]');
    const closed = !!(link && closedIds.has(String(OJClosed.jobIdFrom(link.getAttribute('href')))));
    const ns = noSalary && !/\\d/.test(ownSal(c));
    // Through the extension's own matcher, not .includes: the keyword syntax lives in rules.js, and a
    // harness that re-implements it diverges the moment the syntax grows (a leading = now means
    // whole-word). This is the same injected module, so it cannot disagree.
    const nm = OJRules.matchKeywords(text, neg).length > 0;
    const pm = OJRules.matchKeywords(text, pos).length > 0;
    const good = pm || c.classList.contains('ojc-goal');
    if (nm) negAnyExpected++;
    if (closed) closedExpected++;
    else if (OJRules.isStale(at, now, maxAgeDays)) staleExpected++;
    else if (ns) noSalExpected++;
    else if (nm && good) reconExpected++;
    else if (nm) negExpected++;
    else if (pm) posExpected++;
  }
  return JSON.stringify({ cards: cards.length, staleExpected, noSalExpected, negExpected, posExpected,
    reconExpected, closedExpected, negAnyExpected, noDate, noUtc,
    hiddenExpected: closedExpected + staleExpected + noSalExpected + negExpected });
})()`);

/** The ids the memory is holding, for the rule parity above. One read, one shape. */
const readClosedIds = async () => Object.keys((await readStorage()).closedJobs || {});

// ── 3. live page ─────────────────────────────────────────────────────────
const res = JSON.parse(await withTab(PORT, URL_, async (tab) => {
  await settle(3500);
  const counts = JSON.parse(await ruleEval(tab, { neg, pos, maxAgeDays: MAX_AGE, closedIds: await readClosedIds() }));
  return tab.evaluate(`(() => {
    const cards = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
    return JSON.stringify({
      url: location.href,
      cards: cards.length,
      // What the site claims it is showing. The watchdog below needs it: a page that
      // parses to zero cards must never be able to report PASS.
      claimed: ((document.body.innerText.match(/Displaying\s+(\d+)\s+out of/i) || [])[1] * 1) || null,
      salaries: document.querySelectorAll('.jobpost-cat-box.latest-job-post dd.col').length,
      chip: !!document.getElementById('ojc-chip'),
      chipText: (document.getElementById('ojc-chip') || {}).textContent || null,
      hidden: document.querySelectorAll('.jobpost-cat-box.latest-job-post[hidden]').length,
      invisible: [...document.querySelectorAll('.jobpost-cat-box.latest-job-post[hidden]')]
        .filter(c => getComputedStyle(c).display === 'none').length,
      negatives: document.querySelectorAll('.jobpost-cat-box.ojc-neg').length,
      // Every card that matched a hide keyword says which one, on the hidden cards (visible with
      // show-all on) and on the yellow ones, where it is the reason the card is on screen at all.
      negBadges: document.querySelectorAll('.jobpost-cat-box .ojc-neg-badge').length,
      recons: document.querySelectorAll('.jobpost-cat-box.ojc-recon').length,
      reconOutline: (() => { const c = document.querySelector('.jobpost-cat-box.ojc-recon');
        return c ? getComputedStyle(c).outlineColor : null; })(),
      highlights: document.querySelectorAll('.ojc-pos-badge').length
    });
  })()`).then((page) => JSON.stringify({ ...JSON.parse(page), ...counts }));
}, 500));

console.log(`live page :`, res.url);
console.log(`  cards   : ${res.cards}${res.claimed ? ` (site claims ${res.claimed})` : ''} (${res.salaries} with a salary field)`);
console.log(`  chip    : ${res.chip ? res.chipText : 'MISSING — content script did not run'}`);
console.log(`  hidden  : ${res.hidden}   (expected by rule: ${res.hiddenExpected})`);
console.log(`  stale ${res.staleExpected} / no-salary ${res.noSalExpected} / keyword ${res.negExpected} → hidden, ` +
  `positive ${res.posExpected} → highlighted, ${res.reconExpected} → yellow (reconsider)` +
  `${res.closedExpected ? `, ${res.closedExpected} closed` : ''} · ` +
  `${res.negBadges} ✗ badge(s)`);

if (!res.chip) await fail('content script did not inject — check manifest permissions/host_permissions');

// ── the watchdog (spec.md §2.1) ──────────────────────────────────────────
// Without this, a page that parses to zero cards ends in PASS: hidden 0 == expected 0,
// every assertion holds, and selector drift goes unnoticed. A gate that cannot fail is
// worse than no gate.
if (!res.cards) {
  await fail(`parsed 0 cards${res.claimed ? ` while the site claims to be displaying ${res.claimed}` : ''} ` +
    `— the list markup or SELECTORS.card in content.js has drifted, or this URL has no results`);
}
if (res.claimed && res.cards !== res.claimed) {
  await fail(`the site says it is displaying ${res.claimed} jobs but ${res.cards} cards were parsed ` +
    `— SELECTORS.card is missing some markup`);
}
if (res.cards && !res.salaries) await fail('no dd.col salary elements — list markup may have drifted');
// The recency filter is only as good as the attribute it reads, and a renamed attribute would silently
// turn it off: every card would read as undateable, and an undateable card is deliberately never stale.
if (res.cards && res.noUtc) {
  await fail(`${res.noUtc}/${res.cards} card(s) have no data-temp-2 — the UTC posted attribute has ` +
    `drifted, so the recency filter is falling back to the site's Manila wall clock (or doing nothing)`);
}
if (res.cards && res.noDate) {
  await fail(`${res.noDate}/${res.cards} card(s) have no readable posted date — SELECTORS.cardPosted ` +
    `has drifted, and a card with no date can never be filtered by recency`);
}
if (res.hidden !== res.hiddenExpected) {
  await fail(`hidden ${res.hidden}, rule says ${res.hiddenExpected} (stale ${res.staleExpected} + ` +
    `no-salary ${res.noSalExpected} + keyword ${res.negExpected})`);
}
if (res.hidden !== res.invisible) {
  await fail(`${res.hidden} cards carry [hidden] but only ${res.invisible} are actually display:none — the site CSS is winning`);
}
if (res.negatives !== res.negExpected) await fail(`keyword hides ${res.negatives}, expected ${res.negExpected}`);
if (res.negBadges !== res.negExpected + res.reconExpected) {
  await fail(`${res.negBadges} card(s) carry the ✗ badge, expected ${res.negExpected + res.reconExpected} ` +
    `(keyword hides ${res.negExpected} + reconsidered ${res.reconExpected}) — every negative match must ` +
    `say which keyword matched`);
}
if (res.recons !== res.reconExpected) {
  await fail(`${res.recons} card(s) carry the yellow reconsider outline, expected ${res.reconExpected} — ` +
    `a listing that matches a hide keyword AND looks good (positive keyword, or a goal mark) must be ` +
    `shown, not hidden`);
}
// A card can be both above goal and a positive match, which is why .ojc-recon is declared after .ojc-goal
// at the same specificity: otherwise the goal's green outline wins and the yellow is invisible on
// exactly the cards that are yellow because they pay well.
if (res.recons && !/rgb\(224, 168, 0\)/.test(res.reconOutline || '')) {
  await fail(`a reconsider card's computed outline is ${res.reconOutline}, not the yellow — the goal's ` +
    `green is winning the cascade`);
}
if (res.highlights !== res.posExpected) await fail(`highlights ${res.highlights}, expected ${res.posExpected}`);

// ── 4. chip "Show all" must reveal, and re-hide, everything it hid ───────
// Both toggles happen in ONE tab, and the number to restore is read from that tab before anything is
// clicked. The property here is *reversibility*, so it must not be compared against another page
// load: the board is live, and two loads one second apart hold different no-salary counts (observed:
// 6 cards hidden, then 8 one load later). Section 3 owns "the counts are right"; this owns "Show all
// undoes exactly what was done". The previous version opened a fresh tab per toggle and compared both
// against section 3's number, so it failed on the site being busy rather than on the extension.
if (res.noSalExpected + res.negExpected + res.staleExpected > 0) {
  const r = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    await settle(3000);
    const count = `document.querySelectorAll('.jobpost-cat-box.latest-job-post[hidden]').length`;
    const snap = () => tab.evaluate(`JSON.stringify({ hidden: ${count},
      label: document.querySelector('#ojc-chip b').textContent,
      btn: document.querySelector('#ojc-chip button').textContent })`);
    const before = JSON.parse(await snap());
    await tab.evaluate(`document.querySelector('#ojc-toggle').click()`);
    // Wait for the listing to actually change instead of assuming a fixed delay is enough. (The
    // condition used to be interpolated as the literal `${expectHidden}`, so it never matched and
    // this was a 5 s sleep wearing a wait's clothes.)
    await waitFor(tab, `${count} === 0`, { timeout: 5000 });
    const shown = JSON.parse(await snap());
    await tab.evaluate(`document.querySelector('#ojc-toggle').click()`);
    await waitFor(tab, `${count} === ${before.hidden}`, { timeout: 5000 });
    return JSON.stringify({ before, shown, again: JSON.parse(await snap()) });
  }, 500));
  if (!r.before.hidden) {
    await fail(`this load has 0 hidden cards, so the Show-all toggle cannot be tested ` +
      `(the board changes between loads — re-run, or pick a URL with no-salary listings)`);
  }
  if (r.shown.hidden !== 0) await fail(`after "Show all", ${r.shown.hidden} cards are still hidden`);
  if (!/would be hidden/.test(r.shown.label)) {
    await fail(`chip label did not switch to the preview wording: "${r.shown.label}"`);
  }
  if (r.again.hidden !== r.before.hidden) {
    await fail(`after re-hiding, ${r.again.hidden} hidden vs the ${r.before.hidden} this same tab had ` +
      `before the toggle — Show all did not fully come back`);
  }
  console.log(`toggle    : Show all revealed ${r.before.hidden}, re-hide restored ${r.again.hidden} ` +
    `(same tab, no reload)`);
}

// ── 4b. every branch, exercised on purpose ───────────────────────────────
// The flags default to no keywords, so a bare `node tools/verify-live.mjs` used to reach the negative,
// positive and reconsider branches zero times: the gate stayed green with all three broken. That is a
// gate that cannot fail, which is worse than none (§7). This section seeds its OWN settings — keywords
// chosen to match the page rather than borrowed from the caller — requires each branch to actually fire,
// and requires the listing to agree with the recomputed rule afterwards. Section 3 above still tests the
// caller's configuration; this one tests that the rules work at all.
//
// Recency is off here (maxAgeDays: 0) so it cannot hide the cards these branches are about.
{
  const r = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    await settle(3000);
    /** Seed, then wait until the listing agrees with the recomputed rule — never sleep and hope. */
    const measure = async (partial) => {
      const next = { ...settings, ...partial, maxAgeDays: 0 };
      await storeEval(`chrome.storage.local.set({ settings: ${JSON.stringify(next)} }).then(()=>1)`, 300);
      const read = `JSON.stringify({
        hidden: document.querySelectorAll('.jobpost-cat-box.latest-job-post[hidden]').length,
        neg: document.querySelectorAll('.jobpost-cat-box.ojc-neg').length,
        recon: document.querySelectorAll('.jobpost-cat-box.ojc-recon').length,
        pos: document.querySelectorAll('.ojc-pos-badge').length })`;
      let counts, dom;
      for (let i = 0; i < 40; i++) {
        counts = JSON.parse(await ruleEval(tab, { neg: next.negative, pos: next.positive, maxAgeDays: 0, closedIds: await readClosedIds() }));
        dom = JSON.parse(await tab.evaluate(read));
        const agreed = dom.hidden === counts.hiddenExpected && dom.neg === counts.negExpected &&
          dom.recon === counts.reconExpected && dom.pos === counts.posExpected && counts.cards > 0;
        if (agreed) return { counts, dom, settled: true };
        await settle(250);
      }
      return { counts, dom, settled: false };
    };

    // The keyword is "the": a word that appears in English prose, so the branch is reachable on any
    // page. If it ever stops matching, the section fails loudly rather than passing with nothing tested.
    const hide = await measure({ negative: ['the'], positive: [], goalSalary: 0, goalHourly: 0 });
    const show = await measure({ negative: [], positive: ['the'], goalSalary: 0, goalHourly: 0 });
    const yellow = await measure({ negative: ['the'], positive: [], goalSalary: 1, goalHourly: 1 });

    // The goal-mark seam, which is the one defect this feature had that nothing else caught: a listing
    // that is good only because it pays well is decided by a mark that arrives a pass AFTER the rule
    // pass, so without a re-run it stays hidden. A stray mutation on a live page re-runs the pass for
    // the existing cards and hides that, so the proof has to be a FRESH card with no other activity.
    const arrival = JSON.parse(await tab.evaluate(`(() => {
      const marker = 'the';
      const src = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')]
        .find(c => { const n = c.querySelector('.ojc-salary-note'); return n && n.textContent.trim(); });
      if (!src) return JSON.stringify({ skipped: 'no card carries a salary figure' });
      const clone = src.cloneNode(true);
      for (const injected of clone.querySelectorAll('[class^="ojc-"]')) injected.remove();
      for (const cls of ['ojc-neg', 'ojc-pos', 'ojc-recon', 'ojc-goal']) clone.classList.remove(cls);
      clone.hidden = false;
      clone.removeAttribute('title');
      const desc = clone.querySelector('.desc');
      if (desc) { const a = document.createElement('a'); a.textContent = marker; desc.prepend(a); }
      src.parentElement.appendChild(clone);
      window.__ojcArrival = clone;
      return JSON.stringify({ inserted: true });
    })()`));
    if (arrival.inserted) {
      for (let i = 0; i < 40; i++) {
        Object.assign(arrival, await tab.evaluate(`(() => { const c = window.__ojcArrival;
          return JSON.stringify({ hidden: !!c.hidden, recon: c.classList.contains('ojc-recon'),
            goal: c.classList.contains('ojc-goal'),
            figure: (c.querySelector('.ojc-salary-note') || {}).textContent || null }); })()`).then(JSON.parse));
        if (arrival.recon) break;
        await settle(250);
      }
      await tab.evaluate(`window.__ojcArrival.remove()`);
    }
    return JSON.stringify({ hide, show, yellow, arrival });
  }, 500));

  const branches = [
    ['negative keyword hides', r.hide, r.hide.counts.negExpected > 0],
    ['positive keyword highlights', r.show, r.show.counts.posExpected > 0],
    ['a hide keyword on a good listing turns yellow instead', r.yellow, r.yellow.counts.reconExpected > 0],
  ];
  for (const [name, m, reachable] of branches) {
    if (!reachable) {
      await fail(`cannot exercise "${name}" on this page: no card matches the probe keyword ` +
        `(rule says ${JSON.stringify(m.counts)}) — pick a different page or probe keyword`);
    }
    if (!m.settled) {
      await fail(`"${name}" never settled: the rule says ${JSON.stringify(m.counts)}, the page has ` +
        `${JSON.stringify(m.dom)} — after seeding the listing must match the recomputed rule`);
    }
  }
  if (r.arrival.inserted && !(r.arrival.recon && !r.arrival.hidden)) {
    await fail(`a fresh card that matches a hide keyword and pays above the goal stayed hidden ` +
      `(${JSON.stringify(r.arrival)}) — the goal mark arrives after the rule pass, so without a re-run ` +
      `the reconsider state never applies to a listing that is good only because it pays well`);
  }
  console.log(`branches  : keyword hides ${r.hide.dom.hidden}, highlights ${r.show.dom.pos}, ` +
    `yellow ${r.yellow.dom.recon} — each branch had to fire`);
  if (r.arrival.inserted) console.log(`seam      : a fresh good-pay negative match → ` +
    `${r.arrival.recon ? 'yellow' : 'NOT yellow'}, goal mark ${r.arrival.goal}, hidden ${r.arrival.hidden}`);
  // Put the run's own seeds back: everything below asserts against the caller's configuration, not this
  // section's probe keywords.
  await storeEval(`chrome.storage.local.set({ settings: ${JSON.stringify(settings)} }).then(()=>1)`, 400);
}

// ── 5. in-page options panel: edit here, listing reacts on Save, no reload ──
// The panel must open from the chip, load the saved settings, and re-run the
// rules the instant Save is clicked. Every snapshot below is read from the SAME
// tab session, so any change in hidden-count is proof no reload was involved.
if (res.noSalExpected > 0) {
  const r = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    await settle(3500);
    const snap = async () => JSON.parse(await tab.evaluate(`(()=>{const cs=[...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
      const p=document.getElementById('ojc-panel');
      return JSON.stringify({hidden:cs.filter(c=>c.hidden).length, cards:cs.length,
        saved:(document.querySelector('#ojc-saved')||{}).style?.display,
        panelOpen:!!p && !p.hidden, noSalaryBox:p?.querySelector('#ojc-noSalary')?.checked ?? null,
        panelVisible:!!p && !p.hidden});})()`));
    // Assert on SPECIFIC cards instead of on counts: pick the first card that is hidden only because it
    // has no salary (no keyword match) and the first card hidden by a keyword, then check what the Save
    // does to each. Count arithmetic here has twice produced phantom failures over the rule order
    // (noSalary → negative → positive re-files keyword-matching no-salary cards into the keyword bucket).
    const pick = () => tab.evaluate(`(() => {
      const neg = ${JSON.stringify(neg.map(k => k.toLowerCase()))};
      const ownText = (c) => { const d = c.querySelector('dd.col'); if (!d) return '';
        const o = d.cloneNode(true);
        for (const injected of o.querySelectorAll('[class^="ojc-"]')) injected.remove();
        return o.textContent; };
      let noSalOnly = null, kwOnly = null;
      for (const c of document.querySelectorAll('.jobpost-cat-box.latest-job-post')) {
        const t = (c.textContent || '').toLowerCase();
        const ns = !/\\d/.test(ownText(c)), nm = neg.some(k => t.includes(k));
        if (ns && !nm && !noSalOnly) noSalOnly = { hidden: c.hidden, salary: ownText(c).trim().slice(0, 24) };
        if (nm && !noSalOnly && !kwOnly) kwOnly = { hidden: c.hidden };
      }
      return JSON.stringify({ noSalOnly, kwOnly });
    })()`);
    const pickBefore = JSON.parse(await pick());
    const before = await snap();
    const wasOpen = await tab.evaluate(
      `!!document.getElementById('ojc-panel') && !document.getElementById('ojc-panel').hidden`);
    await tab.evaluate(`document.querySelector('#ojc-gear').click()`);    await settle(200);
    const opened = JSON.parse(await tab.evaluate(`(()=>{const p=document.getElementById('ojc-panel');
      if (!p) return JSON.stringify({exists:false});
      const fields=['#ojc-maxAge','#ojc-neg','#ojc-pos','#ojc-noSalary','#ojc-showHidden','#ojc-autoScan','#ojc-save'];
      return JSON.stringify({exists:true, visible:!p.hidden, inChip:!!document.querySelector('#ojc-chip #ojc-panel'),
        fields:fields.every(s=>!!p.querySelector(s)),
        neg:p.querySelector('#ojc-neg').value, noSalary:p.querySelector('#ojc-noSalary').checked,
        showHidden:p.querySelector('#ojc-showHidden').checked});})()`));
    // change a setting in the panel and Save — no reload between these reads
    await tab.evaluate(`(()=>{document.querySelector('#ojc-noSalary').checked=false;
      document.querySelector('#ojc-save').click()})()`);
    await settle(300);
    const pickOff = JSON.parse(await pick());
    const noSalaryOff = await snap();
    await tab.evaluate(`(()=>{document.querySelector('#ojc-noSalary').checked=true;
      document.querySelector('#ojc-save').click()})()`);
    await settle(300);
    return JSON.stringify({ before, wasOpen, pickBefore, pickOff, pickOn: JSON.parse(await pick()), opened, noSalaryOff, noSalaryOn: await snap() });
  }, 500));

  if (!r.opened.exists) await fail('the chip gear does not open an in-page options panel');
  if (!r.opened.visible) {
    await fail(`the panel exists but is hidden after clicking the gear ` +
      `(it was ${r.wasOpen ? 'ALREADY OPEN before the click, so the click toggled it shut' : 'closed before the click'}; ` +
      `chip=${JSON.stringify(r.opened.chipOrder || null)})`);
  }
  if (r.opened.inChip) await fail('the panel is nested inside #ojc-chip — the chip rebuild will wipe it');
  if (!r.opened.fields) await fail('the in-page panel is missing option fields');
  if (r.opened.neg !== neg.join('\n') || r.opened.noSalary !== true || r.opened.showHidden !== false) {
    await fail(`panel did not load the saved settings: ${JSON.stringify(r.opened)}`);
  }
  if (!r.noSalaryOff.panelVisible) await fail('the panel was destroyed by the rule pass triggered by Save');
  if (r.noSalaryOff.saved !== 'inline') await fail('Save did not confirm with "Saved"');
  // With noSalary off, every card that matches a negative keyword hides — including
  // the no-salary cards that the noSalary rule was shadowing (it is checked first).
  if (!r.pickBefore.noSalOnly) {
    await fail('no card on this page is hidden purely for having no salary — cannot test the setting');
  }
  if (r.pickOff.noSalOnly?.hidden !== false) {
    await fail(`after unchecking "no salary" in the panel, a no-salary card is still hidden ` +
      `(${JSON.stringify(r.pickOff.noSalOnly)}) — the Save did not reach the listing, no reload`);
  }
  if (r.pickOff.kwOnly && r.pickOff.kwOnly.hidden !== true) {
    await fail(`after unchecking "no salary", a keyword-matched card became visible ` +
      `(${JSON.stringify(r.pickOff.kwOnly)}) — the keyword rule must still hide`);
  }
  if (r.pickOn.noSalOnly?.hidden !== true) {
    await fail(`after re-checking "no salary", the no-salary card stayed visible ` +
      `(${JSON.stringify(r.pickOn.noSalOnly)}) — the toggle did not come back, no reload ` +
      `(panel open=${r.noSalaryOn.panelOpen}, box now ${r.noSalaryOn.noSalaryBox}, ` +
      `saved=${JSON.stringify(r.noSalaryOn.saved)}, cards=${r.noSalaryOn.cards})`);
  }
  console.log(`panel     : opened from chip, loaded settings; Save 30→${r.noSalaryOff.hidden}→${r.noSalaryOn.hidden} hidden with no reload`);
}

// ── 6. the observer reacts, and does not feed itself (spec.md §2.2) ───────
// Two properties in one probe. A newly inserted card must be filtered (the extension is live, not
// only correct at boot), and the rule pass must settle — renderChip() wipes the chip on every pass,
// so if isOurs() cannot recognise that pass as its own, each pass schedules the next one forever
// (measured before the fix: 1614 chip rebuilds in 4 s). Rebuilds are counted from document.body so
// the count survives the chip node being replaced.
{
  const loop = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    if (!await activate(tab)) await fail(`the observer check cannot run: ${HIDDEN_HINT}`);
    await settle(3000);
    return tab.evaluate(`(async () => {
      const container = document.querySelector('.jobpost-cat-box.latest-job-post')?.parentElement;
      if (!container) return JSON.stringify({ card: false });
      const chip = document.getElementById('ojc-chip');
      let passes = 0;
      const mo = new MutationObserver(ms => {
        for (const m of ms) if (m.target && m.target.id === 'ojc-chip') passes++;
      });
      mo.observe(document.body, { childList: true, subtree: true });

      // a card with no salary field: the rule must hide it as soon as it appears
      const probe = document.createElement('div');
      probe.className = 'jobpost-cat-box latest-job-post';
      probe.id = 'probe-card-not-ours';   // must not look like an injected #ojc-* node
      probe.innerHTML = '<div><dd class="col">Negotiable</dd></div>';
      container.appendChild(probe);
      // Poll for the effect rather than sleeping a fixed 1500 ms. A fixed window is what this file's own
      // waitFor() exists to avoid, and it duly produced a false alarm once: the card was simply not
      // processed yet, and the run reported the observer as broken.
      const t0 = Date.now();
      while (!probe.hidden && Date.now() - t0 < 4000) await new Promise(r => setTimeout(r, 100));
      const hidden = probe.hidden;
      const windowMs = Date.now() - t0;
      mo.disconnect();
      probe.remove();
      return JSON.stringify({ card: true, chip: !!chip, hidden, passes, windowMs });
    })()`);
  }, 500));

  if (!loop.card) await fail('no card container on the page — cannot check the observer');
  if (!loop.chip) await fail('no chip to observe in the observer check');
  if (!loop.hidden) {
    await fail('a card inserted after boot was not hidden — the mutation observer is not filtering new cards');
  }
  if (loop.passes > 20) {
    await fail(`one external DOM mutation caused ${loop.passes} chip rebuilds in ${loop.windowMs} ms ` +
      `— the rule pass is re-scheduling itself (isOurs() must judge the mutation target)`);
  }
  console.log(`observer  : new no-salary card hidden on arrival · ${loop.passes} chip rebuilds in ` +
    `${loop.windowMs} ms (bounded)`);
}

// ── 7. perpetual pagination (spec.md W6 / D8) ───────────────────────────
// The request count comes from CDP's Network domain, not a patched window.fetch: the loader
// runs in the content script's isolated world, where `fetch` is a different function. Only
// Fetch-type requests are counted, so the tab's own document load (and a category page URL)
// cannot be mistaken for a loader request. Three properties, none of them optional:
//   idle costs nothing · one scroll = one page · the counts describe every loaded card.
{
  const r = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    const reqs = [];
    await tab.send('Network.enable');
    tab.on('Network.requestWillBeSent', p => reqs.push({ url: p.request.url, type: p.type }));
    if (!await activate(tab)) await fail(`the pagination check cannot run: ${HIDDEN_HINT}`);
    await settle(3500);

    // The page facts this section needs, and NOT a fourth opinion on what the rules will do: the
    // prediction comes from `ruleEval` above, the one copy that injects rules.js and closed.js. The
    // version that used to live here re-implemented the match with `.includes()` and knew nothing about
    // the closed rule, so it reported "11 hidden but the rule says 10" the moment the memory held a
    // listing on this page — a phantom failure invented by the harness, not by the extension.
    const snapshot = async () => ({
      ...JSON.parse(await tab.evaluate(`(() => {
        const cards = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
        const shown = document.body.innerText.match(/Displaying\\s+(\\d+)\\s+out of\\s+(\\d+)/i);
        const off = (location.pathname.match(/\\/(\\d+)$/) || [])[1];
        return JSON.stringify({ cards: cards.length, hidden: cards.filter(c => c.hidden).length,
          total: shown ? +shown[2] : null, offset: off ? +off : 0 });
      })()`)),
      expect: JSON.parse(await ruleEval(tab, { neg, pos, maxAgeDays: MAX_AGE, closedIds: await readClosedIds() })).hiddenExpected,
    });
    const fetches = () => reqs
      .filter(x => x.type === 'Fetch' || x.type === 'XHR')
      .map(x => x.url)
      // Only the loader's own URL shape counts: a list page plus an offset segment. The site's
      // own beacons (/cdn-cgi/rum, gtag) are Fetch requests on the same host and would
      // otherwise make "idle costs nothing" unprovable.
      .filter(u => /^https:\/\/www\.onlinejobs\.ph\/jobseekers\/(jobsearch|search)\/[^?]*\d/.test(u));

    const idle = { ...await snapshot(), requests: fetches().length };
    const idleUrls = fetches();
    // Scroll with REAL wheel gestures (a programmatic scroll is not proof of intent and must not
    // buy a page), and keep going until the bottom: a list with few hidden cards is ~10,000 px tall,
    // so one wheel never reaches the sentinel. Stop as soon as the bottom is reached so exactly one
    // page is bought — that is the invariant under test.
    const wheel = () => tab.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: 700, y: 500, deltaX: 0, deltaY: 1300 });
    let wheels = 0;
    for (; wheels < 15; wheels++) {
      const atBottom = await tab.evaluate(
        `Math.round(scrollY) + innerHeight >= document.documentElement.scrollHeight - 40`);
      if (atBottom) break;
      await wheel();
      await settle(220);
    }
    await settle(4000);
    const afterOne = { ...await snapshot(), requests: fetches().length, wheels };
    return JSON.stringify({ idle, idleUrls, afterOne, pageUrls: fetches() });
  }, 500));

  if (!r.idle.cards) await fail('no cards on the page — cannot judge pagination');
  if (r.idle.requests !== 0) {
    await fail(`${r.idle.requests} result page(s) fetched while the page sat idle (${r.idle.cards} cards ` +
      `on screen): ${r.idleUrls.join(', ')} — loading must require a real scroll`);
  }
  // A page whose results are already fully loaded (a final partial page, offset + cards >= total)
  // must do the opposite: stop, spend nothing, and grow nothing.
  const everythingLoaded = r.idle.total !== null && r.idle.offset + r.idle.cards >= r.idle.total;
  if (everythingLoaded) {
    if (r.afterOne.requests !== 0 || r.afterOne.cards !== r.idle.cards) {
      await fail(`all ${r.idle.total} results are already on screen (offset ${r.idle.offset}, ` +
        `${r.idle.cards} cards) but scrolling fetched ${r.afterOne.requests} page(s) and grew the ` +
        `list to ${r.afterOne.cards} — the loader must know when it is done`);
    }
    console.log(`pagination: last page (${r.idle.offset}+${r.idle.cards}=${r.idle.total}) — idle and ` +
      `scrolled both spent 0 requests, nothing to load`);
  } else {
    if (r.afterOne.cards <= r.idle.cards) {
      await fail(`scrolling to the bottom loaded no more cards (${r.idle.cards} → ${r.afterOne.cards}) ` +
        '— the loader is broken, or autoLoad is off');
    }
    if (r.pageUrls.length !== 1) {
      await fail(`one scroll produced ${r.pageUrls.length} loader requests: ${r.pageUrls.join(', ')} ` +
        '(expected exactly one page per scroll)');
    }
    // the offset segment is the whole point: a category URL has no query string, a search URL does
    if (!/\/\d+(\?|$)/.test(r.pageUrls[0])) {
      await fail(`the next-page URL has no offset segment: ${r.pageUrls[0]}`);
    }
    if (r.afterOne.hidden !== r.afterOne.expect) {
      await fail(`after growing to ${r.afterOne.cards} cards, ${r.afterOne.hidden} are hidden but the ` +
        `rule says ${r.afterOne.expect} — the counts must be recomputed over all loaded cards`);
    }
    console.log(`pagination: idle ${r.idle.requests} requests · one scroll → +${r.afterOne.cards - r.idle.cards} cards, ` +
      `1 request (${r.pageUrls[0].replace(/^https:\/\/www\.onlinejobs\.ph/, '')}) · rule parity over ${r.afterOne.cards} cards`);
  }
}

// ── 8. the salary figure (spec.md W7) ───────────────────────────────────
// Money is the one thing here that can be confidently wrong, so this recomputes every card's figure
// from the DOM with the same parser (injected from salary.js), checks the exact text against it, and
// checks the conversion arithmetic against the rate the note itself claims to have used. The FX cache
// is cleared first so this tab has to make the live ECB call rather than reuse an earlier tab's.
{
  await storeEval(`chrome.storage.local.remove('fx').then(()=>1)`, 500);

  const r = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    const fxReqs = [];
    await tab.send('Network.enable');
    tab.on('Network.requestWillBeSent', p => {
      if (/api\.frankfurter\.dev/.test(p.request.url)) fxReqs.push(p.request.url);
    });
    await settle(5000);
    await tab.evaluate(`${salarySrc}\nwindow.__salary = window.OJCSalary; 1`);
    const body = JSON.parse(await tab.evaluate(`(() => {
      const { parseSalary, toPhp, ratePhp, formatNote, formatRate, meetsGoal } = window.__salary;
      const rows = [];
      const currencies = new Set();
      for (const card of document.querySelectorAll('.jobpost-cat-box.latest-job-post')) {
        const d = card.querySelector('dd.col');
        if (!d) continue;
        const own = d.cloneNode(true);
        for (const injected of own.querySelectorAll('[class^="ojc-"]')) injected.remove();
        const posted = own.textContent.trim();
        const shown = d.querySelector('.ojc-salary-note');
        const warn = d.querySelector('.ojc-salary-warn');
        const basis = window.__salary.hoursPerWeekFrom(card.textContent);
        const parsed = parseSalary(posted, basis.hours);
        if (parsed && parsed.currency !== 'PHP') currencies.add(parsed.currency);
        const rate = shown?.dataset.rate ? Number(shown.dataset.rate) : null;
        const rates = rate ? { [parsed.currency]: rate } : {};
        const php = toPhp(parsed, rates);
        const per = ratePhp(parsed, rates);       // the posted rate, even when a month exists
        // ONE goal per card (D13): full-time is judged monthly, part-time/other by the hour
        const hourlyPhp = per && (parsed.unit === 'hour' || parsed.unit === 'hour?') ? per : null;
        const judgedMonthly = basis.basis === 'full-time' || !hourlyPhp;
        const expectGoal = judgedMonthly
          ? (meetsGoal(php, ${GOAL}) ? 'monthly' : '')
          : (meetsGoal(hourlyPhp, ${GOAL_HOURLY}) ? 'hourly' : '');
        rows.push({ posted, currency: parsed ? parsed.currency : null, hasNote: !!shown,
          perUnit: parsed ? parsed.perUnit : false, monthly: parsed ? parsed.monthly : false,
          hours: basis.hours, hoursBasis: basis.basis, unit: parsed ? parsed.unit : null,
          note: shown ? shown.textContent : null, title: shown ? shown.title : null,
          warn: warn ? warn.textContent : null,
          goal: card.classList.contains('ojc-goal') ? (shown?.dataset.goal || 'unknown') : '',
          expect: php ? formatNote(php) : per ? formatRate(per, parsed.unit) : null,
          expectGoal,
          postedStillThere: shown ? d.textContent.includes(posted) : true });
      }
      return JSON.stringify({ rows, currencies: [...currencies] });
    })()`));
    return JSON.stringify({ ...body, fxRequests: fxReqs.length, fxUrls: fxReqs });
  }, 500));

  const parseable = r.rows.filter(x => x.currency);
  if (!parseable.length) await fail('no card had a readable salary — nothing to check');
  const missing = parseable.filter(x => !x.hasNote);
  if (missing.length) {
    await fail(`${missing.length} of ${parseable.length} readable cards got no note ` +
      `(e.g. posted ${JSON.stringify(missing[0].posted)}) — the annotation did not run on them`);
  }
  // the exact text: recomputed from the DOM with the same parser and the same hours basis
  const wrongText = parseable.filter(x => x.expect && x.note !== x.expect);
  if (wrongText.length) {
    await fail(`${wrongText.length} card(s) show a figure the parser does not produce: ` +
      wrongText.slice(0, 3).map(x => `posted ${JSON.stringify(x.posted)} → shown ${JSON.stringify(x.note)}, ` +
        `parser says ${JSON.stringify(x.expect)} (hours ${x.hours ?? 'unstated'})`).join(' | '));
  }
  // THE POLICY: a monthly figure requires stated hours (or a monthly/weekly/yearly amount).
  const inventedMonths = parseable.filter(x => /\/mo$/.test(x.note || '') && !x.monthly);
  if (inventedMonths.length) {
    await fail(`${inventedMonths.length} card(s) claim a month without the hours to justify it: ` +
      inventedMonths.slice(0, 3).map(x => `${JSON.stringify(x.posted)} → ${x.note} (hours basis: ${x.hoursBasis})`).join(' | '));
  }
  const hourlyWithHours = parseable.filter(x => x.hours && (x.unit === 'hour' || x.unit === 'hour?'));
  const unusedHours = hourlyWithHours.filter(x => !x.monthly);
  if (unusedHours.length) {
    await fail(`${unusedHours.length} card(s) state hours/week but were not converted to a month ` +
      `(e.g. ${JSON.stringify(unusedHours[0].posted)}, ${unusedHours[0].hours} h/week)`);
  }
  // A card with no figure must SAY why. The reasons are a closed set (salary-cards.js), and which one
  // applies depends on why the maths stopped, not on the card's unit: an hourly card with no live rate
  // says so, and that is the honest answer. This used to demand the "no monthly figure is claimed"
  // wording from anything with unit 'hour', so a transiently-unavailable currency (NZD during one run)
  // failed the gate even though the card explained itself correctly.
  const REASONS = [
    /per-unit rate has no honest monthly equivalent/,
    /no monthly figure is claimed/,
    /no live [A-Z]{3}→PHP rate/,
    /bare number with no unit/,
  ];
  const silent = parseable.filter(x => !x.note);
  for (const x of silent) {
    if (!REASONS.some(re => re.test(x.title || ''))) {
      await fail(`a card shows no figure without saying why: posted ${JSON.stringify(x.posted)}, ` +
        `title ${JSON.stringify(x.title || '')} — none of the honest reasons matched ` +
        `(${REASONS.map(String).join(' | ')})`);
    }
  }
  const pieces = parseable.filter(x => x.perUnit);
  for (const x of pieces) {
    if (x.note || x.goal) {
      await fail(`a piece rate got a figure or a goal mark: ${JSON.stringify(x.posted)} → ` +
        `${JSON.stringify(x.note)}, goal=${x.goal}`);
    }
  }
  // the disclaimer: only a month that rests on the 40 h/week full-time definition carries one
  const wantWarn = parseable.filter(x => x.monthly && (x.unit === 'hour' || x.unit === 'hour?')
    && x.hoursBasis === 'full-time');
  const hasWarn = parseable.filter(x => x.warn);
  if (hasWarn.length !== wantWarn.length) {
    await fail(`${hasWarn.length} card(s) carry the h/week disclaimer but ${wantWarn.length} should: ` +
      `e.g. ${JSON.stringify((wantWarn.find(x => !x.warn) || hasWarn.find(x => !wantWarn.includes(x)) || {}).posted)}`);
  }
  for (const x of hasWarn) {
    if (!/assumes \d+ h\/week/.test(x.warn) || !/verify/.test(x.warn)) {
      await fail(`the disclaimer does not state the assumption: ${JSON.stringify(x.warn)}`);
    }
  }

  // A re-run of the rule pass must not change a single figure. This is the bug that produced
  // "₱50,186 - ₱401,485/mo": the h/week disclaimer stayed inside the salary cell, so the next pass read
  // its "40 h/week" as a second salary number. A derived DOM feeding its own input is silent otherwise.
  const before = r.rows.map(x => `${x.posted}|${x.note || ''}|${x.warn || ''}`).join('\n');
  const again = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    await settle(4500);
    const read = `[...document.querySelectorAll('.jobpost-cat-box.latest-job-post')].map(c => {
      const d = c.querySelector('dd.col'); if (!d) return '';
      const own = d.cloneNode(true);
      for (const injected of own.querySelectorAll('[class^="ojc-"]')) injected.remove();
      const note = d.querySelector('.ojc-salary-note'), warn = d.querySelector('.ojc-salary-warn');
      return own.textContent.trim() + '|' + (note ? note.textContent : '') + '|' + (warn ? warn.textContent : '');
    })`;
    const first = await tab.evaluate(read);
    // force two more rule passes without touching the settings
    await tab.evaluate(`document.querySelector('#ojc-toggle').click()`);
    await settle(500);
    await tab.evaluate(`document.querySelector('#ojc-toggle').click()`);
    await settle(1500);
    const second = await tab.evaluate(read);
    return JSON.stringify({ first, second });
  }, 500));
  const firstRows = again.first || [], secondRows = again.second || [];
  const drifted = firstRows.map((row, i) => (row === secondRows[i] ? null : { row, after: secondRows[i] })).filter(Boolean);
  if (drifted.length) {
    await fail(`${drifted.length} card(s) changed their figure when the rule pass re-ran (a derived DOM is ` +
      `feeding its own input): before ${JSON.stringify(drifted[0].row)}, after ${JSON.stringify(drifted[0].after)}`);
  }

  const converted = parseable.filter(x => x.note && /^≈ ₱/.test(x.note));
  if (!converted.length) {
    await fail(`no card was converted to ₱ (currencies on page: ${r.currencies.join(', ') || 'none'}) — ` +
      'the ECB rate request or the maths is broken');
  }
  const months = parseable.filter(x => /\/mo$/.test(x.note || ''));
  const rates = parseable.filter(x => /\/(hr|day)$/.test(x.note || ''));  // exactly one rate request per foreign currency, and none for a ₱-only page
  if (r.fxRequests !== r.currencies.length) {
    await fail(`${r.fxRequests} rate request(s) for ${r.currencies.length} foreign currenc(y|ies) ` +
      `${r.currencies.join(', ')}: ${r.fxUrls.join(', ')} — expected exactly one per currency`);
  }
  // the goal brighten: exactly the cards that clear their own goal, and the tag says which one
  const wrongGoal = parseable.filter(x => (x.goal || '') !== (x.expectGoal || ''));
  if (wrongGoal.length) {
    await fail(`${wrongGoal.length} card(s) mis-marked against the goals (₱${GOAL}/mo, ₱${GOAL_HOURLY}/hr): ` +
      wrongGoal.slice(0, 3).map(x => `${JSON.stringify(x.posted)} → ${x.note}, marked=${x.goal || 'none'}, ` +
        `expected=${x.expectGoal || 'none'}`).join(' | '));
  }
  const monthlyMarks = parseable.filter(x => x.goal === 'monthly');
  const hourlyMarks = parseable.filter(x => x.goal === 'hourly');
  if (!monthlyMarks.length) await fail(`no card cleared the ₱${GOAL} monthly goal — lower --goal`);
  if (!hourlyMarks.length) {
    await fail(`no card cleared the ₱${GOAL_HOURLY}/hr hourly goal — lower --goal-hourly, or a posting ` +
      'that only quotes a rate is not being judged at all');
  }
  // the two goals must stay independent and never be derived from one another
  if (hourlyMarks.some(x => x.monthly && x.hoursBasis === 'full-time')) {
    await fail('a full-time card was marked against the HOURLY goal — full time has a month, so the monthly goal judges it');
  }
  if (monthlyMarks.some(x => !x.monthly)) {
    await fail('a card with no monthly figure was marked against the MONTHLY goal');
  }
  // the posted text keeps its place: the figure is added above it, never instead of it
  const swallowed = parseable.filter(x => !x.postedStillThere);
  if (swallowed.length) {
    await fail(`the posted salary text disappeared from ${swallowed.length} card(s) — the figure must sit above it, not replace it`);
  }
  console.log(`salary    : ${months.length} monthly figure(s), ${rates.length} posted-rate figure(s), ` +
    `${pieces.length} piece rate(s) left alone, ${silent.length} with no figure · ` +
    `${r.fxRequests} live rate request(s) for ${r.currencies.join('/') || 'no'} foreign currency · ` +
    `${monthlyMarks.length} above ₱${GOAL}/mo, ${hourlyMarks.length} above ₱${GOAL_HOURLY}/hr`);
}

// ── 9. our own annotation must not feed the rules ───────────────────────
// The salary note, the h/week disclaimer and the highlight badge live in the very cells the rules
// read, so text WE wrote can decide a card's fate. Two real cases: a second rule pass re-parsed the
// disclaimer's own "40 h/week" into the figure "₱50,186 - ₱401,485/mo", and the word "assumes" — which
// is in our disclaimer and on no listing on this board — highlighted two cards. Both are the same bug
// (an output fed back as input) and both are fixed the same way: strip our namespace before reading.
//
// The keyword is taken from the rendered disclaimer rather than hardcoded, so rewording the
// disclaimer cannot silently weaken this check.
{
  const r = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    await settle(3500);
    const read = () => tab.evaluate(`(() => {
      const cards = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
      const siteText = (c) => { const o = c.cloneNode(true);
        for (const i of o.querySelectorAll('[class^="ojc-"]')) i.remove(); return o.textContent.toLowerCase(); };
      const warn = document.querySelector('.ojc-salary-warn');
      // siteText() already lower-cases; take the first word of the disclaimer as the keyword
      const word = warn ? warn.textContent.trim().split(/\\s+/)[0].toLowerCase() : '';
      return JSON.stringify({
        word,
        badges: cards.filter(c => c.querySelector('.ojc-pos-badge')).length,
        warned: cards.filter(c => c.querySelector('.ojc-salary-warn')).length,
        siteTextHasWord: cards.filter(c => siteText(c).includes(word)).length,
      });
    })()`);
    const before = JSON.parse(await read());
    await tab.evaluate(`document.querySelector('#ojc-gear').click()`);
    await settle(300);
    // That word, and only that word, as a positive keyword: nothing on the board contains it.
    await tab.evaluate(`(() => {
      document.querySelector('#ojc-pos').value = ${JSON.stringify(before.word || '')};
      document.querySelector('#ojc-neg').value = '';
      document.querySelector('#ojc-noSalary').checked = false;
      document.querySelector('#ojc-save').click();
      return 1; })()`);
    await settle(900);
    const polluted = JSON.parse(await read());
    // put the harness's seeded settings back through the same Save (this section runs last)
    await tab.evaluate(`(() => {
      document.querySelector('#ojc-pos').value = ${JSON.stringify(pos.join('\n'))};
      document.querySelector('#ojc-neg').value = ${JSON.stringify(neg.join('\n'))};
      document.querySelector('#ojc-noSalary').checked = true;
      document.querySelector('#ojc-save').click();
      return 1; })()`);
    await settle(600);
    return JSON.stringify({ before, polluted });
  }, 500));

  if (!r.before.warned) {
    await fail('no card carries the h/week disclaimer on this page — cannot test that our own text ' +
      'stays out of the rules (run with a page that has hourly full-time listings)');
  }
  if (r.before.siteTextHasWord !== 0) {
    await fail(`the disclaimer word ${JSON.stringify(r.before.word)} also appears in the site's own text ` +
      `on ${r.before.siteTextHasWord} card(s) — this check would not prove anything on this page`);
  }
  if (r.polluted.badges > 0) {
    await fail(`${r.polluted.badges} card(s) were highlighted by our own disclaimer text ` +
      `(keyword ${JSON.stringify(r.before.word)}, present in ${r.before.warned} disclaimer(s) and in 0 ` +
      'listings) — our injected DOM is feeding the rule that decides what to show');
  }
  console.log(`own text  : keyword ${JSON.stringify(r.before.word)} (in ${r.before.warned} disclaimer(s), ` +
    `0 listings) highlighted 0 card(s) — our annotation stays out of the rules`);
}

// ── 10. the listing's own page (spec.md W4) ─────────────────────────────
// Two things can make this section pass without testing anything, so both are ruled out by design:
// the ambient page may have nothing to highlight, and the pay figure may be one this board cannot
// compute. It therefore walks real listings until it finds one that shows a monthly figure, and it
// inserts its own off-platform paragraph (the same trick section 6 uses for a card) to force every
// detector to fire on a page that may contain none of them.
{
  const links = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    await activate(tab);
    await waitFor(tab, `document.querySelectorAll('.jobpost-cat-box').length`, { timeout: 12000 });
    return JSON.stringify(await tab.evaluate(`[...document.querySelectorAll('.jobpost-cat-box a[href*="/job/"]')].map(a => a.getAttribute('href')).slice(0, 3)`));
  }, 400));
  if (!links.length) await fail('no job link on the board page — cannot test the detail page at all');

  const fxStore = JSON.parse(await storeEval(`chrome.storage.local.get('fx').then(r => JSON.stringify((r.fx || {}).rates || {}))`));
  const RATES = {};
  for (const [cur, row] of Object.entries(fxStore)) RATES[cur] = row.rate;

  let checked = 0, parity = null;
  for (const href of links) {
    const r = JSON.parse(await withTab(PORT, 'https://www.onlinejobs.ph' + href, async (tab) => {
      await activate(tab);
      if (!await waitFor(tab, `!!document.getElementById('ojc-detail-bar')`, { timeout: 12000 })) {
        return JSON.stringify({ missing: true });
      }
      await tab.evaluate(`${salarySrc}\nwindow.__salary = window.OJCSalary; 1`);
      const read = () => tab.evaluate(`(() => {
        const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
        const dd = [...document.querySelectorAll('dl.row.no-gutters dd')];
        const val = (re) => { for (const d of dd) { const h = d.querySelector('h3'); if (h && re.test(clean(h.textContent))) return clean(d.querySelector('p')?.textContent || ''); } return null; };
        const bar = document.getElementById('ojc-detail-bar');
        const marks = [...document.querySelectorAll('#job-description [class^="ojc-hl-"]')].map(e => ({ kind: e.className.replace('ojc-hl-', ''), text: clean(e.textContent) }));
        const desc = document.getElementById('job-description');
        return JSON.stringify({
          bar: bar ? [...bar.children].map(c => clean(c.textContent)) : null,
          payItem: bar ? clean(([...bar.children].find(c => /\u20b1|rate only/.test(c.textContent)) || {}).textContent || '') : '',
          hours: val(/hours/i), pay: val(/wage|salary/i), type: val(/type of work/i),
          descText: desc ? clean(desc.textContent) : '',
          marks,
        });
      })()`);
      const before = JSON.parse(await read());

      const expected = await tab.evaluate(`(() => {
        const { parseSalary, toPhp, formatNote, FULL_TIME_HOURS } = window.__salary;
        const hours = /^\\d+$/.test(${JSON.stringify(before.hours || '')}) ? Number(${JSON.stringify(before.hours || '')}) : null;
        const partTime = /part[\\s-]?time|gig/i.test(${JSON.stringify(before.type || '')});
        const basis = hours !== null ? hours : (partTime ? null : FULL_TIME_HOURS);
        const parsed = parseSalary(${JSON.stringify(before.pay || '')}, basis);
        if (!parsed) return '';
        const php = toPhp(parsed, ${JSON.stringify(RATES)});
        return php ? formatNote(php) : '';
      })()`);

      // Force every detector: an ask, a bare link, an email, and the site's redaction, in one paragraph.
      const FIXTURE = 'To apply, please complete this short application form in English: forms.gle/Fixture123, ' +
        'or email your resume to hiring@example.com — last resort: ----------';
      await tab.evaluate(`(() => {
        const p = document.createElement('p');
        p.textContent = ${JSON.stringify(FIXTURE)};
        document.getElementById('job-description').appendChild(p);
        return 1; })()`);
      // A settings write re-runs the page's pass — but only a write that CHANGES something: Chrome fires
      // storage.onChanged for a real change, not for `set` with an identical object. Writing the settings
      // back unchanged looked like a re-run and was not one (the first version of this section asserted
      // nothing and reported an empty mark list). So toggle a field that cannot affect this page.
      const seeded = (await readSettings()).showHidden;
      const poke = async (on) => {
        await storeEval(`chrome.storage.local.get('settings').then(r => chrome.storage.local.set({ settings: Object.assign({}, r.settings, { showHidden: ${on} }) }))`);
        await settle(500);
      };
      await poke(!seeded);
      const after = JSON.parse(await read());
      const fixtureMarks = after.marks.filter(m => FIXTURE.includes(m.text));
      const marked = fixtureMarks.map(m => m.kind + ':' + m.text);
      // Three more real re-runs: a highlighter that re-wraps its own spans fragments the text, and the
      // mark count would climb on every pass.
      for (const on of [seeded, !seeded, seeded]) await poke(on);
      const again = JSON.parse(await read());
      return JSON.stringify({ before, marked, spansAfter: after.marks.length, spansAgain: again.marks.length,
        expected, fixture: FIXTURE });
    }, 400));
    if (r.missing) continue;
    checked++;
    if (r.expected && !parity) parity = r;
    if (parity && r.marked.length >= 5) break;
  }
  if (!checked) await fail('no listing page rendered the detail bar — the W4 files are not being injected');
  if (!parity) await fail(`none of ${checked} listing(s) showed a monthly figure — cannot check the detail ` +
    'page\'s arithmetic (run with a board page that has listings with hours and a rate)');

  const wanted = [['forms.gle/Fixture123', 'url'], ['hiring@example.com', 'email'], ['----------', 'redacted'], ['To apply', 'ask']];
  const missing = wanted.filter(([t]) => !parity.marked.some(m => m === 'warn:' + t));
  if (missing.length) {
    await fail('the off-platform detectors did not fire on a paragraph that contains all of them: ' +
      `missing ${missing.map(m => m[1]).join(', ')} (got ${JSON.stringify(parity.marked)})`);
  }
  if (parity.before.marks.some(m => !parity.before.descText.includes(m.text))) {
    await fail('a highlight contains text that is not in the description — the highlighter is inventing text');
  }
  if (parity.spansAfter !== parity.spansAgain) {
    await fail(`the highlighter is not idempotent: ${parity.spansAfter} marks became ${parity.spansAgain} ` +
      'after extra passes, so the description is being re-wrapped and fragmenting');
  }
  if (parity.before.payItem && !parity.before.payItem.includes(parity.expected)) {
    await fail(`the detail bar shows ${JSON.stringify(parity.before.payItem)} but recomputing the same ` +
      `figures with the same parser and the same cached rate gives ${JSON.stringify(parity.expected)}`);
  }
  console.log(`detail    : ${checked} listing(s) — bar shows ${JSON.stringify(parity.before.payItem)} ` +
    `(hours ${JSON.stringify(parity.before.hours)}), recomputed identically; off-platform paragraph fired ` +
    `${parity.marked.length} mark(s) incl. ${missing.length ? 'MISSING' : 'link, email, redaction and ask'}; ` +
    `${parity.before.marks.length} mark(s) on the page's own text`);
}

// ── 11. the closed-listing memory (spec.md W9) ────────────────────────────
// The learning path cannot be faked from storage — `learn()` reads the page's own words — so the
// closure notice is injected before the extension boots, and the run then checks that it was recorded
// AND that the board acts on the record. A listing that is already closed on the live board would make
// this flaky; a notice injected into a real listing cannot.
{
  const jobHref = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    await activate(tab);
    await waitFor(tab, `document.querySelectorAll('.jobpost-cat-box').length`, { timeout: 12000 });
    return JSON.stringify(await tab.evaluate(`(document.querySelector('.jobpost-cat-box a[href*="/job/"]') || {}).getAttribute?.('href') || ''`));
  }, 400));
  if (!jobHref) await fail('no job link to teach the closure memory with');
  const jobId = (/-\d+(?:[?#]|$)/.exec(jobHref) || [''])[0].replace(/\D/g, '');

  const tab = await openTab(PORT, 'about:blank', 300);
  // `Page.enable` is not optional: without it the injected script is registered and never run, which
  // looks exactly like a listing that is not closed (three attempts were spent on that distinction).
  await tab.send('Page.enable');
  // Runs before every page script in this tab, so the notice is part of the page the extension sees.
  await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: [
    'setInterval(function () {',
    '  if (!document.body || document.getElementById("ojc-fixture-closed")) return;',
    '  var d = document.createElement("div");',
    '  d.id = "ojc-fixture-closed";',
    '  d.textContent = "This job has been closed";',
    '  document.body.prepend(d);',
    '}, 40);',
  ].join('\n') });
  await tab.send('Page.navigate', { url: 'https://www.onlinejobs.ph' + jobHref });
  await activate(tab);
  const barSaysClosed = await waitFor(tab, `!!document.getElementById('ojc-detail-bar')`, { timeout: 12000 });
  const banner = await tab.evaluate(`(() => { const b = document.getElementById('ojc-detail-bar');
    return b ? [...b.children].map(c => c.textContent.trim()).join(' | ') : ''; })()`);
  const learned = await waitFor(STORE, `chrome.storage.local.get('closedJobs').then(r => !!(r.closedJobs||{})[${JSON.stringify(jobId)}])`, { timeout: 8000 });
  tab.close();
  if (!barSaysClosed) await fail('the detail bar never appeared on a page that says the job is closed');
  if (!learned) await fail(`opening closed listing ${jobId} did not record it in chrome.storage.local.closedJobs`);

  // And the board must act on it: hidden, marked, and counted — exactly as the live setting dictates.
  const r = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    await activate(tab);
    await waitFor(tab, `document.querySelectorAll('.jobpost-cat-box').length`, { timeout: 12000 });
    await settle(1200);
    return await tab.evaluate(`(() => {
      const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
      const card = [...document.querySelectorAll('.jobpost-cat-box')].find(c => (c.querySelector('a[href*="/job/"]') || {}).getAttribute?.('href') === ${JSON.stringify(jobHref)});
      const chip = document.getElementById('ojc-chip');
      return JSON.stringify({
        found: !!card,
        hidden: card ? card.hidden : null,
        cls: card ? card.classList.contains('ojc-closed') : false,
        badge: card ? clean((card.querySelector('.ojc-closed-badge') || {}).textContent || '') : '',
        chip: chip ? clean(chip.textContent) : '',
      });
    })()`);
  }, 400));
  const showHidden = (await readSettings()).showHidden;
  if (!r.found) await fail(`the listing we just learned as closed (${jobId}) is no longer on the board page`);
  if (!r.cls || !r.badge) await fail(`a remembered-closed card was not marked (class ${r.cls}, badge ${JSON.stringify(r.badge)})`);
  if (r.hidden !== !showHidden) await fail(`a remembered-closed card had hidden=${r.hidden} with showHidden=${showHidden}`);
  if (!/closed/.test(r.chip)) await fail(`the chip does not count the closed listing: ${JSON.stringify(r.chip)}`);
  // This run deliberately taught the memory a closure for a listing that is NOT closed. Remove it now,
  // explicitly, as well as through the storage snapshot at the end: a kill between the two must not be
  // able to leave a live listing hidden from the user for six months.
  await storeEval(`chrome.storage.local.get('closedJobs').then(r => { const m = r.closedJobs || {}; delete m[${JSON.stringify(jobId)}]; return chrome.storage.local.set({ closedJobs: m }); })`);
  console.log(`closed    : ${jobId} learned from the page ("${banner.split('|')[0].trim()}") and hidden on the board ` +
    `(hidden=${r.hidden}, badge ${JSON.stringify(r.badge)}), chip: ${JSON.stringify(r.chip)}`);
}

console.log('verify-live: PASS');
await restoreStorage();
await STORE?.close();
await settle(250);
process.exit(0);
