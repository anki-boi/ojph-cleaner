import { openTab } from './cdp.mjs';
const URL_ = 'https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=virtual%20assistant';
const tab = await openTab(9333, URL_);
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const s = await tab.evaluate(`JSON.stringify({
    cards: document.querySelectorAll('.jobpost-cat-box.latest-job-post').length,
    chip: !!document.getElementById('ojc-chip'),
    btn: !!document.querySelector('#ojc-chip .ojc-export'),
    url: location.href, title: document.title,
  })`).catch(e => 'ERR ' + e);
  console.log(i, s);
  if (s.includes('"btn":true')) break;
}
await tab.close();
