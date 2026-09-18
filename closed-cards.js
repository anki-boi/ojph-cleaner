/**
 * closed-cards.js — the applier for the closed-listing memory (W9.2–W9.4).
 *
 * Reads and writes `chrome.storage.local.closedJobs`, keeps one in-memory copy for the rule pass to read
 * synchronously, marks what it remembers, and learns a closure the only moment one is visible: on the
 * listing's own page, where OJ.ph prints "This job has been closed".
 *
 * Deliberately not a crawler. Nothing here fetches a listing to ask whether it is still open — that would
 * mean one request per card, which is the property docs/scraping.md exists to protect. The memory grows
 * from what you actually opened, and says so by staying empty until you do.
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage) return; // node: nothing to do
  const pure = self.OJClosed, api = self.OJC;
  if (!pure || !api) return;

  const KEY = 'closedJobs';
  const MAX_AGE_MS = pure.HISTORY_DAYS * 86400000;
  const SAVED_PATH = '/jobseekers/bookmarked_jobs';
  const JOB_LINK = 'a[href*="/jobseekers/job/"]';
  // The closure notice sits above the description, next to the title. Reading just the head of the page
  // keeps a listing's own prose ("we are no longer accepting applications for other roles") from being
  // mistaken for the site's notice.
  const HEAD_CHARS = 1000;

  let held = {};          // id → { at } — what the rule pass reads, kept in sync with storage
  let loaded = false;

  /**
   * Does the page in front of you say the listing is closed? A live DOM read, so callers never race the
   * async `learn()` below — the detail bar asks this directly.
   */
  const pageSaysClosed = () =>
    pure.isClosedText((document.body.innerText || '').slice(0, HEAD_CHARS));

  const jobIdOfCard = (card) => {
    const a = card.querySelector(JOB_LINK);
    return a ? pure.jobIdFrom(a.getAttribute('href')) : null;
  };
  /** Cards, saved rows and job pages all carry the id the same way — in a link, or in the location. */
  const isHeld = (card) => !!held[jobIdOfCard(card)];

  function badgeEl() {
    const b = document.createElement('span');
    b.className = 'ojc-closed-badge';
    b.textContent = '⊘ closed';
    b.title = 'you saw this listing closed — remembered so it stops appearing';
    return b;
  }

  /** Mark a board card: grey, labelled, revealed only by Show all (the rules decide the hiding). */
  function mark(card) {
    card.classList.add('ojc-closed');
    if (!card.querySelector('.ojc-closed-badge')) card.prepend(badgeEl());
  }

  /**
   * Mark the saved-jobs table's rows (a React table — different markup from the board, and the only
   * place dead listings pile up: 4 of 16 measurably). The row stays visible: it may be the only place
   * the row can be deleted from.
   */
  function markRows() {
    if (location.pathname !== SAVED_PATH) return 0;
    let n = 0;
    for (const row of document.querySelectorAll('tr')) {
      const link = row.querySelector(JOB_LINK);
      if (!link || !held[pure.jobIdFrom(link.getAttribute('href'))]) continue;
      row.classList.add('ojc-closed-row');
      if (!row.querySelector('.ojc-closed-badge')) {
        // Beside the title, inside whatever element holds the link — a row can be rendered without its
        // cells being in place yet, and a badge parented to the <tr> is not where a table puts a cell.
        (link.parentNode || row).appendChild(badgeEl());
        n++;
      }
    }
    return n;
  }

  /**
   * Learn a closure from the page in front of you. Only the listing's own page can teach this, and the
   * write prunes at the same time, so the map cannot grow without bound (6 months ≈ 54 KB of ids).
   */
  async function learn() {
    const id = pure.jobIdFrom(location.pathname);
    if (!id || !pageSaysClosed()) return null;
    if (held[id]) return null;                  // already known: nothing to write
    await remember(id);
    return id;
  }

  async function remember(id) {
    if (!id) return;
    // Read-modify-write, not a blind write of the in-memory copy: two tabs can each hold a map that
    // predates the other's closure, and the second write would delete the first one's memory. Measured
    // live: five closings, one survivor. The window left is one get→set, not one page lifetime.
    // ponytail: not atomic — chrome.storage has no compare-and-set. A lost update here costs one
    // remembered listing, which the next visit re-learns; a transaction would cost a background worker.
    const store = (await chrome.storage.local.get(KEY))[KEY];
    held = pure.record(pure.prune(store, Date.now(), MAX_AGE_MS), id, Date.now(), MAX_AGE_MS);
    await chrome.storage.local.set({ [KEY]: held });
  }

  /** Read the memory once at boot, then re-run the rules: the first pass ran before it was loaded. */
  async function load() {
    const store = (await chrome.storage.local.get(KEY))[KEY];
    held = pure.prune(store, Date.now(), MAX_AGE_MS);
    loaded = true;
    api.refreshRules();
    markRows();
  }

  // The saved-jobs table is a React table and renders its rows in batches, so the first pass can run
  // before any row exists. A trailing debounce — reset on every mutation — means the LAST batch always
  // gets a pass; the earlier one-shot version dropped the mutations that arrived mid-render and left
  // rows unmarked (found live: 1 of 3 marked). Our own badge insertion is ignored, so it cannot loop.
  const ours = (node) => node.nodeType === 1 &&
    (node.classList?.contains('ojc-closed-badge') || node.classList?.contains('ojc-closed-row'));
  function watchRows() {
    if (location.pathname !== SAVED_PATH) return;
    let timer = null;
    const queue = () => { clearTimeout(timer); timer = setTimeout(markRows, 150); };
    new MutationObserver((muts) => {
      if (muts.some(m => [...m.addedNodes, ...m.removedNodes].some(n => n.nodeType === 1 && !ours(n)))) queue();
    }).observe(document.body, { childList: true, subtree: true });
    queue();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) {
      held = pure.prune(changes[KEY].newValue, Date.now(), MAX_AGE_MS);
      api.refreshRules();
    }
  });

  const boot = async () => {
    // Load FIRST. Running these concurrently let `load` overwrite the map `learn` had just written, which
    // is how five closures were remembered as one (found live, not in a test).
    await load();
    await learn();
    markRows();
    watchRows();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  self.OJCClosed = {
    isHeld, mark, markRows, remember, load, learn, pageSaysClosed,
    size: () => Object.keys(held).length,
    isLoaded: () => loaded,
  };
})();
