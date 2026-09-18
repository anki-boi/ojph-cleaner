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
    let noSalExpected = 0, negExpected = 0, posExpected = 0;
    for (const c of cards) {
      const e = expectHide(c);
      if (e.ns) noSalExpected++;
      else if (e.nm) negExpected++;
      else if (e.pm) posExpected++;
    }
    return JSON.stringify({
      url: location.href,
      cards: cards.length,
      salaries: document.querySelectorAll('.jobpost-cat-box.latest-job-post dd.col').length,
      chip: !!document.getElementById('ojc-chip'),
      chipText: (document.getElementById('ojc-chip') || {}).textContent || null,
      hidden: document.querySelectorAll('.jobpost-cat-box.latest-job-post[hidden]').length,
      negatives: document.querySelectorAll('.jobpost-cat-box.ojc-neg').length,
      highlights: document.querySelectorAll('.ojc-pos-badge').length,
      noSalExpected, negExpected, posExpected
    });
  })()`);
}, 500));

console.log('live page :', res.url);
console.log(`  cards   : ${res.cards} (${res.salaries} with a salary field)`);
console.log(`  chip    : ${res.chip ? res.chipText : 'MISSING — content script did not run'}`);
console.log(`  hidden  : ${res.hidden}   (expected by rule: ${res.noSalExpected + res.negExpected})`);
console.log(`  no-salary ${res.noSalExpected} → hidden, keyword ${res.negExpected} → hidden, positive ${res.posExpected} → highlighted`);

if (!res.chip) await fail('content script did not inject — check manifest permissions/host_permissions');
if (res.cards && !res.salaries) await fail('no dd.col salary elements — list markup may have drifted');
if (res.hidden !== res.noSalExpected + res.negExpected) {
  await fail(`hidden ${res.hidden}, rule says ${res.noSalExpected + res.negExpected} (no-salary ${res.noSalExpected} + keyword ${res.negExpected})`);
}
if (res.negatives !== res.negExpected) await fail(`keyword hides ${res.negatives}, expected ${res.negExpected}`);
if (res.highlights !== res.posExpected) await fail(`highlights ${res.highlights}, expected ${res.posExpected}`);

// ── 4. chip "Show all" must reveal, and re-hide, everything it hid ───────
const expected = res.noSalExpected + res.negExpected;
if (expected > 0) {
  const toggled = async () => withTab(PORT, URL_, async (tab) => {
    await settle(3000);
    await tab.evaluate(`document.querySelector('#ojc-chip button').click()`);
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

console.log('verify-live: PASS');
await settle(250);
process.exit(0);
