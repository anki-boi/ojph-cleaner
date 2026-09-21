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

  /** The tier a scan gave the listing, as a mark on its saved row (F2): the saved table is where the
   *  user comes back to, so a row the scan has graded says so there. A mark, not a filter — the row
   *  stays exactly where the site put it. Tiers a scan never reached carry no mark at all. */
  const TIER_MARK = { high: '★ high yield', worth: 'worth considering', pos: '✓ highlighted' };

  /**
   * Mark the saved-jobs table's rows (a React table — different markup from the board, and the only
   * place dead listings pile up: 4 of 16 measurably). The row stays visible: it may be the only place
   * the row can be deleted from. Each row that carries a listing id gets two marks, independently:
   * the closure badge when the memory has it, and the scan's tier when a record does.
   */
  function markRows() {
    if (location.pathname !== SAVED_PATH) return 0;
    const recs = self.OJCRecordsUI?.all?.() || {};
    let n = 0;
    for (const row of document.querySelectorAll('tr')) {
      const link = row.querySelector(JOB_LINK);
      if (!link) continue;
      const id = pure.jobIdFrom(link.getAttribute('href'));
      // Beside the title, inside whatever element holds the link — a row can be rendered without its
      // cells being in place yet, and a badge parented to the <tr> is not where a table puts a cell.
      const cell = link.parentNode || row;
      if (held[id]) {
        row.classList.add('ojc-closed-row');
        if (!row.querySelector('.ojc-closed-badge')) { cell.appendChild(badgeEl()); n++; }
      }
      const label = recs[id] && TIER_MARK[recs[id].tier];
      const mark = row.querySelector('.ojc-row-tier');
      if (label) {
        if (!mark) {
          mark = document.createElement('span');
          mark.className = 'ojc-row-tier';
          cell.appendChild(mark);
        }
        mark.textContent = label;
        mark.title = 'what the deep scan judged this listing to be';
      } else if (mark) mark.remove();
    }
    return n;
  }

  /** The tier marks need the job memory, which loads in its own module on its own clock. Ask it to be
   *  loaded, then mark again — the React table re-renders in batches anyway, and this makes sure the
   *  LAST pass has the records in hand. */
  function tierRows() {
    const load = self.OJCRecordsUI?.load;
    if (!load) return;
    Promise.resolve(load()).then(markRows).catch(() => {});
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
    (node.classList?.contains('ojc-closed-badge') || node.classList?.contains('ojc-closed-row') ||
     node.classList?.contains('ojc-row-tier'));
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
    if (area !== 'local') return;
    if (changes[KEY]) {
      held = pure.prune(changes[KEY].newValue, Date.now(), MAX_AGE_MS);
      api.refreshRules();
    }
    // A scan in another tab re-grades the rows you bookmarked: the tier marks must follow it.
    if (changes.jobRecords && location.pathname === SAVED_PATH) markRows();
  });

  const boot = async () => {
    // Load FIRST. Running these concurrently let `load` overwrite the map `learn` had just written, which
    // is how five closures were remembered as one (found live, not in a test).
    await load();
    await learn();
    markRows();
    tierRows();
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
