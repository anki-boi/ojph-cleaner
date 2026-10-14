// tools/record-gifs.mjs — record the README's GIFs on the made-up board (tools/fiction.mjs).
//
//   OJC_SANDBOX_PORT=9454 node tools/sandbox.mjs        # a throwaway Chrome with this checkout loaded
//   node tools/record-gifs.mjs --port=9454              # → docs/img/bar.gif, docs/img/setup.gif
//   node tools/record-gifs.mjs --port=9454 --only=setup
//
// Each GIF is a scripted sequence of clicks on the invented listings: frames are screenshots taken while the
// steps play, and ffmpeg (palette pass) turns them into a GIF. No real employer is ever on screen, and the
// browser's settings are put back afterwards. Needs ffmpeg on the PATH.
import { openTab, withTab } from './cdp.mjs';
import { FICTION_SETTINGS, applyFiction } from './fiction.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (name, dflt) => { const h = process.argv.find(a => a.startsWith(`--${name}=`)); return h ? h.split('=').slice(1).join('=') : dflt; };
const PORT = Number(arg('port', process.env.OJC_CDP_PORT || 9444));
const ONLY = arg('only', '');
const URL_ = 'https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=virtual+assistant';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, '..', 'docs/img');
const VIEW = { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const info = JSON.parse(await withTab(PORT, 'chrome://extensions/', t => t.evaluate(
  `chrome.developerPrivate.getExtensionsInfo({includeDisabled:true}).then(l => JSON.stringify(l.filter(e => /ojph-cleaner/i.test(e.path || '')).map(e => e.id)))`), 1500));
if (!info.length) throw new Error('OJ.ph Cleaner is not loaded in this browser');
const store = await openTab(PORT, `chrome-extension://${info[0]}/options.html`);
const snapshot = await store.evaluate(`chrome.storage.local.get(null).then(r => JSON.stringify(r))`);

/** Play `steps` (async fns given the tab) while grabbing frames; write `name`.gif. */
async function record(name, steps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ojc-gif-${name}-`));
  await store.evaluate(`chrome.storage.local.clear().then(() => chrome.storage.local.set({ ui: { onboarded: true }, settings: ${JSON.stringify(FICTION_SETTINGS)} })).then(()=>1)`);
  await withTab(PORT, 'about:blank', async (tab) => {
    await tab.send('Page.enable');
    await tab.send('Emulation.setDeviceMetricsOverride', VIEW);
    await tab.send('Page.navigate', { url: URL_ });
    await sleep(6000);
    await applyFiction(tab);
    await sleep(5000);
    await tab.evaluate(`(()=>{const t=document.querySelector('#ojc-toast button[aria-label=Dismiss]'); if(t) t.click(); window.scrollTo(0, 330); return 1})()`);
    await sleep(500);
    let n = 0, recording = true;
    const grab = (async () => {
      while (recording) {
        const { data } = await tab.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(dir, `f${String(n++).padStart(4, '0')}.png`), Buffer.from(data, 'base64'));
        await sleep(110);
      }
    })();
    const click = (sel, text) => tab.evaluate(`(()=>{const els=[...document.querySelectorAll(${JSON.stringify(sel)})];
      const el = ${text ? `els.find(e => e.textContent.includes(${JSON.stringify(text)}))` : 'els[0]'}; if (el) el.click(); return !!el })()`);
    const js = (code) => tab.evaluate(`(()=>{${code}; return 1})()`);
    await sleep(900);
    for (const s of steps) await s({ click, js, sleep });
    await sleep(900);
    recording = false;
    await grab;
    console.log(`  ${name}: ${n} frames`);
  }, 0);
  const out = path.join(OUT, `${name}.gif`);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '9', '-i', path.join(dir, 'f%04d.png'),
    '-vf', 'scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    out], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`  ${path.relative(process.cwd(), out)}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

const pause = (ms) => async ({ sleep }) => sleep(ms);
const GIFS = {
  // The bar: the pills filter the board, the hidden breakdown opens, Peek brings the hidden back.
  bar: [
    async ({ click }) => click('.ojc-view', 'Top picks'), pause(1600),
    async ({ click }) => click('.ojc-view', 'Maybe'), pause(1400),
    async ({ click }) => click('.ojc-view', 'Lowball'), pause(1600),
    async ({ click }) => click('.ojc-view', 'Everything'), pause(900),
    async ({ click }) => click('#ojc-hidden-btn'), pause(1300),
    async ({ click }) => click('#ojc-toggle'), pause(1600),
    async ({ click }) => click('#ojc-toggle'), pause(700),
    async ({ js }) => js(`document.body.click()`), pause(600),
  ],
  // Setup, all five screens: kinds of work, experience, the words (with the matching guide), pay, instant no's.
  setup: [
    async ({ click }) => click('#ojc-gear'), pause(500),
    async ({ click }) => click('#ojc-rerun-setup'), pause(1200),
    async ({ click }) => click('.ojc-archebtn', 'General VA'), pause(700),
    async ({ click }) => click('.ojc-archebtn', 'Customer Support'), pause(1300),
    async ({ click }) => click('#ojc-setup-next'), pause(900),
    async ({ click }) => click('.ojc-levelbtn', 'New to online work'), pause(1500),
    async ({ click }) => click('#ojc-setup-next'), pause(2600),
    async ({ click }) => click('#ojc-setup-next'), pause(500),
    async ({ js }) => js(`const m=document.getElementById('ojc-setup-month'); m.value='900'; m.dispatchEvent(new Event('input'))`), pause(1600),
    async ({ click }) => click('#ojc-setup-next'), pause(800),
    async ({ click }) => click('.ojc-chipbtn', 'crypto'), pause(500),
    async ({ click }) => click('.ojc-chipbtn', 'unpaid trial'), pause(1500),
    async ({ click }) => click('#ojc-setup-next'), pause(1800),
  ],
};

try {
  console.log('gifs:');
  for (const [name, steps] of Object.entries(GIFS)) if (!ONLY || ONLY === name) await record(name, steps);
} finally {
  await store.evaluate(`chrome.storage.local.clear().then(() => chrome.storage.local.set(${snapshot})).then(()=>1)`);
  await store.close();
  console.log('  settings restored');
}
