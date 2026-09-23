/**
 * pay-sort.js — the board, best-paying first, once a deep scan has finished (spec.md D41).
 *
 * The rule is about what the extension REFUSES to assume. A month and an hourly rate are not the same
 * quantity, and turning one into the other needs a work week — which salary.js refuses to assume anywhere
 * else (D13), so it refuses here too. Three blocks, in this order:
 *
 *   a month, highest first  →  a posted rate, highest first  →  no figure at all, in the site's own order
 *
 * The consequence is deliberate, and worth saying out loud: a ₱5,000/mo listing outranks a ₱500/hr one.
 * The order never contradicts the figure printed on the card, and the card that rests on the 40 h/week
 * assumption keeps its own ⚠ label rather than being quietly promoted by the sort.
 *
 * Not part of the rule pass, on purpose. A reorder is roughly one mutation per card, and the observer
 * schedules a pass for any mutation it does not recognise — so a sort inside the pass is a pass that
 * schedules the next one (spec.md §2.2's shape; measured at 31 mutations per reorder of a 30-card board).
 * It runs at the END of a salary pass instead, which is the one moment the pay keys are known to be current,
 * and it writes nothing at all unless the order actually changed.
 *
 * Two halves in one file, unlike salary.js/salary-cards.js: the ordering rule is twenty lines, and a second
 * file for it would be ceremony. The DOM half never runs in node, so `node test-paysort.js` gets the pure
 * rule alone — the same guarantee the other pure/applier pairs give, without the extra file.
 */
(function (root, factory) {
  const pure = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }
  root.OJCPaySort = pure;
  if (typeof document === 'undefined') return;

  const api = self.OJC;
  if (!api) return;   // content.js failed to boot; there is no board to rank

  // A scan has finished in this tab, so the board may be ranked from here on. Session-only, like the tier
  // view: an order is a way of reading the board, not a preference about it.
  let armed = false;

  /**
   * A deep scan just ended — **any** end, including one you stopped and one the site cut short, because a
   * partial ranking of the figures we do have is still honest and the next run moves cards up as more
   * figures become stated. The sort itself waits for the salary pass below, which is where the keys are
   * written; on a page whose figures were already current that pass is a no-op re-read.
   */
  function afterScan() {
    if (!api.getSettings().sortByPay) return;   // the board is the user's; nothing reorders it unasked
    armed = true;
    self.OJCSalaryUI?.annotate?.();   // re-derive every figure, then resort() at the end of that pass
  }

  /**
   * Re-apply the order, if a scan has earned it. Called at the end of every salary pass — after the keys
   * were just rewritten — and it does nothing when the order already holds, which is the whole reason a
   * sort that runs on every pass is not a mutation loop.
   */
  function resort() {
    if (!armed || !api.getSettings().sortByPay) return;
    const cards = api.cards();
    const container = cards[0] && cards[0].parentElement;
    if (!container) return;
    const want = pure.rankOrder(cards.map((card, index) =>
      ({ card, pay: card.dataset.ojcPay, unit: card.dataset.ojcPayUnit, index })));
    if (want.every((it, i) => it.card === cards[i])) return;   // in order: touch nothing, schedule nothing

    // Before the loader's sentinel, never after it. pagination.js keeps the sentinel last on purpose, and a
    // reorder that leaves it mid-list makes it visible — measured: one reorder appended after the sentinel
    // pulled 30 more listings on its own, while inserting before it made zero requests.
    const sentinel = document.getElementById('ojc-sentinel');
    const place = sentinel && sentinel.parentElement === container ? sentinel : null;
    const frag = document.createDocumentFragment();
    for (const it of want) frag.appendChild(it.card);
    container.insertBefore(frag, place);
  }

  root.OJCPaySort.afterScan = afterScan;
  root.OJCPaySort.resort = resort;
})(typeof self !== 'undefined' ? self : this, function () {
  const RATES = ['hour', 'day'];

  /**
   * One card's rank key, from the two attribute strings salary-cards.js wrote. Pure: strings in, numbers
   * out. Anything that is not a positive number with a unit we understand is "no figure" — never a ranked
   * zero, which would put the unpriceable at the top of the month block.
   */
  function keyOf(pay, unit, index) {
    const n = Number(pay);
    const block = !(Number.isFinite(n) && n > 0) ? 2 : unit === 'month' ? 0 : RATES.includes(unit) ? 1 : 2;
    // 0 and not NaN for an unranked card: a comparator that returns NaN orders the array however the engine
    // feels like it, which is a bug that only shows up on a board that happens to be in the wrong shape.
    return { block, pay: block === 2 ? 0 : n, index };
  }

  /** The whole board in rank order. A new array — the caller's order is the tie-break and must survive. */
  function rankOrder(items) {
    return items
      .map(it => ({ it, k: keyOf(it.pay, it.unit, it.index) }))
      .sort((a, b) => a.k.block - b.k.block || b.k.pay - a.k.pay || a.k.index - b.k.index)
      .map(x => x.it);
  }

  return { rankOrder, keyOf, RATES };
});
