/**
 * triage.js — your own calls on the board (spec.md W20): ✕ Not for me, 💾 Save and 📨 Applied on every card (D51,
 * D77), the stamp on a job you applied to and on a new post of a role you applied to (D77, D78), "new since your
 * last visit" (D54), the suggested block word (D53), and the bar's 🃏 Swipe and 📋 My jobs buttons.
 *
 * The decisions live in `chrome.storage.local.myJobs` (myjobs.js explains why not in settings or jobRecords).
 * Everything here is an applier: the decisions themselves are myjobs.js, the counting suggest.js and visits.js.
 * It reaches the rule pass through two doors content.js keeps open — `isPassed` (read before the verdict) and a
 * card hook (run after it) — so it can never change why a listing got its tier.
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage || typeof document === 'undefined') return;
  const api = self.OJC;
  if (!api) return;
  const M = self.OJCMyJobsPure, V = self.OJCVisits, SG = self.OJCSuggest, L = self.OJCLabels;
  const JOB_LINK = 'a[href*="/jobseekers/job/"]';

  let jobs = {};                      // the myJobs map, as stored
  let ui = {};                        // dismissed suggestions live in the `ui` key
  let cutoff = null, visitKey = null, visits = {};
  let newCount = 0;

  // ── reading a card ──────────────────────────────────────────────────────
  const linkOf = (card) => card.querySelector(JOB_LINK);
  const idOf = (card) => { const a = linkOf(card); return a ? self.OJClosed.jobIdFrom(a.getAttribute('href')) : null; };
  const own = (el) => { if (!el) return ''; const o = el.cloneNode(true); o.querySelectorAll('[class^="ojc-"], [class*="badge"]').forEach(x => x.remove()); return o.textContent.replace(/\s+/g, ' ').trim(); };
  const titleOf = (card) => own(card.querySelector('dt h4')) || own(linkOf(card));
  // "Company • Posted on …" — and a card with no company is just "Posted on …", which is not a company.
  const companyOf = (card) => (([co, rest]) => (rest !== undefined ? co.trim() : ''))(own(card.querySelector(api.SELECTORS.cardPosted)).split(/[•·]/));
  function factsOf(card) {
    const a = linkOf(card);
    return {
      title: titleOf(card),
      company: companyOf(card),
      url: a ? new URL(a.getAttribute('href'), location.href).href : '',
      pay: card.querySelector('.ojc-salary-note')?.textContent || own(card.querySelector(api.SELECTORS.cardSalary)).slice(0, 60),
      sig: SG.signature(api.ownText(card)),
    };
  }

  // ── storage ─────────────────────────────────────────────────────────────
  const write = (next) => { jobs = M.prune(next, Date.now()); doneIdx = null; return chrome.storage.local.set({ myJobs: jobs }); };

  // The applied entries by title, rebuilt only when myJobs changes: a pass asks once per card, and walking every
  // entry for every card was 300 × 3 000 lookups a pass.
  let doneIdx = null;
  function repostFor(id, title, company) {
    if (!doneIdx) {
      doneIdx = new Map();
      for (const [k, e] of Object.entries(jobs)) if (M.isDone(e)) { const t = M.titleKey(e.title); if (t) doneIdx.set(t, { ...(doneIdx.get(t) || {}), [k]: e }); }
    }
    const some = doneIdx.get(M.titleKey(title));
    return some ? M.repostOf(some, id, title, company) : null;
  }
  const ago = (t) => { const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
  const onDay = (t) => 'on ' + new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

  /** Move a listing; says what happened, and offers to take it back (D48). */
  async function decide(card, state, { quiet = false } = {}) {
    const id = idOf(card);
    if (!id) return;
    const before = jobs;
    await write(M.set(jobs, id, state, Date.now(), factsOf(card)));
    api.refreshRules();
    if (quiet) return;
    const title = factsOf(card).title || 'this job';
    const say = state === 'passed' ? `Hidden: ${title}` : state ? `${cap(state)}: ${title}` : `Removed from My jobs: ${title}`;
    self.OJCToast?.show(say, { action: { label: L.btn.undo, run: async () => { await write(before); api.refreshRules(); } } });
  }
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  // ── the card hook: buttons, the stamp, the "new" mark ───────────────────
  const UNHIDE = { kw: 'kw', nosal: 'noSal', gig: 'gig' };   // tier → the bar's hidden count it was counted in
  const mkBtn =(cls, label, title) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label; b.title = title; return b; };
  function decorate(card, { tier, box, at, counts }) {
    const id = idOf(card);
    const state = M.stateOf(jobs, id), entry = id ? jobs[id] : null, done = M.isDone(entry);
    let acts = card.querySelector(':scope > .ojc-acts');
    if (!acts) {
      acts = document.createElement('span');
      acts.className = 'ojc-acts';
      const save = mkBtn('ojc-act-save', '💾 Save', 'keep this one in My jobs');
      const applied = mkBtn('ojc-act-applied', L.mine.apply, L.mine.applyTip);
      const pass = mkBtn('ojc-act-pass', '✕ Not for me', 'hide this listing for good (you can undo)');
      // The site's card navigates on click; our buttons must not.
      for (const b of [save, applied, pass]) b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
      save.addEventListener('click', () => decide(card, M.stateOf(jobs, idOf(card)) === 'saved' ? null : 'saved'));
      applied.addEventListener('click', () => decide(card, M.stateOf(jobs, idOf(card)) === 'applied' ? null : 'applied'));
      pass.addEventListener('click', () => decide(card, M.stateOf(jobs, idOf(card)) === 'passed' ? null : 'passed'));
      acts.append(save, applied, pass);
      card.appendChild(acts);
    }
    const save = acts.querySelector('.ojc-act-save'), applied = acts.querySelector('.ojc-act-applied'), pass = acts.querySelector('.ojc-act-pass');
    save.textContent = state === 'saved' ? '✓ Saved' : '💾 Save';
    save.classList.toggle('is-on', state === 'saved');
    save.hidden = done;                                                   // applied & beyond: the Applied button speaks
    applied.textContent = done ? `✓ ${cap(state)}` : L.mine.apply;
    applied.classList.toggle('is-on', done);
    applied.disabled = done && state !== 'applied';                       // interview, offer: move it in My jobs
    applied.title = state === 'applied' ? L.mine.undoApplyTip : applied.disabled ? L.mine.laterTip : L.mine.applyTip;
    pass.textContent = state === 'passed' ? '↶ Show again' : '✕ Not for me';
    acts.hidden = !id;
    // D77: a job you applied to is your call, and a word filter must not take it off your board. Only the
    // content rules give way (a blocked word, no pay listed, a gig with no hours); too old and closed still hide.
    if (done && card.hidden && UNHIDE[tier]) { card.hidden = false; counts[UNHIDE[tier]]--; }
    stamp(card, entry, done);
    // D77: applied cards stay on the board, dimmed, and the 📨 Applied pill shows only them (and their reposts).
    card.classList.toggle('ojc-done', done);
    box.querySelector(':scope > .ojc-repost')?.remove();
    let mine = done;
    if (!state && id && !card.hidden) {                                   // D78: a new post of a role you applied to
      const r = repostFor(id, titleOf(card), companyOf(card));
      if (r) {
        const b = document.createElement('span');
        b.className = 'ojc-repost';
        b.textContent = L.mine.repost(onDay(M.appliedAt(r.entry)), r.sameCompany);
        b.title = L.mine.repostTip(r.entry.title, r.sameCompany);
        box.appendChild(b);
        mine = true;
      }
    }
    if (mine) { card.dataset.ojcView = 'applied'; if (!card.hidden) counts.applied = (counts.applied || 0) + 1; }
    else delete card.dataset.ojcView;
    box.querySelector('.ojc-new')?.remove();
    if (tier !== 'passed' && !card.hidden && V.isNew(at, cutoff)) {
      const b = document.createElement('span');
      b.className = 'ojc-new';
      b.textContent = '● new since last visit';
      b.title = 'posted after you last looked at this search';
      box.prepend(b);
      counts.newSince = (counts.newSince || 0) + 1;
    }
  }
  api.addCardHook(decorate);

  /** The line under a job that is yours: when you applied, where, and the start of your note. */
  function stamp(card, entry, done) {
    let line = card.querySelector(':scope > .ojc-mine');
    const note = entry?.note ? `"${clip(entry.note.replace(/\s+/g, ' '), 90)}"` : '';
    const text = done ? L.mine.stamp(entry.state, ago(M.appliedAt(entry)), entry.via) + (note ? ` · ${note}` : '')
      : entry?.state === 'saved' && note ? `${L.mine.savedNote} · ${note}` : '';
    if (!text) { line?.remove(); return; }
    if (!line) {
      line = document.createElement('div');
      line.className = 'ojc-mine';
      line.title = L.mine.stampTip;
      card.insertBefore(line, card.querySelector(':scope > .ojc-glance, :scope > .ojc-acts'));
    }
    line.classList.toggle('is-done', done);
    if (line.textContent !== text) line.textContent = text;
  }

  // ── new since last visit (D54) ──────────────────────────────────────────
  async function startVisit() {
    if (!api.LIST_RE.test(location.pathname)) return;
    visitKey = V.searchKey(location.href);
    visits = (await chrome.storage.local.get('visits')).visits || {};
    const opened = V.open(visits[visitKey], Date.now());
    cutoff = opened.cutoff;
    visits = V.prune({ ...visits, [visitKey]: opened.entry }, Date.now());
    await chrome.storage.local.set({ visits });
    api.refreshRules();
  }
  const touch = () => {
    if (!visitKey || self.OJCBackup?.restoring) return;   // D79: a restore is replacing this key
    visits = { ...visits, [visitKey]: V.touch(visits[visitKey], Date.now()) };
    chrome.storage.local.set({ visits });
  };
  setInterval(touch, 60 * 1000);
  addEventListener('pagehide', touch);

  // ── the suggested block word (D53) ──────────────────────────────────────
  function suggestion() {
    const all = Object.values(jobs);
    const s = api.getSettings();
    return SG.suggest({
      passed: all.filter(e => e.state === 'passed' && e.sig).map(e => e.sig),
      kept: all.filter(e => e.state !== 'passed' && e.sig).map(e => e.sig),
      existing: [...(s.negative || []), ...(s.positive || [])],
      dismissed: ui.dismissedSuggestions || [],
    }, { max: 1 })[0] || null;
  }
  async function block(word) {
    const before = { ...api.getSettings() };
    api.setSettings({ ...before, negative: [...(before.negative || []), word] });
    api.refreshRules();
    api.persist();
    self.OJCToast?.show(`Blocked "${word}"`, { action: { label: L.btn.undo, run: () => { api.setSettings(before); api.refreshRules(); api.persist(); } } });
  }
  async function dismiss(word) {
    ui = { ...ui, dismissedSuggestions: [...new Set([...(ui.dismissedSuggestions || []), word])] };
    await chrome.storage.local.set({ ui });
    api.refreshRules();
  }

  // ── the bar's buttons ───────────────────────────────────────────────────
  const bar = self.OJCChip;
  bar?.addAction({ id: 'ojc-btn-suggest', order: 8,
    text: () => { const g = suggestion(); return g ? `Block "${g.word}"?` : ''; },
    hidden: () => !suggestion(),
    title: 'seen in most of the jobs you passed on, and almost none you kept — click to block it',
    onClick: () => { const g = suggestion(); if (g) block(g.word); } });
  bar?.addAction({ id: 'ojc-btn-suggest-x', order: 9, text: '✕', title: 'not this word — never suggest it again',
    hidden: () => !suggestion(), onClick: () => { const g = suggestion(); if (g) dismiss(g.word); } });
  bar?.addAction({ id: 'ojc-btn-streak', order: 6,
    text: () => { const g = Number(api.getSettings().weeklyApplyGoal) || 0, s = M.streak(jobs, Date.now()); return `${s.days ? '🔥 ' + s.days + 'd · ' : '📨 '}${s.week}/${g}`; },
    hidden: () => !(Number(api.getSettings().weeklyApplyGoal) > 0),
    title: 'your streak (days in a row with an application) and applications this week against your weekly goal — click for My jobs',
    onClick: () => window.open(chrome.runtime.getURL('jobs.html'), '_blank') });
  bar?.addAction({ id: 'ojc-btn-swipe', order: 1, text: '🃏 Swipe', title: 'go through the board one card at a time (keyboard: ← pass, → save, ↑ applied)',
    onClick: () => self.OJCSwipe?.open() });
  bar?.addAction({ id: 'ojc-btn-myjobs', order: 2,
    text: () => { const c = M.counts(jobs); const n = c.saved + c.applied + c.interview + c.offer; return n ? `📋 My jobs ${n}` : '📋 My jobs'; },
    title: 'everything you saved and applied to, with follow-up reminders',
    onClick: () => window.open(chrome.runtime.getURL('jobs.html'), '_blank') });

  // ── boot ────────────────────────────────────────────────────────────────
  chrome.storage.local.get(['myJobs', 'ui'], (r) => {
    jobs = r.myJobs || {};
    doneIdx = null;
    ui = r.ui || {};
    startVisit();
    api.refreshRules();
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.myJobs) { jobs = ch.myJobs.newValue || {}; doneIdx = null; }
    if (ch.ui) ui = ch.ui.newValue || {};
    if (ch.myJobs || ch.ui) api.refreshRules();
  });

  self.OJCTriage = {
    isPassed: (card) => M.isPassed(jobs, idOf(card)),
    decide, idOf, factsOf, stateOf: (card) => M.stateOf(jobs, idOf(card)),
    newCount: () => newCount, all: () => jobs,
  };
})();
