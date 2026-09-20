/**
 * detail-parse.js — what a job's own page says, from a Document (spec.md W12).
 *
 * Pure-ish: no chrome, no network, no globals beyond the two pure modules it reads. It takes a `Document`
 * — the live page, or one built by `DOMParser` from a scan's `fetch` — and returns the same facts either
 * way, which is the point: the board's deep scan and the listing's own page must never disagree about
 * what a listing says.
 *
 * Before this file, `detail.js` owned the only copy of these selectors and the scan would have been a
 * second one. Two copies of "where the salary is" is two answers to the same question (§4.2).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./closed.js'));
  else root.OJCDetailParse = factory(root.OJClosed);
})(typeof self !== 'undefined' ? self : this, function (closed) {
  const DESC_SEL = 'p#job-description';
  const DD_SEL = 'dl.row.no-gutters dd';
  /** A listing's own URL ends in its numeric id: `/jobseekers/job/some-slug-1733870`. */
  const JOB_RE = /\/jobseekers\/job\/(?:[^/?#]*-)?(\d+)\/?(?:[?#]|$)/;
  /** The closure notice sits above the description; reading only the head keeps a listing's own prose
   *  ("we are no longer accepting applications for other roles") from being read as the site's notice. */
  const HEAD_CHARS = 1000;

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  /**
   * The page's own words, as one string. `innerText` on a live page, `textContent` on a `DOMParser`
   * document — a document with no browsing context has no layout, so `innerText` there is empty and a
   * scan that asked for it would read every listing as "not closed".
   */
  function pageText(doc) {
    const body = doc && doc.body;
    if (!body) return '';
    return (body.innerText || body.textContent || '').slice(0, HEAD_CHARS);
  }

  /**
   * An element's text with a space where each `<br>` was.
   *
   * `textContent` alone GLUES the lines of this description together — a `<br>` contributes no character
   * — so "Skills required<br>QuickBooks" reads as "requiredQuickBooks" and a keyword can neither match
   * nor be highlighted across a line break. The live page never noticed because its highlighter walks
   * text nodes one at a time; a scan that stores one blob does.
   */
  function textOf(el) {
    const clone = el.cloneNode(true);
    for (const br of clone.querySelectorAll('br')) br.replaceWith('\n');
    return (clone.textContent || '').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim();
  }

  /** The overview's own label/value pairs: `dd > h3` is the label, `dd > p` the value. */
  function overview(doc, labelRe) {
    for (const dd of doc.querySelectorAll(DD_SEL)) {
      const h = dd.querySelector('h3'), p = dd.querySelector('p');
      if (h && p && labelRe.test(clean(h.textContent))) return clean(p.textContent);
    }
    return null;
  }

  /**
   * Everything the board's scan or the listing's page needs, in one shape.
   *
   * `hoursPerWeek` is a NUMBER only when the field is a plain integer (the live contract: 40, 35, 25, 20,
   * 15, 10, 9, 5…) and `null` for `TBD` — never a guess. The caller decides what to do with a null: D28
   * lets a full-time listing fall back to 40 h/week *with the disclaimer on the bar*, and a part-time one
   * claim no month at all.
   */
  function parse(doc) {
    const desc = doc.querySelector(DESC_SEL);
    const raw = desc ? textOf(desc) : null;
    const hoursRaw = overview(doc, /hours?\s*per\s*week/i);
    return {
      description: raw,
      typeOfWork: overview(doc, /type of work/i),
      wage: overview(doc, /wage|salary/i),
      hoursRaw,
      hoursPerWeek: /^\d+$/.test(clean(hoursRaw)) ? Number(clean(hoursRaw)) : null,
      dateUpdated: overview(doc, /date updated/i),
      closed: closed.isClosedText(pageText(doc)),
      ok: !!raw,        // a page with no description is a page this extension cannot describe (2/20 live)
    };
  }

  /** The job id in a pathname, or null — the memory's own reader, so both agree on what a listing is. */
  const jobIdOf = (pathname) => closed.jobIdFrom(pathname);

  return { parse, pageText, textOf, overview, jobIdOf, DESC_SEL, DD_SEL, JOB_RE, HEAD_CHARS };
});
