// tools/capture-screens.js — capture the store/README screenshots from the live site.
//
//   node tools/capture-screens.js
//   node tools/capture-screens.js --url="https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=bookkeeper"
//
// Writes full-size PNGs into docs/img/ under the names the README and docs/store.md expect,
// then run `node tools/make-store-images.js` to cut the store-sized versions.
//
// Why a tool: the store rejects any screenshot that is not exactly 1280x800 (or 640x400), and
// the README shows the same three files — so every UI change invalidates both, and
// hand-recapturing them is the chore that silently does not happen.
//
// It drives the automation Chrome on :9333 (see docs/HANDOFF.md §2), opens its own tab and
// closes it, so the user's own tabs are not touched. Settings are snapshotted before and
// restored after, including on failure, so their browser is left as it was found.
//
// Options:
//   --url=<search page>   page to capture on (default: a bookkeeper search)
//   --port=<n>            CDP port (default 9333, or OJC_CDP_PORT)
//   --reload              reload the unpacked extension first. Off by default: the reload
//                         invalidates any extension page already open, and the extension in the
//                         automation profile is already this repo's code (HANDOFF §2). Reload it
//                         by hand from chrome://extensions if you have just edited it.
//   --keep-settings       do not restore the previous settings afterwards
//   --scan                press Scan and wait for it to finish before capturing. Slow, and it
//                         reads listing pages for real — off by default.
'use strict';

import { openTab, withTab } from './cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);

const PORT = Number(arg('port', process.env.OJC_CDP_PORT || 9333));
const URL_ = arg('url', 'https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=bookkeeper');
const KEEP = flag('keep-settings');
const DO_SCAN = flag('scan');
const DO_RELOAD = flag('reload');

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const OUT = path.resolve(HERE, '..', 'docs/img');

// 1280x800 at 2x — a crisp full size that downscales to the store's exact 1280x800.
const VIEW = { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false };
const SETTINGS = {
  negative: ['crypto', 'video editor'],
  positive: ['quickbooks', 'ai'],
  noSalary: true,
  showHidden: false,
  maxAgeDays: 7,
  autoLoad: true,
  goalSalary: 40000,
  goalHourly: 300,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, label) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out: ${label}`)), ms)),
]);

/**
 * Poll a page expression. Every evaluate is raced against a deadline, because a
 * Runtime.evaluate issued while the tab is mid-navigation can simply never answer — which
 * would otherwise hang the whole capture with no output.
 */
async function waitFor(tab, expr, { timeout = 15000, label = expr } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let ok = false;
    try { ok = await withTimeout(tab.evaluate(`!!(${expr})`), 4000, 'evaluate'); } catch { ok = false; }
    if (ok) return true;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(250);
  }
}

async function shot(tab, file, clip) {
  const params = { format: 'png' };
  if (clip) params.clip = { ...clip, scale: VIEW.deviceScaleFactor };
  const { data } = await tab.send('Page.captureScreenshot', params);
  const buf = Buffer.from(data, 'base64');
  fs.writeFileSync(file, buf);
  console.log(`  ${path.basename(file)}  ${(buf.length / 1024).toFixed(1)} KB`);
}

console.log('extension:');
const info = JSON.parse(await withTab(PORT, 'chrome://extensions/', (t) => t.evaluate(
  `chrome.developerPrivate.getExtensionsInfo({includeDisabled:true}).then(list =>
     JSON.stringify(list.filter(e => /ojph-cleaner/i.test(e.path || ''))
       .map(e => ({ id: e.id, name: e.name, version: e.version }))))`), 1800));
if (!info.length) throw new Error('OJ.ph Cleaner is not loaded in the automation profile (docs/HANDOFF.md §2)');
const EXT = info[0];
console.log(`  ${EXT.name} ${EXT.version}  ${EXT.id}`);

if (DO_RELOAD) {
  await withTab(PORT, 'chrome://extensions/', (t) => t.evaluate(
    `chrome.developerPrivate.reload(${JSON.stringify(EXT.id)}, { failQuietly: true }).then(() => 1)`), 2500);
  console.log('  reloaded');
}

// An extension page is the only context that can touch chrome.storage. Opened AFTER any
// reload, because a reload tears down extension pages that are already open.
let store = await openTab(PORT, `chrome-extension://${EXT.id}/options.html`);
const snapshot = JSON.parse(await store.evaluate(`chrome.storage.local.get(null).then(r => JSON.stringify(r))`));

