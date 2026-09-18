/**
 * pagination.js — perpetual pagination for list pages (spec.md W6).
 *
 * Loaded as a second content script, after content.js. Two parts:
 *   1. `OJCPager` — pure URL/offset maths, UMD so node can unit-test it (test-pager.js).
 *   2. the loader — DOM + network, talking to content.js through the small `self.OJC` API.
 *
 * Why it is not in content.js: the core extension must stay free of network code (it makes no
 * request of its own), and every injected node it grows costs the chip a rebuild.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.OJCPager = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SELECTOR = '.jobpost-cat-box.latest-job-post';

  /**
   * The next result page's URL, built from the current one. The site addresses pages by how many
   * jobs are already displayed, so `/jobseekers/jobsearch?kw=x` → `/jobseekers/jobsearch/30?kw=x`.
   * Handles all three shapes: bare list, list with an offset segment, category pages.
   */
  function nextPageUrl(href, offset) {
    const [path, query] = href.split('?');
    const base = /\/\d+$/.test(path) ? path.replace(/\/\d+$/, '/') : path.replace(/\/$/, '') + '/';
    return base + offset + (query ? '?' + query : '');
  }

  /** "Displaying 30 out of 297 jobs" → { from: 30, total: 297 }, or null if the line is absent. */
  function parseShown(text) {
    const m = (text || '').match(/Displaying\s+(\d+)\s+out of\s+(\d+)/i);
    return m ? { from: +m[1], total: +m[2] } : null;
  }

  /**
   * How many jobs the site had already skipped when this page was served — the numeric tail of the
   * URL, 0 when there is none. The next offset is this plus the cards actually on screen, NOT the
   * "Displaying N" counter: on a final partial page that counter is the page's size (7), not the
   * position, and using it would send the loader back to page 1.
   */
  function pageOffset(pathname) {
    const m = (pathname || '').match(/\/(\d+)$/);
    return m ? +m[1] : 0;
  }

  /** The identity of a card for de-duplication: its job href, else its leading text. */
  function jobKeyOf(card) {
    const a = card.querySelector('a[href*="/jobseekers/job/"]');
    return a ? a.getAttribute('href') : (card.textContent || '').slice(0, 120).trim();
  }

  return { SELECTOR, nextPageUrl, parseShown, pageOffset, jobKeyOf };
});

// ── the loader (browser only) ────────────────────────────────────────────
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage) return; // node: only the helpers above
  const api = self.OJC;
  if (!api) return; // content.js failed to boot; nothing to page
  const { nextPageUrl, parseShown, pageOffset, jobKeyOf } = self.OJCPager;

  const MIN_GAP_MS = 600;
  const pag = { armed: false, busy: false, done: false, pages: 0, lastAt: 0 };
  let sentinel = null, io = null, scrollHooked = false, visible = false;

  function stop(reason) {
    if (pag.done) return;
    pag.done = true;
    if (sentinel) { sentinel.remove(); sentinel = null; }
    if (io) { io.disconnect(); io = null; }
    api.setNote('');
    console.log('[OJ Cleaner] stopped loading more —', reason);
  }

  async function loadNextPage() {
    const settings = api.getSettings();
    if (pag.busy || pag.done || !settings.autoLoad || !api.LIST_RE.test(location.pathname)) return;
    const now = api.cards();
    if (!now.length) return;

    const info = parseShown(document.body.innerText);
    // Everything the site has is already here: stop *before* spending a request. On the final
    // partial page (e.g. offset 290 with 7 cards out of 297) the "Displaying 7" counter is the
    // page's size, not its position, so the position has to come from the URL.
    const here = pageOffset(location.pathname) + now.length;
    if (info && info.total && here >= info.total) return stop('every result is already loaded');
    if (Date.now() - pag.lastAt < MIN_GAP_MS) return; // fast scrolling must not machine-gun the site

    pag.busy = true;
    pag.lastAt = Date.now();
    api.setNote('loading more…');
    const container = now[0].parentElement;
    const seen = new Set(now.map(jobKeyOf));
    try {
      const url = nextPageUrl(location.href, here);
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) return stop(`the next page returned ${res.status}`);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      // A page of nothing but jobs we already have means we are at the end (or the site
      // repeats itself) — never keep fetching on the strength of a count alone.
      const incoming = [...doc.querySelectorAll(self.OJCPager.SELECTOR)]
        .filter(c => { const k = jobKeyOf(c); return !seen.has(k) && (seen.add(k), true); });
      if (!incoming.length) return stop('the next page held no jobs we did not already have');
      for (const c of incoming) container.appendChild(document.importNode(c, true));
      placeSentinel();   // the new last card is further down; the trigger must follow it
      pag.pages++;
      api.setNote('');
      api.refreshRules(); // the observer sees the insertion too; this makes the repaint immediate
      console.log(`[OJ Cleaner] loaded ${incoming.length} more jobs (page ${pag.pages + 1})`);
    } catch {
      stop('offline or blocked');
    } finally {
      pag.busy = false;
    }
  }

  /** The sentinel belongs after the LAST card, not where it was first inserted: appending a page
   *  to the container would otherwise leave it stranded mid-list, marking a bottom that is no longer
   *  the bottom. */
  function placeSentinel() {
    if (!sentinel) return;
    const all = api.cards();
    const last = all[all.length - 1];
    if (last?.parentElement && sentinel.previousElementSibling !== last) {
      last.parentElement.appendChild(sentinel);
    }
  }

  /**
   * The trigger is "the sentinel is visible AND the user has scrolled": the two can arrive in either
   * order (the IntersectionObserver callback is not guaranteed to run after the scroll event for the
   * same gesture), so both paths call this instead of one setting the flag the other is waiting for.
   */
  function maybeLoad() {
    if (!visible || !pag.armed || pag.busy || pag.done) return;
    pag.armed = false;
    loadNextPage();
  }

  /**
   * Put the sentinel after the last card and watch it. Loading requires a **real scroll** since
   * the last page: a short list (or one where the keywords hid most cards) would otherwise sit
   * with the sentinel on screen and pull the entire result set without the user doing anything.
   */
  function arm() {
    const settings = api.getSettings();
    if (sentinel?.isConnected || pag.done || !settings.autoLoad) return;
    const first = api.cards()[0];
    if (!first || !first.parentElement) return;
    sentinel = document.createElement('div');
    sentinel.id = 'ojc-sentinel';
    first.parentElement.appendChild(sentinel);
    if (io) io.disconnect();
    io = new IntersectionObserver((entries) => {
      visible = entries.some(e => e.isIntersecting);
      maybeLoad();
    }, { rootMargin: '400px' });
    io.observe(sentinel);
    placeSentinel();
    if (!scrollHooked) {
      window.addEventListener('scroll', () => { pag.armed = true; maybeLoad(); }, { passive: true });
      scrollHooked = true;
    }
  }

  self.OJCLoader = { arm, stop: () => stop('turned off') };
})();
