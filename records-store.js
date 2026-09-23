/**
 * records-store.js — the persistence side of the job memory (spec.md W12, D35/D36).
 *
 * Split from records-cards.js when that file passed the gate's 300-line cap. The split follows the
 * boundary the old file already documented: records-cards.js answers the rule pass **synchronously**
 * (it runs inside a requestAnimationFrame, where a promise is a race), and this file is everything
 * that touches disk — loading the memory, hydrating the cached descriptions, flushing dirty
 * records, and the `absorb`/`recheck` entry points that create and update records.
 *
 * Both halves share one state object (`S`), owned here. records-cards.js reads it synchronously;
 * this file is the only writer, so "write only when something changed" is enforced in exactly one
 * place. The pure state machine lives in records.js, the pure verdict in tiers.js — the same split
 * as closed.js/closed-cards.js, for the same reason.
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage) return; // node: nothing to do
  const pure = self.OJCRecords, tiers = self.OJCTiers, parse = self.OJCDetailParse;
  const closed = self.OJClosed, rules = self.OJRules, planner = self.OJCDetailText;
  const api = self.OJC, cache = self.OJCDetailCache;
  if (!pure || !tiers || !parse || !api || !cache) return;

  const canon = pure.canon;   // key-order-insensitive compare (see records.canon)
  const KEY = 'jobRecords';
  const MAX_AGE_MS = pure.HISTORY_DAYS * 86400000;
  const EMPTY_CARD = { pos: [], neg: [], goal: false };

  /** Shared state. records-cards.js reads these synchronously; this file is the only writer. */
  const S = {
    settings: {},        // the settings the facts were derived under
    held: {},            // id → record, as stored
    texts: new Map(),    // id → the listing's own page (description + overview fields)
    facts: new Map(),    // id → description facts derived from `texts` under the CURRENT settings
    dirty: new Set(),    // ids whose record changed and must be written
    currentSk: 0,        // the keyword-list signature those facts were derived under
    ready: false,        // the cached descriptions for this page have been hydrated
    writing: false,
    lastWritten: '',
    loadPromise: null,
    missing: new Set(),  // ids the cache did not have — asked for once, never again on this page
    hydrating: false,
  };

  const idOf = (card) => {
    const a = card.querySelector('a[href*="/jobseekers/job/"]');
    return a ? closed.jobIdFrom(a.getAttribute('href')) : null;
  };

  /** The facts a description yields. `planner.plan` is the detail page's own detector (W4), so the board
   *  and a listing's page can never disagree about what an off-platform ask is. A week longer than
   *  40 hours is deliberately NOT derived here — it lives in the record's `fields.hoursPerWeek`, which
   *  salary-cards.js reads to print the hours badge in the warning colour, and it never moves a tier. */
  const derive = (text) => (text
    ? tiers.detailFacts(text, S.settings, rules.matchKeywords, planner.plan)
    : null);

  /** See `records.js`'s `sameFacts`: pure, so it is pinned by the unit tests rather than by this glue. */
  const sameFacts = pure.sameFacts;

  /** Merge the dirty records into what is on disk. Never a blind write of the in-memory map: another tab
   *  may have remembered a listing since this one booted, and a whole-map write would delete it. */
  async function flush() {
    if (S.writing || !S.dirty.size) return;
    S.writing = true;
    const ids = [...S.dirty];
    S.dirty.clear();
    try {
      const stored = (await chrome.storage.local.get(KEY))[KEY];
      const merged = pure.prune(stored, Date.now(), MAX_AGE_MS);
      for (const id of ids) if (S.held[id]) merged[id] = S.held[id];
      S.held = { ...S.held, ...merged };
      const json = canon(S.held);
      // Set this BEFORE the await. `chrome.storage.local.set` fires `onChanged` in this very context, and
      // the event can arrive before the promise resolves — so the echo used to look like another tab's
      // write, and the listener replaced the in-memory map with the older on-disk one. Measured live:
      // 27 listings scanned, 2 records saved, every record added since the last write silently dropped.
      S.lastWritten = json;
      await chrome.storage.local.set({ [KEY]: S.held });
    } catch (e) {
      console.warn('[OJ Cleaner] could not save the job memory', e);
      for (const id of ids) S.dirty.add(id);   // retry on the next change instead of losing it silently
    } finally {
      S.writing = false;
      if (S.dirty.size) flush();
    }
  }

  /** Which records are worth reading the cache for: the ids on this page, and only where one exists — so a
   *  profile with no scans performs zero IndexedDB work on every page load. */
  function pageIds() {
    const ids = new Set();
    for (const card of api.cards()) {
      const id = idOf(card);
      if (id && S.held[id]) ids.add(id);
    }
    const here = parse.jobIdOf(location.pathname);
    if (here && S.held[here]) ids.add(here);
    return [...ids];
  }

  async function hydrate(ids) {
    if (!ids.length) return 0;
    const rows = await cache.getMany(ids);
    // Remember what the cache did not have, so a card whose listing was never cached is not looked up on
    // every pass for the rest of the page's life.
    for (const id of ids) if (!rows.has(id)) S.missing.add(id);
    let changed = false;
    for (const [id, row] of rows) {
      S.texts.set(id, row);
      S.facts.set(id, derive(row.desc));
      // Keep the stored keyword facts in step with the settings they were derived under. Without this a
      // record would claim a verdict computed from an older keyword list, and the live harness — which
      // reads that same record to recompute the expected tier — would disagree with the board.
      if (S.held[id] && S.held[id].sk !== S.currentSk) {
        const next = pure.apply(S.held[id], { tier: S.held[id].tier, detail: S.facts.get(id), sk: S.currentSk }, Date.now());
        S.held[id] = next;
        S.dirty.add(id);
        changed = true;
      }
    }
    if (changed) await flush();
    return rows.size;
  }

  /**
   * Read the cache for any card on this page that has a record but no facts yet. Called from the rule
   * pass, which runs whenever the page's cards change.
   *
   * `load()` hydrates ONCE, when the script boots, and that is not enough: the site's list can render
   * after `document_idle`, and a page whose cards are not in the DOM yet hydrates nothing at all. The
   * symptom is quiet but complete — the deep scan's keywords, off-platform tags and `HOURS PER WEEK`
   * simply do not appear on that load, on every card, until something else happens to re-run the pass.
   * The live harness caught it as seven cards whose figure did not match the hours the scan had
   * recorded for them.
   */
  function hydrateNew() {
    if (!S.ready || S.hydrating) return;
    const ids = pageIds().filter(id => !S.texts.has(id) && !S.missing.has(id));
    if (!ids.length) return;
    S.hydrating = true;
    hydrate(ids)
      .then(n => { if (n) api.refreshRules(); })   // the descriptions are in hand: re-decide the page
      .catch(e => console.warn('[OJ Cleaner] could not read the detail cache', e))
      .finally(() => { S.hydrating = false; });
  }

  /** Read the memory once, then re-run the rules: the first pass ran before it was loaded. Idempotent —
   *  the boot and the settings load both race to call it, and the later call must not start over. */
  function load() {
    if (!S.loadPromise) {
      S.loadPromise = (async () => {
        S.held = pure.prune((await chrome.storage.local.get(KEY))[KEY], Date.now(), MAX_AGE_MS);
        S.currentSk = pure.settingsKey(S.settings);
        api.refreshRules();          // card-level verdicts, and the memory is awake for the badge
        await hydrate(pageIds());
        S.ready = true;
        api.refreshRules();          // …and now with the descriptions in hand: promote / demote
      })().catch((e) => {
        console.warn('[OJ Cleaner] the job memory failed to load', e);
        S.ready = true;
      });
    }
    return S.loadPromise;
  }

  /** Store a listing's own words. Shared by the scan and by a manual visit. */
  async function remember(id, url, page) {
    const row = { id: String(id), url, at: Date.now(), desc: page.description, closed: page.closed,
      fields: { typeOfWork: page.typeOfWork, wage: page.wage, hoursPerWeek: page.hoursPerWeek,
                dateUpdated: page.dateUpdated } };
    await cache.put(row);
    S.texts.set(String(id), row);
    S.facts.set(String(id), derive(page.description));
    return row;
  }

  /**
   * The scan's entry point: a fetched listing's document plus the facts the board already knows about its
   * card. Writes the cache, updates the record, and reports whether the tier moved.
   */
  async function absorb(id, doc, decideInput) {
    await load();
    const sid = String(id);
    const page = parse.parse(doc);
    if (!page.ok && !page.closed) return { ok: false, reason: 'no description on the page' };
    if (page.ok) await remember(sid, decideInput.url, page);
    const at = Date.now();
    const prev = S.held[sid] || null;
    const tier = tiers.decide({ ...decideInput, closed: decideInput.closed || page.closed,
      detail: page.ok ? S.facts.get(sid) : null });
    const next = pure.apply(prev, { tier, scannedAt: at, sk: S.currentSk, card: decideInput.card,
      detail: page.ok ? S.facts.get(sid) : undefined,
      fields: page.ok ? S.texts.get(sid).fields : undefined }, at);
    S.held[sid] = next;
    S.dirty.add(sid);
    await flush();
    return { ok: true, tier, prevTier: prev ? prev.tier : null, moved: !!prev && prev.tier !== tier, closed: page.closed };
  }

  /**
   * A listing's own page, opened by you: re-derive from the live document, record what changed, and clear
   * the change mark — you are looking at it right now, so there is nothing left to tell you about it.
   */
  async function recheck(doc) {
    await load();
    const id = parse.jobIdOf(location.pathname);
    if (!id) return null;
    const sid = String(id);
    const page = parse.parse(doc);
    const now = Date.now();
    if (page.ok) await remember(sid, location.href, page);
    const prev = S.held[sid] || null;
    const next = pure.apply(prev, {
      // The card-level rules (stale, no salary) were decided on the board and are not re-litigated here: a
      // record only exists for a listing that passed them. What this page adds is its own words.
      tier: tiers.decide({ closed: page.closed, card: (prev && prev.card) || EMPTY_CARD,
                           detail: page.ok ? S.facts.get(sid) : null }),
      scannedAt: page.ok ? now : undefined,
      sk: S.currentSk,
      detail: page.ok ? S.facts.get(sid) : undefined,
      fields: page.ok ? S.texts.get(sid).fields : undefined,
    }, now);
    next.seen = true;
    // Only write when something actually moved. A re-check runs on every settings change and every visit
    // to the page, and a record written unconditionally would fire `chrome.storage.onChanged` for nothing.
    if (prev && sameFacts(prev, next)) return next;
    S.held[sid] = next;
    S.dirty.add(sid);
    await flush();
    return next;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    const value = changes[KEY].newValue || {};
    // Our own write echoes back; adopting it again would be a second pass per write for nothing. Compared
    // key-order-insensitively, because Chrome hands the object back with its keys reordered and a plain
    // stringify says "different" for a byte-identical record — which is what let the write loop run.
    if (canon(value) === S.lastWritten) return;
    const next = pure.prune(value, Date.now(), MAX_AGE_MS);
    // Another tab's write must not be able to delete a record this tab has changed but not yet written: the
    // disk value is older than `held` for exactly the ids still in `dirty`, so those win.
    for (const id of S.dirty) if (S.held[id]) next[id] = S.held[id];
    // And a STALE snapshot must not undo a record this tab has already moved past — our own write's echo can
    // arrive after a newer one is in flight, which is the other half of the 45-passes/second loop above:
    // the echo was adopted wholesale, the difference it re-created was seen as a change, and the pass that
    // saw it wrote storage again. `checkedAt` orders two copies of the same record; the newer one wins, and a
    // tie keeps the in-memory copy because that is the one carrying this tab's work.
    for (const id of Object.keys(next)) {
      const mine = S.held[id];
      if (mine && (mine.checkedAt || 0) >= (next[id].checkedAt || 0)) next[id] = mine;
    }
    S.held = next;
    api.refreshRules();
  });

  chrome.storage.local.get('settings', (res) => {
    S.settings = { ...(res?.settings || {}) };
    load();
  });

  self.OJCRStore = {
    S, idOf, derive, sameFacts,
    flush, load, hydrate, hydrateNew, remember, absorb, recheck,
  };
})();