async function restore() {
  if (KEEP) return console.log('  (--keep-settings: leaving the seeded settings in place)');
  await store.evaluate(`chrome.storage.local.clear().then(() => chrome.storage.local.set(${JSON.stringify(snapshot)}).then(()=>1))`);
  console.log('  settings restored');
}

try {
  await store.evaluate(`chrome.storage.local.set({ settings: ${JSON.stringify(SETTINGS)} }).then(()=>1)`);

  console.log('\nscreenshots:');
  await withTab(PORT, 'about:blank', async (tab) => {
    await tab.send('Page.enable');
    await tab.send('Emulation.setDeviceMetricsOverride', VIEW);
    await tab.send('Page.navigate', { url: URL_ });
    // Let the navigation commit before the first evaluate, or it can be issued into a
    // context that is about to be destroyed and never answer.
    await sleep(2500);
    await waitFor(tab, `document.readyState === 'complete'`, { timeout: 30000, label: 'page load' });
    await waitFor(tab, `document.getElementById('ojc-chip')`, { label: 'the chip (#ojc-chip)' });
    // The rule pass is rAF-scheduled and salary conversion waits on the FX rate; give both
    // time to settle so the capture shows final figures rather than skeletons.
    await sleep(3000);

    if (DO_SCAN) {
      console.log('  running Scan (this reads listing pages for real)…');
      await tab.evaluate(`(()=>{const b=document.getElementById('ojc-scan'); if(b) b.click(); return 1})()`);
      const deadline = Date.now() + 180000;
      for (;;) {
        const busy = await withTimeout(tab.evaluate(
          `(()=>{const b=document.getElementById('ojc-scan'); return b?/stop/i.test(b.textContent):false})()`),
          8000, 'scan poll').catch(() => false);
        if (!busy) break;
        if (Date.now() > deadline) { console.log('  (scan still running after 3 min — capturing anyway)'); break; }
        await sleep(1000);
      }
      await sleep(1200);
    }

    await shot(tab, path.join(OUT, 'list-chip.png'));

    // Scrolled to a highlighted card, so the badge and the marks are in frame.
    await tab.evaluate(`(()=>{const el=document.querySelector('.ojc-pos,.ojc-tier-badge,.ojc-pos-badge');
      if(el) el.scrollIntoView({block:'center'}); return 1})()`);
    await sleep(900);
    await shot(tab, path.join(OUT, 'highlight.png'));

    // One card, up close. The full-viewport shots are all list-overview; this is the one that
    // shows what the extension actually tells you about a single listing — the badge, the
    // converted figure, the goal line and the hours caveat — at a legible size.
    // Scroll and measure in SEPARATE evaluates: the site sets `scroll-behavior: smooth`, so a
    // rect read in the same call as scrollIntoView() is measured mid-animation and the clip
    // lands offset from the card.
    const scrolled = await tab.evaluate(`(()=>{
      const mark = document.querySelector('.ojc-pos, .ojc-recon, .ojc-tier-badge, .ojc-pos-badge');
      if (!mark) return 0;
      const card = mark.closest('.jobpost-cat-box.latest-job-post') || mark.parentElement;
      card.scrollIntoView({ block: 'center', behavior: 'instant' });
      return 1})()`);
    if (scrolled) {
      await sleep(900);
      // Give the card room, then clip to its FULL rect. The site's result cards are ~1608x584
      // CSS px — wider than a 1280 viewport and a 2.75:1 shape, so no 1.6:1 crop of one shows it
      // whole without slicing the description off mid-sentence. The whole card is captured and
      // make-store-images letterboxes it onto the 1280x800 canvas instead.
      await tab.send('Emulation.setDeviceMetricsOverride', { ...VIEW, width: 1680, height: 1050 });
      await tab.evaluate(`(()=>{
        const mark = document.querySelector('.ojc-pos, .ojc-recon, .ojc-tier-badge, .ojc-pos-badge');
        const card = mark.closest('.jobpost-cat-box.latest-job-post') || mark.parentElement;
        card.scrollIntoView({ block: 'center', behavior: 'instant' });
        return 1})()`);
      await sleep(900);
      const cardRect = JSON.parse(await tab.evaluate(`(()=>{
        const mark = document.querySelector('.ojc-pos, .ojc-recon, .ojc-tier-badge, .ojc-pos-badge');
        const card = mark.closest('.jobpost-cat-box.latest-job-post') || mark.parentElement;
        const r = card.getBoundingClientRect();
        return JSON.stringify({ x: Math.max(0, r.x + window.scrollX), y: Math.max(0, r.y + window.scrollY),
          width: r.width, height: r.height })})()`));
      await sleep(400);
      await shot(tab, path.join(OUT, 'card-detail.png'), cardRect);
      await tab.send('Emulation.setDeviceMetricsOverride', VIEW);
      await sleep(400);
    } else {
      console.log('  (no marked card on this page — skipping card-detail.png)');
    }

    // The settings panel, clipped to its own box so the shot is the panel and nothing else.
    await tab.evaluate(`(()=>{const g=document.getElementById('ojc-gear'); if(g) g.click(); return 1})()`);
    await waitFor(tab, `document.getElementById('ojc-panel') && !document.getElementById('ojc-panel').hidden`,
      { timeout: 8000, label: 'the options panel (#ojc-panel)' });
    await sleep(700);

    // In context, and natively 1280x800 — this is the one the store wants for its settings
    // slot. The panel alone is ~680x1900, and no crop of it reaches 1280x800 without throwing
    // most of it away.
    await shot(tab, path.join(OUT, 'panel-in-page.png'));

    // The panel's body is an internal scroll box, so a plain clipped capture photographs only
    // the top of the settings and silently loses the salary goals and the scan toggles — the two
    // things worth showing. Unclamp it, and give the viewport room for the taller panel (it is
    // position:fixed, so a panel taller than the viewport cannot be photographed at all).
    await tab.evaluate(`(()=>{const p=document.getElementById('ojc-panel'), b=document.getElementById('ojc-panel-body');
      if(p) p.style.maxHeight = 'none';
      if(b) { b.style.maxHeight = 'none'; b.style.overflowY = 'visible'; }
      return 1})()`);
    await tab.send('Emulation.setDeviceMetricsOverride', { ...VIEW, height: 2200 });
    await sleep(900);

    const rect = JSON.parse(await tab.evaluate(`(()=>{const p=document.getElementById('ojc-panel');
      const r=p.getBoundingClientRect();
      // captureScreenshot clips in PAGE coordinates, but getBoundingClientRect is VIEWPORT
      // relative - and the page is scrolled here, so without the scroll offsets the clip
      // lands off the panel and yields a blank white image.
      return JSON.stringify({x:Math.max(0,r.x+window.scrollX), y:Math.max(0,r.y+window.scrollY),
        width:r.width, height:r.height})})()`));
    await shot(tab, path.join(OUT, 'options-panel.png'), rect);

    await tab.evaluate(`(()=>{const p=document.getElementById('ojc-panel'), b=document.getElementById('ojc-panel-body');
      if(p) p.style.maxHeight = '';
      if(b) { b.style.maxHeight = ''; b.style.overflowY = ''; }
      return 1})()`);
    await tab.send('Emulation.setDeviceMetricsOverride', VIEW);
    await sleep(300);
    await tab.send('Emulation.clearDeviceMetricsOverride');
  }, 0);

  await restore();
  console.log('\ndone. now run: node tools/make-store-images.js');
} catch (err) {
  try { await restore(); } catch {}
  throw err;
} finally {
  try { await store.close(); } catch {}
  store = null;
}
