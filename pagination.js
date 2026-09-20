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
  function jobKeyOf(card, ownText) {
    const a = card.querySelector('a[href*="/jobseekers/job/"]');
    if (a) return a.getAttribute('href');
    // The fallback key must be the SITE's text: our salary note changes over a card's life (a rate
    // first, a month once the live rates land), and a key that moves makes the pager re-import a card
    // it already has. `ownText` is supplied by the loader; the default keeps this module pure.
    return ((ownText ? ownText(card) : card.textContent) || '').slice(0, 120).trim();
  }

  /**
   * Has the list already reached the end of the recency window?
   *
   * The board is sorted newest-first, so the OLDEST card loaded is the tail of the list: once it is older
   * than the window, every card on every later page is too — and the rule pass would hide all of them the
   * moment they arrived. Fetching those pages is pure waste, so the loader stops *before* the request.
   * (Same test the deep scan uses to know where to stop paging; one definition, two callers.)
   *
   * `0` means the window is off, and a card whose date cannot be read is never a reason to stop: the rule
   * that must not lose a listing does not get to end the list either.
   */
  function pastHorizon(postedMs, nowMs, maxAgeDays) {
    const max = Number(maxAgeDays);
    if (!(max > 0)) return false;
    const known = (postedMs || []).filter(t => typeof t === 'number' && isFinite(t));
    if (!known.length) return false;
    return Math.min(...known) < nowMs - max * 86400000;
  }

  return { SELECTOR, nextPageUrl, parseShown, pageOffset, jobKeyOf, pastHorizon };
});

