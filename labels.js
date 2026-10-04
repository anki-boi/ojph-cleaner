/**
 * labels.js — every word the extension shows, in one table (spec.md D43, W16).
 *
 * The internal names never change (D44): tier keys `high` / `worth` / `pos`, setting keys, record fields,
 * classes and ids stay exactly as stored and as the harness reads them. Only what a person reads lives here,
 * so a rename is one edit and `test-labels.js` can prove the old vocabulary is gone from the source.
 *
 * Pure and UMD: content scripts read `self.OJCLabels`, node tests and tools/verify-live.mjs `require` it.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCLabels = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const L = {
    /** The tiers as filter pills and bar counts (plural), and as a single card's verdict (singular). */
    tier: { all: 'Everything', high: 'Top picks', worth: 'Maybe', pos: 'Liked' },
    tierOne: {
      high: 'Top pick', worth: 'Maybe', pos: 'Liked', kw: 'blocked word', nosal: 'no pay listed',
      stale: 'too old', closed: 'closed', none: 'not sorted yet', passed: 'you passed',
    },
    icon: { high: '⭐', worth: '🤔', pos: '💚', hidden: '🙈' },
    /** Why a listing is hidden — the bar's breakdown. */
    hidden: {
      closed: 'Closed', stale: 'Too old', noSal: 'No pay listed', kw: 'Blocked words', passed: 'You passed',
    },
    hiddenTip: {
      closed: 'you saw these listings close — hidden from now on',
      stale: 'posted longer ago than your "too old after" setting',
      noSal: 'the listing states no figure',
      kw: 'mentions a word you never want to see, and does not meet your minimum pay',
      passed: 'you marked these "not for me"',
    },
    tierTip: {
      all: 'show the whole board with only your hiding rules applied',
      high: 'meets your minimum pay — including the few that mention a blocked word but pay 50 %+ over your minimum',
      worth: 'mentions a word you block, but meets your minimum pay — your call',
      pos: 'mentions a word you are into, but pays below your minimum',
    },
    btn: {
      peek: 'Peek at hidden', unpeek: 'Hide them again', scan: 'Read posts', stop: 'Stop',
      csv: 'Download CSV', settings: 'Settings', undo: 'Undo',
    },
    btnTip: {
      scan: 'open every listing inside your window and re-sort it by its full description (2 at a time)',
      scanOff: 'add a word or a minimum pay first — there is nothing to sort by',
      stop: 'stop reading — everything read so far is kept, and the next run skips it',
      csv: 'download everything the extension remembers about each listing as a spreadsheet',
      csvOff: 'nothing remembered yet — read some posts first',
    },
    /** `N hidden` / `N would be hidden` (the second while peeking — the harness asserts on it). */
    hiddenTotal: (n, peeking) => (peeking ? `${n} would be hidden` : `${n} hidden`),
    /** Marks painted on a card. */
    mark: {
      fresh: '● posted today', freshTip: 'posted in the last 24 hours — apply while the list is short',
      dup: '⚠ reposted', dupTip: 'the same title and company was posted again — this is the older copy',
      up: '↑ better than it looked', down: '↓ worse than it looked',
      offPlatform: '⚠ wants you off OLJ',
      offPlatformTip: 'asks you to apply or talk somewhere other than OnlineJobs.ph',
      negotiable: '⚠ negotiable', negotiableTip: 'states no figure — the pay is negotiable',
      closed: '⊘ closed', closedTip: 'you saw this listing closed — remembered so it stops appearing',
      assumes: (h) => `if full-time (${h} h/wk) — confirm the hours`,
      fit: (n, max) => `fits your resume ${n}/${max}`,
      overHours: (h) => `⚠ ${h} h/week — longer than a 40 h week`,
      partHours: (h) => `⏱ part-time month at ${h} h/week`,
      hours: (h) => `⏱ ${h} h/week`,
    },
    /** The verdict mark on a saved-jobs row. */
    row: { high: '★ top pick', worth: 'maybe', pos: '✓ liked' },
    /** Scan and loader progress. */
    note: {
      loadingPages: 'Reading posts: loading result pages…',
      loadedJobs: (n) => `Reading posts: loaded ${n} jobs…`,
      progress: (done, total, up, down) => `Reading posts ${done} of ${total} · ${up} better · ${down} worse`,
      nothingToScan: 'Nothing to sort by: add a word or a minimum pay first',
      notAList: 'Reading posts works on a job list page',
      loadingMore: 'Loading more…',
    },
    /** The display currencies (D66). PHP first: it is the default and the board's own currency. */
    currency: { PHP: { symbol: '₱', name: 'Philippine peso' }, USD: { symbol: '$', name: 'US dollar' } },
    toast: {
      saved: 'Settings saved',
      currency: (code) => `Showing pay in ${code}. Exchange rates are the ECB's reference rates, refreshed daily.`,
    },
  };
  return L;
});
