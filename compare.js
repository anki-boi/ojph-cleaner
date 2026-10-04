/**
 * compare.js — pin up to three jobs and see them side by side (spec.md D62).
 *
 * Pins are per tab (sessionStorage): a comparison is a moment's work, not a preference, and a pin that followed
 * you into tomorrow's search would be a stale one. What a pinned card SAID is kept with the pin, so a job that
 * scrolled off, or came from another page of the search, still compares.
 */
(() => {
  'use strict';
  if (typeof document === 'undefined' || typeof chrome === 'undefined') return;
  const api = self.OJC;
  if (!api) return;
  const MAX = 3, KEY = 'ojc-pins';
  const idOf = (card) => self.OJCRecordsUI?.idOf?.(card) || self.OJCTriage?.idOf?.(card) || null;
  let pins = [];
  try { pins = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { pins = []; }
  const keep = () => { try { sessionStorage.setItem(KEY, JSON.stringify(pins)); } catch { /* private mode: pins live in memory */ } };

  const txt = (card, sel) => card.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() || '';
  function snapshot(card) {
    const f = self.OJCTriage?.factsOf?.(card) || {};
    const tags = (cls) => [...card.querySelectorAll(`.ojc-badges > ${cls}`)].map(b => b.textContent).join(' · ');
    return {
      id: idOf(card), title: f.title || txt(card, 'dt h4'), company: f.company || '', url: f.url || '',
      pay: txt(card, '.ojc-salary-note') || txt(card, api.SELECTORS.cardSalary),
      goal: card.classList.contains('ojc-goal') ? (txt(card, '.ojc-salary-note') ? 'meets your minimum' : '') : 'below your minimum',
      hours: txt(card, '.ojc-hours') || (txt(card, '.ojc-salary-warn') ? txt(card, '.ojc-salary-warn') : ''),
      when: tags('.ojc-sched'), risk: tags('.ojc-risk') || 'no warning signs found',
      fit: txt(card, '.ojc-fit'), posted: txt(card, api.SELECTORS.cardPosted).split(/[•·]/).pop().trim(),
      marks: [tags('.ojc-pos-badge'), tags('.ojc-neg-badge'), tags('.ojc-flag-badge'), tags('.ojc-again')].filter(Boolean).join(' · '),
    };
  }

  function toggle(card) {
    const id = idOf(card);
    if (!id) return;
    if (pins.some(p => p.id === id)) pins = pins.filter(p => p.id !== id);
    else if (pins.length >= MAX) { self.OJCToast?.show(`Compare holds ${MAX} jobs — unpin one first.`); return; }
    else pins = [...pins, snapshot(card)];
    keep();
    api.refreshRules();
  }

  function decorate(card) {
    const acts = card.querySelector(':scope > .ojc-acts');
    if (!acts) return;
    let b = acts.querySelector('.ojc-act-pin');
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'ojc-act-pin';
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggle(card); });
      acts.prepend(b);
    }
    const on = pins.some(p => p.id === idOf(card));
    b.textContent = on ? '📌 Pinned' : '📌';
    b.title = on ? 'unpin from Compare' : `pin to compare side by side (up to ${MAX})`;
    b.classList.toggle('is-on', on);
  }
  api.addCardHook(decorate);

  const ROWS = [['Pay', 'pay'], ['Your minimum', 'goal'], ['Hours', 'hours'], ['When (your time)', 'when'],
    ['Warning signs', 'risk'], ['Resume fit', 'fit'], ['Posted', 'posted'], ['Marks', 'marks']];
  let node = null;
  function close() { node?.remove(); node = null; }
  function open() {
    close();
    node = document.createElement('div');
    node.id = 'ojc-compare';
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', 'Compare pinned jobs');
    const card = document.createElement('div');
    card.className = 'ojc-cmp-card';
    const top = document.createElement('div');
    top.className = 'ojc-cmp-top';
    top.innerHTML = '<b>📌 Compare</b>';
    const x = document.createElement('button');
    x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Close'); x.onclick = close;
    top.appendChild(x);
    const table = document.createElement('table');
    const head = table.insertRow();
    head.appendChild(document.createElement('th'));
    for (const p of pins) {
      const th = document.createElement('th');
      const a = document.createElement(p.url ? 'a' : 'span');
      if (p.url) { a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; }
      a.textContent = p.title || 'Untitled';
      const co = document.createElement('small'); co.textContent = p.company;
      const un = document.createElement('button');
      un.type = 'button'; un.textContent = 'unpin';
      un.onclick = () => { pins = pins.filter(q => q.id !== p.id); keep(); api.refreshRules(); pins.length ? open() : close(); };
      th.append(a, co, un);
      head.appendChild(th);
    }
    for (const [label, k] of ROWS) {
      if (!pins.some(p => p[k])) continue;
      const tr = table.insertRow();
      const th = document.createElement('th'); th.textContent = label; tr.appendChild(th);
      for (const p of pins) { const td = tr.insertCell(); td.textContent = p[k] || '—'; }
    }
    card.append(top, table);
    node.appendChild(card);
    node.addEventListener('click', (e) => { if (e.target === node) close(); });
    document.body.appendChild(node);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && node) close(); });

  self.OJCChip?.addAction({ id: 'ojc-btn-compare', order: 3, text: () => `📌 Compare ${pins.length}`,
    hidden: () => !pins.length, title: 'see your pinned jobs side by side', onClick: open });
  self.OJCCompare = { open, close, pins: () => pins.slice() };
})();
