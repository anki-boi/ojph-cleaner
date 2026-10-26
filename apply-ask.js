/**
 * apply-ask.js: "Did you apply?" (spec.md D76).
 *
 * Most listings send you somewhere else to apply: a Google Form, a careers page, an email. That moment happens off
 * this site, so nothing here can see it, and a job you applied to looked like any other the next day. What this
 * file CAN see is the step just before: on a listing's page you copy something from the post (OnlineJobs.ph blanks
 * the links themselves, so an address is copied by hand), open a link the post still carries, or press the site's
 * own Apply button. That arms one question. When you come back to the tab after a real absence, a small card asks
 * "Did you apply?" with the place filled in; one click files the job as Applied in My jobs, then offers a note.
 *
 * Nothing is ever marked on its own: the question is the whole feature. It is per tab (sessionStorage), so it
 * survives leaving the page and coming back with Back, and it is forgotten after a few hours. ⚙ (or "Stop asking"
 * on the card) turns it off: `settings.askApplied === false`.
 */
(() => {
  'use strict';
  if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) return;
  const M = self.OJCMyJobsPure, L = self.OJCLabels, closed = self.OJClosed;
  if (!M || !L || !closed) return;
  const KEY = 'ojc-apply-pending';
  const AWAY_MS = 8000;              // away for less than this was a glance at another tab, not an application
  const KEEP_MS = 6 * 3600 * 1000;   // a question nobody came back to answer is dropped
  const SITE = 'OnlineJobs.ph';
  const DESC_SEL = 'p#job-description';
  const jobId = /\/jobseekers\/job\//.test(location.pathname) ? closed.jobIdFrom(location.pathname) : null;
  // The site's own application form posts to /apply; asking there would interrupt the application itself.
  const composing = /^\/apply\/?$/.test(location.pathname);

  let settings = {}, jobs = {}, away = 0, card = null;

  const read = () => {
    try { const p = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return p && Date.now() - p.at < KEEP_MS ? p : null; }
    catch { return null; }
  };
  const keep = (p) => { try { if (p) sessionStorage.setItem(KEY, JSON.stringify(p)); else sessionStorage.removeItem(KEY); } catch { /* storage blocked: no question */ } };
  const text = (sel) => (document.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
  const off = () => settings.askApplied === false;

  const hostOf = M.hostOf, pointsTo = M.whereFrom;

  // ── arming the question ─────────────────────────────────────────────────
  function arm(kind, via) {
    if (!jobId || off() || M.isDone(jobs[jobId])) return;
    keep({ id: jobId, kind, via: via || null, at: Date.now(),
      title: text('h1') || document.title.replace(/\s*[-|].*$/, ''), url: location.href.split('#')[0], pay: text('#ojc-detail-bar .ojc-bar-pay') });
  }

  if (jobId) {
    document.addEventListener('click', (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest('[id^="ojc-"]')) return;
      if (t.closest('form[action="/apply"] button, form[action="/apply"] [type=submit], a.apply-from-blur')) return arm('site', SITE);
      const a = t.closest(`${DESC_SEL} a[href]`);
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (/^mailto:/i.test(href)) return arm('email', decodeURIComponent(href.slice(7).split('?')[0]));
      const host = hostOf(a.href);
      if (host && !/(^|\.)onlinejobs\.ph$/i.test(host)) arm('link', host);
    }, true);
    document.addEventListener('copy', () => {
      const sel = document.getSelection();
      const s = sel ? String(sel).trim() : '';
      const at = sel?.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      if (s.length < 4 || !at?.closest?.(DESC_SEL)) return;
      const p = pointsTo(s);
      arm(p.kind, p.via);
    }, true);
  }

  // ── asking ──────────────────────────────────────────────────────────────
  function maybeAsk() {
    const p = read();
    if (!p || composing || card?.isConnected) return;
    if (off() || M.isDone(jobs[p.id])) { keep(null); return; }
    if (Date.now() - p.at < AWAY_MS) return;
    show(p);
  }

  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
  const btn = (cls, txt, fn) => { const b = el('button', cls, txt); b.type = 'button'; b.onclick = fn; return b; };
  const close = () => { card?.remove(); card = null; };

  function show(p) {
    close();
    card = el('div');
    card.id = 'ojc-ask';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', L.mine.ask('', null));
    const why = p.kind === 'link' ? L.mine.askWhy.link(p.via) : p.kind === 'email' ? L.mine.askWhy.email(p.via)
      : p.kind === 'site' ? L.mine.askWhy.site : L.mine.askWhy.copy;
    const x = btn('ojc-ask-x', '✕', close);
    x.title = L.mine.close;
    x.setAttribute('aria-label', L.mine.close);
    card.append(x, el('b', null, L.mine.ask(p.title, p.via)), el('small', null, why),
      el('div', 'ojc-ask-btns'));
    card.lastChild.append(
      btn('ojc-ask-yes', L.mine.yes, () => yes(p)),
      btn('ojc-ask-no', L.mine.notYet, () => { keep(null); close(); }),
      btn('ojc-ask-never', L.mine.never, never));
    document.body.appendChild(card);
    card.querySelector('.ojc-ask-yes').focus({ preventScroll: true });
  }

  async function yes(p) {
    const before = jobs;
    jobs = M.prune(M.set(jobs, p.id, 'applied', Date.now(), { title: p.title, url: p.url, pay: p.pay, via: p.via }), Date.now());
    keep(null);
    await chrome.storage.local.set({ myJobs: jobs });
    self.OJCToast?.show(L.mine.done(p.title), { action: { label: L.btn.undo, run: async () => { jobs = before; await chrome.storage.local.set({ myJobs: jobs }); close(); } } });
    // The same card becomes the note: the moment you applied is when you remember what you sent.
    card.querySelector('b').textContent = L.mine.done(p.title);
    card.querySelector('small').textContent = '';
    const input = el('input');
    input.type = 'text';
    input.placeholder = L.mine.notePh;
    input.setAttribute('aria-label', L.mine.notePh);
    const saveNote = async () => {
      if (input.value.trim()) {
        jobs = M.note(jobs, p.id, input.value);
        await chrome.storage.local.set({ myJobs: jobs });
        self.OJCToast?.show(L.mine.noteSaved);
      }
      close();
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') saveNote(); if (e.key === 'Escape') close(); };
    const btns = card.querySelector('.ojc-ask-btns');
    btns.replaceChildren(btn('ojc-ask-yes', L.mine.noteSave, saveNote), btn('ojc-ask-no', L.mine.close, close));
    card.querySelector('small').replaceWith(input);
    input.focus();
  }

  /** "Stop asking": one settings field, merged into what is stored (the panel's form owns the rest). */
  async function setAsk(on) {
    const { settings: stored } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(stored || {}), askApplied: on } });
  }
  async function never() {
    keep(null);
    close();
    await setAsk(false);
    self.OJCToast?.show(L.mine.neverDone, { action: { label: L.btn.undo, run: () => setAsk(true) } });
  }

  // Away and back: the tab hidden (another tab, a minimized window) or the window losing focus (a mail app).
  const leave = () => { if (!away) away = Date.now(); };
  const back = () => {
    if (document.hidden) return;
    const was = away;
    away = 0;
    if (was && Date.now() - was >= AWAY_MS) maybeAsk();
  };
  document.addEventListener('visibilitychange', () => (document.hidden ? leave() : back()));
  addEventListener('blur', leave);
  addEventListener('focus', back);
  // Back to the page through the back button (bfcache) or a fresh load: the question was armed before you left.
  addEventListener('pageshow', (e) => { if (e.persisted) maybeAsk(); });

  chrome.storage.local.get(['settings', 'myJobs'], (r) => {
    settings = r.settings || {};
    jobs = r.myJobs || {};
    maybeAsk();
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.settings) settings = ch.settings.newValue || {};
    if (ch.myJobs) jobs = ch.myJobs.newValue || {};
  });

  self.OJCApplyAsk = { pointsTo, maybeAsk };
})();
