/**
 * records-cards.js — the synchronous applier for the job memory (spec.md W12, D35/D36).
 *
 * Split from the old records-cards.js when that file passed the gate's 300-line cap: this half answers
 * the rule pass **synchronously** — `detailFor`, `note`, `mark` and `hoursInfoFor` are plain lookups,
 * because the pass runs inside a requestAnimationFrame and a promise there is a race, not a lookup.
 * The persistence half — loading the memory, hydrating the cached descriptions, flushing dirty
 * records, and the `absorb`/`recheck` entry points — lives in records-store.js, which owns the shared
 * state object this file reads. The pure state machine lives in records.js, the pure verdict in
 * tiers.js — the same split as closed.js/closed-cards.js, for the same reason.
 *
 * The two boundaries that keep it correct:
 *
 *   1. **Never write from here.** Only records-store.js touches disk, and it writes only when something
 *      changed — a per-pass write would fire `chrome.storage.onChanged` and schedule the next pass
 *      forever (§2.2's loop, one layer up).
 *   2. **Never create a record for a card nobody asked about.** Records are born from a deep scan or
 *      from opening a listing, in records-store.js.
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage) return; // node: nothing to do
  const pure = self.OJCRecords, store = self.OJCRStore;
  if (!pure || !store) return;
  const S = store.S;

  /** The listing's own page fields, when a scan (or an opened page) learned them. W13.5 reads the hours
   *  to turn an assumed 40 h/week month into a stated one — and to flag a week longer than full time. */
  function hoursInfoFor(card) {
    const id = store.idOf(card);
    if (!id) return null;
    const fields = S.texts.get(id)?.fields ?? S.held[id]?.fields;
    const hours = Number(fields?.hoursPerWeek);
    if (!Number.isFinite(hours) || hours <= 0) return null;
    return { hours, type: fields.typeOfWork || null };
  }

  /**
   * The description facts for a card, or null when there are none to trust.
   *
   * Freshly derived facts win. When the cache has been evicted, the stored facts are used **only if they
   * were derived under these same keyword lists** (`sk`): keyword verdicts are relative to the settings,
   * the off-platform flags are not, and reusing a keyword match from an older list is exactly the class
   * of wrong this project refuses. When it cannot be trusted the card falls back to its own text, as if
   * the scan had never run (D36).
   */
  function detailFor(card) {
    const id = store.idOf(card);
    if (!id) return null;
    if (S.facts.has(id)) return S.facts.get(id);
    const rec = S.held[id];
    return rec && rec.sk === S.currentSk && rec.detail ? rec.detail : null;
  }

  const recordFor = (card) => S.held[store.idOf(card)] || null;

  /** How interesting a verdict is, for reading a tier move as a promotion or a demotion. High yield is
   *  the top, because PAY is what makes it high yield (the user's rule); a keyword you like sits below. */
  const RANK = { none: 0, nosal: 0, stale: 0, closed: 0, kw: 1, pos: 2, worth: 3, high: 4 };
  const LABEL = { high: 'High yield', worth: 'Worth considering', pos: 'Highlighted',
    kw: 'hidden by a keyword', nosal: 'no salary', stale: 'stale', closed: 'closed', none: 'unclassified' };

  /**
   * The change mark: `↑ promoted` / `↓ demoted` on a card whose tier moved since you last looked at it.
   * Applied by the rule pass and cleared when the listing is opened (see records-store.js `recheck`).
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

  /**
   * Fold a pass's verdict into the stored record. Called for every card by the rule pass; returns the
   * new record only when it actually moved, so the caller can skip everything else.
   */
  function note(card, tier, cardFacts) {
    // Until the page's own descriptions are hydrated, the pass is working from half a listing's text.
    // Deciding (and then writing) a verdict from half of it would invent demotions out of nothing.
    if (!S.ready) return null;
    const id = store.idOf(card);
    if (!id || !S.held[id]) return null;            // no record ⇒ nothing here was ever scanned or opened
    const next = pure.apply(S.held[id], { tier, card: cardFacts, detail: detailFor(card), sk: S.currentSk }, Date.now());
    if (store.sameFacts(S.held[id], next)) return null;
    S.held[id] = next;
    S.dirty.add(id);
    store.flush();
    return next;
  }

  /** Re-derive every hydrated description under new settings — the whole point of caching the text
   *  (D36): a keyword edit re-tiers the page with zero requests. */
  function onSettings(next) {
    S.settings = { ...(next || {}) };
    S.currentSk = pure.settingsKey(S.settings);
    for (const [id, text] of S.texts) S.facts.set(id, store.derive(text.desc, text.fields?.hoursPerWeek));
  }

  self.OJCRecordsUI = {
    load: store.load, hydrate: store.hydrate, hydrateNew: store.hydrateNew, flush: store.flush,
    note, mark, detailFor, hoursInfoFor, recordFor, onSettings,
    absorb: store.absorb, recheck: store.recheck, idOf: store.idOf,
    isReady: () => S.ready,
    size: () => Object.keys(S.held).length,
    dirtyCount: () => S.dirty.size,
    cachedCount: () => S.texts.size,
    all: () => ({ ...S.held }),
    /** When this listing's own words were last fetched, for the scan's cache check — `null` when nothing
     *  is cached, and never a guess: the scan compares it against the cache's own TTL. */
    cachedAt: (id) => (id != null && S.texts.get(String(id))?.at) || null,
    factsFor: (id) => S.facts.get(String(id)) || null,
    textFor: (id) => S.texts.get(String(id)) || null,
  };
})();
