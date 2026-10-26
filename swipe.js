/**
 * swipe.js — the board one card at a time (spec.md D52). Keyboard first:
 *
 *   ←  not for me (hidden for good)     →  save      ↑  applied      Enter  open the post      Z  undo      Esc  close
 *
 * It walks the cards the board is showing right now, in the board's order — so a tier pill or a pay sort
 * decides what you swipe through. Every decision goes through triage.js (the same `myJobs` store, the same
 * Undo), so swiping and the card buttons can never disagree.
 *
 * The whole post, not the card's preview (D84). A post Read posts has opened is already kept (IndexedDB, 7 days,
 * records-store.js), so it shows at once. One that has not been read is fetched when you reach it, the same single
 * request as Open post, and kept the same way (records.absorb, so its verdict updates too); the next card's post
 * is fetched while you read this one, one request at a time. A refusal from the site (429) stops the fetching
 * for the rest of the swipe, and the preview stays.
 */
(() => {
  'use strict';
  if (typeof document === 'undefined' || typeof chrome === 'undefined') return;
  const api = self.OJC;
  if (!api) return;

  let node = null, deck = [], at = 0, done = [];   // done: [{ card, prev }] for Z

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const ownText = (x) => (x ? api.ownText(x).replace(/\s+/g, ' ').trim() : '');

  // ── the full post (D84) ──
  const R = self.OJCRecordsUI;
  const idOf = (card) => self.OJCTriage?.idOf?.(card) || null;
  const linkOf = (card) => card.querySelector('a[href*="/jobseekers/job/"]');
  const fullOf = (card) => { const id = idOf(card); return id ? R?.descFor?.(id) || null : null; };
  const fetching = new Map();   // id → promise, so a card is never fetched twice
  let refused = false, queue = Promise.resolve();
  /** One post, one request, queued behind any other this swipe has asked for. Resolves when it is kept (or not). */
  function fetchFull(card) {
    const id = idOf(card), a = linkOf(card);
    if (!id || !a || !R?.absorb || refused || fullOf(card)) return Promise.resolve();
    if (!fetching.has(id)) {
      fetching.set(id, queue = queue.then(async () => {
        if (refused || !node) return;
        try {
          const res = await fetch(a.href, { credentials: 'same-origin' });
          if (res.status === 429) { refused = true; return; }
          if (!res.ok) return;
          const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
          await R.absorb(id, doc, { url: a.href, card: api.cardFactsOf(card), closed: false, stale: false, noSalary: false });
          await self.OJCSalaryUI?.annotate?.();   // the post's own hours: the card's hourly figure, before it is drawn again
        } catch { /* offline: the preview stays */ }
      }));
    }
    return fetching.get(id);
  }
  /** Show this card's post in full; fetch it first when it has not been read, then the next one in the deck. */
  function fill(card, p, figs) {
    const full = fullOf(card);
    const settings = api.getSettings();
    FG = FG || self.OJCFigures || null;
    // Posts space every line with blank ones; one line each reads as the post, without screens of white.
    if (full) p.textContent = full.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
    // D85: the same marks and the same bar as the post's own page (figures.js), so the two never disagree.
    const marks = FG ? FG.highlight(p, settings) : null;
    if (full) { p.classList.remove('is-preview'); if (FG) figures(card, marks, figs, settings); }
    else if (!refused) {
      p.classList.add('is-preview');
      p.dataset.note = 'Loading the full post…';
      // Fetched while still on screen: draw the card again, so At a glance (made from the post) appears too.
      fetchFull(card).then(() => { if (p.isConnected && fullOf(card)) render(); else delete p.dataset.note; });
    }
    if (self.OJCScan?.isRunning?.()) return;   // Read posts is already fetching; one prefetch would be a third request
    const next = deck[deck.indexOf(card) + 1];
    if (next && !fullOf(next)) fetchFull(next);
  }

  // figures.js loads after this file (it sits beside detail.js), so it is looked up when a card is drawn.
  let FG = null;
  /** The figures bar from the kept post's own fields (WAGE, HOURS PER WEEK, TYPE OF WORK), at the live rate. */
  async function figures(card, marks, host, settings) {
    const row = R?.textFor?.(idOf(card));
    if (!row || !host) return;
    const fl = row.fields || {};
    let rates = {};
    const want = FG.currencies(fl.wage, settings);
    if (want.length) { try { rates = (await self.OJCSalaryUI?.loadRates?.(want)) || {}; } catch { rates = {}; } }
    const f = FG.facts({ posted: fl.wage, hoursRaw: fl.hoursPerWeek != null ? String(fl.hoursPerWeek) : '', typeRaw: fl.typeOfWork }, rates);
    const media = self.OJCMediaAsk?.find(row.desc || '');   // D86
    host.replaceChildren(FG.bar(FG.items(f, { settings, rates, marks, media, closed: !!row.closed })));
    host.previousElementSibling?.matches('.ojc-sw-sub') && (host.previousElementSibling.hidden = true);   // the bar says it better
  }

  function face(card) {
    const T = self.OJCTriage;
    const f = T.factsOf(card);
    const wrap = el('div', 'ojc-sw-face');
    const marks = el('div', 'ojc-sw-marks');
    for (const b of card.querySelectorAll('.ojc-badges > span')) marks.appendChild(el('span', b.className, b.textContent));
    const state = T.stateOf(card);
    if (state) marks.appendChild(el('span', 'ojc-sw-state', state));
    const desc = ownText(card.querySelector('.desc') || card).replace(/\s*See More\s*$/i, '').slice(0, 700).replace(/[.…\s]+$/, '');
    const descP = el('p', 'ojc-sw-desc', desc + '…');
    const figs = el('div', 'ojc-sw-figs');
    wrap.append(marks, el('h3', null, f.title || 'Untitled'), el('p', 'ojc-sw-co', f.company),
      el('p', 'ojc-sw-pay', card.querySelector('.ojc-salary-note')?.textContent || ownText(card.querySelector(api.SELECTORS.cardSalary))),
      el('p', 'ojc-sw-sub', [card.querySelector('.ojc-salary-warn')?.textContent, card.querySelector('.ojc-hours')?.textContent].filter(Boolean).join(' · ')),
      figs, descP);
    fill(card, descP, figs);
    // At a glance (D60), when the post has been read: the fastest way to decide, so it goes first in line.
    const g = self.OJCGlanceUI?.modelFor?.(card);
    if (g && (g.doing.length || g.want.length)) {
      const box = el('div', 'ojc-sw-glance');
      for (const [label, lines] of [["You'd do", g.doing], ['They want', g.want]]) {
        if (!lines.length) continue;
        const ul = el('ul');
        for (const l of lines) ul.appendChild(el('li', null, l));
        box.append(el('b', null, label), ul);
      }
      wrap.insertBefore(box, wrap.querySelector('.ojc-sw-desc'));
    }
    return wrap;
  }

  function render() {
    const body = node.querySelector('.ojc-sw-body');
    body.innerHTML = '';
    body.scrollTop = 0;   // every job starts at its title, whatever the last one was scrolled to
    node.querySelector('.ojc-sw-count').textContent = at < deck.length ? `${at + 1} of ${deck.length}` : `${deck.length} of ${deck.length}`;
    node.querySelector('#ojc-sw-undo').disabled = !done.length;
    if (at >= deck.length) {
      body.append(el('div', 'ojc-sw-end', deck.length ? "That's the board. 🎉" : 'Nothing on the board to go through.'),
        el('p', 'ojc-sw-sub', 'Your saved and applied jobs are in 📋 My jobs.'));
      for (const b of node.querySelectorAll('.ojc-sw-acts button[data-act]')) b.disabled = true;
      return;
    }
    for (const b of node.querySelectorAll('.ojc-sw-acts button[data-act]')) b.disabled = false;
    body.appendChild(face(deck[at]));
  }

  async function act(kind) {
    const card = deck[at];
    if (!card) return;
    if (kind === 'open') { const a = card.querySelector('a[href*="/jobseekers/job/"]'); if (a) window.open(a.href, '_blank', 'noopener'); return; }
    const T = self.OJCTriage;
    done.push({ card, prev: T.stateOf(card) });
    await T.decide(card, kind, { quiet: true });
    at++;
    render();
  }

  async function undo() {
    const last = done.pop();
    if (!last) return;
    await self.OJCTriage.decide(last.card, last.prev, { quiet: true });
    at = Math.max(0, deck.indexOf(last.card));
    render();
  }

  function close() {
    if (!node) return;
    node.remove();
    node = null;
    document.removeEventListener('keydown', onKey, true);
    if (done.length) self.OJCToast?.show(`${done.length} decision${done.length === 1 ? '' : 's'} saved — see 📋 My jobs`);
    api.refreshRules();
  }

  function onKey(e) {
    if (!node || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = { ArrowLeft: 'passed', ArrowRight: 'saved', ArrowUp: 'applied', Enter: 'open' }[e.key];
    if (k) { e.preventDefault(); e.stopPropagation(); act(k); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undo(); }
  }

  function open() {
    if (node || !self.OJCTriage) return;
    deck = api.cards().filter(c => !c.hidden);
    at = 0;
    done = [];
    refused = false;   // a new swipe tries again
    fetching.clear();
    node = el('div');
    node.id = 'ojc-swipe';
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-modal', 'true');
    node.setAttribute('aria-label', 'Swipe through jobs');
    const card = el('div', 'ojc-sw-card');
    const top = el('div', 'ojc-sw-top');
    const x = el('button', 'ojc-sw-close', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.onclick = close;
    top.append(el('b', null, '🃏 Swipe'), el('span', 'ojc-sw-count'), x);
    const acts = el('div', 'ojc-sw-acts');
    const btn = (act_, label, hint, cls) => {
      const b = el('button', cls); b.type = 'button'; b.dataset.act = act_;
      b.append(el('span', null, label), el('kbd', null, hint));
      b.onclick = () => act(act_);
      return b;
    };
    const undoB = el('button', 'ojc-sw-undo');
    undoB.id = 'ojc-sw-undo';
    undoB.type = 'button';
    undoB.append(el('span', null, '↶ Undo'), el('kbd', null, 'Z'));
    undoB.onclick = undo;
    acts.append(btn('passed', '✕ Not for me', '←', 'is-pass'), undoB, btn('open', 'Open post', 'Enter'),
      btn('applied', '✓ Applied', '↑'), btn('saved', '💾 Save', '→', 'is-save'));
    card.append(top, el('div', 'ojc-sw-body'), acts);
    node.appendChild(card);
    node.addEventListener('click', (e) => { if (e.target === node) close(); });
    document.body.appendChild(node);
    document.addEventListener('keydown', onKey, true);
    render();
  }

  self.OJCSwipe = { open, close };
})();
