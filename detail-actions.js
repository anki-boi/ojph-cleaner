/**
 * detail-actions.js — Save / Applied / Not for me on a listing's own page (spec.md W21.2).
 *
 * The page you read before applying is where "I applied" actually happens, so the three buttons sit right
 * under the figures bar (detail.js). They write the same `myJobs` map as the board's card buttons and Swipe
 * (myjobs.js), so My jobs, the board and this page always agree.
 */
(() => {
  'use strict';
  if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) return;
  const M = self.OJCMyJobsPure, closed = self.OJClosed, L = self.OJCLabels;
  const id = closed?.jobIdFrom(location.pathname);
  if (!M || !id || !/\/jobseekers\/job\//.test(location.pathname)) return;

  let jobs = {}, box = null;
  const text = (sel) => (document.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
  const facts = () => ({
    title: text('h1') || document.title.replace(/\s*[-|].*$/, ''),
    url: location.href.split('#')[0],
    pay: text('#ojc-detail-bar .ojc-bar-pay'),
  });

  async function decide(state) {
    const before = jobs;
    const now = M.stateOf(jobs, id);
    jobs = M.prune(M.set(jobs, id, now === state ? null : state, Date.now(), facts()), Date.now());
    await chrome.storage.local.set({ myJobs: jobs });
    paint();
    const what = now === state ? 'Removed from My jobs' : state === 'passed' ? 'Hidden from the board' : `${state[0].toUpperCase()}${state.slice(1)}`;
    self.OJCToast?.show(what, { action: { label: L.btn.undo, run: async () => { jobs = before; await chrome.storage.local.set({ myJobs: jobs }); paint(); } } });
  }

  function paint() {
    const bar = document.getElementById('ojc-detail-bar');
    if (!bar) return;
    if (!box || !box.isConnected) {
      box = document.createElement('div');
      box.id = 'ojc-detail-acts';
      for (const [state, label] of [['saved', '💾 Save'], ['applied', '✓ I applied'], ['passed', '✕ Not for me']]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.state = state;
        b.textContent = label;
        b.onclick = () => decide(state);
        box.appendChild(b);
      }
      const link = document.createElement('a');
      link.href = chrome.runtime.getURL('jobs.html');
      link.target = '_blank';
      link.textContent = '📋 My jobs';
      box.appendChild(link);
      bar.after(box);
    }
    const now = M.stateOf(jobs, id);
    for (const b of box.querySelectorAll('button')) {
      b.classList.toggle('is-on', b.dataset.state === now);
      b.setAttribute('aria-pressed', String(b.dataset.state === now));
    }
  }

  chrome.storage.local.get('myJobs', (r) => {
    jobs = r.myJobs || {};
    // The figures bar is drawn after the page settles (detail.js); wait for it rather than guess a delay.
    let tries = 0;
    const t = setInterval(() => { if (document.getElementById('ojc-detail-bar') || ++tries > 40) { clearInterval(t); paint(); } }, 250);
  });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.myJobs) { jobs = ch.myJobs.newValue || {}; paint(); } });
})();