// ── the loader (browser only) ────────────────────────────────────────────
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage) return; // node: only the helpers above
  const api = self.OJC;
  if (!api) return; // content.js failed to boot; nothing to page
  const { nextPageUrl, parseShown, pageOffset, jobKeyOf, pastHorizon } = self.OJCPager;
  const ownText = api.ownText;   // card identity must be the site's words, not our annotation

  const MIN_GAP_MS = 600;
  // `gesture` counts scroll events; `spent` is the last gesture that bought a page. One scroll buys
  // ONE page: without this the flag survived across a load, and a sentinel still inside the 400px
  // margin spent the same gesture over and over — one nudge pulled /30, /60, /90 in a row.
  const pag = { busy: false, done: false, pages: 0, lastAt: 0, gesture: 0, spent: -1, reason: '' };
  let sentinel = null, io = null, scrollHooked = false, visible = false;

  /** Why the loader stopped, when the reason is one a settings change can undo. */
  const HORIZON = 'your recency window ends here';

  function stop(reason) {
    if (pag.done) return;
    pag.done = true;
    pag.reason = reason;
    if (sentinel) { sentinel.remove(); sentinel = null; }
    if (io) { io.disconnect(); io = null; }
    api.setNote('');
    console.log('[OJ Cleaner] stopped loading more —', reason);
  }

  /**
   * Fetch and import the next result page, reporting instead of deciding.
   *
   * `force` is the scan's path (W13, D33): the user pressed Scan, and that press *is* the gesture the
   * scroll path insists on — so the guard is skipped, and the politeness gap is waited out rather than
   * refused. Everything else is identical, which is the point: there is exactly one place in this
   * extension that grows the card list.
   *
   * Returns `{ ok, added, url, reason, done }`. `done` means "there is nothing more to fetch", so the
   * scroll path may stop the loader for good; a plain miss (too soon, autoLoad off) leaves it armed.
   */
  async function loadOne(force = false) {
    if (pag.busy) return { ok: false, reason: 'already loading', retry: true };
    if (pag.done) return { ok: false, reason: 'the end of the list was already reached', done: true };
    const settings = api.getSettings();
    if (!force && !settings.autoLoad) return { ok: false, reason: 'autoLoad is off' };
    if (!api.LIST_RE.test(location.pathname)) return { ok: false, reason: 'not a list page' };
    const now = api.cards();
    if (!now.length) return { ok: false, reason: 'no cards on the page' };

    const info = parseShown(document.body.innerText);
    // Everything the site has is already here: stop *before* spending a request. On the final partial page
    // (e.g. offset 290 with 7 cards out of 297) the "Displaying 7" counter is the page's size, not its
    // position, so the position has to come from the URL.
    const here = pageOffset(location.pathname) + now.length;
    if (info && info.total && here >= info.total) {
      return { ok: false, reason: 'every result is already loaded', done: true };
    }
    // Past the recency window: the next page is entirely stale, so it is not worth a request. This is the
    // same horizon the deep scan pages by — without it the loader happily pulled page after page of listings
    // the rule pass would hide on arrival.
    if (pastHorizon(api.cards().map(api.postedAt), Date.now(), settings.maxAgeDays)) {
      return { ok: false, reason: HORIZON, done: true };
    }
    if (force) {
      const wait = MIN_GAP_MS - (Date.now() - pag.lastAt);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    } else if (Date.now() - pag.lastAt < MIN_GAP_MS) {
      return { ok: false, reason: 'too soon', retry: true };
    }

    pag.busy = true;
    pag.lastAt = Date.now();
    const container = now[0].parentElement;
    const seen = new Set(now.map(c => jobKeyOf(c, ownText)));
    try {
      const url = nextPageUrl(location.href, here);
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) return { ok: false, reason: `the next page returned ${res.status}`, done: true };
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      // A page of nothing but jobs we already have means we are at the end (or the site repeats itself) —
      // never keep fetching on the strength of a count alone.
      const incoming = [...doc.querySelectorAll(self.OJCPager.SELECTOR)]
        .filter(c => { const k = jobKeyOf(c, ownText); return !seen.has(k) && (seen.add(k), true); });
      if (!incoming.length) return { ok: false, reason: 'the next page held no jobs we did not already have', done: true };
      for (const c of incoming) container.appendChild(document.importNode(c, true));
      placeSentinel();   // the new last card is further down; the trigger must follow it
      pag.pages++;
      return { ok: true, added: incoming.length, url };
    } catch {
      return { ok: false, reason: 'offline or blocked', done: true };
    } finally {
      pag.busy = false;
    }
  }

  /**
   * A settings change can move the horizon — a wider window means there are more pages worth loading — so a
   * loader that stopped *because of the window* is armed again. One that reached the real end of the results
   * is not: there is nothing behind it to find.
   */
  function rearm() {
    if (pag.done && pag.reason === HORIZON) { pag.done = false; pag.reason = ''; }
    arm();
  }

  /** The scroll path (W6/D8): the guards ARE the feature, so it keeps them and stops only on a real end. */
  async function loadNextPage() {
    if (pag.busy || pag.done || !api.getSettings().autoLoad) return;
    api.setNote('loading more…');
    const r = await loadOne(false);
    api.setNote('');
    if (!r.ok) {
      if (r.done) stop(r.reason);
      return;
    }
    api.refreshRules(); // the observer sees the insertion too; this makes the repaint immediate
    console.log(`[OJ Cleaner] loaded ${r.added} more jobs (page ${pag.pages + 1})`);
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
  /**
   * Arm on real user input only — a wheel, a touch drag, a scroll key or a mousedown (scrollbar drag).
   * A bare `scroll` event is not proof of intent: the page itself can scroll programmatically, and
   * counting that would let the site pull pages the user never asked for.
   */
  const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);
  function hookGestures() {
    if (scrollHooked) return;
    const bump = () => { pag.gesture++; maybeLoad(); };
    for (const ev of ['wheel', 'touchmove', 'mousedown']) {
      window.addEventListener(ev, bump, { passive: true });
    }
    window.addEventListener('keydown', (e) => { if (SCROLL_KEYS.has(e.key)) bump(); }, { passive: true });
    window.addEventListener('scroll', maybeLoad, { passive: true });
    scrollHooked = true;
  }

  function maybeLoad() {
    if (!visible || pag.busy || pag.done) return;
    if (pag.gesture <= pag.spent) return; // this gesture has already bought its page
    pag.spent = pag.gesture;
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
    hookGestures();
  }

  self.OJCLoader = {
    arm,
    rearm,
    stop: () => stop('turned off'),
    loadOne,                                   // the scan's door into the same fetch path (W13)
    isDone: () => pag.done,
    stopReason: () => pag.reason,
    pagesLoaded: () => pag.pages,
  };
})();
