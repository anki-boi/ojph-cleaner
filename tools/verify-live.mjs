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
// W12's verdict table and state machine, injected for the same reason `rules.js` is: the tier the harness
// expects must come out of the SAME function the extension ran, not a re-implementation of it. The tier
// table has eight branches and a compatibility rule (no detail ⇒ 0.8.0's verdicts), which is exactly the
// kind of thing two copies get wrong in opposite directions.
const TIERS_SRC = fs.readFileSync(new URL('../tiers.js', import.meta.url), 'utf8');
const RECORDS_SRC = fs.readFileSync(new URL('../records.js', import.meta.url), 'utf8');
// detail-text.js is the off-platform detector (W4). Injected so the harness derives a scanned listing's
// facts with the SAME planner the extension used — an ask is only an ask if this file says so.
const DETAILTEXT_SRC = fs.readFileSync(new URL('../detail-text.js', import.meta.url), 'utf8');

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
const SNAP_KEEP = 5;
/**
 * Keep a timestamped copy of every snapshot, newest five only.
 *
 * The rolling file is written at the start of each run, so a run that the OS kills (which no handler can
 * catch) leaves its own seed in place and the NEXT run snapshots that seed as if it were the user's state —
 * the failure mode the comment on `restoreStorage` describes, one layer deeper. Dated copies mean there is
 * always something older to go back to.
 */
function saveDatedSnapshot(snap) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(os.tmpdir(), `ojc-snapshot-${stamp}.json`), JSON.stringify(snap, null, 1));
    const dir = os.tmpdir();
    const files = fs.readdirSync(dir).filter(f => /^ojc-snapshot-.*\.json$/.test(f)).sort();
    for (const old of files.slice(0, Math.max(0, files.length - SNAP_KEEP))) {
      try { fs.unlinkSync(path.join(dir, old)); } catch { /* best effort */ }
    }
  } catch (e) {
    console.error(`verify-live: WARNING — could not keep a dated snapshot (${e.message})`);
  }
}
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
  // The WHOLE message, not just its first line: cdp.mjs appends the tail of the page-side expression that
  // threw, and that is the only thing that makes a SyntaxError in a `tab.evaluate` template literal findable.
  console.error(`verify-live: ${what} — ${err && err.message ? err.message : err}`);
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
/**
 * Click a button the way a human does: hit-tested mousedown, a pause, then mouseup.
 *
 * `element.click()` cannot tell a button from a button that is REPLACED between the two halves of a click,
 * and that difference shipped: the chip used to be rebuilt wholesale on every rule pass, so a mousedown on
 * Settings landed on one node, the pass replaced it, the mouseup landed on its replacement, and the browser
 * dispatched the click on their common ancestor instead of on the handler. Measured live on an idle page:
 * pointerdown, mousedown and mouseup all reported `ojc-gear`, and no click event ever fired — which is why
 * the user reported "clicking the settings button is broken" while every synthetic click in this file passed.
 *
 * The pause in the middle is the point: it gives a rule pass the chance to land between the two halves, which
 * is exactly what a real user's click has to survive.
 */
