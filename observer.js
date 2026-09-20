/**
 * observer.js — the one MutationObserver (split out of content.js, spec.md §2.2, W12).
 *
 * The rule pass has to run again when the page changes under it: the site appends cards, the loader imports
 * a result page, a saved-jobs table renders in batches, and salary.js moves a goal mark (which the pass
 * reads, one beat later). This file watches for all of that and nothing else.
 *
 * The load-bearing part is `isOurs()`, and it has cost this project two real bugs:
 *
 *   1. **A removed node has no parent.** `isOurs()` used to walk `parentNode` to decide whether a mutation
 *      was ours. A child removed from the chip is already detached, so the walk never reached `#ojc-chip`
 *      and every chip rebuild scheduled the next one — one external DOM mutation produced 1 614 rebuilds in
 *      4 s, forever. Judge the mutation's **target** (still attached); `verify-live` asserts the count stays
 *      bounded.
 *   2. **Every injected class must be listed here.** A badge the pass adds is a real child-list mutation,
 *      and a class `isOurs()` cannot recognise is a rule pass that schedules the next rule pass. Adding a
 *      badge means adding it in two places, and forgetting the second is a 400-pass/second page.
 */
(() => {
  'use strict';
  if (typeof document === 'undefined') return;
  const api = self.OJC;
  if (!api) return;   // content.js failed to boot; nothing to re-run

  // Classes listed explicitly rather than matched by "ojc-*": .ojc-pos/.ojc-neg/.ojc-recon/.ojc-goal/
  // .ojc-flag sit on the *site's* cards, and a mutation inside a highlighted card is a real change worth
  // re-running for.
  const OUR_CLASSES = ['ojc-pos-badge', 'ojc-neg-badge', 'ojc-closed-badge', 'ojc-closed-row',
    'ojc-salary-note', 'ojc-salary-warn', 'ojc-tier-badge', 'ojc-flag-badge', 'ojc-hours', 'ojc-badges',
    // W4's detail-page marks. Not because the board's rules read them — a detail page has no cards to hide
    // — but because a mutation we cannot recognise schedules a rule pass, and a listing's own page can
    // carry related-job cards that those rules *do* read.
    'ojc-hl-pos', 'ojc-hl-neg', 'ojc-hl-warn'];

  function isOurs(node) {
    let n = node;
    while (n) {
      if (typeof n.id === 'string' && n.id.startsWith('ojc-')) return true; // chip, panel, sentinel, note
      if (n.classList && OUR_CLASSES.some(c => n.classList.contains(c))) return true;
      n = n.parentNode;
    }
    return false;
  }

  let ticking = false;
  function schedule() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; api.refreshRules(); });
  }

  function onMutate(muts) {
    for (const m of muts) {
      if (isOurs(m.target)) continue; // our own chip/panel/badge rebuild
      if (m.type === 'characterData') return schedule();
      const nodes = [...m.addedNodes, ...m.removedNodes].filter(n => n.nodeType === 1);
      if (nodes.some(n => !isOurs(n))) return schedule();
    }
  }

  const watch = () => new MutationObserver(onMutate)
    .observe(document.body, { childList: true, subtree: true, characterData: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();

  self.OJCObserver = { isOurs, OUR_CLASSES, schedule, watch };
})();
