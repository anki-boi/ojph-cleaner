/**
 * chip.js — the status bar at the top of the results column (spec.md D45/D46, W17).
 *
 * It used to be a panel floating in the bottom-right corner, and it sat on top of the first card's salary
 * (docs/img/list-chip.png). It is now one slim bar, sticky inside the site's own results column, so it scrolls
 * with the board and never covers a card:
 *
 *   [Everything] [⭐ Top picks 14] [🤔 Maybe 2] [💚 Liked 3]   🙈 3 hidden ▾      Read posts  ⚙
 *   ▓▓▓▓▓▓░░░░ Reading posts 12 of 40 · 1 better · 0 worse
 *
 * Two controls that never share a word (D46): the pills choose what you LOOK at; `N hidden ▾` opens the
 * reasons and `Peek at hidden`, which shows what the rules took away. The old panel had a view called "All"
 * beside a button called "Show All" that did something else.
 *
 * **The interactive nodes are persistent.** A rule pass that replaced a button between mousedown and mouseup
 * made the browser dispatch the click on the common ancestor, so the handler never ran (measured live on the
 * old panel). Buttons are built once and only updated; the breakdown rows are rebuilt, because they are not
 * clickable. Ids kept from the panel (#ojc-chip, #ojc-toggle, #ojc-scan, #ojc-gear, .ojc-view
 * [data-view], data-ojc-pass) are what tools/verify-live.mjs holds on to.
 *
 * Reads nothing and decides nothing: content.js hands it the counts and the callbacks. Later waves add their
 * own buttons through `addAction` instead of editing this file.
 */
