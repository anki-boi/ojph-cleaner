/**
 * triage.js — your own calls on the board (spec.md W20): ✕ Not for me and 💾 Save on every card (D51), "new
 * since your last visit" (D54), the suggested block word (D53), and the bar's 🃏 Swipe and 📋 My jobs buttons.
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
  function factsOf(card) {
    const a = linkOf(card);
    return {
      title: own(card.querySelector('dt h4')) || own(a),
      // "Company • Posted on …" — and a card with no company is just "Posted on …", which is not a company.
      company: (([co, rest]) => (rest !== undefined ? co.trim() : ''))(own(card.querySelector(api.SELECTORS.cardPosted)).split(/[•·]/)),
      url: a ? new URL(a.getAttribute('href'), location.href).href : '',
      pay: card.querySelector('.ojc-salary-note')?.textContent || own(card.querySelector(api.SELECTORS.cardSalary)).slice(0, 60),
      sig: SG.signature(api.ownText(card)),
    };
  }

  // ── storage ─────────────────────────────────────────────────────────────
  const write = (next) => { jobs = M.prune(next, Date.now()); return chrome.storage.local.set({ myJobs: jobs }); };

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

  // ── the card hook: buttons, the "new" mark ──────────────────────────────
  function decorate(card, { tier, box, at, counts }) {
    const id = idOf(card);
    const state = M.stateOf(jobs, id);
    let acts = card.querySelector(':scope > .ojc-acts');
    if (!acts) {
      acts = document.createElement('span');
      acts.className = 'ojc-acts';
      const mk = (cls, label, title) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label; b.title = title; return b; };
      const save = mk('ojc-act-save', '💾 Save', 'keep this one in My jobs');
      const pass = mk('ojc-act-pass', '✕ Not for me', 'hide this listing for good (you can undo)');
      // The site's card navigates on click; our buttons must not.
      for (const b of [save, pass]) b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
      save.addEventListener('click', () => decide(card, M.stateOf(jobs, idOf(card)) === 'saved' ? null : 'saved'));
      pass.addEventListener('click', () => decide(card, M.stateOf(jobs, idOf(card)) === 'passed' ? null : 'passed'));
      acts.append(save, pass);
      card.appendChild(acts);
    }
    const save = acts.querySelector('.ojc-act-save'), pass = acts.querySelector('.ojc-act-pass');
    save.textContent = state && state !== 'passed' ? `✓ ${cap(state)}` : '💾 Save';
    save.classList.toggle('is-on', !!state && state !== 'passed');
    save.disabled = !!state && !['saved', 'passed'].includes(state);   // applied & beyond: move it in My jobs
    pass.textContent = state === 'passed' ? '↶ Show again' : '✕ Not for me';
    acts.hidden = !id;
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
    if (!visitKey) return;
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
  bar?.addAction({ id: 'ojc-btn-suggest', order: 1,
    text: () => { const g = suggestion(); return g ? `Block "${g.word}"?` : ''; },
    hidden: () => !suggestion(),
    title: 'seen in most of the jobs you passed on, and almost none you kept — click to block it',
    onClick: () => { const g = suggestion(); if (g) block(g.word); } });
  bar?.addAction({ id: 'ojc-btn-suggest-x', order: 2, text: '✕', title: 'not this word — never suggest it again',
    hidden: () => !suggestion(), onClick: () => { const g = suggestion(); if (g) dismiss(g.word); } });
  bar?.addAction({ id: 'ojc-btn-streak', order: 4,
    text: () => { const g = Number(api.getSettings().weeklyApplyGoal) || 0, s = M.streak(jobs, Date.now()); return `${s.days ? '🔥 ' + s.days + 'd · ' : '📨 '}${s.week}/${g}`; },
    hidden: () => !(Number(api.getSettings().weeklyApplyGoal) > 0),
    title: 'your streak (days in a row with an application) and applications this week against your weekly goal — click for My jobs',
    onClick: () => window.open(chrome.runtime.getURL('jobs.html'), '_blank') });
  bar?.addAction({ id: 'ojc-btn-swipe', order: 5, text: '🃏 Swipe', title: 'go through the board one card at a time (keyboard: ← pass, → save, ↑ applied)',
    onClick: () => self.OJCSwipe?.open() });
  bar?.addAction({ id: 'ojc-btn-myjobs', order: 6,
    text: () => { const c = M.counts(jobs); const n = c.saved + c.applied + c.interview + c.offer; return n ? `📋 My jobs ${n}` : '📋 My jobs'; },
    title: 'everything you saved and applied to, with follow-up reminders',
    onClick: () => window.open(chrome.runtime.getURL('jobs.html'), '_blank') });

  // ── boot ────────────────────────────────────────────────────────────────
  chrome.storage.local.get(['myJobs', 'ui'], (r) => {
    jobs = r.myJobs || {};
    ui = r.ui || {};
    startVisit();
    api.refreshRules();
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.myJobs) jobs = ch.myJobs.newValue || {};
    if (ch.ui) ui = ch.ui.newValue || {};
    if (ch.myJobs || ch.ui) api.refreshRules();
  });

  self.OJCTriage = {
    isPassed: (card) => M.isPassed(jobs, idOf(card)),
    decide, idOf, factsOf, stateOf: (card) => M.stateOf(jobs, idOf(card)),
    newCount: () => newCount, all: () => jobs,
  };
})();
