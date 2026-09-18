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

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const PORT = +(process.env.OJC_CDP_PORT || 9333);
const EXT_NAME = process.env.OJC_EXT_NAME || 'OJ.ph Cleaner';
const URL_ = arg('url', 'https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=virtual%20assistant');
const neg = arg('neg', '').split(',').filter(Boolean);
const pos = arg('pos', '').split(',').filter(Boolean);

const fail = async msg => { console.error('verify-live: FAIL — ' + msg); await new Promise(r => setTimeout(r, 250)); process.exit(1); };
const settle = ms => new Promise(r => setTimeout(r, ms));

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
const settings = { negative: neg, positive: pos, noSalary: true, showHidden: false, autoScan: false };
await withTab(PORT, `chrome-extension://${EXT_ID}/options.html`, tab =>
  tab.evaluate(`chrome.storage.local.set({ settings: ${JSON.stringify(settings)} }).then(()=>1)`), 1200);
console.log(`settings  : ${JSON.stringify(settings)}`);

// ── 3. live page ─────────────────────────────────────────────────────────
const res = JSON.parse(await withTab(PORT, URL_, async (tab) => {
  await settle(3500);
  return tab.evaluate(`(() => {
    const neg = ${JSON.stringify(neg.map(k => k.toLowerCase()))};
    const pos = ${JSON.stringify(pos.map(k => k.toLowerCase()))};
    const cards = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
    const text = c => (c.textContent || '').toLowerCase();
    const hasSalary = c => { const d = c.querySelector('dd.col'); return /\\d/.test(d ? d.textContent : ''); };
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
  const toggled = async () => withTab(PORT, URL_, async (tab) => {
    await settle(3000);
    await tab.evaluate(`document.querySelector('#ojc-toggle').click()`);
    await settle(400);
    return tab.evaluate(`JSON.stringify({
      hidden: document.querySelectorAll('.jobpost-cat-box.latest-job-post[hidden]').length,
      label: document.querySelector('#ojc-chip b').textContent,
      btn: document.querySelector('#ojc-chip button').textContent
    })`);
  }, 500);
  const shown = JSON.parse(await toggled());
  if (shown.hidden !== 0) await fail(`after "Show all", ${shown.hidden} cards are still hidden`);
  if (!/would be hidden/.test(shown.label)) await fail(`chip label did not switch to the preview wording: "${shown.label}"`);
  const hiddenAgain = JSON.parse(await toggled());
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
      return JSON.stringify({hidden:cs.filter(c=>c.hidden).length,
        saved:(document.querySelector('#ojc-saved')||{}).style?.display,
        panelVisible:!!document.querySelector('#ojc-panel') && !document.querySelector('#ojc-panel').hidden});})()`));
    const before = await snap();
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
    const noSalaryOff = await snap();
    await tab.evaluate(`(()=>{document.querySelector('#ojc-noSalary').checked=true;
      document.querySelector('#ojc-save').click()})()`);
    await settle(300);
    return JSON.stringify({ before, opened, noSalaryOff, noSalaryOn: await snap() });
  }, 500));

  if (!r.opened.exists) await fail('the chip gear does not open an in-page options panel');
  if (!r.opened.visible) await fail('the panel exists but is hidden after clicking the gear');
  if (r.opened.inChip) await fail('the panel is nested inside #ojc-chip — the chip rebuild will wipe it');
  if (!r.opened.fields) await fail('the in-page panel is missing option fields');
  if (r.opened.neg !== neg.join('\n') || r.opened.noSalary !== true || r.opened.showHidden !== false) {
    await fail(`panel did not load the saved settings: ${JSON.stringify(r.opened)}`);
  }
  if (!r.noSalaryOff.panelVisible) await fail('the panel was destroyed by the rule pass triggered by Save');
  if (r.noSalaryOff.saved !== 'inline') await fail('Save did not confirm with "Saved"');
  // With noSalary off, every card that matches a negative keyword hides — including
  // the no-salary cards that the noSalary rule was shadowing (it is checked first).
  if (r.noSalaryOff.hidden !== res.negAnyExpected) {
    await fail(`after unchecking "no salary" in the panel, ${r.noSalaryOff.hidden} hidden — expected ${res.negAnyExpected} keyword hides, no reload`);
  }
  if (r.noSalaryOn.hidden !== expected) {
    await fail(`after re-checking "no salary" in the panel, ${r.noSalaryOn.hidden} hidden vs ${expected}, no reload`);
  }
  console.log(`panel     : opened from chip, loaded settings; Save 30→${r.noSalaryOff.hidden}→${r.noSalaryOn.hidden} hidden with no reload`);
}

// ── 6. the rule pass must not feed itself (spec.md §2.2) ────────────────
// renderChip() wipes the chip on every pass; if isOurs() cannot recognise that pass as
// its own, each pass schedules the next one and the page never idles. One external DOM
// mutation is the trigger a real page provides constantly. Measured before the fix:
// 1614 chip rebuilds in 4 s. Bounded afterwards.
{
  const loop = JSON.parse(await withTab(PORT, URL_, async (tab) => {
    await settle(3500);
    return tab.evaluate(`new Promise(res => {
      const chip = document.getElementById('ojc-chip');
      if (!chip) return res(JSON.stringify({ chip: false }));
      let passes = 0;
      const mo = new MutationObserver(ms => { passes += ms.length; });
      mo.observe(chip, { childList: true });
      setTimeout(() => {                       // one mutation, like the site's own scripts
        const d = document.createElement('div');
        d.id = 'ojc-probe';
        document.body.appendChild(d);
        setTimeout(() => {
          mo.disconnect();
          document.getElementById('ojc-probe')?.remove();
          res(JSON.stringify({ chip: true, passes, windowMs: 2000, cards: document.querySelectorAll('.jobpost-cat-box.latest-job-post').length }));
        }, 2000);
      }, 300);
    })`);
  }, 500));
  if (!loop.chip) await fail('no chip to observe in the loop check');
  // One rebuild = 2 records (the wipe, then the append). A handful is a page reacting to
  // its own insertion; hundreds per second is the loop.
  if (loop.passes > 20) {
    await fail(`one external DOM mutation caused ${loop.passes} chip rebuilds in ${loop.windowMs} ms ` +
      `— the rule pass is re-scheduling itself (isOurs() must judge the mutation target)`);
  }
  console.log(`loop      : 1 external mutation → ${loop.passes} chip rebuilds in ${loop.windowMs} ms (bounded)`);
}

console.log('verify-live: PASS');
await settle(250);
process.exit(0);
