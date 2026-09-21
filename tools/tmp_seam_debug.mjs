import { withTab, openTab } from './cdp.mjs';
import fs from 'fs';

const PORT = 9333;
const URL_ = 'https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=virtual%20assistant';
const salarySrc = fs.readFileSync(new URL('../salary.js', import.meta.url), 'utf8');
const store = await openTab(PORT, 'chrome-extension://ogbleogpeljbekginheeggkdcbpdalol/options.html');

const fxStore = JSON.parse(await store.evaluate(`new Promise(res => chrome.storage.local.get('fx').then(r => res(JSON.stringify((r.fx || {}).rates || {}))))`));
console.log('fx store:', JSON.stringify(fxStore));
const RATES = Object.fromEntries(Object.entries(fxStore).map(([c, r]) => [c, r.rate]));
console.log('now:', Date.now(), 'ages(h):', Object.fromEntries(Object.entries(fxStore).map(([c, r]) => [c, ((Date.now() - r.at) / 3600000).toFixed(1)])));

const tab = await openTab(PORT, URL_);
await new Promise(r => setTimeout(r, 8000));

const out = await tab.evaluate(`(() => {
  const cards = [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
  const withNote = cards.filter(c => { const n = c.querySelector('.ojc-salary-note'); return n && n.textContent.trim(); });
  const src = withNote[0];
  const rows = withNote.slice(0, 8).map(c => {
    const dd = c.querySelector('dd.col');
    const own = dd ? dd.cloneNode(true) : null;
    if (own) for (const i of own.querySelectorAll('[class^="ojc-"]')) i.remove();
    return { note: (c.querySelector('.ojc-salary-note') || {}).textContent, salary: own ? own.textContent.trim() : null };
  });
  let cloneInfo = null;
  if (src) {
    const clone = src.cloneNode(true);
    for (const injected of clone.querySelectorAll('[class^="ojc-"]')) injected.remove();
    for (const cls of ['ojc-neg','ojc-pos','ojc-recon','ojc-goal']) clone.classList.remove(cls);
    clone.hidden = false;
    clone.removeAttribute('title');
    const desc = clone.querySelector('.desc');
    if (desc) { const a = document.createElement('a'); a.textContent = 'the'; desc.prepend(a); }
    src.parentElement.appendChild(clone);
    window.__c = clone;
  }
  return JSON.stringify({ noteCount: withNote.length, rows, srcFound: !!src });
})()`);
console.log('initial:', out);
await new Promise(r => setTimeout(r, 4000));

const cloneNow = await tab.evaluate(`(() => {
  const c = window.__c; if (!c) return JSON.stringify({ gone: true });
  const dd = c.querySelector('dd.col');
  const own = dd ? dd.cloneNode(true) : null;
  if (own) for (const i of own.querySelectorAll('[class^="ojc-"]')) i.remove();
  return JSON.stringify({
    note: (c.querySelector('.ojc-salary-note') || {}).textContent,
    salary: own ? own.textContent.trim() : null,
    hidden: c.hidden, recon: c.classList.contains('ojc-recon'), goal: c.classList.contains('ojc-goal'),
    basis: (c.querySelector('.ojc-salary-note') || {}).dataset?.basis,
    rate: (c.querySelector('.ojc-salary-note') || {}).dataset?.rate,
  });
})()`);
console.log('clone :', cloneNow);

const recomp = await tab.evaluate(`${salarySrc}
(() => {
  const c = window.__c; if (!c) return JSON.stringify({ gone: true });
  const S = window.OJCSalary;
  const dd = c.querySelector('dd.col');
  const own = dd ? dd.cloneNode(true) : null;
  if (own) for (const i of own.querySelectorAll('[class^="ojc-"]')) i.remove();
  const text = own ? own.textContent.trim() : '';
  const parsed = S.parseSalary(text, 40);
  const php = parsed ? S.toPhp(parsed, ${JSON.stringify(RATES)}) : null;
  return JSON.stringify({ text, parsed, php });
})()`);
console.log('recomp:', recomp);

await tab.close(); await store.close();
