/**
 * page.js — every coupling to the site's LIST markup, in one place.
 *
 * Split out of content.js when the W12–W14 work pushed it past the gate's 300-line ceiling, and it is the
 * split the architecture doc already asked for: this file knows what a card is and how to read it, and
 * `content.js` decides what to do about it. Site drift is a one-line fix here, and tools/verify-live.mjs
 * asserts the live result (it fails loudly when a page parses to zero cards).
 *
 * The detail page's own markup is NOT here — that lives in detail-parse.js, which the board's deep scan and
 * the listing's own page share.
 */
(() => {
  'use strict';

  const LIST_RE = /\/jobseekers\/(jobsearch|search)(\/|$)/; // keyword search (with or without /offset/) + category list pages
  const SELECTORS = {
    card: '.jobpost-cat-box.latest-job-post',
    cardSalary: 'dd.col',
    cardPosted: 'p[data-temp]',   // W8: "Posted on …", on every card
  };
  const cards = () => [...document.querySelectorAll(SELECTORS.card)];

  /**
   * The site's own text inside `el`, free of anything this extension injected.
   *
   * Our note, warning and badge live in the same cells the rules read, so text we wrote can end up feeding the
   * rule that decides whether to hide the card. That happened for real twice: a second rule pass re-parsed the
   * disclaimer's "40 h/week" into the figure (₱50,186 - ₱401,485/mo), and the keyword "assumes" — which
   * appears on no listing on the board — highlighted a card because of our warning.
   */
  const ownText = (el) => {
    const own = el.cloneNode(true);
    for (const injected of own.querySelectorAll('[class^="ojc-"]')) injected.remove();
    return own.textContent || '';
  };

  /** The site's posted salary text, with our annotation stripped: the no-salary verdict must not be able to
   *  be changed by a figure we added. */
  const cardSalary = (c) => {
    const d = c.querySelector(SELECTORS.cardSalary);
    return d ? ownText(d).trim() : '';
  };

  /**
   * When the card was posted, in epoch ms — or `null` when it does not say.
   * Read from the attribute, not the visible text: no injected node can carry it, and a card whose date
   * cannot be read is left visible (the recency rule must not be the thing that loses a listing).
   */
  const postedAt = (c) => {
    const p = c.querySelector(SELECTORS.cardPosted);
    if (!p) return null;
    return self.OJRules.parsePosted(p.getAttribute('data-temp-2')) ??
      self.OJRules.parsePosted(p.getAttribute('data-temp'), self.OJRules.MANILA_OFFSET_MINUTES);
  };

  /**
   * The duplicate key for a re-posted job: its title and company, normalized (the re-post shares both,
   * and nothing else on a card can match by accident). The employment badge inside the title is markup,
   * not title, so it is stripped. Returns null when the title cannot be read — and a card with no key is
   * never a duplicate, in the safe direction.
   */
  const dupKeyOf = (c) => {
    const h = c.querySelector('dt h4');
    const p = c.querySelector(SELECTORS.cardPosted);
    if (!h) return null;
    const hh = h.cloneNode(true);
    hh.querySelectorAll('[class*="badge"]').forEach(b => b.remove());
    const title = (hh.textContent || '').replace(/[ \t]+/g, ' ').trim().toLowerCase();
    if (!title) return null;
    const company = p ? ownText(p).split(/[•·]/)[0].replace(/[ \t]+/g, ' ').trim().toLowerCase() : '';
    return title + '|' + company;
  };

  self.OJCPage = { LIST_RE, SELECTORS, cards, ownText, cardSalary, postedAt, dupKeyOf };
})();
