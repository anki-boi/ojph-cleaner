/**
 * chip.js — the status panel in the bottom-right corner (spec.md §4.3).
 *
 * Split out of content.js, which was at 299 of the gate's 300 lines: the rule pass and the status UI have
 * nothing to say to each other, and this file is the one that grows every time the panel says more.
 *
 * It is a panel, not a line, because a single line stopped being readable the moment it had five numbers
 * in it ("137 hidden (0 stale, 36 no salary, 101 keywords, 6 highlighted, 87 to reconsider)"): the two
 * questions a reader actually has — why were these hidden, and what did the keyword pass find — were
 * separated by commas. So: the hidden total with its reasons, then the matching stats, then the two
 * buttons. Colour does the grouping: each row's dot and number carry the same hue as the mark it refers
 * to on the cards themselves (.ojc-closed grey, .ojc-neg red, .ojc-pos green, .ojc-recon yellow).
 *
 * Reads nothing and decides nothing: content.js hands it the counts and the two click handlers.
 */
(() => {
  'use strict';
  if (typeof document === 'undefined') return;

  const ID = 'ojc-chip';
  const NOTE_ID = 'ojc-note';
  let collapsed = false;   // session-only: a collapsed panel that forgets is worse than one that does not

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

  function ensure() {
    let chip = document.getElementById(ID);
    if (!chip || !chip.isConnected) {
      chip = document.createElement('div');
      chip.id = ID;
      document.body.appendChild(chip);
    }
    return chip;
  }

  const row = (kind, count, label, title) => {
    const li = document.createElement('li');
    li.className = `ojc-chip-row ojc-chip-${kind}`;
    const n = document.createElement('span');
    n.className = 'ojc-chip-count';
    n.textContent = String(count);
    const t = document.createElement('span');
    t.textContent = label;
    li.append(n, t);
    if (title) li.title = title;
    return li;
  };

  const group = (label, rows) => {
    const box = document.createElement('div');
    box.className = 'ojc-chip-group';
    const head = document.createElement('i');
    head.textContent = label;
    const ul = document.createElement('ul');
    ul.append(...rows);
    box.append(head, ul);
    return box;
  };

  /**
   * Rebuild the panel. Called on every rule pass, so it is a full rebuild rather than a patch: the pass
   * owns the numbers, and a stale number left in the DOM by a partial update is exactly the class of bug
   * this extension keeps finding (spec.md §2.2). The ids the harness and the panel rely on are preserved.
   */
  function render({ counts, showHidden, note, onToggle, onSettings }) {
    const chip = ensure();
    chip.innerHTML = '';
    chip.classList.toggle('ojc-chip-collapsed', collapsed);

    const head = document.createElement('div');
    head.id = 'ojc-chip-head';
    head.title = totalTitle(counts);
    const total = document.createElement('b');
    total.id = 'ojc-chip-total';
    total.textContent = totalLabel(counts, showHidden);
    const caret = document.createElement('span');
    caret.id = 'ojc-chip-caret';
    caret.textContent = collapsed ? '▸' : '▾';
    head.append(total, caret);
    head.onclick = () => { collapsed = !collapsed; render({ counts, showHidden, note, onToggle, onSettings }); };

    const body = document.createElement('div');
    body.id = 'ojc-chip-body';
    const hiddenRows = [
      counts.closed ? row('closed', counts.closed, 'Closed', 'you saw these listings close — hidden from now on') : null,
      row('stale', counts.stale, 'Stale', 'posted longer ago than your recency window'),
      row('nosal', counts.noSal, 'No Salary', 'the listing states no figure'),
    ].filter(Boolean);
    body.append(group('Hidden', hiddenRows));
    body.append(group('Stats', [
      row('kw', counts.kw, 'Keywords Matched', 'matched a hide keyword and did not look good enough to reconsider'),
      row('pos', counts.pos, 'Highlighted', 'matched a keyword you like'),
      row('recon', counts.recon, 'Worth Considering', 'matched a hide keyword but looks good — shown in yellow'),
    ]));

    chip.append(head, body);
    if (note) {
      // Outside the collapsed body on purpose: the loader reports here ("loaded page 2 of 3"), and a
      // message about what just happened must not be hidden by a panel the user folded away.
      const n = document.createElement('div');
      n.id = NOTE_ID;
      n.textContent = note;
      chip.appendChild(n);
    }
    const actions = document.createElement('div');
    actions.id = 'ojc-chip-actions';
    const toggle = document.createElement('button');
    toggle.id = 'ojc-toggle';
    toggle.textContent = showHidden ? 'Hide All' : 'Show All';
    toggle.onclick = onToggle;
    const gear = document.createElement('button');
    gear.id = 'ojc-gear';
    gear.textContent = 'Settings';
    gear.onclick = onSettings;
    actions.append(toggle, gear);
    chip.appendChild(actions);
    return chip;
  }

  const hide = () => {
    const chip = document.getElementById(ID);
    if (chip) chip.style.display = 'none';
  };

  self.OJCChip = { render, hide, isCollapsed: () => collapsed };
})();
