// tools/verify-live.mjs — reload the unpacked extension in the automation Chrome
// and assert it actually works on the live site. This is the real end-to-end check:
// unit tests cannot see a missing manifest permission or a drifted selector.
//
//   node tools/verify-live.mjs
//   node tools/verify-live.mjs --url="https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=bookkeeper"
//   node tools/verify-live.mjs --neg=crypto,insurance --pos=bookkeeper
//
// Env: OJC_CDP_PORT (default 9333), OJC_EXT_NAME (default "OJ.ph Cleaner").
import { connect, withTab } from './cdp.mjs';
import fs from 'fs';

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

// salary.js's pure factory, injected into the page so the harness can recompute every figure from
// the DOM with the SAME code the extension used — a parity check, not a second opinion.
const salarySrc = fs.readFileSync(new URL('../salary.js', import.meta.url), 'utf8');

const fail = async msg => { console.error('verify-live: FAIL — ' + msg); await new Promise(r => setTimeout(r, 250)); process.exit(1); };
const settle = ms => new Promise(r => setTimeout(r, ms));

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

// Reload so edits on disk take effect. (runtimeErrors are historical and persist
// across reloads, so the pass/fail decision below is based on behaviour.)
await withTab(PORT, 'chrome://extensions', tab => tab.evaluate(
  `chrome.developerPrivate.reload(${JSON.stringify(EXT_ID)}, { failQuietly: true }).then(()=>1)`));
await settle(2500);
console.log(`extension : ${EXT_NAME} v${EXT_VERSION} ${state} (${EXT_PATH})`);

// ── 2. optional: seed keyword settings through the options page ──────────
// Always seed, even with no flags: settings persist in chrome.storage, so an
// unseeded run would be judged against whatever a previous run left behind.
const settings = { negative: neg, positive: pos, noSalary: true, showHidden: false, autoScan: false, goalSalary: GOAL, goalHourly: GOAL_HOURLY };
await withTab(PORT, `chrome-extension://${EXT_ID}/options.html`, tab =>
  tab.evaluate(`chrome.storage.local.set({ settings: ${JSON.stringify(settings)} }).then(()=>1)`), 1200);
// Drop the FX cache so the live ECB path is exercised on every run (otherwise a 24h-old rate from a
// previous run would silently satisfy it).
await withTab(PORT, `chrome-extension://${EXT_ID}/options.html`, tab =>
  tab.evaluate(`chrome.storage.local.remove('fx').then(()=>1)`), 800);
/** The durable settings, read through an extension context (page scripts cannot see chrome.storage). */
const storedSettings = async () => JSON.parse(await withTab(PORT, `chrome-extension://${EXT_ID}/options.html`,
  tab => tab.evaluate(`chrome.storage.local.get('settings').then(r => JSON.stringify(r.settings || {}))`), 350));
// A tab that boots before a write lands sees the old value — so wait for the seed to be durable rather
// than assuming the write beat the next tab. (It did not, once, and reported a phantom failure.)
for (let i = 0; i < 20; i++) {
  const now = await storedSettings();
  if (now.goalSalary === GOAL && now.goalHourly === GOAL_HOURLY && now.autoLoad === true) break;
  await settle(200);
}
console.log(`settings  : ${JSON.stringify(settings)}`);


/**
 * Count what the rule pass will do, with the rule's own order (noSalary → negative → positive).
 * `negAny` is the count when noSalary is OFF: a no-salary card that also matches a keyword re-files into
 * the keyword bucket, so it must be counted there (docs/HANDOFF.md §2.3). One implementation, used by
 * every section that needs a count — two copies of this logic disagreed and reported phantom failures.
 */
