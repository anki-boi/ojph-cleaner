// jobs.js — the "My jobs" page (spec.md D56, D64): your saved and applied listings as a board, the follow-up
// nudge, notes, the passed list, and the streak. It reads and writes the same `myJobs` key the board does, so
// both stay in step through chrome.storage.onChanged.
(() => {
  'use strict';
  const M = self.OJCMyJobsPure;
  const $ = (id) => document.getElementById(id);
  const COLS = [
    { state: 'saved', label: 'Saved', dot: 'var(--saved)', empty: 'Press 💾 Save on a job, or → in Swipe.' },
    { state: 'applied', label: 'Applied', dot: 'var(--applied)', empty: 'Move a saved job here once you have applied.' },
    { state: 'interview', label: 'Interview', dot: 'var(--interview)', empty: 'Nothing yet — it will come.' },
    { state: 'offer', label: 'Offer', dot: 'var(--offer)', empty: '' },
  ];
  const ORDER = COLS.map(c => c.state);
  let jobs = {}, settings = {};

  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v; else if (k.startsWith('on')) n[k] = v; else if (v != null) n.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
    return n;
  };
  const ago = (t) => {
    const d = Math.floor((Date.now() - t) / 864e5);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  };
  const save = (next) => { jobs = M.prune(next, Date.now()); return chrome.storage.local.set({ myJobs: jobs }); };
  const move = (id, state) => save(M.set(jobs, id, state, Date.now()));

  function card(id, e, col) {
    const i = ORDER.indexOf(e.state);
    const note = h('textarea', { placeholder: 'Notes — who you talked to, what they asked…', 'aria-label': 'Notes' });
    note.value = e.note || '';
    note.onchange = () => save(M.note(jobs, id, note.value));
    return h('article', { class: 'job', style: `--dot:${col.dot}` },
      e.url ? h('a', { class: 't', href: e.url, target: '_blank', rel: 'noopener' }, e.title || 'Untitled job') : h('b', {}, e.title || 'Untitled job'),
      e.company ? h('div', { class: 'co' }, e.company) : null,
      e.pay ? h('div', { class: 'pay' }, e.pay) : null,
      h('div', { class: 'when' }, `${col.label} ${ago(e.at)}`),
      M.needsFollowUp(e, Date.now()) ? h('span', { class: 'nudge', title: 'applied a while ago with no move since — a short, polite follow-up message often gets a reply' }, '📨 Follow up?') : null,
      note,
      h('div', { class: 'moves' },
        i > 0 ? h('button', { onclick: () => move(id, ORDER[i - 1]), title: `back to ${COLS[i - 1].label}` }, `← ${COLS[i - 1].label}`) : null,
        i < ORDER.length - 1 ? h('button', { onclick: () => move(id, ORDER[i + 1]), title: `move to ${COLS[i + 1].label}` }, `${COLS[i + 1].label} →`) : null,
        h('button', { class: 'quiet', onclick: () => move(id, 'passed'), title: 'not going anywhere — move it to Passed' }, '✕')));
  }

  function render() {
    const board = $('board');
    board.innerHTML = '';
    const rows = Object.entries(jobs).sort((a, b) => b[1].at - a[1].at);
    for (const col of COLS) {
      const mine = rows.filter(([, e]) => e.state === col.state);
      board.append(h('section', { class: 'col', style: `--dot:${col.dot}`, 'aria-label': col.label },
        h('h2', {}, col.label, h('span', {}, String(mine.length))),
        mine.length ? mine.map(([id, e]) => card(id, e, col)) : h('div', { class: 'empty' }, col.empty)));
    }
    const passed = rows.filter(([, e]) => e.state === 'passed');
    $('passed-sum').textContent = `Passed (${passed.length}) — hidden from the board`;
    $('passed').innerHTML = '';
    for (const [id, e] of passed.slice(0, 200)) {
      $('passed').append(h('li', {},
        e.url ? h('a', { href: e.url, target: '_blank', rel: 'noopener' }, e.title || id) : h('span', {}, e.title || id),
        h('span', { class: 'when' }, ago(e.at)),
        h('button', { onclick: () => save(M.set(jobs, id, null, Date.now())), title: 'show it on the board again' }, '↶ Show again')));
    }
    const goal = Number(settings.weeklyApplyGoal) || 0;
    const s = M.streak(jobs, Date.now());
    $('streak').innerHTML = '';
    if (goal > 0) $('streak').append(s.days ? '🔥 ' : '', h('b', {}, s.days ? `${s.days}-day streak` : 'No streak yet'), ` · ${s.week} of ${goal} applications this week`);
    else if (s.week) $('streak').append(`${s.week} application${s.week === 1 ? '' : 's'} this week`);
    self.OJCInsights?.render?.($('insights'), settings);
  }

  chrome.storage.local.get(['myJobs', 'settings'], (r) => { jobs = r.myJobs || {}; settings = r.settings || {}; render(); });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.myJobs) jobs = ch.myJobs.newValue || {};
    if (ch.settings) settings = ch.settings.newValue || {};
    // Never re-render under someone typing a note: their text would be replaced by the stored one.
    if ((ch.myJobs || ch.settings) && !(document.activeElement && document.activeElement.tagName === 'TEXTAREA')) render();
  });
})();
