/**
 * glance.js — a listing "at a glance" (spec.md D60): up to three lines of what you'd do and what they want,
 * lifted WORD FOR WORD from the post's own headed sections. Extractive and deterministic — an LLM summary stays
 * rejected (§8: it would send the post to a third party, and could say things the post never did). A post with
 * no such sections gets no glance rather than a guess.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCGlance = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DO = /^(key\s+)?(responsibilities|duties|tasks|what\s+you('ll|\s+will)\s+(do|be\s+doing)|your\s+(role|day|tasks|responsibilities)|the\s+role|job\s+duties|scope\s+of\s+work|you\s+will)\b/i;
  const WANT = /^(requirements|qualifications|what\s+(you|we)('ll)?\s+(need|want|are\s+looking\s+for|look\s+for)|what\s+we\s+expect|must[\s-]+haves?|skills(\s+required)?|who\s+you\s+are|ideal\s+candidate|you\s+have|you\s+are|we\s+need)\b/i;
  const ANY_HEAD = /^[A-Z][A-Za-z'’ /&-]{2,48}:?\s*$/;   // a short line on its own, ending the previous section
  const BULLET = /^\s*(?:[-•*·▪●◦–]|\d{1,2}[.)])\s*/;

  const clean = (l) => l.replace(BULLET, '').replace(/\s+/g, ' ').trim();
  const clip = (l, n = 120) => (l.length > n ? l.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : l);

  /** → { doing: string[], want: string[] } — each at most `max` lines, in the post's own order and words. */
  function extract(text, max = 3) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim());
    const out = { doing: [], want: [] };
    let into = null;
    for (const raw of lines) {
      if (!raw) continue;
      // "Requirements: 2 years of QuickBooks" — a heading and its first item on one line.
      const inline = /^([^:]{3,40}):\s+(.+)$/.exec(raw);
      if (inline && (DO.test(inline[1]) || WANT.test(inline[1])) && !BULLET.test(raw)) {
        into = DO.test(inline[1]) ? 'doing' : 'want';
        if (out[into].length < max) out[into].push(clip(clean(inline[2])));
        continue;
      }
      const head = raw.replace(/[:：]\s*$/, '').trim();
      const isHead = head.length <= 60 && !BULLET.test(raw) && (DO.test(head) || WANT.test(head) || ANY_HEAD.test(raw));
      if (isHead) { into = DO.test(head) ? 'doing' : WANT.test(head) ? 'want' : null; continue; }
      if (!into || out[into].length >= max) continue;
      const l = clean(raw);
      if (l.length < 4) continue;
      out[into].push(clip(l));
    }
    return out;
  }

  const isEmpty = (g) => !g || (!g.doing.length && !g.want.length);
  return { extract, isEmpty };
});