const ruleCounts = (tab, negative, positive) => tab.evaluate(`(() => {
  const neg = ${JSON.stringify(negative.map(k => k.toLowerCase()))};
  const cards = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
  const ownText = (c) => {
    const d = c.querySelector('dd.col');
    if (!d) return '';
    const own = d.cloneNode(true);
    for (const injected of own.querySelectorAll('[class^="ojc-"]')) injected.remove();
    return own.textContent;
  };
  let noSal = 0, kw = 0, pos = 0, negAny = 0;
  for (const c of cards) {
    const text = (c.textContent || '').toLowerCase();
    const ns = !/\\d/.test(ownText(c));
    const nm = neg.filter(k => text.includes(k)).length > 0;
    const pm = ${JSON.stringify(positive.map(k => k.toLowerCase()))}.some(k => text.includes(k));
    if (nm) negAny++;
    if (ns) noSal++;
    else if (nm) kw++;
    else if (pm) pos++;
  }
  return JSON.stringify({ cards: cards.length, noSal, kw, pos, negAny, on: noSal + kw, off: negAny });
})()`);

// ── 3. live page ─────────────────────────────────────────────────────────
const res = JSON.parse(await withTab(PORT, URL_, async (tab) => {
  await settle(3500);
  return tab.evaluate(`(() => {
    const neg = ${JSON.stringify(neg.map(k => k.toLowerCase()))};
    const pos = ${JSON.stringify(pos.map(k => k.toLowerCase()))};
    const cards = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
    const text = c => (c.textContent || '').toLowerCase();
    const hasSalary = c => { const d = c.querySelector('dd.col'); if (!d) return false;
      const own = d.cloneNode(true);
      for (const injected of own.querySelectorAll('[class^="ojc-"]')) injected.remove();
      return /\\d/.test(own.textContent); };
    // the same rule order content.js uses, recomputed from the DOM
    const expectHide = c => { const ns = !hasSalary(c); const nm = neg.some(k => text(c).includes(k));
      return { ns, nm, pm: pos.some(k => text(c).includes(k)) }; };
    let noSalExpected = 0, negExpected = 0, posExpected = 0, negAnyExpected = 0;
    for (const c of cards) {
      const e = expectHide(c);
      if (neg.some(k => text(c).includes(k))) negAnyExpected++; // the only hide rule left when noSalary is off
      if (e.ns) noSalExpected++;
      else if (e.nm) negExpected++;
      else if (e.pm) posExpected++;
    }
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
      highlights: document.querySelectorAll('.ojc-pos-badge').length,
      noSalExpected, negExpected, posExpected, negAnyExpected
    });
  })()`);
}, 500));

console.log('live page :', res.url);
console.log(`  cards   : ${res.cards}${res.claimed ? ` (site claims ${res.claimed})` : ''} (${res.salaries} with a salary field)`);
console.log(`  chip    : ${res.chip ? res.chipText : 'MISSING — content script did not run'}`);
console.log(`  hidden  : ${res.hidden}   (expected by rule: ${res.noSalExpected + res.negExpected})`);
console.log(`  no-salary ${res.noSalExpected} → hidden, keyword ${res.negExpected} → hidden, positive ${res.posExpected} → highlighted`);

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
if (res.hidden !== res.noSalExpected + res.negExpected) {
  await fail(`hidden ${res.hidden}, rule says ${res.noSalExpected + res.negExpected} (no-salary ${res.noSalExpected} + keyword ${res.negExpected})`);
}
if (res.hidden !== res.invisible) {
  await fail(`${res.hidden} cards carry [hidden] but only ${res.invisible} are actually display:none — the site CSS is winning`);
}
if (res.negatives !== res.negExpected) await fail(`keyword hides ${res.negatives}, expected ${res.negExpected}`);
if (res.highlights !== res.posExpected) await fail(`highlights ${res.highlights}, expected ${res.posExpected}`);