const realClick = async (tab, selector, holdMs = 250) => {
  const at = JSON.parse(await tab.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)});
    if (!e) return JSON.stringify({ missing: true });
    const r = e.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); })()`));
  if (at.missing) return false;
  await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none' });
  await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
  await settle(holdMs);
  await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
  await settle(500);
  return true;
};

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

/**
 * The board must actually render cards before anything that sits on them can be checked. Late in a run
 * the site has been hammered by the scan section and answers 429, and a throttled board page has no
 * cards for the chip to exist on — so wait, and retry the navigation once before calling it a failure.
 */
const CARDS_EXPR = `document.querySelectorAll('.jobpost-cat-box.latest-job-post').length`;
const waitCards = async (tab) => {
  if (await waitFor(tab, CARDS_EXPR, { timeout: 20000 })) return true;
  await tab.send('Page.navigate', { url: URL_ });
  return !!(await waitFor(tab, CARDS_EXPR, { timeout: 20000 }));
};

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
// …and a DATED copy, because the rolling file is overwritten by the next run's snapshot — so a run that is
// SIGKILLed (no handler can run) leaves its seeded settings in place, the next run dutifully snapshots THOSE,
// and the user's real keywords are gone with nothing to recover from. That is not hypothetical: it is how
// this session lost the 1 negative + 1 positive keyword list the profile started with. The five most recent
// copies are kept, and any of them can be restored by hand (or with --restore).
saveDatedSnapshot(SNAPSHOT);
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
/**
 * The verdict every card should have, recomputed from the DOM — with the extension's own code.
 *
 * `rules.js`, `tiers.js`, `records.js` and `closed.js` are injected (the same UMD factories the
 * content script uses), so this is a parity check and not a second opinion: the eight-branch verdict
 * table, the date maths and the job-id extraction all come from the code under test.
 *
 * Two things make it match the extension exactly, and both have a live failure behind them:
 *
 *   1. **The record's keyword facts are only trusted when the record was derived under the same keyword
 *      lists** (`records.settingsKey`). The board does that (D36), so a harness that skipped it would
 *      predict tiers the board cannot reach and report phantom failures.
 *   2. **`posExpected` is the ✓ badge count, not a bucket count**: a card can be High yield because it
 *      pays above a goal with no keyword at all, and those carry no badge.
 */
/**
 * Put the page's cached descriptions (the extension's own IndexedDB store) into the page world once, so
 * `ruleEval` can re-derive a scanned listing's facts from the cache exactly as records-cards.js does.
 * One read per page, not one per poll: section 4b polls 40 times and would otherwise re-read 60 rows 40 times.
 */
const primeCache = (tab) => tab.evaluate(`new Promise((res) => {
  const ids = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')]
    .map(c => { const a = c.querySelector('a[href*="/job/"]'); return a ? a.getAttribute('href') : null; })
    .filter(Boolean).map(h => (h.match(/[0-9]+\\/?$/) || [])[0]).filter(Boolean);
  const out = {};
  if (!ids.length) { self.__ojcCache = out; return res(0); }
  const r = indexedDB.open('ojc', 1);
  r.onerror = () => { self.__ojcCache = out; res(0); };
  r.onsuccess = () => {
    const store = r.result.transaction('details', 'readonly').objectStore('details');
    let pending = ids.length;
    const finish = () => { if (--pending === 0) { self.__ojcCache = out; res(Object.keys(out).length); } };
    for (const id of ids) {
      const q = store.get(String(id));
      q.onsuccess = () => {
        // The SAME 7-day TTL the extension applies (detail-cache getMany): a stale row is one the
        // extension will not read, and a harness that reads it anyway predicts a figure the board has
        // deliberately stopped using — five phantom "wrong figure" failures, all of them the harness's.
        const row = q.result;
        if (row && Date.now() - Number(row.at || 0) <= 604800000) {
          out[String(id)] = { desc: row.desc, hours: row.fields ? row.fields.hoursPerWeek : null };
        }
        finish();
      };
      q.onerror = finish;
    }
  };
})`);

const ruleEval = (tab, { neg = [], pos = [], maxAgeDays = 0, noSalary = true, closedIds = [], records = {}, rescue = false, rescueNeg = false, showHidden = false } = {}) => tab.evaluate(`${RULES_SRC}
${DETAILTEXT_SRC}
${TIERS_SRC}
${RECORDS_SRC}
${CLOSED_SRC}
(() => {
  const settings = { negative: ${JSON.stringify(neg)}, positive: ${JSON.stringify(pos)} };
  const maxAgeDays = ${JSON.stringify(Number(maxAgeDays) || 0)};
  const noSalary = ${JSON.stringify(noSalary !== false)};
  const rescue = ${JSON.stringify(!!rescue)};
  const rescueNeg = ${JSON.stringify(!!rescueNeg)};
  const showHidden = ${JSON.stringify(!!showHidden)};
  const closedIds = new Set(${JSON.stringify(closedIds.map(String))});
  const saved = OJCRecords.prune(${JSON.stringify(records)}, Date.now(), OJCRecords.HISTORY_DAYS * 86400000);
  const sk = OJCRecords.settingsKey(settings);
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
  const idOf = (c) => { const a = c.querySelector('a[href*="/job/"]'); return a ? OJClosed.jobIdFrom(a.getAttribute('href')) : null; };
  // The duplicate key, mirroring page.js: title + company, normalized, employment badge stripped.
  // (No \\s or \\b here: this is page-side code inside a template literal, where an escape loses its
  // backslash — a literal tab in the character class is the same match.)
  const dupKeyOf = (c) => {
    const h = c.querySelector('dt h4');
    if (!h) return null;
    const hh = h.cloneNode(true);
    hh.querySelectorAll('[class*="badge"]').forEach(b => b.remove());
    const title = (hh.textContent || '').replace(/[ \t]+/g, ' ').trim().toLowerCase();
    if (!title) return null;
    const p = c.querySelector('p[data-temp]');
    const company = p ? ownText(p).split(/[•·]/)[0].replace(/[ \t]+/g, ' ').trim().toLowerCase() : '';
    return title + '|' + company;
  };
  const dupSet = OJRules.findDuplicates(cards.map(c => ({ key: dupKeyOf(c), at: postedAt(c) })));
  const tiers = { closed: 0, stale: 0, nosal: 0, high: 0, pos: 0, worth: 0, kw: 0, none: 0 };
  let noDate = 0, noUtc = 0, negBadges = 0, posBadges = 0, flagBadges = 0, scanned = 0, overHours = 0, fresh = 0, dups = 0, negRescuedCount = 0, bothSides = 0;
  for (let i = 0; i < cards.length; i++) { const c = cards[i];
    const text = ownText(c);
    const p = c.querySelector('p[data-temp]');
    if (!p || !p.getAttribute('data-temp-2')) noUtc++;
    const at = postedAt(c);
    if (at == null) noDate++;
    const id = idOf(c);
    const rec = id ? saved[String(id)] : null;
    // The extension re-derives a record's facts from the CACHED description under the CURRENT settings (D36)
    // and only falls back to the stored facts when the cache is gone — and only then if those were derived
    // under these same keyword lists. Both branches are mirrored here. Skipping the first one made the
    // harness predict card-level verdicts for cards the board had genuinely deep-scanned, and it reported a
    // phantom failure the moment a single record existed.
    const row = rec ? (self.__ojcCache || {})[String(id)] : null;
    const detail = row && row.desc
      ? OJCTiers.detailFacts(row.desc, settings, OJRules.matchKeywords, OJCDetailText.plan)
      : (rec && rec.detail && rec.sk === sk ? rec.detail : null);
    if (rec) scanned++;
    if (rec && rec.fields && Number(rec.fields.hoursPerWeek) > 40) overHours++;
    const card = { ...OJCTiers.cardFacts(text, settings, OJRules.matchKeywords), goal: c.classList.contains('ojc-goal'),
      goalBy: c.dataset.goalBy !== undefined ? Number(c.dataset.goalBy) : null };
    const tier = OJCTiers.decide({
      closed: !!(id && closedIds.has(String(id))),
      stale: OJRules.isStale(at, now, maxAgeDays),
      noSalary: noSalary && !/\\d/.test(ownSal(c)),
      rescue, rescueNeg, negotiable: OJRules.isNegotiable(ownSal(c)), card, detail,
    });
    tiers[tier]++;
    // Fresh mirrors content.js: high yield, posted within a day, on the SAME posted instant as the recency rule.
    if (tier === 'high' && at != null && now - at < 24 * 3600 * 1000) fresh++;
    // Duplicates mirror content.js: the older copy is tagged whenever the card is VISIBLE (the view is all).
    const visibleTiers = showHidden
      ? ['high', 'pos', 'worth', 'none', 'closed', 'stale', 'nosal', 'kw']
      : ['high', 'pos', 'worth', 'none'];
    if (dupSet.has(i) && visibleTiers.includes(tier)) dups++;
    // The negotiable rescue mirror: NO figure (a card that says DOE but also states $4-$6 is a salaried
    // card, not a rescued one), the word says negotiable, the toggle is on, and the card landed where a
    // rescued card lands (pos or worth — both visible, so the tag must be on the card).
    if (noSalary && !/\\d/.test(ownSal(c)) && rescueNeg && OJRules.isNegotiable(ownSal(c)) && ['pos', 'worth'].includes(tier)) negRescuedCount++;
    const nm = card.neg.length > 0 || !!(detail && detail.neg && detail.neg.length);
    const pm = card.pos.length > 0 || !!(detail && detail.pos && detail.pos.length);
    // The D40 count: a listing that matched a keyword you like AND one you asked to hide. With no goal met
    // these must all be hidden, not yellow — that is the whole decision (see the bothSidesNoGoal probe).
    if (pm && nm) bothSides++;
    const flagged = !!(detail && (detail.flags || []).length);
    // One badge per KIND, mirroring content.js: a ✓ on High yield and Highlighted, a ✗ on every card a
    // hide keyword matched (high via the super-green rule, worth and kw), a ⚠ on anything off-platform.
    // The ✓ badge goes on High yield AND on Highlighted: a keyword you like is badged wherever it lands.
    if ((tier === 'high' || tier === 'pos' || tier === 'worth') && pm) posBadges++;   // worth badges both sides now
    if ((tier === 'high' || tier === 'worth' || tier === 'kw') && nm) negBadges++;
    // The off-platform tag goes on EVERY card that carries one, whatever its tier — it is a tag, not a verdict.
    if (['high', 'worth', 'kw', 'none'].includes(tier) && flagged) flagBadges++;
  }
  return JSON.stringify({ cards: cards.length, tiers,
    closedExpected: tiers.closed, staleExpected: tiers.stale, noSalExpected: tiers.nosal,
    negExpected: tiers.kw, reconExpected: tiers.worth, highExpected: tiers.high, posTierExpected: tiers.pos, freshExpected: fresh, dupExpected: dups, negRescuedExpected: negRescuedCount, bothSides,
    flagTagExpected: flagBadges,
    posExpected: posBadges, negBadgeExpected: negBadges, flagBadgeExpected: flagBadges,
    hiddenExpected: tiers.closed + tiers.stale + tiers.nosal + tiers.kw,
    scannedCards: scanned, overHours, noDate, noUtc });
})()`);

/** The ids the memory is holding, for the rule parity above. One read, one shape. */
const readClosedIds = async () => Object.keys((await readStorage()).closedJobs || {});
/** The remembered verdicts, for the same reason: the rule pass reads them, so a prediction that ignores
 *  them is wrong — and the extension's own `sk` check decides which of their facts are still usable. */
const readRecords = async () => (await readStorage()).jobRecords || {};

// ── 3. live page ─────────────────────────────────────────────────────────
const res = JSON.parse(await withTab(PORT, URL_, async (tab) => {
  await settle(3500);
  await primeCache(tab);   // the cached descriptions, before anything recomputes from them
  const counts = JSON.parse(await ruleEval(tab, { neg, pos, maxAgeDays: MAX_AGE, closedIds: await readClosedIds(), records: await readRecords() }));
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
      highlights: document.querySelectorAll('.ojc-pos-badge').length,
      flagBadges: document.querySelectorAll('.ojc-flag-badge').length,
      hoursBadges: document.querySelectorAll('.ojc-hours').length,
      hoursOver: document.querySelectorAll('.ojc-hours-over').length,
      freshBadges: document.querySelectorAll('.jobpost-cat-box .ojc-fresh').length,
      dupBadges: document.querySelectorAll('.jobpost-cat-box .ojc-dup').length,
      tierBadges: document.querySelectorAll('.ojc-tier-badge').length,
      // The verdict the pass wrote on each card (data-ojc-tier) — the board's own claim, which the
      // recomputation above has to agree with bucket by bucket.
      domTiers: (() => {
        const t = { closed: 0, stale: 0, nosal: 0, high: 0, pos: 0, worth: 0, kw: 0, none: 0, unset: 0 };
        for (const c of cards) t[c.dataset.ojcTier || 'unset']++;
        return t;
      })()
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
  `${res.negBadges} ✗ badge(s) · ${res.freshExpected} fresh (high yield, last 24 h) · ${res.dupExpected} duplicate(s)`);

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
if (res.freshBadges !== res.freshExpected) {
  await fail(`${res.freshBadges} card(s) carry the ● fresh mark, expected ${res.freshExpected} — fresh is high yield ` +
    `posted within 24 h, judged on the same instant as the recency rule`);
}
if (res.dupBadges !== res.dupExpected) {
  await fail(`${res.dupBadges} card(s) carry the ⚠ duplicate mark, expected ${res.dupExpected} — the OLDER copy per ` +
    `title+company is marked, and only when it is visible`);
}
if (res.negBadges !== res.negBadgeExpected) {
  await fail(`${res.negBadges} card(s) carry the ✗ badge, expected ${res.negBadgeExpected} — every card a hide ` +
    `keyword matched must say which keyword matched, whichever bucket it landed in (hidden ${res.negExpected}, ` +
    `reconsidering ${res.reconExpected})`);
}
// The verdict table itself, bucket by bucket: what the pass wrote on the cards against what the same
// table says it should be. This is the assertion that would have caught the whole of W12 being wired
// backwards — a wrong bucket is invisible in the total, because the total counts hidden cards only.
for (const t of ['closed', 'stale', 'nosal', 'high', 'pos', 'worth', 'kw', 'none']) {
  if (res.domTiers[t] !== res.tiers[t]) {
    await fail(`${res.domTiers[t]} card(s) are "${t}", the rule says ${res.tiers[t]} — ` +
      `on the page ${JSON.stringify(res.domTiers)}, by the rule ${JSON.stringify(res.tiers)}`);
  }
}
if (res.domTiers.unset) await fail(`${res.domTiers.unset} card(s) carry no data-ojc-tier — the rule pass did not classify every card`);
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
// The off-platform tag: a tag, not a tier (the user's rule). Counted on every visible card that carries one.
if (res.flagBadges !== res.flagTagExpected) {
  await fail(`${res.flagBadges} card(s) carry the off-platform tag, expected ${res.flagTagExpected} — it tags every ` +
    `card that asks you to apply elsewhere, whatever tier it is in`);
}

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
    await primeCache(tab);
    // Read the remembered verdicts ONCE: nothing in this section scans, so the map cannot change between
    // polls — and a storage read inside a 40×250 ms poll loop is 120 reads for one answer.
    const closedIds = await readClosedIds();
    const records = await readRecords();
    /** Seed, then wait until the listing agrees with the recomputed rule — never sleep and hope. */
    const measure = async (partial) => {
      const next = { ...settings, ...partial, maxAgeDays: 0 };
      await storeEval(`chrome.storage.local.set({ settings: ${JSON.stringify(next)} }).then(()=>1)`, 300);
      const read = `JSON.stringify({
        hidden: document.querySelectorAll('.jobpost-cat-box.latest-job-post[hidden]').length,
        neg: document.querySelectorAll('.jobpost-cat-box.ojc-neg').length,
        recon: document.querySelectorAll('.jobpost-cat-box.ojc-recon').length,
        pos: document.querySelectorAll('.ojc-pos-badge').length,
        negotiable: [...document.querySelectorAll('.ojc-flag-badge')].filter(b => b.textContent.includes('negotiable')).length,
        both: [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')]
          .filter(c => c.querySelector('.ojc-pos-badge') && c.querySelector('.ojc-neg-badge')).length })`;
      let counts, dom;
      for (let i = 0; i < 40; i++) {
        counts = JSON.parse(await ruleEval(tab, { neg: next.negative, pos: next.positive, maxAgeDays: 0, closedIds, records,
          rescue: next.rescueNoSalary, rescueNeg: next.rescueNegotiable }));
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
    // Super green: the same hide keyword, but now TWO positive words against it, and a ₱1 goal that no
    // figure fails — so every card that carries both words has more positives than negatives, pays ≥ 150 %
    // of the goal, and must move out of yellow into High yield. (Probe words: 'the' and 'a' are prose,
    // so the branch is reachable on any board.)
    const superGreen = await measure({ negative: ['the'], positive: ['the', 'a'], goalSalary: 1, goalHourly: 1 });
    // D40 — the goal is a hard filter. The same both-sides cards as superGreen, with NO goal to clear: every
    // one of them must be HIDDEN, where the old `good && neg` table kept them yellow. This is the one live
    // case where a keyword you like used to hold a hide-keyword listing on the board, so it is the case the
    // user closed — and `bothSides` proves the probe actually reached it rather than passing on a page with
    // no such card.
    const bothSidesNoGoal = await measure({ negative: ['the'], positive: ['the', 'a'], goalSalary: 0, goalHourly: 0 });
    // The negotiable rescue (0.12): a no-figure listing that says Negotiable/DOE and matches a keyword you
    // like stays on the board with a ⚠ negotiable tag, instead of hiding. 'the' again — prose. This
    // measure covers the NATURAL cards (and proves a salaried card that merely says DOE is not tagged);
    // reachability itself is proven by the seam below, because boards do not reliably carry a pure
    // "Negotiable" card — the one this board has says $4-$6/hr DOE, and a stated figure is not no-salary.
    const negotiable = await measure({ negative: [], positive: ['the'], noSalary: true, rescueNegotiable: true, goalSalary: 0, goalHourly: 0 });
    // The negotiable seam (like the goal-mark seam): a FRESH clone whose salary cell says only
    // "Negotiable" and whose text matches the probe keyword. It must come out visible, pos, tagged.
    const negSeam = JSON.parse(await tab.evaluate(`(() => {
      const src = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')].find(c => c.querySelector('dd.col'));
      if (!src) return JSON.stringify({ skipped: 'no card carries a salary cell' });
      const clone = src.cloneNode(true);
      for (const injected of clone.querySelectorAll('[class^="ojc-"]')) injected.remove();
      for (const cls of ['ojc-neg', 'ojc-pos', 'ojc-recon', 'ojc-goal']) clone.classList.remove(cls);
      clone.hidden = false;
      clone.removeAttribute('title');
      const d = clone.querySelector('dd.col');
      if (d) d.textContent = 'Negotiable';
      const desc = clone.querySelector('.desc');
      if (desc) { const a = document.createElement('a'); a.textContent = ' the'; desc.prepend(a); }
      src.parentElement.appendChild(clone);
      window.__ojcNegSeam = clone;
      return JSON.stringify({ inserted: true });
    })()`));
    if (negSeam.inserted) {
      for (let i = 0; i < 40; i++) {
        Object.assign(negSeam, JSON.parse(await tab.evaluate(`(() => { const c = window.__ojcNegSeam;
          return JSON.stringify({ hidden: c.hidden, tier: c.dataset.ojcTier,
            badge: (c.querySelector('.ojc-badges .ojc-flag-badge') || {}).textContent || null }); })()`)));
        if (negSeam.tier === 'pos' && negSeam.badge && String(negSeam.badge).includes('negotiable')) break;
        await settle(250);
      }
      await tab.evaluate(`window.__ojcNegSeam.remove()`);
    }

    // The seam seeds its OWN settings: the super-green probe left positive keywords in place, and under
    // those the fresh card is correctly super green — this test is about the yellow state, not that one.
    await storeEval(`chrome.storage.local.set({ settings: { ...${JSON.stringify(settings)}, negative: ['the'], positive: [], goalSalary: 1, goalHourly: 1, maxAgeDays: 0 } }).then(()=>1)`, 300);
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
    return JSON.stringify({ hide, show, yellow, superGreen, bothSidesNoGoal, negotiable, negSeam, arrival });
  }, 500));

  const branches = [
    ['negative keyword hides', r.hide, r.hide.counts.negExpected > 0],
    ['positive keyword highlights', r.show, r.show.counts.posExpected > 0],
    ['a hide keyword on a good listing turns yellow instead', r.yellow, r.yellow.counts.reconExpected > 0],
    ['super green: more positives than negatives, pay ≥ 150 % of the goal → high yield',
      r.superGreen, r.superGreen.counts.highExpected > r.yellow.counts.highExpected],
    ['D40: keywords you like and keywords you hide, below the goal → hidden',
      r.bothSidesNoGoal, r.bothSidesNoGoal.counts.bothSides > 0],
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
    `yellow ${r.yellow.dom.recon}, super green ${r.superGreen.counts.highExpected - r.yellow.counts.highExpected} card(s) out of yellow, ` +
    `both-sides-no-goal ${r.bothSidesNoGoal.counts.bothSides} hidden, ` +
    `negotiable ${r.negotiable.dom.negotiable} natural + ${r.negSeam.badge ? 'seam tagged' : 'seam NOT tagged'} — each branch had to fire`);
  // D40, stated as the invariant rather than as a count: no listing may be Worth considering with no goal
  // met. `bothSides` above proves the probe had cards to make yellow, so this cannot pass vacuously.
  if (r.bothSidesNoGoal.counts.reconExpected !== 0) {
    await fail(`${r.bothSidesNoGoal.counts.reconExpected} card(s) came out Worth considering with no salary goal ` +
      `met (${r.bothSidesNoGoal.counts.bothSides} matched a keyword you like and one you asked to hide) — ` +
      `the goal is a hard filter, so a keyword you like can never keep a hide-keyword listing on the board`);
  }
  if (r.superGreen.counts.highExpected > r.yellow.counts.highExpected && r.superGreen.dom.both === 0) {
    await fail('a card matched keywords on both sides but shows only one badge — the user must see both');
  }
  // The natural cards: every rescued no-figure card must carry the tag that says why it is on the board —
  // and a salaried card that merely says DOE must not get one (the mirror counts it, the DOM must not tag it).
  if (r.negotiable.dom.negotiable !== r.negotiable.counts.negRescuedExpected) {
    await fail(`${r.negotiable.dom.negotiable} ⚠ negotiable tag(s), expected ${r.negotiable.counts.negRescuedExpected} — `
      + `every rescued no-figure card must say why it is on the board`);
  }
  // The seam card: the branch must be provable on this board.
  if (r.negSeam.inserted && !(r.negSeam.tier === 'pos' && !r.negSeam.hidden && String(r.negSeam.badge || '').includes('negotiable'))) {
    await fail(`the negotiable seam card came out ${JSON.stringify(r.negSeam)} — a no-figure card that says `
      + `Negotiable and matches a liked keyword must be shown, pos, and tagged`);
  }
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
    // A real click: the chip must survive a rule pass between the two halves (see realClick).
    await realClick(tab, '#ojc-gear');
    const opened = JSON.parse(await tab.evaluate(`(()=>{const p=document.getElementById('ojc-panel');
      if (!p) return JSON.stringify({exists:false});
      const fields=['#ojc-maxAge','#ojc-neg','#ojc-pos','#ojc-noSalary','#ojc-showHidden','#ojc-autoScan','#ojc-save'];
      return JSON.stringify({exists:true, visible:!p.hidden, inChip:!!document.querySelector('#ojc-chip #ojc-panel'),
        fields:fields.every(s=>!!p.querySelector(s)),
        neg:p.querySelector('#ojc-neg').value, noSalary:p.querySelector('#ojc-noSalary').checked,
        showHidden:p.querySelector('#ojc-showHidden').checked});})()`));
    // change a setting in the panel and Save — with a real click, and no reload between these reads
    await tab.evaluate(`document.querySelector('#ojc-noSalary').checked = false; 1`);
    await realClick(tab, '#ojc-save');
    await settle(300);
    const pickOff = JSON.parse(await pick());
    const noSalaryOff = await snap();
    await tab.evaluate(`document.querySelector('#ojc-noSalary').checked = true; 1`);
    await realClick(tab, '#ojc-save');
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
      if (!chip) return JSON.stringify({ card: !!container, chip: false });
      // Count PASSES, from the counter the extension writes on the chip (data-ojc-pass). Counting mutation
      // records instead made the bound unreadable: one pass rewrites a dozen rows, so "65 mutations" was
      // five passes or one, and the number moved every time the panel gained a row.
      let passes = 0;
      const startPass = Number(chip.dataset.ojcPass || 0);
      const mo = new MutationObserver(ms => {
        for (const m of ms) if (m.type === 'attributes' && m.attributeName === 'data-ojc-pass') passes++;
      });
      mo.observe(chip, { attributes: true, attributeFilter: ['data-ojc-pass'] });
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
      // One more beat, so a pass that is still queued when the card lands is counted: the goal-mark re-run
      // arrives a pass after the one that saw the card.
      await new Promise(r => setTimeout(r, 700));
      const windowMs = Date.now() - t0;
      const total = Number(chip.dataset.ojcPass || 0) - startPass;
      mo.disconnect();
      probe.remove();
      return JSON.stringify({ card: true, chip: true, hidden, passes: total, observed: passes, windowMs });
    })()`);
  }, 500));

  if (!loop.card) await fail('no card container on the page — cannot check the observer');
  if (!loop.chip) await fail('no chip to observe in the observer check');
  if (!loop.hidden) {
    await fail('a card inserted after boot was not hidden — the mutation observer is not filtering new cards');
  }
  // A bound, not a count: one inserted card should cost a handful of passes (the pass that sees it, the one
  // the goal mark asks for, and whatever the live page mutates meanwhile). A pass that schedules the next one
  // forever — the §2.2 loop, measured at 1 614 rebuilds in 4 s — blows straight past this.
  if (loop.passes > 12) {
    await fail(`one external DOM mutation caused ${loop.passes} rule passes in ${loop.windowMs} ms ` +
      `— the rule pass is re-scheduling itself (isOurs() must judge the mutation target)`);
  }
  console.log(`observer  : new no-salary card hidden on arrival · ${loop.passes} rule pass(es) in ` +
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
    await primeCache(tab);

    // The page facts this section needs, and NOT a fourth opinion on what the rules will do: the
    // prediction comes from `ruleEval` above, the one copy that injects rules.js and closed.js. The
    // version that used to live here re-implemented the match with `.includes()` and knew nothing about
    // the closed rule, so it reported "11 hidden but the rule says 10" the moment the memory held a
    // listing on this page — a phantom failure invented by the harness, not by the extension.
    const snapshot = async () => ({
      // rules.js is injected so `isStale` and `parsePosted` are the extension's own, not a second copy of
      // the date maths (the same reason ruleEval injects it).
      ...JSON.parse(await tab.evaluate(`${RULES_SRC}
(() => {
        const cards = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
        const shown = document.body.innerText.match(/Displaying\\s+(\\d+)\\s+out of\\s+(\\d+)/i);
        const off = (location.pathname.match(/\\/(\\d+)$/) || [])[1];
        const oldest = cards.map(c => { const p = c.querySelector('p[data-temp]');
          return p ? (OJRules.parsePosted(p.getAttribute('data-temp-2')) ??
            OJRules.parsePosted(p.getAttribute('data-temp'), OJRules.MANILA_OFFSET_MINUTES)) : null; })
          .filter(t => typeof t === 'number');
        const oldestAge = oldest.length ? Math.round((Date.now() - Math.min(...oldest)) / 86400000 * 10) / 10 : null;
        return JSON.stringify({ cards: cards.length, hidden: cards.filter(c => c.hidden).length,
          total: shown ? +shown[2] : null, offset: off ? +off : 0,
          // Is the tail already outside the window? Then the loader must refuse the next page.
          pastWindow: oldest.length > 0 && OJRules.isStale(Math.min(...oldest), Date.now(), ${MAX_AGE}),
          oldestAge });
      })()`)),
      expect: JSON.parse(await ruleEval(tab, { neg, pos, maxAgeDays: MAX_AGE, closedIds: await readClosedIds(), records: await readRecords() })).hiddenExpected,
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
  } else if (r.idle.pastWindow) {
    // The loader is allowed — required, in fact — to stop before a page it knows is entirely stale: the
    // oldest card loaded is the tail of a newest-first list, so everything after it is outside the window
    // and would be hidden on arrival (the user's own report: "your pagination is kinda overkill since you
    // still paginate even though you have reached the history threshold").
    if (r.afterOne.cards !== r.idle.cards || r.afterOne.requests !== r.idle.requests) {
      await fail(`the window ends at ${r.idle.cards} cards (oldest ${r.idle.oldestAge}d > ${MAX_AGE}d) but ` +
        `scrolling fetched ${r.afterOne.requests} more page(s) and grew the list to ${r.afterOne.cards} ` +
        '— past the recency window there is nothing worth a request');
    }
    console.log(`pagination: window reached at ${r.idle.cards} cards (tail ${r.idle.oldestAge}d old, ` +
      `window ${MAX_AGE}d) — scrolling spent 0 requests`);
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
    // The scan's own HOURS PER WEEK, straight from the page's cache — the same source the extension reads.
    // Without it this section recomputed every part-time card as a rate-only card ("hours unstated") and
    // reported five mismatches against cards that legitimately show a part-time month (W13.5).
    await primeCache(tab);
    // Only for listings that HAVE a remembered verdict: records-cards.js hydrates the cache per card id
    // that already has a record, so a cached page nobody has judged must not change the figure either.
    const recordsNow = await readRecords();
    const recordIds = Object.keys(recordsNow);
    const recordHours = {};
    for (const [id, rec] of Object.entries(recordsNow)) {
      const h = Number(rec && rec.fields && rec.fields.hoursPerWeek);
      if (Number.isFinite(h) && h > 0) recordHours[id] = h;
    }
    await tab.evaluate(`window.RECORD_HOURS = ${JSON.stringify(recordHours)}; 1`);
    const scanHours = JSON.parse(await tab.evaluate(`(() => {
      const allowed = new Set(${JSON.stringify(recordIds)});
      const out = {};
      for (const id of Object.keys(self.__ojcCache || {})) {
        const row = self.__ojcCache[id];
        if (allowed.has(id) && row && Number(row.hours) > 0) out[id] = Number(row.hours);
      }
      return JSON.stringify(out);
    })()`));
    // …handed to the page-side expression by name, since that world has no `scanHours` of its own.
    await tab.evaluate(`window.SCAN_HOURS = ${JSON.stringify(scanHours)}; 1`);
    // closed.js is injected for its job-id reader — the same one the extension and the cache use.
    const body = JSON.parse(await tab.evaluate(`${CLOSED_SRC}
(() => {
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
        // The listing's own hours win over the card's prose, exactly as records-cards.js decides it: a scan
        // that read HOURS PER WEEK = 10 makes the month honest, and the card says "part-time month at 10 h/week".
        const jobId = (() => { const a = card.querySelector('a[href*="/job/"]'); return a ? OJClosed.jobIdFrom(a.getAttribute('href')) : null; })();
        // The hours the extension SAYS it used, declared on the note it wrote (salary-cards.js sets
        // data-hours and data-basis). The harness used to guess this from the card's prose, and guessed wrong
        // the moment a scanned listing's own HOURS PER WEEK differed from what its preview text happened to
        // say — seven phantom failures. The FIGURE is still recomputed here with the same parser; only the
        // input is declared rather than guessed, and the declaration itself is checked below.
        const ownCard = (() => { const o = card.cloneNode(true);
          for (const injected of o.querySelectorAll('[class^="ojc-"]')) injected.remove();
          return o.textContent; })();
        const declaredHours = shown && shown.dataset.hours ? Number(shown.dataset.hours) : null;
        const declaredBasis = (shown && shown.dataset.basis) || null;
        const fromCache = jobId && SCAN_HOURS[jobId] ? SCAN_HOURS[jobId] : null;
        const fromRecord = jobId && window.RECORD_HOURS[jobId] ? window.RECORD_HOURS[jobId] : null;
        const fromText = (window.__salary.hoursPerWeekFrom(ownCard) || {}).hours ?? null;
        // Is that declaration legitimate? Either the scan cache really says those hours, or the card's own
        // words do — and a card with neither must declare none.
        const basisOk = declaredHours === null
          ? (fromCache === null && fromText === null)
          : (declaredHours === fromCache || declaredHours === fromText || declaredHours === fromRecord);
        const basis = { hours: declaredHours, basis: declaredBasis };
        const parsed = parseSalary(posted, basis.hours);
        if (parsed && parsed.currency !== 'PHP') currencies.add(parsed.currency);
        const rate = shown?.dataset.rate ? Number(shown.dataset.rate) : null;
        const rates = rate ? { [parsed.currency]: rate } : {};
        const php = toPhp(parsed, rates);
        const per = ratePhp(parsed, rates);       // the posted rate, even when a month exists
        // ONE goal per card (D13): full-time is judged monthly, part-time/other by the hour
        const hourlyPhp = per && (parsed.unit === 'hour' || parsed.unit === 'hour?') ? per : null;
        // One goal per card (D13): a full-time listing is judged monthly, a part-time one by the hour — the
        // honest month a scan bought does NOT move it to the monthly goal (lower pay for fewer hours is the
        // point of part-time). The card shows the month; the goal judges the rate.
        const judgedMonthly = basis.basis === 'full-time' || !hourlyPhp;
        const expectGoal = judgedMonthly
          ? (meetsGoal(php, ${GOAL}) ? 'monthly' : '')
          : (meetsGoal(hourlyPhp, ${GOAL_HOURLY}) ? 'hourly' : '');
        rows.push({ posted, currency: parsed ? parsed.currency : null, hasNote: !!shown,
          basisOk, declaredHours, declaredBasis, fromCache, fromText, fromRecord, basisSource: fromCache !== null ? 'cache' : (fromText !== null ? 'card-text' : 'neither'),
          // No backslashes on purpose: this is page-side code inside a template literal, where a \d escape
          // loses its backslash and arrives as a plain d (a SyntaxError at evaluate time).
          ownHours: (ownCard.match(/([0-9]{1,3})[ \t]*(?:hours?|hrs?)[ \t]*(?:[/]|per[ \t]+)?[ \t]*(?:week|wk)/i) || [])[0] || null,
          perUnit: parsed ? parsed.perUnit : false, monthly: parsed ? parsed.monthly : false,
          hours: basis.hours, hoursBasis: basis.basis, unit: parsed ? parsed.unit : null,
          note: shown ? shown.textContent : null, title: shown ? shown.title : null,
          warn: warn ? warn.textContent : null,
          goal: card.classList.contains('ojc-goal') ? (shown?.dataset.goal || 'unknown') : '',
          band: shown ? (shown.dataset.band || '') : '',
          goalBy: card.dataset.goalBy !== undefined ? Number(card.dataset.goalBy) : null,
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
  // The declaration itself: the hours a card used must be hours it could have known. This is the policy
  // check that a guessed input used to do by accident — now it is explicit, and the figure check below is
  // about arithmetic alone.
  const badBasis = r.rows.filter(x => x.declaredBasis && !x.basisOk);
  if (badBasis.length) {
    await fail(`${badBasis.length} card(s) declare hours that neither the scan cache nor the card's own words ` +
      `support: ` + badBasis.slice(0, 3).map(x => `${JSON.stringify(x.posted)} declares ${x.declaredHours}` +
      `h, cache says ${x.fromCache}, record says ${x.fromRecord}, card text says ${x.fromText}`).join(' | '));
  }
  const missingHours = r.rows.filter(x => x.hasNote && !x.declaredBasis && (x.fromCache !== null || x.fromText !== null || x.fromRecord !== null));
  if (missingHours.length) {
    await fail(`${missingHours.length} card(s) had hours available (cache ${missingHours[0].fromCache}, ` +
      `card text ${missingHours[0].fromText}) but their note declares none — the listing's own hours must ` +
      `reach the figure`);
  }

  // the exact text: recomputed from the DOM with the same parser and the same hours basis
  const wrongText = parseable.filter(x => x.expect && x.note !== x.expect);
  if (wrongText.length) {
    await fail(`${wrongText.length} card(s) show a figure the parser does not produce: ` +
      wrongText.slice(0, 3).map(x => `posted ${JSON.stringify(x.posted)} → shown ${JSON.stringify(x.note)}, ` +
        `parser says ${JSON.stringify(x.expect)} (hours ${x.hours ?? 'unstated'} via ${x.basisSource}` +
        `${x.ownHours ? `, the card's own text said ${JSON.stringify(x.ownHours)}` : ', no hours phrase in the card text'})`).join(' | '));
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
  // The premium bands: a band mark only where the margin really reaches that band, and every card
  // that reaches a band carries the mark — checked both directions, so a wrong band is a failure either way.
  const banded = parseable.filter(x => x.band);
  for (const x of banded) {
    const need = x.band === 'b50' ? 0.5 : 0.25;
    if (!(x.goalBy >= need)) {
      await fail(`a ${x.band} band on a card whose margin over its goal is ${x.goalBy} — the band needs ≥ ${need}: ${JSON.stringify(x.posted)}`);
    }
  }
  for (const x of parseable) {
    if (x.expectGoal && x.goalBy >= 0.25 && !x.band) {
      await fail(`a card that clears its goal by ${x.goalBy} carries no premium band: ${JSON.stringify(x.posted)}`);
    }
  }
  // the posted text keeps its place: the figure is added above it, never instead of it
  const swallowed = parseable.filter(x => !x.postedStillThere);
  if (swallowed.length) {
    await fail(`the posted salary text disappeared from ${swallowed.length} card(s) — the figure must sit above it, not replace it`);
  }
  console.log(`salary    : ${months.length} monthly figure(s), ${rates.length} posted-rate figure(s), ` +
    `${pieces.length} piece rate(s) left alone, ${silent.length} with no figure · ` +
    `${r.fxRequests} live rate request(s) for ${r.currencies.join('/') || 'no'} foreign currency · ` +
    `${monthlyMarks.length} above ₱${GOAL}/mo, ${hourlyMarks.length} above ₱${GOAL_HOURLY}/hr · ${banded.length} premium band mark(s)`);
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
  if (!/closed/i.test(r.chip)) await fail(`the chip does not count the closed listing: ${JSON.stringify(r.chip)}`);
  // This run deliberately taught the memory a closure for a listing that is NOT closed. Remove it now,
  // explicitly, as well as through the storage snapshot at the end: a kill between the two must not be
  // able to leave a live listing hidden from the user for six months.
  await storeEval(`chrome.storage.local.get('closedJobs').then(r => { const m = r.closedJobs || {}; delete m[${JSON.stringify(jobId)}]; return chrome.storage.local.set({ closedJobs: m }); })`);
  console.log(`closed    : ${jobId} learned from the page ("${banner.split('|')[0].trim()}") and hidden on the board ` +
    `(hidden=${r.hidden}, badge ${JSON.stringify(r.badge)}), chip: ${JSON.stringify(r.chip)}`);
}

// ── 12. the deep scan, the tiers and the views (spec.md W12–W14) ─────────
// The scan is the only feature here that spends requests on pages the user did not open, so its budget is
// ASSERTED rather than trusted: nothing is fetched before the button is pressed (counted from CDP, because
// the content script's fetch is invisible to a page-world patch), never more than two listings at once, and
// a second run of the same page costs nothing because everything it read was cached.
//
// The tiers are asserted the same way the rules are: the board writes its verdict on every card
// (`data-ojc-tier`), and `ruleEval` recomputes it from the DOM *and the remembered records* with the
// extension's own table. That is the check that catches the whole feature being wired backwards, and it
// cannot pass by agreeing with itself — the two sides read different sources.
{
  const SCAN = { ...settings, negative: ['crypto'], positive: ['assistant'], maxAgeDays: 3,
                 scanWorth: true, scanAll: false };
  await storeEval(`chrome.storage.local.set({ settings: ${JSON.stringify(SCAN)} }).then(()=>1)`, 500);
  const recordsBefore = await readRecords();
  /** The ids in the page's own IndexedDB store — same origin as the content script's cache. */
  const cacheKeys = (tab) => tab.evaluate(`new Promise(res => {
    const r = indexedDB.open('ojc', 1);
    r.onsuccess = () => { const q = r.result.transaction('details', 'readonly').objectStore('details').getAllKeys();
      q.onsuccess = () => res(JSON.stringify(q.result)); };
    r.onerror = () => res('[]'); })`);
  const cacheDrop = (tab, ids) => tab.evaluate(`new Promise(res => {
    const r = indexedDB.open('ojc', 1);
    r.onsuccess = () => { const t = r.result.transaction('details', 'readwrite'); const s = t.objectStore('details');
      for (const id of ${JSON.stringify(ids)}) s.delete(String(id));
      t.oncomplete = () => res(1); t.onerror = () => res(0); };
    r.onerror = () => res(0); })`);

  const FACT = `(() => {
    const cards = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
    const byTier = {};
    for (const c of cards) byTier[c.dataset.ojcTier || 'unset'] = (byTier[c.dataset.ojcTier || 'unset'] || 0) + 1;
    const btn = document.getElementById('ojc-scan');
    const view = (v) => { const b = document.querySelector('.ojc-view[data-view="' + v + '"]');
      return b ? { label: b.textContent.trim(), on: b.classList.contains('is-on') } : null; };
    return JSON.stringify({ cards: cards.length, byTier,
      visible: cards.filter(c => !c.hidden).length, hidden: cards.filter(c => c.hidden).length,
      tierBadges: document.querySelectorAll('.ojc-tier-badge').length,
      hoursBadges: document.querySelectorAll('.ojc-hours').length,
      hoursOver: document.querySelectorAll('.ojc-hours-over').length,
      scanBtn: btn ? { label: btn.textContent.trim(), disabled: btn.disabled } : null,
      views: { high: view('high'), worth: view('worth'), all: view('all') },
      note: (document.getElementById('ojc-note') || {}).textContent || null });
  })()`;
  const btnLabel = `(() => { const b = document.getElementById('ojc-scan'); return b ? b.textContent.trim() : null; })()`;

  const r = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    await tab.send('Network.enable');
    await tab.send('Page.enable');
    // Anything the extension throws while this section runs is captured verbatim: a click handler that
    // throws leaves the panel and the board exactly as they were, which looks identical to a click that was
    // never delivered — and that is not something to guess about twice.
    const errors = [];
    // When this section began. The scan stamps `checkedAt` on every listing it reads, and on a board whose
    // listings are already in the memory that stamp is the only observable proof the memory was WRITTEN.
    const runStart = Date.now();
    tab.on('Runtime.exceptionThrown', p => errors.push(
      String((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text).split('\n').slice(0, 2).join(' | ')));
    let inflight = 0, peak = 0;
    const live = new Map();          // requestId → url, so a breach can name the requests that overlapped
    const starts = [];               // when each listing fetch STARTED — the politeness bound that is measurable
    let peakSet = [];
    const urls = [];
    tab.on('Network.requestWillBeSent', p => {
      if (!/\/jobseekers\/job\//.test(p.request.url)) return;
      starts.push(p.timestamp);
      inflight++; urls.push(p.request.url);
      // `type` and `initiator` are what separate the extension's own fetch from the site's own prefetch of a
      // job page, which would otherwise look identical in this count.
      live.set(p.requestId, p.request.url + ' [' + p.type + ' ' + (p.initiator && p.initiator.type) + ']');
      if (inflight > peak) { peak = inflight; peakSet = [...live.values()]; }
    });
    const done = (p) => { if (p && live.has(p.requestId)) { live.delete(p.requestId); inflight = Math.max(0, inflight - 1); } };
    tab.on('Network.loadingFinished', done);
    tab.on('Network.loadingFailed', done);
    if (!await activate(tab)) await fail(`the scan check cannot run: ${HIDDEN_HINT}`);
    await settle(3500);

    const before = JSON.parse(await tab.evaluate(FACT));
    const idle = urls.length;                       // nothing may have been fetched yet
    const cache = await cacheKeys(tab);

    // (a) press Scan, and let it finish
    await tab.evaluate(`document.getElementById('ojc-scan').click()`);
    const labels = [];
    let sawStop = false;
    for (let i = 0; i < 240; i++) {
      await settle(1500);
      const l = await tab.evaluate(btnLabel);
      labels.push(l);
      if (l && l !== 'Scan') sawStop = true;
      if (l === 'Scan') break;
    }
    await settle(1500);
    const afterFirst = JSON.parse(await tab.evaluate(FACT));
    const firstRun = urls.length;
    // The records that exist right now: any listing the first run managed to READ has one, so a second run
    // fetching that id again is a cache miss. This is the assertion below, and it holds whether or not the
    // first run finished — the site's own 429 does not get to make the check inapplicable.
    const readAfterFirst = await readRecords();

    // (b) a second run must not re-read what the first one read: every listing it has a record for is cached,
    // and a listing it could NOT read (429, HTTP error, no description) has no record, so retrying exactly
    // those is correct rather than a regression.
    if (afterFirst.scanBtn && !afterFirst.scanBtn.disabled) {
      await tab.evaluate(`document.getElementById('ojc-scan').click()`);
      for (let i = 0; i < 240; i++) {
        await settle(1000);
        if (await tab.evaluate(btnLabel) === 'Scan') break;
      }
      await settle(1000);
    }
    const secondRun = urls.length;
    const idsOf = (list) => list.map(u => (u.match(/-?([0-9]+)\/?$/) || [])[1]).filter(Boolean);
    const firstIds = idsOf(urls.slice(0, firstRun));
    const secondIds = idsOf(urls.slice(firstRun));
    const refetched = secondIds.filter(id => readAfterFirst[id]);
    const scannedOnce = firstIds.filter(id => readAfterFirst[id]);

    // (c) the views filter the board to one tier, and All puts it back.
    //
    // The view is live page state and this harness drives the user's own browser, so the check must not
    // assume where it starts. It did, and it flapped: a run that found the board already on "High yield"
    // (a stray click in the real window) failed here — clicking the view that is already active correctly
    // toggles it OFF, so the board looked unchanged, and every `setView` call in the page trace came from
    // the click handler. Establishing the precondition is not papering over the flap: the normalisation is
    // asserted as `views.all` below, so a board that cannot be put back on "All" still fails.
    // Deliberately leave the board on a tier first: that is the state a stray click in the real window left
    // it in when this check flapped, so the regression is exercised on every run, not just on the unlucky one.
    await tab.evaluate(`document.querySelector('.ojc-view[data-view="high"]').click()`);
    await settle(500);
    await tab.evaluate(`document.querySelector('.ojc-view[data-view="all"]').click()`);
    await settle(500);
    const views = {};
    // Read the live setting rather than reaching for one of the section-scoped copies: it is the value the
    // DOM's hidden state was actually produced under, and hidden tiers are only visible when it is on.
    const showHidden = (await readSettings()).showHidden;
    views.all = JSON.parse(await tab.evaluate(`(() => {
      const HIDDEN_TIERS = ['closed', 'stale', 'nosal', 'kw'];
      const cards = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
      // 'shouldShow' is what the RULES leave on the board, and it is the baseline the "All must not lose
      // cards" assertion uses. It is derived from the tiers rather than from a snapshot taken earlier in the
      // run, because this harness drives the user's own browser: whichever view it happened to be left on is
      // not the board's true size, and a check that treats it as one fails on a correct board (measured).
      return JSON.stringify({ visible: cards.filter(c => !c.hidden).length,
        shouldShow: ${showHidden} ? cards.length : cards.filter(c => !HIDDEN_TIERS.includes(c.dataset.ojcTier)).length,
        on: document.querySelector('.ojc-view[data-view="all"]').classList.contains('is-on') }); })()`));
    for (const v of ['high', 'worth']) {
      await tab.evaluate(`document.querySelector('.ojc-view[data-view="${v}"]').click()`);
      await settle(500);
      views[v] = JSON.parse(await tab.evaluate(`(() => {
        const cards = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
        const vis = cards.filter(c => !c.hidden);
        const b = document.querySelector('.ojc-view[data-view="${v}"]');
        return JSON.stringify({ visible: vis.length, wrong: vis.filter(c => c.dataset.ojcTier !== '${v}').length,
          button: b.textContent.trim(), on: b.classList.contains('is-on'),
          // Self-diagnosing: if a view ever fails to take, these say whether the panel was rebuilt, doubled,
          // or is showing a different tier than the one that was clicked.
          chips: document.querySelectorAll('#ojc-chip').length,
          allViews: [...document.querySelectorAll('.ojc-view')].map(x => (x.dataset.view || '?') + (x.classList.contains('is-on') ? '*' : '')).join(' '),
          note: (document.getElementById('ojc-note') || {}).textContent || null }); })()`));
      // …and clicking the view that is already on must put the whole board back. This is the gesture that
      // flapped (above), and it is also what a user does after looking at one tier.
      await tab.evaluate(`document.querySelector('.ojc-view[data-view="${v}"]').click()`);
      await settle(500);
      views[v].off = JSON.parse(await tab.evaluate(`(() => {
        const cards = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
        return JSON.stringify({ visible: cards.filter(c => !c.hidden).length,
          on: document.querySelector('.ojc-view[data-view="${v}"]').classList.contains('is-on'),
          allOn: document.querySelector('.ojc-view[data-view="all"]').classList.contains('is-on') }); })()`));
    }
    await tab.evaluate(`document.querySelector('.ojc-view[data-view="all"]').click()`);
    await settle(500);
    views.allEnd = JSON.parse(await tab.evaluate(`(() => {
      const cards = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
      return JSON.stringify({ visible: cards.filter(c => !c.hidden).length,
        on: document.querySelector('.ojc-view[data-view="all"]').classList.contains('is-on') }); })()`));

    return JSON.stringify({ before, afterFirst, idle, firstRun, secondRun, peak, peakSet, sawStop, refetched,
      scannedOnce, runStart, labels: labels.filter(Boolean).slice(0, 8), cache, views, starts, errors });
  }, 500));

  if (!r.before.scanBtn) await fail('no Scan button in the panel — the deep scan is not wired in');
  if (r.before.scanBtn.disabled) {
    await fail(`the Scan button is disabled although this run seeded a keyword and a goal — ` +
      `the panel says there is nothing to scan for`);
  }
  if (r.idle !== 0) await fail(`${r.idle} listing page(s) fetched before the Scan button was pressed — nothing may run unprompted`);
  if (!r.sawStop) await fail('pressing Scan never showed the running state ("Stop …") — the button did not start a scan');
  if (!r.firstRun) await fail(`the scan fetched no listing at all — this page has nothing to scan, or the queue is empty`);
  // The politeness budget, measured the only way it can be measured from outside: how often a listing fetch
  // STARTS. In-flight counting is what this check used to do, and it read 3 on a perfectly obedient scan —
  // CDP reports `loadingFinished` after our `await res.text()` has already resolved, so the tail of one wave
  // overlaps the head of the next in that count. The property the user asked for ("two at a time") is a rate:
  // two per wave, waves ≥400 ms apart, so no three fetches may start inside a 350 ms window. A runaway — the
  // failure this replaced ("never paginate") was meant to prevent — trips it immediately.
  const starts = r.starts || [];
  for (let i = 0; i < starts.length; i++) {
    const inWindow = starts.filter(t => t >= starts[i] && t - starts[i] < 0.35).length;
    if (inWindow > 2) {
      await fail(`the scan started ${inWindow} listing fetches within 350 ms (at ${starts[i].toFixed(2)}s) — ` +
        `the budget is 2 at a time with ≥400 ms between pairs. In-flight peak was ${r.peak}: ` +
        r.peakSet.map(u => u.replace(/^https:\/\/www\.onlinejobs\.ph/, '')).join(' | '));
    }
  }
  // The cache: a re-run must never re-read a listing the first run already READ. Counting fetches instead
  // was wrong twice over — an unreadable listing (an HTTP error, or the site's own 429 half-way through)
  // has no record and SHOULD be retried, and a run the site cut short legitimately continues next time.
  // Asking "did it fetch anything it already has a verdict for?" is exact, and it applies to every run.
  if (r.refetched.length) {
    await fail(`the second scan re-fetched ${r.refetched.length} listing(s) it already had a verdict for ` +
      `(${r.refetched.slice(0, 3).join(', ')}) — everything a scan reads is cached for 7 days`);
  }
  if (!r.scannedOnce.length) {
    await fail(`the first scan fetched ${r.firstRun} listing(s) and remembered none of them — nothing was cached, ` +
      `so the second run had to read them all again`);
  }
  // The tiers after the scan, recomputed with the extension's own table AND the remembered records.
  const parity = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    if (!await activate(tab)) await fail(`the tier parity check cannot run: ${HIDDEN_HINT}`);
    await settle(3500);
    await primeCache(tab);   // the scan's own cache, re-read after it wrote
    const closedIds = await readClosedIds();
    const records = await readRecords();
    const dom = `(() => { const t = { closed: 0, stale: 0, nosal: 0, high: 0, pos: 0, worth: 0, kw: 0, none: 0, unset: 0 };
      for (const c of document.querySelectorAll('.jobpost-cat-box.latest-job-post')) t[c.dataset.ojcTier || 'unset']++;
      return JSON.stringify(t); })()`;
    let counts, tiers, domTiers;
    for (let i = 0; i < 24; i++) {
      counts = JSON.parse(await ruleEval(tab, { neg: SCAN.negative, pos: SCAN.positive, maxAgeDays: SCAN.maxAgeDays,
        closedIds, records }));
      domTiers = JSON.parse(await tab.evaluate(dom));
      tiers = counts.tiers;
      if (['closed', 'stale', 'nosal', 'high', 'pos', 'worth', 'kw', 'none'].every(t => domTiers[t] === tiers[t])) break;
      await settle(250);
    }
    return JSON.stringify({ tiers, domTiers, counts, scanned: counts.scannedCards, overHours: counts.overHours });
  }, 500));
  for (const t of ['closed', 'stale', 'nosal', 'high', 'pos', 'worth', 'kw', 'none']) {
    if (parity.domTiers[t] !== parity.tiers[t]) {
      await fail(`after the scan, ${parity.domTiers[t]} card(s) are "${t}" but the rule says ${parity.tiers[t]} ` +
        `(page ${JSON.stringify(parity.domTiers)} vs rule ${JSON.stringify(parity.tiers)}) — the remembered ` +
        `description facts and the board disagree, which is what the record's settings signature exists to prevent`);
    }
  }
  if (parity.domTiers.unset) await fail(`${parity.domTiers.unset} card(s) have no verdict after the scan`);
  if (!parity.scanned) {
    await fail('no card on the page was recognised as deep-scanned — the records are not reaching the rule pass');
  }

  // What the scan remembered, and in what shape. "Remembered" is about what it READ, not what it CREATED: on
  // a board whose listings the memory already knows — the permanent state for a search you have scanned before
  // — there is nothing new to create, and an assertion that demands a new record fails on a memory that is
  // working perfectly (measured: 222 stored, 222 before, 19 fetched, 0 new). What proves the scan WROTE is the
  // `checkedAt` stamp `absorb` puts on every listing it reads, freshly, whether or not the record existed.
  const records = await readRecords();
  const readIds = r.scannedOnce;                      // ids the scan fetched that have a verdict
  const restamped = readIds.filter(id => Number((records[id] || {}).checkedAt || 0) >= r.runStart);
  const newIds = Object.keys(records).filter(id => !(id in recordsBefore));
  if (!restamped.length) {
    await fail(`the scan read ${readIds.length} listing(s) but stamped none of them as checked just now — ` +
      `the job memory is not being written (stored ${Object.keys(records).length}, ${newIds.length} of them new)`);
  }
  const badShape = restamped.filter(id => {
    const rec = records[id];
    return !rec || typeof rec.tier !== 'string' || typeof rec.sk !== 'number' ||
      !rec.detail || !Array.isArray(rec.detail.pos) || !Array.isArray(rec.detail.neg) ||
      !Array.isArray(rec.detail.flags) || typeof rec.at !== 'number';
  });
  if (badShape.length) await fail(`${badShape.length} scan record(s) are incomplete: ${JSON.stringify(records[badShape[0]])}`);
  if (!parity.overHours) {
    console.log('scan      : no listing on this page states a week longer than 40 h — the over-40 flag is ' +
      'proved by test-tiers.js (unit) and by the live run that found a 45 h/week listing');
  }

  // The views: exactly one tier on screen, and the count on the button is that tier's size.
  for (const v of ['high', 'worth']) {
    if (!r.views[v].on) await fail(`clicking the ${v} view did not mark it active (views: ${JSON.stringify(r.views)}; ` +
      `chips ${r.views[v].chips}, buttons "${r.views[v].allViews}", note ${JSON.stringify(r.views[v].note)}` +
      `${r.errors.length ? `; page errors: ${r.errors.slice(0, 2).join(' // ')}` : ''})`);
    if (r.views[v].wrong) {
      await fail(`${r.views[v].wrong} card(s) in the ${v} view are not "${v}" — the view must show one tier only`);
    }
    const n = +((r.views[v].button.match(/(\d+)\s*$/) || [])[1] ?? NaN);
    if (r.views[v].visible !== n) {
      await fail(`the ${v} view shows ${r.views[v].visible} card(s) but its button says ${n}`);
    }
    // Clicking the view that is on puts the whole board back, marked "All" — the other half of the toggle.
    if (r.views[v].off.on || !r.views[v].off.allOn) {
      await fail(`clicking the active ${v} view again did not return to All ` +
        `(off: ${JSON.stringify(r.views[v].off)}) — the view is a toggle, and a second click must undo it`);
    }
    if (r.views[v].off.visible !== r.views.all.visible) {
      await fail(`after clicking the active ${v} view off, ${r.views[v].off.visible} card(s) show but the board ` +
        `has ${r.views.all.visible} — leaving a tier view must lose nothing`);
    }
  }
  if (!r.views.all.on) await fail('the board is not on All before the views are exercised — the check cannot start');
  if (r.views.all.visible !== r.views.all.shouldShow) {
    await fail(`the All view shows ${r.views.all.visible} card(s) but the rules leave ${r.views.all.shouldShow} on ` +
      `the board — All is the unfiltered board, so it must lose nothing`);
  }
  if (!r.views.allEnd.on || r.views.allEnd.visible !== r.views.all.visible) {
    await fail(`the board did not come back to All at the end (${JSON.stringify(r.views.allEnd)} vs ` +
      `${JSON.stringify(r.views.all)}) — All must always be reachable`);
  }

  // ── the change mark: a listing whose tier moved says so, until you open it ──
  const seeded = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    if (!await activate(tab)) await fail(`the change-mark check cannot run: ${HIDDEN_HINT}`);
    await settle(3500);
    // closed.js is injected for its job-id reader: \\d inside a template literal LOSES its backslash (an
    // unknown escape drops it), so a hand-written id regex here arrives as /-?(d+)/ and the page throws a
    // SyntaxError — the same trap as a backtick in page-side code, one escape over.
    return tab.evaluate(`${CLOSED_SRC}
(() => {
      const c = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')]
        .find(x => x.dataset.ojcTier && x.dataset.ojcTier !== 'kw' && x.querySelector('a[href*="/jobseekers/job/"]'));
      if (!c) return JSON.stringify({ ok: false });
      const a = c.querySelector('a[href*="/jobseekers/job/"]');
      return JSON.stringify({ ok: true, href: a.href, id: OJClosed.jobIdFrom(a.getAttribute('href')),
        tier: c.dataset.ojcTier, title: (c.querySelector('h4, h3, a') || {}).textContent || '' });
    })()`);
  }, 500));
  if (!seeded.ok) await fail('no card on this page can carry a change mark — cannot test the mark');
  // A record claiming a tier the card cannot have (`kw`, with no hide keyword configured) forces a move on
  // the next pass. That is the only way to test the mark without waiting for a live listing to change.
  await storeEval(`chrome.storage.local.get(['jobRecords', 'settings']).then(r => {
    const m = r.jobRecords || {};
    m[${JSON.stringify(seeded.id)}] = { tier: 'kw', prev: null, seen: true, changedAt: null,
      at: Date.now(), checkedAt: Date.now(), card: null, detail: null, fields: null,
      sk: ${JSON.stringify(0)} };
    return chrome.storage.local.set({ jobRecords: m });
  })`);
  const marked = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    if (!await activate(tab)) await fail(`the change-mark check cannot run: ${HIDDEN_HINT}`);
    await settle(3500);
    return tab.evaluate(`(() => {
      const c = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')]
        .find(x => (x.querySelector('a[href*="/jobseekers/job/"]') || {}).href === ${JSON.stringify(seeded.href)});
      if (!c) return JSON.stringify({ found: false });
      const b = c.querySelector('.ojc-tier-badge');
      return JSON.stringify({ found: true, badge: b ? b.textContent.trim() : null, tier: c.dataset.ojcTier });
    })()`);
  }, 500));
  if (!marked.found) await fail(`the card we seeded a stale verdict for is no longer on the board (${seeded.href})`);
  if (!marked.badge) {
    await fail(`a listing whose remembered tier (kw) differs from its real one (${marked.tier}) carries no change ` +
      `mark — the ↑/↓ badge is what tells the user a listing was re-decided`);
  }
  // Opening the listing clears it: you are looking at it, so there is nothing left to tell you.
  const cleared = JSON.parse(await withTab(PORT, seeded.href, async (tab) => {
    await settle(3000);
    return tab.evaluate(`(() => JSON.stringify({ url: location.pathname, bar: !!document.getElementById('ojc-detail-bar') }))()`);
  }, 500));
  const recAfter = (await readRecords())[String(seeded.id)];
  if (!cleared.bar) await fail(`the listing page ${cleared.url} rendered no detail bar — the re-check cannot have run`);
  if (recAfter && recAfter.seen !== true) {
    await fail(`opening listing ${seeded.id} did not clear its change mark (record seen=${recAfter.seen}, ` +
      `prev=${recAfter.prev}, tier=${recAfter.tier})`);
  }
  if (!recAfter) await fail(`opening listing ${seeded.id} deleted its record instead of updating it`);

  // Leave the profile as it was: the cache entries this section created, and the harness's settings.
  await withTab(PORT, URL_, async (tab) => {
    let now;
    try { now = JSON.parse(await cacheKeys(tab)); }
    catch (e) {
      // A tab Chrome will not give IndexedDB access (an interstitial after a few hundred requests, say) is not
      // a reason to crash the run: the entries are a cache with a 7-day TTL, and the snapshot still restores
      // everything the user can see.
      console.log(`cache     : could not read the page cache to clean up (${e.message}) — the TTL will evict it`);
      return 1;
    }
    const mine = now.filter(id => !JSON.parse(r.cache).includes(id));
    if (mine.length) await cacheDrop(tab, mine);
    return 1;
  }, 300);
  await storeEval(`chrome.storage.local.get('jobRecords').then(r => {
    const m = r.jobRecords || {};
    delete m[${JSON.stringify(seeded.id)}];
    return chrome.storage.local.set({ jobRecords: m });
  })`);
  await storeEval(`chrome.storage.local.set({ settings: ${JSON.stringify(settings)} }).then(()=>1)`, 400);

  console.log(`scan      : ${r.firstRun} listing(s) fetched, peak ${r.peak} in flight · ` +
    `2nd run +${r.secondRun - r.firstRun} (${r.refetched.length} of them re-reads) · ` +
    `${restamped.length}/${readIds.length} read stamped (${newIds.length} new) · ${parity.domTiers.high} high / ${parity.domTiers.pos} highlighted / ` +
    `${parity.domTiers.worth} worth / ${parity.counts.flagTagExpected} off-platform tag(s) · ${r.afterFirst.note || ''}`);
  console.log(`views     : high ${r.views.high.visible}/${r.views.high.button.match(/\d+$/)} · ` +
    `worth ${r.views.worth.visible}/${r.views.worth.button.match(/\d+$/)} · all ${r.views.all.visible} ` +
    `(−${r.afterFirst.visible - r.views.all.visible} hidden) · toggle-off restores ` +
    `${r.views.high.off.visible}/${r.views.worth.off.visible} · none in the wrong tier`);
  console.log(`memory    : ${seeded.id} seeded as "kw" → marked "${marked.badge}" (real tier ${marked.tier}), ` +
    `then cleared by opening the listing (seen=${recAfter.seen})`);
  if (parity.overHours) console.log(`hours     : ${parity.overHours} listing(s) state a week longer than 40 h — flagged on the card`);
  if (newIds.length) console.log(`cache     : ${newIds.length} new description(s) cached, then dropped again (the run leaves no trace)`);
}

