/**
 * closed.js — the memory of listings you have seen close (spec.md W9, D29).
 *
 * Pure: no DOM, no chrome, no network, and unit-tested by test-closed.js. The applier that reads and
 * writes `chrome.storage.local` lives in closed-cards.js, the same split as salary.js/salary-cards.js.
 *
 * The memory exists because a dead listing is the one kind of result the board cannot filter: OJ.ph
 * prints "This job has been closed" on the listing's own page and nowhere else, so the only moment a
 * closure can be observed is when you have already opened it. Measured the day this was built: 1 of 30
 * listings on the deepest board page was closed, and 4 of 16 saved jobs — the saved list is where dead
 * listings accumulate.
 *
 * It is deliberately a cache of what you have seen, not a crawler: nothing here fetches anything.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.OJClosed = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /** Entries older than this are forgotten (the user's cap: "max history of 6 months is good"). */
  const HISTORY_DAYS = 180;
  /** Both slug spellings carry the id last: board cards use a lowercase slug, saved jobs Title-Case. */
  const JOB_ID_RE = /\/jobseekers\/job\/(?:[^/?#]*-)?(\d+)\/?(?:[?#]|$)/;
  /** The live page's own words, verified 2026-09-18 on two closed listings. */
  const CLOSED_RE = /this job has been closed|no longer accepting (?:applications|applicants)/i;

  /**
   * The job id in a link or a path — `'/jobseekers/job/Medical-Assistant-1570005'` → `'1570005'`.
   * Returns null for anything that is not a listing, including a search page: hiding a card because a
   * nearby URL looked job-shaped would lose a listing, which is the one thing this extension must not do.
   */
  function jobIdFrom(href) {
    const m = JOB_ID_RE.exec(String(href ?? ''));
    return m ? m[1] : null;
  }

  /** Does this page say the listing is closed? */
  function isClosedText(text) {
    return CLOSED_RE.test(String(text ?? ''));
  }

  /**
   * Drop entries older than `maxAgeMs`, and anything that is not a `{ at }` stamp. Returns a new map:
   * the caller is holding the copy the rule pass reads, and mutating it in place would change a verdict
   * halfway through a pass.
   */
  function prune(map, nowMs, maxAgeMs) {
    const out = {};
    for (const [id, entry] of Object.entries(map || {})) {
      const at = entry && typeof entry.at === 'number' ? entry.at : null;
      if (at !== null && nowMs - at <= maxAgeMs) out[id] = { at };
    }
    return out;
  }

  /** Remember a closure, pruning at the same time so the map can never grow without bound. */
  function record(map, id, nowMs, maxAgeMs) {
    const out = prune(map, nowMs, maxAgeMs);
    if (id) out[String(id)] = { at: nowMs };
    return out;
  }

  return { jobIdFrom, isClosedText, prune, record, HISTORY_DAYS };
});
