/**
 * swipe.js — the board one card at a time (spec.md D52). Keyboard first:
 *
 *   ←  not for me (hidden for good)     →  save      ↑  applied      Enter  open the post      Z  undo      Esc  close
 *
 * It walks the cards the board is showing right now, in the board's order — so a tier pill or a pay sort
 * decides what you swipe through. Every decision goes through triage.js (the same `myJobs` store, the same
 * Undo), so swiping and the card buttons can never disagree.
 */
(() => {
  'use strict';
  if (typeof document === 'undefined' || typeof chrome === 'undefined') return;
  const api = self.OJC;
  if (!api) return;

  let node = null, deck = [], at = 0, done = [];   // done: [{ card, prev }] for Z

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const ownText = (x) => { if (!x) return ''; const o = x.cloneNode(true); o.querySelectorAll('[class^="ojc-"]').forEach(i => i.remove()); return o.textContent.replace(/\s+/g, ' ').trim(); };

  function face(card) {
    const T = self.OJCTriage;
    const f = T.factsOf(card);
    const wrap = el('div', 'ojc-sw-face');
    const marks = el('div', 'ojc-sw-marks');
    for (const b of card.querySelectorAll('.ojc-badges > span')) marks.appendChild(el('span', b.className, b.textContent));
    const state = T.stateOf(card);
    if (state) marks.appendChild(el('span', 'ojc-sw-state', state));
    const desc = ownText(card.querySelector('.desc') || card).slice(0, 700);
    wrap.append(marks, el('h3', null, f.title || 'Untitled'), el('p', 'ojc-sw-co', f.company),
      el('p', 'ojc-sw-pay', card.querySelector('.ojc-salary-note')?.textContent || ownText(card.querySelector(api.SELECTORS.cardSalary))),
      el('p', 'ojc-sw-sub', [card.querySelector('.ojc-salary-warn')?.textContent, card.querySelector('.ojc-hours')?.textContent].filter(Boolean).join(' · ')),
      el('p', 'ojc-sw-desc', desc + (desc.length >= 700 ? '…' : '')));
    return wrap;
  }

  function render() {
    const body = node.querySelector('.ojc-sw-body');
    body.innerHTML = '';
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