// ── 13. the new doors (F1–F3): the export, the tier mark, the keyword lists ──
{
  // F1: the chip's Export button is enabled exactly when the memory has something to export, and a
  // real click must put a CSV on disk — the header plus one row per record, the URLs filled from the
  // page's own cache. The file is the ground truth: the page world is denied the IndexedDB cache
  // (CSP), so rebuilding the CSV in a tab would test a copy, not the export.
  const recs = await readRecords();
  const n = Object.keys(recs).length;
  const DL_DIRS = [path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'AppData', 'Local', 'agent-chrome-profile', 'Downloads')];
  const dlBefore = new Set(DL_DIRS.flatMap(d => { try { return fs.readdirSync(d); } catch { return []; } }));
  const expBtn = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    if (!await activate(tab)) await fail(`the export check cannot run: ${HIDDEN_HINT}`);
    if (!await waitCards(tab)) await fail('no cards rendered on the board page (the site throttles after the scan)');
    // The chip builds after the cards, on its own clock — wait for the button itself.
    // The action buttons are identified by id (mk sets b.id), not class.
    if (!await waitFor(tab, `!!document.querySelector('#ojc-export')`, { timeout: 15000 }))
      await fail('the chip rendered no Export button');
    const btn = JSON.parse(await tab.evaluate(`(() => {
      const b = document.querySelector('#ojc-export');
      return JSON.stringify({ btn: !!b, disabled: b ? b.disabled : null });
    })()`));
    if (btn.btn && n > 0) await realClick(tab, '#ojc-export');
    return JSON.stringify(btn);
  }, 400));
  if (!expBtn.btn) await fail('the chip has no Export button');
  if ((n > 0) !== !expBtn.disabled) {
    await fail(`the Export button is ${expBtn.disabled ? 'disabled' : 'enabled'} while the memory holds ${n} record(s) ` +
      '— it should be enabled exactly when the memory is not empty');
  }
  if (n > 0) {
    let file = null;
    for (let i = 0; i < 24 && !file; i++) {
      await settle(500);
      for (const d of DL_DIRS) {
        let names = []; try { names = fs.readdirSync(d); } catch { continue; }
        for (const f of names) if (f.startsWith('ojph-scan-') && f.endsWith('.csv') && !dlBefore.has(f)) { file = d + '/' + f; break; }
        if (file) break;
      }
    }
    if (!file) await fail('clicking Export started no CSV download');
    const text = fs.readFileSync(file, 'utf8');
    try { fs.unlinkSync(file); } catch { /* a leftover CSV is a small price for a live check */ }
    const lines = text.replace(/^\uFEFF/, '').trimEnd().split('\n');
    if (lines[0] !== 'id,url,tier,prev,changed,checked,hours,type,wage,flags,pos,neg')
      await fail(`the export's header row is not the schema: ${lines[0]}`);
    if (lines.length !== n + 1) await fail(`the CSV has ${lines.length - 1} row(s) for ${n} record(s) — every record is a row`);
    const ids = new Set(lines.slice(1).map(l => l.split(',')[0]));
    const missing = Object.keys(recs).filter(id => !ids.has(id));
    if (missing.length) await fail(`the CSV is missing record(s): ${missing.slice(0, 5).join(', ')}`);
    const withUrl = lines.slice(1).filter(l => l.split(',')[1] !== '').length;
    console.log(`export    : ${n} record(s) → a downloaded CSV of ${n} row(s), ${withUrl} URL(s) filled from the cache`);
  } else {
    console.log('export    : the memory is empty on this run — button present and correctly disabled');
  }

  // F2: on the saved-jobs table, every row whose listing a scan has judged carries the tier mark — and
  // no row without a judged tier does. The records are read from storage and handed in, so the check
  // runs entirely in the page world, like the rest of the harness.
  const MARK = { high: '★ high yield', worth: 'worth considering', pos: '✓ highlighted' };
  const saved = JSON.parse(await withTab(PORT, 'https://www.onlinejobs.ph/jobseekers/bookmarked_jobs', async (tab) => {
    if (!await activate(tab)) await fail(`the tier-mark check cannot run: ${HIDDEN_HINT}`);
    // The table renders in batches; an empty bookmarks list has no rows at all, so a timeout here is
    // not a failure — it just means there is nothing to check.
    await waitFor(tab, `!!document.querySelector('a[href*="/jobseekers/job/"]')`, { timeout: 20000 });
    await settle(1500);   // the records store loads on its own clock, then the rows get marked
    return tab.evaluate(`(() => {
      const recs = ${JSON.stringify(recs)};
      const MARK = ${JSON.stringify(MARK)};
      const rows = [...document.querySelectorAll('tr')].filter(r => r.querySelector('a[href*="/jobseekers/job/"]'));
      const out = rows.map(r => {
        const a = r.querySelector('a[href*="/jobseekers/job/"]');
        const m = r.querySelector('.ojc-row-tier');
        return { href: a ? a.getAttribute('href') : '', marked: !!m, label: m ? m.textContent.trim() : '',
                 expect: (() => { const idm = (a && a.href.match(/[0-9]+\\/?$/) || [])[0];
                   const t = idm && recs[idm] ? recs[idm].tier : null; return t && MARK[t] || null; })() };
      });
      return JSON.stringify(out);
    })()`);
  }, 500));
  for (const row of saved) {
    if (row.expect && !row.marked) await fail(`saved row ${row.href} (tier ${row.expect}) carries no tier mark`);
    if (row.expect && row.marked && row.label !== row.expect)
      await fail(`saved row ${row.href} is marked "${row.label}", its tier says "${row.expect}"`);
    if (!row.expect && row.marked)
      await fail(`saved row ${row.href} carries a tier mark it has no right to: "${row.label}"`);
  }
  console.log(`tiers     : ${saved.length} saved row(s) checked against the scan's verdicts — marks match`);

  // F3: the keyword-list doors sit in the panel next to the lists they move. The format itself is unit-
  // tested (test-rules.js); here we only prove the buttons exist where the user will find them.
  const kw = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    if (!await activate(tab)) await fail(`the keyword-list check cannot run: ${HIDDEN_HINT}`);
    if (!await waitCards(tab)) await fail('no cards rendered on the board page (the site throttles after the scan)');
    if (!await waitFor(tab, `!!document.querySelector('#ojc-gear')`, { timeout: 10000 }))
      await fail('the chip never rendered on the board page');
    await realClick(tab, '#ojc-gear');
    await settle(300);
    const got = JSON.parse(await tab.evaluate(`(() => {
      const p = document.getElementById('ojc-panel');
      return JSON.stringify({ open: !!p && !p.hidden,
        copy: !!p?.querySelector('#ojc-kw-copy'), paste: !!p?.querySelector('#ojc-kw-paste') });
    })()`));
    await realClick(tab, '#ojc-gear');   // the panel back the way we found it
    return JSON.stringify(got);
  }, 400));
  if (!kw.open || !kw.copy || !kw.paste)
    await fail(`the panel is missing the keyword-list copy/paste buttons (open=${kw.open}, copy=${kw.copy}, paste=${kw.paste})`);
  console.log('keywords  : the panel carries both copy and paste doors');
}

console.log('verify-live: PASS');
await restoreStorage();
await STORE?.close();
await settle(250);
process.exit(0);
