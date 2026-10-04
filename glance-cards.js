/**
 * glance-cards.js — the folded "At a glance" on every card whose post has been read (spec.md D60).
 *
 * The extraction is glance.js (the post's own words, from its own sections); this only places it: a <details>
 * at the bottom of the card, closed, so the board stays as short as it was. Its risk reasons (risk.js) ride
 * along as "Watch out", the same text the ⚠ tag shows on hover.
 */
(() => {
  'use strict';
  if (typeof document === 'undefined' || typeof chrome === 'undefined') return;
  const api = self.OJC;
  if (!api) return;
  const G = self.OJCGlance;
  const cache = new Map();   // id → { len, html-free model } — re-extracted only when the cached text changes

  function model(id) {
    const text = self.OJCRecordsUI?.descFor?.(id);
    if (!text) return null;
    const hit = cache.get(id);
    if (hit && hit.len === text.length) return hit.g;
    const g = G.extract(text);
    cache.set(id, { len: text.length, g });
    return g;
  }

  function decorate(card) {
    const id = self.OJCRecordsUI?.idOf?.(card);
    const g = id ? model(id) : null;
    let box = card.querySelector(':scope > .ojc-glance');
    if (!g || G.isEmpty(g) || card.hidden) { if (box) box.hidden = true; return; }
    if (!box) {
      box = document.createElement('details');
      box.className = 'ojc-glance';
      // Opening it must not follow the card's own link.
      box.addEventListener('click', (e) => e.stopPropagation());
      const acts = card.querySelector(':scope > .ojc-acts');
      card.insertBefore(box, acts || null);
    }
    box.hidden = false;
    const key = JSON.stringify(g);
    if (box.dataset.k === key) return;   // unchanged: touch nothing, so a pass costs nothing
    box.dataset.k = key;
    box.innerHTML = '';
    const sum = document.createElement('summary');
    sum.textContent = 'At a glance';
    box.appendChild(sum);
    for (const [label, lines] of [["You'd do", g.doing], ['They want', g.want]]) {
      if (!lines.length) continue;
      const h = document.createElement('b');
      h.textContent = label;
      const ul = document.createElement('ul');
      for (const l of lines) { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); }
      box.append(h, ul);
    }
  }

  api.addCardHook(decorate);
  self.OJCGlanceUI = { modelFor: (card) => { const id = self.OJCRecordsUI?.idOf?.(card); return id ? model(id) : null; } };
})();
