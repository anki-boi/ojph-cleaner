import { withTab } from './cdp.mjs';
import fs from 'fs';

const PORT = 9333;
const BOARD = 'https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=virtual%20assistant';
const salarySrc = fs.readFileSync(new URL('../salary.js', import.meta.url), 'utf8');

const links = JSON.parse(await withTab(PORT, BOARD, async (tab) => {
  await new Promise(r => setTimeout(r, 5000));
  return JSON.stringify(await tab.evaluate(`[...document.querySelectorAll('.jobpost-cat-box a[href*="/job/"]')].map(a => a.getAttribute('href')).slice(0, 3)`));
}));
console.log('links:', links);

const fxStore = JSON.parse(await withTab(PORT, 'chrome-extension://ogbleogpeljbekginheeggkdcbpdalol/options.html', (tab) =>
  tab.evaluate(`new Promise(res => chrome.storage.local.get('fx').then(r => res(JSON.stringify((r.fx || {}).rates || {}))))`)));
console.log('fx store:', JSON.stringify(fxStore));
const RATES = Object.fromEntries(Object.entries(fxStore).map(([c, r]) => [c, r.rate]));

for (const href of links) {
  const data = JSON.parse(await withTab(PORT, 'https://www.onlinejobs.ph' + href, async (tab) => {
    await new Promise(r => setTimeout(r, 5000));
    const hasBar = await tab.evaluate(`!!document.getElementById('ojc-detail-bar')`);
    if (!hasBar) return JSON.stringify({ hasBar });
    return await tab.evaluate(`(() => {
      const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
      const dd = [...document.querySelectorAll('dl.row.no-gutters dd')];
      const val = (re) => { for (const d of dd) { const h = d.querySelector('h3'); if (h && re.test(clean(h.textContent))) return clean(d.querySelector('p')?.textContent || ''); } return null; };
      const bar = document.getElementById('ojc-detail-bar');
      return JSON.stringify({ hasBar: true, bar: [...bar.children].map(c => clean(c.textContent)),
        hours: val(/hours/i), pay: val(/wage|salary/i), type: val(/type of work/i) });
    })()`);
  }));
  console.log('---', href);
  console.log(JSON.stringify(data, null, 1));
  if (!data.hasBar) continue;
  const recomp = await withTab(PORT, 'https://www.onlinejobs.ph' + href, (tab) => tab.evaluate(`${salarySrc}
    (() => {
      const S = window.OJCSalary;
      const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
      const dd = [...document.querySelectorAll('dl.row.no-gutters dd')];
      const val = (re) => { for (const d of dd) { const h = d.querySelector('h3'); if (h && re.test(clean(h.textContent))) return clean(d.querySelector('p')?.textContent || ''); } return null; };
      const posted = val(/wage|salary/i); const hoursRaw = val(/hours per week/i); const typeRaw = val(/type of work/i);
      const hours = /^\\d+$/.test(clean(hoursRaw)) ? Number(clean(hoursRaw)) : null;
      const partTime = /part[\\s-]?time|gig/i.test(typeRaw || '');
      const basis = hours !== null ? hours : (partTime ? null : S.FULL_TIME_HOURS);
      const parsed = S.parseSalary(posted, basis);
      const php = parsed ? S.toPhp(parsed, ${JSON.stringify(RATES)}) : null;
      return JSON.stringify({ posted, hoursRaw, typeRaw, hours, basis, parsed, php, note: php ? S.formatNote(php) : null });
    })()`));
  console.log('recomp :', recomp);
}
