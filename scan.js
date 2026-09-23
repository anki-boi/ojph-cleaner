/**
 * scan.js — the deep scan (spec.md W13, D33/D34/D37).
 *
 * Two phases behind one button:
 *
 *   1. **Preliminary.** Page through the results until the recency window ends. The board is sorted
 *      newest-first (verified live 2026-09-18 across five offsets), so the horizon is a one-page
 *      lookahead: fetch a page, and if its newest card is already older than `maxAgeDays`, every page after
 *      it is too. A watchdog checks that assumption on every page and stops loudly if the site ever sorts
 *      differently — without it a sort-order change would silently skip half the results.
 *   2. **Deep.** Open each listing and re-decide it with its own words: High yield first, then Worth
 *      considering, then (only with `scanAll`) everything else. 2 at a time, 400 ms between pairs, and a
 *      hard cap on pages, listings and time.
 *
 * The politeness story this replaces (D5/D8 forbade both halves) is: **nothing runs unless the button is
 * pressed.** Outside a run, the old rules are untouched — an idle page still spends zero requests. Inside
 * a run the user asked for, the caps and the Stop button are the guarantee, and every result is cached so
 * the second run of the same page is free.
 *
 * This file owns no rule logic and no storage: it decides *when* to ask records-cards.js to re-derive a
 * listing, and that module decides what the re-derivation means.
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage) return; // node: nothing to do
  const api = self.OJC, parse = self.OJCDetailParse, records = self.OJCRecordsUI;
  const loader = self.OJCLoader, closed = self.OJCClosed, cache = self.OJCDetailCache;
  if (!api || !parse || !records || !loader || !cache) return;

  const MAX_PAGES = 10;        // 300 cards: a full 300-result search, and a bounded run
  const MAX_LISTINGS = 300;
  const MAX_MS = 10 * 60 * 1000;
  const CONCURRENCY = 2;       // the user's own budget ("two at a time")
  const GAP_MS = 400;          // between pairs, never between the two in a pair
  /** Order of the passes (D34): High yield, then Worth considering, then — only if asked — the rest. A
   *  highlighted card (a keyword you like, below your goal) rides with Worth considering: it is the other
   *  "interesting but not high-yield" bucket, and its description is still worth reading. */
  const RANK = { high: 0, worth: 1, pos: 1, kw: 2, none: 2 };
  const st = { running: false, stopped: false, attempted: 0, total: 0, pages: 0, promoted: 0,
    demoted: 0, closed: 0, cached: 0, failed: 0, noDesc: 0, reasons: [], reason: '' };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const label = () => (st.running && st.total ? `${st.attempted}/${st.total}` : '');
  const isRunning = () => st.running;

  /** The most recent posted time among these cards, or null when none of them states one. */
  const newestPosted = (cards) => {
    let newest = null;
    for (const c of cards) {
      const at = api.postedAt ? api.postedAt(c) : null;
      if (at != null && (newest === null || at > newest)) newest = at;
    }
    return newest;
  };

  // ── Phase 1: paginate to the recency horizon ─────────────────────────────
  async function paginate() {
    const settings = api.getSettings();
    const days = Number(settings.maxAgeDays) > 0 ? Number(settings.maxAgeDays) : 0;
    const horizon = days ? days * 86400000 : 0;
    let newest = newestPosted(api.cards());
    let retries = 0;
    while (st.pages < MAX_PAGES && !st.stopped) {
      const before = api.cards().length;
      const r = await loader.loadOne(true);
      if (!r.ok) {
        if (r.retry) {
          // The only retry a FORCED load can give is "another load is in flight" — a user scroll racing
          // the scan's first page. That clears in a beat; if it does not, something is stuck, and the
          // loop must not busy-wait on it for the rest of the run. 25 × 400 ms = 10 s, then give up.
          if (retries++ >= 25) { st.reason = 'could not load the next page'; return; }
          await sleep(400);
          continue;
        }
        st.reason = r.reason;
        return;
      }
      retries = 0;
      st.pages++;
      api.refreshRules();                       // the imported cards join the counts immediately
      const fresh = api.cards().slice(before);
      const newestNew = newestPosted(fresh);
      // The watchdog: this rule is only valid while the board is newest-first.
      if (newestNew != null && newest != null && newestNew > newest) {
        st.reason = 'the board is no longer sorted by date, so the recency window cannot say where to stop';
        return;
      }
      if (newestNew != null) newest = newestNew;
      if (horizon && newestNew != null && Date.now() - newestNew > horizon) {
        st.reason = `every job on page ${st.pages + 1} is older than your ${days}-day window`;
        return;
      }
      api.setNote(`scanning: loaded ${api.cards().length} jobs…`);
    }
    st.reason = st.pages >= MAX_PAGES ? `stopped at the ${MAX_PAGES}-page cap` : 'reached the end of the results';  }

  // ── Phase 2: open the listings, priority first ───────────────────────────
  /** The queue, in pass order. Cards hidden by a closed/stale/no-salary verdict are not scanned — no
   *  request can change a fact — and everything below Worth considering waits for `scanAll`. */
  function buildQueue() {
    const settings = api.getSettings();
    const items = [];
    for (const c of api.cards()) {
      const tier = api.tierOf(c);
      const rank = RANK[tier];
      if (rank === undefined) continue;                                  // closed / stale / nosal
      if (rank === 1 && !settings.scanWorth) continue;                    // pass 2
      if (rank === 2 && !settings.scanAll) continue;                      // pass 3, off by default
      const a = c.querySelector('a[href*="/jobseekers/job/"]');
      if (!a) continue;
      const id = parse.jobIdOf(a.getAttribute('href'));
      if (!id) continue;
      const cachedAt = records.cachedAt(id);
      if (cachedAt && Date.now() - cachedAt < cache.TTL_MS) { st.cached++; continue; }
      items.push({ id, url: a.href, card: c, rank });
    }
    return items.sort((x, y) => x.rank - y.rank);
  }

  /** One listing. A 429 or a network error stops the whole fleet — the plan's politeness rule, and the
   *  opposite of the retry-harder behaviour that gets an account noticed. */
  async function fetchOne(item) {
    st.attempted++;
    const note = (why) => { if (st.reasons.length < 5 && !st.reasons.includes(why)) st.reasons.push(why); };
    try {
      const res = await fetch(item.url, { credentials: 'same-origin' });
      if (res.status === 429) {
        st.reason = 'the site asked us to slow down (HTTP 429)';
        st.stopped = true;
        return;
      }
      if (!res.ok) { st.failed++; note(`HTTP ${res.status}`); return; }
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const r = await records.absorb(item.id, doc, {
        url: item.url, card: api.cardFactsOf(item.card), closed: false, stale: false, noSalary: false,
      });
      if (!r.ok) { st.noDesc++; note(r.reason || 'no description'); return; }
      if (r.closed) { st.closed++; await closed?.remember?.(item.id); }
      if (r.moved) (RANK[r.tier] < RANK[r.prevTier] ? st.promoted++ : st.demoted++);
    } catch (e) {
      st.reason = `offline or blocked (${e && e.name ? e.name : 'fetch failed'})`;
      st.stopped = true;
    }
  }

  async function deepScan(items, startedAt) {
    st.total = items.length;
    if (!items.length) { st.reason = st.reason || 'nothing left to scan'; return; }
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      if (st.stopped) break;
      if (st.attempted >= MAX_LISTINGS) { st.reason = `stopped at the ${MAX_LISTINGS}-listing cap`; break; }
      if (Date.now() - startedAt > MAX_MS) { st.reason = 'stopped at the 10-minute cap'; break; }
      await Promise.all(items.slice(i, i + CONCURRENCY).map(fetchOne));
      // The rule pass redraws the whole board, so on a 298-card list it is the expensive part of a wave (~150
      // waves in a full run). Every fifth wave — ten listings at 2 at a time — keeps the re-tiering visibly
      // live without paying a full pass per listing; the run always ends with one.
      if ((i / CONCURRENCY) % 5 === 0 || i + CONCURRENCY >= items.length) api.refreshRules();
      api.setNote(`scanning ${st.attempted}/${st.total} · ${st.promoted} promoted · ${st.demoted} demoted`);
      if (i + CONCURRENCY < items.length && !st.stopped) await sleep(GAP_MS);
    }
  }

  // ── The button ───────────────────────────────────────────────────────────
  const outcome = () => {
    const n = st.attempted - st.failed - st.noDesc;
    const bits = [`${n} scanned`];
    if (st.promoted) bits.push(`${st.promoted} promoted`);
    if (st.demoted) bits.push(`${st.demoted} demoted`);
    if (st.closed) bits.push(`${st.closed} closed`);
    if (st.cached) bits.push(`${st.cached} already cached`);
    if (st.failed) bits.push(`${st.failed} fetch error${st.failed === 1 ? '' : 's'}`);
    if (st.noDesc) bits.push(`${st.noDesc} with no description`);
    if (st.pages) bits.push(`${st.pages} result page${st.pages === 1 ? '' : 's'}`);
    return bits.join(' · ') + (st.reason ? ` — ${st.reason}` : '') +
      (st.reasons.length ? ` [${st.reasons.join('; ')}]` : '');
  };

  function stop(why) {
    if (!st.running) return;
    st.stopped = true;
    st.reason = why || 'stopped by you';
  }

  async function start() {
    if (st.running) return;
    if (!api.hasSomethingToScanFor()) {
      api.setNote('nothing to scan for: add a keyword or a salary goal first');
      return;
    }
    if (!api.LIST_RE.test(location.pathname)) {
      api.setNote('the scan runs on a job list page');
      return;
    }
    Object.assign(st, { running: true, stopped: false, attempted: 0, total: 0, pages: 0, promoted: 0,
      demoted: 0, closed: 0, cached: 0, failed: 0, noDesc: 0, reasons: [], reason: '' });
    const startedAt = Date.now();
    api.setNote('scanning: loading result pages…');
    try {
      await paginate();
      const queue = buildQueue();
      if (!st.stopped) await deepScan(queue, startedAt);
    } catch (e) {
      st.reason = `stopped: ${(e && e.message) || e}`;
    } finally {
      st.running = false;
      api.refreshRules();
      // D41: a run has ended, so the board may be ranked — ANY end, because a partial ranking of the
      // figures we do have is still honest, and the next run moves cards up as more of them are stated.
      self.OJCPaySort?.afterScan?.();
      api.setNote(outcome());
      console.log('[OJ Cleaner] scan', st);
    }
  }

  const toggle = () => (st.running ? stop() : start());

  /** D36's free half: a settings change re-derives every cached description (records-cards.onSettings),
   *  so a scan in flight has nothing to update here — but a scan that is *stopped* by a settings change
   *  would leave a stale progress note behind, so the note is refreshed. */
  const onSettings = () => { if (!st.running && st.reason) api.setNote(outcome()); };

  // `autoScan` (D4, finally functional in W13.6): off by default, because the promise of this feature is
  // that the site sees no traffic you did not ask for. Turned on, it waits for the page to settle first.
  chrome.storage.local.get('settings', (res) => {
    if (res?.settings?.autoScan) setTimeout(start, 1200);
  });

  self.OJCScan = { start, stop, toggle, isRunning, label, state: () => ({ ...st }), onSettings };
})();
