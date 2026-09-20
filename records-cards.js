/**
 * records-cards.js — the applier for the job memory (spec.md W12, D35/D36).
 *
 * Reads and writes `chrome.storage.local.jobRecords` (the light, synchronous verdict per listing) and
 * `detail-cache.js`'s IndexedDB store (the listing's own words, which make a keyword edit free). The pure
 * state machine lives in records.js and the pure verdict in tiers.js — the same split as
 * closed.js/closed-cards.js, for the same reason: the interesting logic must be testable without a browser.
 *
 * Three jobs, and the boundaries between them are the whole design:
 *
 *   1. **Answer the rule pass synchronously.** `detailFor(card)` must never await: the pass runs inside a
 *      requestAnimationFrame, and a promise there is a race, not a lookup. So the memory is read once at
 *      boot into an in-memory copy, exactly as the closed-listing memory does.
 *   2. **Write only when something changed.** The pass re-derives every card on every pass; writing per
 *      pass would hammer storage, fire `chrome.storage.onChanged`, and schedule the next pass forever
 *      (§2.2's loop, one layer up). Only a moved tier or changed facts marks a record dirty, and the flush
 *      merges into what is on disk rather than overwriting it — two tabs must not eat each other's memory
 *      (the read-modify-write the closed memory learned the hard way).
 *   3. **Never create a record for a card nobody asked about.** Records are born from a deep scan or from
 *      opening a listing. Creating one per card would grow storage with listings you never looked at.
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
  const JOB_LINK = 'a[href*="/jobseekers/job/"]';
  const EMPTY_CARD = { pos: [], neg: [], goal: false };
  const LABEL = { high: 'High yield', worth: 'Worth considering', pos: 'Highlighted',
    kw: 'hidden by a keyword', nosal: 'no salary', stale: 'stale', closed: 'closed', none: 'unclassified' };
  /** How interesting a verdict is, for reading a tier move as a promotion or a demotion. High yield is the
   *  top, because PAY is what makes it high yield (the user's rule); a keyword you like sits below it. */
  const RANK = { none: 0, nosal: 0, stale: 0, closed: 0, kw: 1, pos: 2, worth: 3, high: 4 };

  let settings = {};
  let held = {};              // id → record, as stored
  const texts = new Map();    // id → the listing's own page (description + overview fields)
  const facts = new Map();    // id → description facts derived from `texts` under the CURRENT settings
  const dirty = new Set();    // ids whose record changed and must be written
  let currentSk = 0;          // the keyword-list signature those facts were derived under
  let ready = false;          // the cached descriptions for this page have been hydrated
  let writing = false, lastWritten = '', loadPromise = null;
  const missing = new Set();   // ids the cache did not have — asked for once, never again on this page
  let hydrating = false;

  const idOf = (card) => {
    const a = card.querySelector(JOB_LINK);
    return a ? closed.jobIdFrom(a.getAttribute('href')) : null;
  };

  /** The facts a description yields. `planner.plan` is the detail page's own detector (W4), so the board
   *  and a listing's page can never disagree about what an off-platform ask is.
   *
   *  The listing's own `HOURS PER WEEK` adds one more fact (W13.7): **a week longer than 40 hours is
   *  flagged automatically.** It rides the same `flags` list the off-platform asks use, so it demotes a
   *  green card to Worth considering (or shows a plain one with its warning) through exactly one code
   *  path — and it is re-derived from the cached text on every settings change like everything else. */
  const derive = (text, hours) => (text
    ? tiers.detailFacts(text, settings, rules.matchKeywords, planner.plan, hours)
    : null);

  /**
   * The description facts for a card, or null when there are none to trust.
   *
   * Freshly derived facts win. When the cache has been evicted, the stored facts are used **only if they
   * were derived under these same keyword lists** (`sk`): keyword verdicts are relative to the settings,
   * the off-platform flags are not, and reusing a keyword match from an older list is exactly the class of
   * wrong this project refuses. When it cannot be trusted the card falls back to its own text, as if the
   * scan had never run (D36).
   */
  function detailFor(card) {
    const id = idOf(card);
    if (!id) return null;
    if (facts.has(id)) return facts.get(id);
    const rec = held[id];
    return rec && rec.sk === currentSk && rec.detail ? rec.detail : null;
  }

  /** The listing's own page fields, when a scan (or an opened page) learned them. W13.5 reads the hours to
   *  turn an assumed 40 h/week month into a stated one — and to flag a week longer than full time. */
  function hoursInfoFor(card) {
    const id = idOf(card);
    if (!id) return null;
    const fields = texts.get(id)?.fields ?? held[id]?.fields;
    const hours = Number(fields?.hoursPerWeek);
    if (!Number.isFinite(hours) || hours <= 0) return null;
    return { hours, type: fields.typeOfWork || null };
  }

  const recordFor = (card) => held[idOf(card)] || null;

  /**
   * The change mark: `↑ promoted` / `↓ demoted` on a card whose tier moved since you last looked at it.
   * Applied by the rule pass and cleared when the listing is opened (see `recheck`).
   */
  function mark(card) {
    const rec = recordFor(card);
    if (!pure.isChanged(rec)) return null;
    const up = (RANK[rec.tier] ?? 0) > (RANK[rec.prev] ?? 0);
    const el = document.createElement('span');
    el.className = 'ojc-tier-badge';
    el.textContent = up ? '↑ promoted' : '↓ demoted';
    el.title = `this listing was "${LABEL[rec.prev] || rec.prev}" when it was last checked and is now ` +
      `"${LABEL[rec.tier] || rec.tier}" — opening it clears this mark`;
    card.prepend(el);
    return rec;
  }

  /** Was this record materially different from the last one? Timestamps do not count — if they did, every
   *  pass would look like a change and storage would be rewritten forever. Nor does KEY ORDER: a record that
   *  comes back from `chrome.storage.local` is the same record with its keys in Chrome's order, and comparing
   *  those two with a plain stringify is false for a byte-identical record. Measured live, that single
   *  comparison produced 2 184 record writes and ~75 rule passes per second, forever, on an idle page. */
  const sameFacts = (a, b) => a.tier === b.tier && a.prev === b.prev && a.seen === b.seen &&
    a.sk === b.sk && canon(a.card) === canon(b.card) && canon(a.detail) === canon(b.detail) &&
    canon(a.fields) === canon(b.fields);

  /**
   * Fold a pass's verdict into the stored record. Called for every card by the rule pass; returns the new
   * record only when it actually moved, so the caller can skip everything else.
   */
  function note(card, tier, cardFacts) {
    // Until the page's own descriptions are hydrated, the pass is working from half a listing's text.
    // Deciding (and then writing) a verdict from half of it would invent demotions out of nothing.
    if (!ready) return null;
    const id = idOf(card);
    if (!id || !held[id]) return null;            // no record ⇒ nothing here was ever scanned or opened
    const next = pure.apply(held[id], { tier, card: cardFacts, detail: detailFor(card), sk: currentSk }, Date.now());
    if (sameFacts(held[id], next)) return null;
    held[id] = next;
    dirty.add(id);
    flush();
    return next;
  }

  /** Merge the dirty records into what is on disk. Never a blind write of the in-memory map: another tab
   *  may have remembered a listing since this one booted, and a whole-map write would delete it. */
  async function flush() {
    if (writing || !dirty.size) return;
    writing = true;
    const ids = [...dirty];
    dirty.clear();
    try {
      const stored = (await chrome.storage.local.get(KEY))[KEY];
      const merged = pure.prune(stored, Date.now(), MAX_AGE_MS);
      for (const id of ids) if (held[id]) merged[id] = held[id];
      held = { ...held, ...merged };
      const json = pure.canon(merged);
      // Set this BEFORE the await. `chrome.storage.local.set` fires `onChanged` in this very context, and the
      // event can arrive before the promise resolves — so the echo used to look like another tab's write,
      // and the listener replaced the in-memory map with the older on-disk one. Measured live: 27 listings
      // scanned, 2 records saved, every record added since the last write silently dropped.
      lastWritten = json;
      await chrome.storage.local.set({ [KEY]: merged });
    } catch (e) {
      console.warn('[OJ Cleaner] could not save the job memory', e);
      for (const id of ids) dirty.add(id);   // retry on the next change instead of losing it silently
    } finally {
      writing = false;
      if (dirty.size) flush();
    }
  }

  /** Re-derive every hydrated description under new settings — the whole point of caching the text (D36):
   *  a keyword edit re-tiers the page with zero requests. */
  function onSettings(next) {
    settings = { ...(next || {}) };
    currentSk = pure.settingsKey(settings);
    for (const [id, text] of texts) facts.set(id, derive(text.desc, text.fields?.hoursPerWeek));
  }

  /** Store a listing's own words. Shared by the scan and by a manual visit. */
  async function remember(id, url, page) {
    const row = { id: String(id), url, at: Date.now(), desc: page.description, closed: page.closed,
      fields: { typeOfWork: page.typeOfWork, wage: page.wage, hoursPerWeek: page.hoursPerWeek,
                dateUpdated: page.dateUpdated } };
    await cache.put(row);
    texts.set(String(id), row);
    facts.set(String(id), derive(page.description, page.hoursPerWeek));
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
    const prev = held[sid] || null;
    const tier = tiers.decide({ ...decideInput, closed: decideInput.closed || page.closed,
      detail: page.ok ? facts.get(sid) : null });
    const next = pure.apply(prev, { tier, scannedAt: at, sk: currentSk, card: decideInput.card,
      detail: page.ok ? facts.get(sid) : undefined,
      fields: page.ok ? texts.get(sid).fields : undefined }, at);
    held[sid] = next;
    dirty.add(sid);
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
    const prev = held[sid] || null;
    const next = pure.apply(prev, {
      // The card-level rules (stale, no salary) were decided on the board and are not re-litigated here: a
      // record only exists for a listing that passed them. What this page adds is its own words.
      tier: tiers.decide({ closed: page.closed, card: (prev && prev.card) || EMPTY_CARD,
                           detail: page.ok ? facts.get(sid) : null }),
      scannedAt: page.ok ? now : undefined,
      sk: currentSk,
      detail: page.ok ? facts.get(sid) : undefined,
      fields: page.ok ? texts.get(sid).fields : undefined,
    }, now);
    next.seen = true;
    // Only write when something actually moved. A re-check runs on every settings change and every visit to
    // the page, and a record written unconditionally would fire `chrome.storage.onChanged` for nothing.
    if (prev && sameFacts(prev, next)) return next;
    held[sid] = next;
    dirty.add(sid);
    await flush();
    return next;
  }

  /** Which records are worth reading the cache for: the ids on this page, and only where one exists — so a
   *  profile with no scans performs zero IndexedDB work on every page load. */
  function pageIds() {
    const ids = new Set();
    for (const card of api.cards()) {
      const id = idOf(card);
      if (id && held[id]) ids.add(id);
    }
    const here = parse.jobIdOf(location.pathname);
    if (here && held[here]) ids.add(here);
    return [...ids];
  }

  async function hydrate(ids) {
    if (!ids.length) return 0;
    const rows = await cache.getMany(ids);
    // Remember what the cache did not have, so a card whose listing was never cached is not looked up on
    // every pass for the rest of the page's life.
    for (const id of ids) if (!rows.has(id)) missing.add(id);
    let changed = false;
    for (const [id, row] of rows) {
      texts.set(id, row);
      facts.set(id, derive(row.desc, row.fields?.hoursPerWeek));
      // Keep the stored keyword facts in step with the settings they were derived under. Without this a
      // record would claim a verdict computed from an older keyword list, and the live harness — which
      // reads that same record to recompute the expected tier — would disagree with the board.
      if (held[id] && held[id].sk !== currentSk) {
        const next = pure.apply(held[id], { tier: held[id].tier, detail: facts.get(id), sk: currentSk }, Date.now());
        held[id] = next;
        dirty.add(id);
        changed = true;
      }
    }
    if (changed) await flush();
    return rows.size;
  }

  /**
   * Read the cache for any card on this page that has a record but no facts yet. Called from the rule pass,
   * which runs whenever the page's cards change.
   *
   * `load()` hydrates ONCE, when the script boots, and that is not enough: the site's list can render after
   * `document_idle`, and a page whose cards are not in the DOM yet hydrates nothing at all. The symptom is
   * quiet but complete — the deep scan's keywords, off-platform tags and `HOURS PER WEEK` simply do not
   * appear on that load, on every card, until something else happens to re-run the pass. The live harness
   * caught it as seven cards whose figure did not match the hours the scan had recorded for them.
   */
  function hydrateNew() {
    if (!ready || hydrating) return;
    const ids = pageIds().filter(id => !texts.has(id) && !missing.has(id));
    if (!ids.length) return;
    hydrating = true;
    hydrate(ids)
      .then(n => { if (n) api.refreshRules(); })   // the descriptions are in hand: re-decide the page
      .catch(e => console.warn('[OJ Cleaner] could not read the detail cache', e))
      .finally(() => { hydrating = false; });
  }

  /** Read the memory once, then re-run the rules: the first pass ran before it was loaded. Idempotent —
   *  the boot and the settings load both race to call it, and the later call must not start over. */
  function load() {
    if (!loadPromise) {
      loadPromise = (async () => {
        held = pure.prune((await chrome.storage.local.get(KEY))[KEY], Date.now(), MAX_AGE_MS);
        currentSk = pure.settingsKey(settings);
        api.refreshRules();          // card-level verdicts, and the memory is awake for the badge
        await hydrate(pageIds());
        ready = true;
        api.refreshRules();          // …and now with the descriptions in hand: promote / demote
      })().catch((e) => {
        console.warn('[OJ Cleaner] the job memory failed to load', e);
        ready = true;
      });
    }
    return loadPromise;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    const value = changes[KEY].newValue || {};
    // Our own write echoes back; adopting it again would be a second pass per write for nothing.
    // Our own write echoes back; adopting it again would be a second pass per write for nothing. Compared
    // key-order-insensitively, because Chrome hands the object back with its keys reordered and a plain
    // stringify says "different" for a byte-identical record — which is what let the write loop run.
    if (pure.canon(value) === lastWritten) return;
    const next = pure.prune(value, Date.now(), MAX_AGE_MS);
    // Another tab's write must not be able to delete a record this tab has changed but not yet written: the
    // disk value is older than `held` for exactly the ids still in `dirty`, so those win.
    for (const id of dirty) if (held[id]) next[id] = held[id];
    held = next;
    api.refreshRules();
  });

  chrome.storage.local.get('settings', (res) => {
    settings = { ...(res?.settings || {}) };
    load();
  });

  self.OJCRecordsUI = {
    load, hydrate, hydrateNew, flush, note, mark, detailFor, hoursInfoFor, recordFor, onSettings, absorb, recheck, idOf,
    isReady: () => ready,
    size: () => Object.keys(held).length,
    dirtyCount: () => dirty.size,
    cachedCount: () => texts.size,
    all: () => ({ ...held }),
    /** When this listing's own words were last fetched, for the scan's cache check — `null` when nothing
     *  is cached, and never a guess: the scan compares it against the cache's own TTL. */
    cachedAt: (id) => (id != null && texts.get(String(id))?.at) || null,
    factsFor: (id) => facts.get(String(id)) || null,
    textFor: (id) => texts.get(String(id)) || null,
    factsFor: (id) => facts.get(String(id)) || null,
    textFor: (id) => texts.get(String(id)) || null,
  };
})();
