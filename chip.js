/**
 * chip.js — the status panel in the bottom-right corner (spec.md §4.3, W14).
 *
 * Split out of content.js, which was at 299 of the gate's 300 lines: the rule pass and the status UI have
 * nothing to say to each other, and this file is the one that grows every time the panel says more.
 *
 * It is a panel, not a line, because a single line stopped being readable the moment it had five numbers in
 * it ("137 hidden (0 stale, 36 no salary, 101 keywords, 6 highlighted, 87 to reconsider)"). So: the hidden
 * total with its reasons, then the tier stats, then the views, then the buttons. Colour does the grouping:
 * each row's dot and number carry the same hue as the mark it refers to on the cards themselves
 * (.ojc-closed grey, .ojc-neg red, .ojc-pos green, .ojc-recon yellow).
 *
 * **The buttons are persistent nodes.** The first version rebuilt the whole panel on every rule pass
 * (`innerHTML = ''`), which is correct for the numbers and fatal for clicking: a mousedown lands on one
 * `<button id="ojc-gear">`, the pass replaces it, the mouseup lands on a *different* node, and the browser
 * dispatches the click on their nearest common ancestor — so the handler never runs. Measured live on an
 * idle page: pointerdown, mousedown and mouseup all reported `ojc-gear`, and no click event at all. The
 * Settings button (and Show all, Scan and the view buttons) failed whenever the page happened to mutate
 * mid-click. So the interactive parts — the head, the three action buttons and the three view buttons — are
 * created once and only *updated*; the non-interactive rows are still rebuilt, because a stale number is a
 * bug and a stale row is not clickable.
 *
 * Reads nothing and decides nothing: content.js hands it the counts and the callbacks.
 */