// ── 4. chip "Show all" must reveal, and re-hide, everything it hid ───────
const expected = res.noSalExpected + res.negExpected;
if (expected > 0) {
  const toggled = async (expectHidden) => withTab(PORT, URL_, async (tab) => {
    await settle(3000);
    await tab.evaluate(`document.querySelector('#ojc-toggle').click()`);
    // wait for the listing to actually change, instead of assuming 400 ms is enough
    await waitFor(tab, `[...document.querySelectorAll('.jobpost-cat-box.latest-job-post[hidden]')].length === ${'${expectHidden}'}`,
      { timeout: 5000 });
    return tab.evaluate(`JSON.stringify({
      hidden: document.querySelectorAll('.jobpost-cat-box.latest-job-post[hidden]').length,
      label: document.querySelector('#ojc-chip b').textContent,
      btn: document.querySelector('#ojc-chip button').textContent
    })`);
  }, 500);
  const shown = JSON.parse(await toggled(0));
  if (shown.hidden !== 0) await fail(`after "Show all", ${shown.hidden} cards are still hidden`);
  if (!/would be hidden/.test(shown.label)) await fail(`chip label did not switch to the preview wording: "${shown.label}"`);
  const hiddenAgain = JSON.parse(await toggled(expected));
  if (hiddenAgain.hidden !== expected) await fail(`after re-hiding, ${hiddenAgain.hidden} hidden vs ${expected}`);
  console.log(`toggle    : Show all revealed ${expected}, re-hide restored ${hiddenAgain.hidden}`);
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
      const fields=['#ojc-neg','#ojc-pos','#ojc-noSalary','#ojc-showHidden','#ojc-autoScan','#ojc-save'];
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
      await new Promise(r => setTimeout(r, 1500));
      const hidden = probe.hidden;
      mo.disconnect();
      probe.remove();
      return JSON.stringify({ card: true, chip: !!chip, hidden, passes, windowMs: 1500 });
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

    const snapshot = `(() => {
      const neg = ${JSON.stringify(neg.map(k => k.toLowerCase()))};
      const cards = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
      let expect = 0;
      for (const c of cards) {
        const d = c.querySelector('dd.col');
        const own = d ? d.cloneNode(true) : null;
        for (const injected of (own ? own.querySelectorAll('[class^="ojc-"]') : [])) injected.remove();
        const ns = !/\\d/.test(own ? own.textContent : '');
        const nm = neg.some(k => (c.textContent || '').toLowerCase().includes(k));
        if (ns || nm) expect++;   // hidden either way — noSalary cannot un-hide a keyword match
      }
      const shown = document.body.innerText.match(/Displaying\\s+(\\d+)\\s+out of\\s+(\\d+)/i);
      const off = (location.pathname.match(/\\/(\\d+)$/) || [])[1];
      return JSON.stringify({ cards: cards.length, hidden: cards.filter(c => c.hidden).length, expect,
        total: shown ? +shown[2] : null, offset: off ? +off : 0 });
    })()`;
    const fetches = () => reqs
      .filter(x => x.type === 'Fetch' || x.type === 'XHR')
      .map(x => x.url)
      // Only the loader's own URL shape counts: a list page plus an offset segment. The site's
      // own beacons (/cdn-cgi/rum, gtag) are Fetch requests on the same host and would
      // otherwise make "idle costs nothing" unprovable.
      .filter(u => /^https:\/\/www\.onlinejobs\.ph\/jobseekers\/(jobsearch|search)\/[^?]*\d/.test(u));

    const idle = { ...JSON.parse(await tab.evaluate(snapshot)), requests: fetches().length };
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
    const afterOne = { ...JSON.parse(await tab.evaluate(snapshot)), requests: fetches().length, wheels };
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
  await withTab(PORT, `chrome-extension://${EXT_ID}/options.html`, tab =>
    tab.evaluate(`chrome.storage.local.remove('fx').then(()=>1)`), 600);

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
  // a card with no figure must SAY why: a piece rate has no monthly equivalent, and a foreign
  // currency without a live rate is never approximated
  const silent = parseable.filter(x => !x.note);
  for (const x of silent) {
    const explains = x.perUnit ? /per-unit rate has no honest monthly equivalent/.test(x.title || '')
      : x.unit === 'hour' ? /no monthly figure is claimed/.test(x.title || '')
      : /no live [A-Z]{3}|bare number/.test(x.title || '');
    if (!explains) {
      await fail(`a card shows no figure without saying why: posted ${JSON.stringify(x.posted)}, ` +
        `title ${JSON.stringify(x.title)}`);
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

console.log('verify-live: PASS');
await settle(250);
process.exit(0);