(() => {
  'use strict';
  if (typeof document === 'undefined') return;
  const L = self.OJCLabels;

  const ID = 'ojc-chip';
  const VIEWS = ['all', 'high', 'worth', 'pos'];
  let ui = null;
  let popOpen = false;
  const actions = [];   // { id, text, title, onClick, order, hidden() } registered by other modules

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (id, cls, text) => { const b = el('button', cls, text); if (id) b.id = id; b.type = 'button'; return b; };

  function build() {
    const bar = document.getElementById(ID) || el('div');
    bar.id = ID;
    bar.className = 'ojc-bar';
    bar.innerHTML = '';
    const row = el('div', 'ojc-bar-row');

    const pills = el('div', 'ojc-pills');
    const viewBtns = {};
    for (const key of VIEWS) {
      const b = button(null, `ojc-view ojc-view-${key}`);
      b.dataset.view = key;
      viewBtns[key] = b;
      pills.appendChild(b);
    }

    // The hidden total is the bar's one <b>: the harness reads `#ojc-chip b` for the "would be hidden" wording.
    const hiddenBtn = button('ojc-hidden-btn', 'ojc-hidden-btn');
    const total = el('b');
    total.id = 'ojc-chip-total';
    const caret = el('span', 'ojc-caret');
    hiddenBtn.append(L.icon.hidden + ' ', total, caret);

    const fresh = el('span', 'ojc-newcount');   // D54: how many cards are new since your last visit
    const spacer = el('span', 'ojc-spacer');
    const extra = el('span', 'ojc-extra');   // buttons other modules register (swipe, my jobs, …)
    const scan = button('ojc-scan', 'ojc-act');
    const gear = button('ojc-gear', 'ojc-act ojc-icon', '⚙');
    gear.setAttribute('aria-label', L.btn.settings);
    gear.title = L.btn.settings;
    row.append(pills, hiddenBtn, fresh, spacer, extra, scan, gear);

    const pop = el('div', 'ojc-pop');
    pop.id = 'ojc-hidden-pop';
    pop.hidden = true;
    const list = el('ul', 'ojc-pop-list');
    const toggle = button('ojc-toggle', 'ojc-peek');
    pop.append(list, toggle);

    const status = el('div', 'ojc-bar-status');
    const progress = el('span', 'ojc-progress');
    const fill = el('i');
    progress.appendChild(fill);
    const note = el('span');
    note.id = 'ojc-note';
    status.append(progress, note);

    bar.append(row, pop, status);
    hiddenBtn.onclick = () => { popOpen = !popOpen; ui && paintPop(); };
    ui = { bar, viewBtns, hiddenBtn, total, caret, fresh, extra, scan, gear, pop, list, toggle, status, progress, fill, note, extraBtns: {} };
    return ui;
  }

  /** Inside the site's results column, above the first card; floating only if the page has no list at all. */
  function mount(u) {
    const first = document.querySelector('.jobpost-cat-box.latest-job-post');
    const host = first && first.parentElement;
    u.bar.classList.toggle('ojc-floating', !host);
    if (host) { if (host.firstElementChild !== u.bar) host.prepend(u.bar); }
    else if (u.bar.parentElement !== document.body) document.body.appendChild(u.bar);
  }

  const hiddenTotal = (c) => c.closed + c.stale + c.noSal + c.kw + (c.passed || 0);

  function paintPop() {
    const u = ui;
    u.pop.hidden = !popOpen;
    u.caret.textContent = popOpen ? ' ▴' : ' ▾';
    u.hiddenBtn.setAttribute('aria-expanded', String(popOpen));
  }

  function render({ counts, showHidden, note, view = 'all', scanning = false, canScan = true,
                    onToggle, onView, onScan, onSettings, progress = null, pass = 0 }) {
    const u = ui && ui.bar.isConnected ? ui : build();
    mount(u);
    u.bar.style.display = '';
    // One attribute write per pass, for the live harness: an attribute is not a child/text mutation, so the
    // observer never sees it and it cannot feed the loop it exists to measure.
    u.bar.dataset.ojcPass = String(pass);

    for (const key of VIEWS) {
      const b = u.viewBtns[key];
      const n = key === 'all' ? null : counts[key] || 0;
      b.textContent = key === 'all' ? L.tier.all : `${L.icon[key]} ${L.tier[key]} ${n}`;
      b.classList.toggle('is-on', view === key);
      b.classList.toggle('is-empty', n === 0);
      // An empty tier is not worth a button on a one-line bar — unless it is the one you are looking at.
      b.hidden = n === 0 && view !== key;
      b.setAttribute('aria-pressed', String(view === key));
      b.title = L.tierTip[key];
      b.onclick = () => onView(view === key ? 'all' : key);
    }

    const total = hiddenTotal(counts);
    u.total.textContent = L.hiddenTotal(total, showHidden);
    u.hiddenBtn.title = 'why these are hidden';
    u.list.innerHTML = '';
    for (const key of ['stale', 'noSal', 'kw', 'closed', 'passed']) {
      if ((key === 'closed' || key === 'passed') && !counts[key]) continue;
      const li = el('li', `ojc-pop-row ojc-pop-${key}`);
      li.append(el('span', 'ojc-pop-n', String(counts[key] || 0)), el('span', null, L.hidden[key]));
      li.title = L.hiddenTip[key];
      u.list.appendChild(li);
    }
    u.toggle.textContent = showHidden ? L.btn.unpeek : `${L.btn.peek} (${total})`;
    u.toggle.disabled = !total && !showHidden;
    u.toggle.onclick = onToggle;
    paintPop();
    u.fresh.textContent = counts.newSince ? `● ${counts.newSince} new` : '';
    u.fresh.title = 'posted since you last looked at this search';
    u.fresh.hidden = !counts.newSince;

    u.scan.textContent = scanning ? L.btn.stop : L.btn.scan;
    u.scan.title = scanning ? L.btnTip.stop : canScan ? L.btnTip.scan : L.btnTip.scanOff;
    u.scan.disabled = !scanning && !canScan;
    u.scan.classList.toggle('is-running', scanning);
    u.scan.onclick = onScan;
    u.gear.onclick = onSettings;

    for (const a of actions) {
      let b = u.extraBtns[a.id];
      if (!b || !b.isConnected) { b = u.extraBtns[a.id] = button(a.id, 'ojc-act'); u.extra.appendChild(b); }
      b.textContent = typeof a.text === 'function' ? a.text() : a.text;
      b.title = a.title || '';
      b.hidden = a.hidden ? !!a.hidden() : false;
      b.onclick = a.onClick;
    }

    // Progress: a bar while a run is going, then the outcome line; the row disappears when there is nothing to say.
    const pct = progress && progress.total ? Math.min(100, Math.round(100 * progress.done / progress.total)) : null;
    u.progress.hidden = !scanning;
    u.fill.style.width = (pct ?? 4) + '%';
    u.note.textContent = note || '';
    u.status.hidden = !note && !scanning;
    return u.bar;
  }

  const hide = () => {
    const bar = document.getElementById(ID);
    if (bar) bar.style.display = 'none';
  };

  /** Register a bar button — later waves (swipe, my jobs) add theirs here instead of editing this file. */
  function addAction(a) {
    const at = actions.findIndex(x => x.id === a.id);
    if (at >= 0) actions.splice(at, 1);
    actions.push(a);
    actions.sort((x, y) => (x.order || 0) - (y.order || 0));
    if (ui) { for (const b of Object.values(ui.extraBtns)) b.remove(); ui.extraBtns = {}; }
  }

  // A click anywhere else folds the hidden breakdown away, like any other dropdown.
  document.addEventListener('click', (e) => {
    if (popOpen && ui && !ui.pop.contains(e.target) && !ui.hiddenBtn.contains(e.target)) { popOpen = false; paintPop(); }
  });

  self.OJCChip = { render, hide, addAction, hiddenTotal };
})();
