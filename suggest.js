/**
 * suggest.js — "Block this word?" from what you passed on (spec.md D53).
 *
 * Deterministic counting, never a model and never automatic: after enough passes, a word or two-word phrase
 * that shows up in at least half of the listings you passed on, and in almost none of the ones you kept
 * (saved / applied), is offered as a chip — `Block "cold calling"? seen in 9 of the 12 you passed`. One click
 * adds it (with Undo); dismissing it hides that suggestion for good.
 *
 * Counted per LISTING (document frequency), not per occurrence: a post that says "sales" twelve times is still
 * one post about sales.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCSuggest = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // English glue words plus the words every job post uses — none of them says anything about THIS job.
  const STOP = new Set(('a about above after again all also am an and any are as at be because been before being '
    + 'below between both but by can could did do does doing down during each few for from further had has have '
    + 'having he her here hers him his how i if in into is it its just me more most my no nor not now of off on '
    + 'once only or other our ours out over own same she should so some such than that the their them then there '
    + 'these they this those through to too under until up very was we were what when where which while who whom '
    + 'why will with would you your yours us per via etc able must need needs looking look join work working job '
    + 'jobs role position company team client clients time hours hour week weekly month monthly day daily year '
    + 'years experience experienced skills skill strong good great excellent well new help ensure including '
    + 'include required requirements responsibilities apply candidate candidates ideal please send also get '
    + 'full part salary pay rate usd php based remote home online support provide using use make one two '
    + 'see more less like want '
    // The board's own furniture, printed on every card: "Posted on …", "See More", the job-type badge.
    + 'posted gig any full-time part-time freelance hiring urgent needed wanted').split(/\s+/).filter(Boolean));

  const tokens = (text) => (String(text || '').toLowerCase().match(/[a-z][a-z0-9+#]*(?:[-'][a-z0-9]+)*/g) || [])
    .filter(w => w.length >= 3 || /^[a-z]{2}\+?$/.test(w) === false && w.length >= 2);

  /** The distinct terms a listing contains: content words, and adjacent pairs of content words. */
  function terms(text) {
    const t = tokens(text);
    const out = new Set();
    for (let i = 0; i < t.length; i++) {
      const w = t[i];
      if (STOP.has(w) || w.length < 3) continue;
      out.add(w);
      const n = t[i + 1];
      if (n && !STOP.has(n) && n.length >= 3) out.add(w + ' ' + n);
    }
    return out;
  }

  const df = (texts) => {
    const c = new Map();
    // A listing is either its text or the terms already taken from it (myJobs keeps `sig`, not the description).
    for (const t of texts) for (const term of (Array.isArray(t) ? new Set(t) : terms(t))) c.set(term, (c.get(term) || 0) + 1);
    return c;
  };

  /**
   * @param passed   texts of listings you passed on
   * @param kept     texts of listings you saved or applied to
   * @param existing words already on either keyword list (never suggested again)
   * @param dismissed suggestions you closed
   * @returns up to `max` of { word, seen, of }, best first
   */
  function suggest({ passed = [], kept = [], existing = [], dismissed = [] },
                   { minPasses = 8, minShare = 0.5, maxKeptShare = 0.1, max = 3 } = {}) {
    if (passed.length < minPasses) return [];
    const skip = new Set([...existing, ...dismissed].map(w => String(w).toLowerCase().trim()));
    const p = df(passed), k = df(kept);
    let cands = [...p.entries()]
      .filter(([w, n]) => n / passed.length >= minShare && (k.get(w) || 0) / Math.max(1, kept.length) <= maxKeptShare)
      .filter(([w]) => !skip.has(w) && !w.split(' ').some(part => skip.has(part)));
    // A phrase that explains its words beats the words: "cold calling" in 9 posts makes "cold" (9) and
    // "calling" (9) redundant — but "calling" in 14 posts is a broader signal and stays.
    const phrases = cands.filter(([w]) => w.includes(' '));
    cands = cands.filter(([w, n]) => w.includes(' ') || !phrases.some(([pw, pn]) => pw.split(' ').includes(w) && pn >= n));
    cands.sort((a, b) => b[1] - a[1] || (b[0].includes(' ') ? 1 : 0) - (a[0].includes(' ') ? 1 : 0) || a[0].localeCompare(b[0]));
    return cands.slice(0, max).map(([word, seen]) => ({ word, seen, of: passed.length }));
  }

  /** What a decision keeps about a listing: its most telling terms, phrases first — a few hundred bytes. */
  const signature = (text, max = 40) => [...terms(text)].sort((x, y) => (y.includes(' ') ? 1 : 0) - (x.includes(' ') ? 1 : 0)).slice(0, max);

  return { suggest, terms, signature, STOP };
});