(() => {
  'use strict';
  if (typeof document === 'undefined') return;

  const ID = 'ojc-chip';
  const VIEW_LABEL = { high: 'High yield', worth: 'Worth considering' };
  let collapsed = false;   // session-only: a collapsed panel that forgets is worse than one that does not
  /** The persistent skeleton. Created on the first render, then only ever updated. */
  let ui = null;

  /** `137 Hidden:` / `137 would be hidden:` — the same wording the harness asserts on the toggle. */
  const totalLabel = (counts, showHidden) => {
    const total = counts.closed + counts.stale + counts.noSal + counts.kw;
    return showHidden ? `${total} would be hidden:` : `${total} Hidden:`;
  };

  /** Why the header says 137 when the Hidden list only adds to 36: the keyword row lives under Stats. */
  const totalTitle = (counts) => [
    `${counts.stale} stale`,
    `${counts.noSal} no salary`,
    `${counts.kw} matched a hide keyword`,
    counts.closed ? `${counts.closed} already seen closed` : null,
  ].filter(Boolean).join(' + ');

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /** Build the panel once. Every node here outlives a rule pass. */
  function build() {
    const chip = document.getElementById(ID) || el('div');
    chip.id = ID;
    chip.innerHTML = '';
    if (!chip.isConnected) document.body.appendChild(chip);

    const head = el('div');
    head.id = 'ojc-chip-head';
    const total = el('b');
    total.id = 'ojc-chip-total';
    const caret = el('span');
    caret.id = 'ojc-chip-caret';
    head.append(total, caret);

    const body = el('div');
    body.id = 'ojc-chip-body';
    const hiddenBox = el('div', 'ojc-chip-group');
    hiddenBox.id = 'ojc-chip-hidden';
    const statsBox = el('div', 'ojc-chip-group');
    statsBox.id = 'ojc-chip-stats';
    // The views: three buttons, created once, so a click can never be swallowed by a rebuild.
    const views = el('div', 'ojc-chip-group ojc-views');
    const viewsHead = el('i', null, 'Views');
    const bar = el('div', 'ojc-view-bar');
    const viewBtns = {};
    for (const [key, label] of [['high', 'High yield'], ['worth', 'Worth considering']]) {
      const b = el('button', 'ojc-view');
      b.type = 'button';
      b.dataset.view = key;
      viewBtns[key] = b;
      bar.appendChild(b);
    }
    const all = el('button', 'ojc-view ojc-view-all');
    all.type = 'button';
    all.dataset.view = 'all';
    all.textContent = 'All';
    viewBtns.all = all;
    bar.appendChild(all);
    // Tooltips and handlers are set on every render (they close over that render's counts), but the NODES
    // never change identity after this function runs.
    views.append(viewsHead, bar);

    const note = el('div');
    note.id = 'ojc-note';

    const actions = el('div');
    actions.id = 'ojc-chip-actions';
    const mk = (id, text) => { const b = el('button'); b.id = id; b.type = 'button'; b.textContent = text; return b; };
    const toggle = mk('ojc-toggle', 'Show All');
    const scan = mk('ojc-scan', 'Scan');
    const gear = mk('ojc-gear', 'Settings');
    actions.append(toggle, scan, gear);

    body.append(hiddenBox, statsBox, views);
    chip.append(head, body, note, actions);
    ui = { chip, head, total, caret, body, hiddenBox, statsBox, views, viewsHead, viewBtns, note, actions, toggle, scan, gear };
    return ui;
  }

  const row = (kind, count, label, title) => {
    const li = el('li', `ojc-chip-row ojc-chip-${kind}`);
    li.append(el('span', 'ojc-chip-count', String(count)), el('span', null, label));
    if (title) li.title = title;
    return li;
  };

  /** Replace a group's rows. `rows` are not interactive, so rebuilding them cannot swallow a click — and a
   *  number left behind by a partial update is the class of bug this extension keeps finding (§2.2). */
  function fill(box, label, rows) {
    box.innerHTML = '';
    box.append(el('i', null, label));
    const ul = el('ul');
    ul.append(...rows.filter(Boolean));
    box.appendChild(ul);
  }

  function render({ counts, showHidden, note, view = 'all', scanning = false, canScan = true,
                    onToggle, onView, onScan, onSettings, progress = '', pass = 0 }) {
    const u = ui && ui.chip.isConnected ? ui : build();
    u.chip.style.display = '';
    // One attribute write per pass, for the live harness: mutating a data attribute is not a mutation the
    // observer reports (it watches children and text), so this cannot feed the loop it exists to measure.
    u.chip.dataset.ojcPass = String(pass);
    u.chip.classList.toggle('ojc-chip-collapsed', collapsed);

    u.head.title = totalTitle(counts);
    u.head.onclick = () => { collapsed = !collapsed; render({ counts, showHidden, note, view, scanning, canScan, onToggle, onView, onScan, onSettings, progress, pass }); };
    u.total.textContent = totalLabel(counts, showHidden);
    u.caret.textContent = collapsed ? '▸' : '▾';

    fill(u.hiddenBox, 'Hidden', [
      counts.closed ? row('closed', counts.closed, 'Closed', 'you saw these listings close — hidden from now on') : null,
      row('stale', counts.stale, 'Stale', 'posted longer ago than your recency window'),
      row('nosal', counts.noSal, 'No Salary', 'the listing states no figure'),
    ]);
    fill(u.statsBox, 'Stats', [
      row('kw', counts.kw, 'Keywords Matched', 'matched a hide keyword and did not look good enough to reconsider'),
      // Highlighted is NOT a tier: a keyword you like on a listing that pays below your goal. The user's
      // rule — positive keywords do not make a listing high-yield, only passing salary does.
      row('pos', counts.pos, 'Highlighted', 'matches a keyword you like, and pays below your goal'),
      row('high', counts.high, 'High yield', 'pays at or above your goal — with or without a keyword you like'),
      row('worth', counts.worth, 'Worth Considering', 'matches a hide keyword, but still looks good'),
      // A TAG count, not a tier: these listings are graded exactly like any other one (the user's rule).
      counts.offPlat ? row('offplat', counts.offPlat, 'Off-platform', 'ask you to apply or contact outside OnlineJobs.ph — a tag on the card, not a filter: they are graded like any other listing') : null,
    ]);

    u.viewsHead.textContent = view === 'all' ? 'Views' : `Views · showing ${VIEW_LABEL[view]}`;
    const counts4 = { high: counts.high, worth: counts.worth };
    for (const key of ['high', 'worth']) {
      const b = u.viewBtns[key];
      b.textContent = `${key === 'high' ? 'High yield' : 'Worth considering'} ${counts4[key]}`;
      b.classList.toggle('is-on', view === key);
      b.title = view === key
        ? 'showing only these — click "All" to show the whole board again'
        : `show only the ${counts4[key]} listing(s) in this tier, hiding every other card`;
      b.onclick = () => onView(view === key ? 'all' : key);
    }
    u.viewBtns.all.classList.toggle('is-on', view === 'all');
    u.viewBtns.all.title = 'show the board with only the normal rules applied';
    u.viewBtns.all.onclick = () => onView('all');

    // Outside the collapsible body on purpose: the loader and the scan report here ("loaded page 2 of 3",
    // "168 scanned · 9 promoted"), and a message about what just happened must not be hidden by a panel the
    // user folded away.
    u.note.textContent = note || '';
    u.note.hidden = !note;

    u.toggle.textContent = showHidden ? 'Hide All' : 'Show All';
    u.toggle.onclick = onToggle;
    u.scan.textContent = scanning ? (progress ? `Stop ${progress}` : 'Stop') : 'Scan';
    u.scan.title = scanning
      ? 'stop the scan — everything finished so far is kept, and a re-run skips what is cached'
      : canScan
        ? 'load every result inside your recency window, then open each listing to re-decide it (2 at a time)'
        : 'add a keyword or a salary goal first — there is nothing for a scan to decide with';
    u.scan.disabled = !scanning && !canScan;
    u.scan.classList.toggle('ojc-off', u.scan.disabled);
    u.scan.onclick = onScan;
    u.gear.onclick = onSettings;
    return u.chip;
  }

  const hide = () => {
    const chip = document.getElementById(ID);
    if (chip) chip.style.display = 'none';
  };

  self.OJCChip = { render, hide, isCollapsed: () => collapsed };
})();
