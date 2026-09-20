/**
 * records.js — the remembered state of one job listing (spec.md W12, D35).
 *
 * Pure: no DOM, no chrome, no network. UMD, unit-tested by test-records.js. The applier that reads and
 * writes `chrome.storage.local.jobRecords` lives in records-cards.js — the same split as closed.js /
 * closed-cards.js and salary.js / salary-cards.js.
 *
 * One record per job id holds what a deep scan (and every later re-check) found: the tier, the facts
 * behind it, when it was derived, and whether it has moved since you last looked at it. The user asked
 * for exactly this — "remembers the states and stats for each job listing link" — and the state machine
 * below is the part that has to be right, because it decides when storage is written.
 *
 * **Idempotence is the load-bearing property.** The board re-derives every card on every rule pass, so
 * `apply(existing, sameVerdict)` must leave `tier`, `prev`, `seen` and `changedAt` untouched. If it did
 * not, each pass would look like a change, write storage, fire `chrome.storage.onChanged`, and schedule
 * the next pass — a self-sustaining write loop of the same family as §2.2's mutation loop. Only
 * `checkedAt` moves, and the caller writes only when something else did.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.OJCRecords = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /** Entries older than this are forgotten — the same 180-day cap the closed memory uses. */
  const HISTORY_DAYS = 180;
  /** Hard cap, oldest `at` evicted first. ~250 B/record ⇒ 1 000 records ≈ 250 KB of a 10 MB quota. */
  const MAX_ENTRIES = 1000;

  /** A record worth keeping: an object with a numeric `at` (when it was last derived from a page). */
  const valid = (entry) => !!entry && typeof entry === 'object' && typeof entry.at === 'number';

  /**
   * Drop what is too old, malformed, or past the entry cap. Returns a NEW map: the caller holds the copy
   * the rule pass reads, and pruning it in place would change a verdict halfway through a pass.
   * `maxAgeMs` of 0 (or anything not > 0) means "no age limit", matching how every other window in this
   * project reads a 0 — it must never mean "forget everything".
   */
  function prune(map, nowMs, maxAgeMs) {
    const keep = [];
    for (const [id, entry] of Object.entries(map || {})) {
      if (!valid(entry)) continue;
      if (maxAgeMs > 0 && nowMs - entry.at > maxAgeMs) continue;
      keep.push([id, entry]);
    }
    if (keep.length <= MAX_ENTRIES) return Object.fromEntries(keep);
    keep.sort((a, b) => b[1].at - a[1].at);   // newest first
    return Object.fromEntries(keep.slice(0, MAX_ENTRIES));
  }

  /**
   * Fold a fresh derivation into the stored record.
   *
   * `updates.tier` is the only field that can move the mark; `card`/`detail` are the facts behind it and
   * are stored as given. Omitting one leaves the stored one alone, which matters because the board knows
   * the card facts and the scan knows the description facts — neither call has both.
   * `scannedAt` stamps the description's own age (the 7-day TTL reads it); `checkedAt` is always now.
   */
  function apply(prev, updates, nowMs) {
    const base = prev && typeof prev === 'object' ? prev : null;
    const u = updates || {};
    const tier = u.tier != null ? u.tier : (base ? base.tier : 'none');
    const moved = !!base && base.tier !== tier;
    return {
      tier,
      // Where the last move came from. Kept across a no-op re-derivation, and overwritten by the next
      // move, so a card that bounces high → worth → high still says "was worth" when you see it.
      prev: moved ? base.tier : (base ? base.prev ?? null : null),
      seen: moved ? false : (base ? !!base.seen : true),
      changedAt: moved ? nowMs : (base ? base.changedAt ?? null : null),
      at: u.scannedAt != null ? u.scannedAt : (base ? base.at : nowMs),
      checkedAt: nowMs,
      card: u.card !== undefined ? u.card : (base ? base.card ?? null : null),
      detail: u.detail !== undefined ? u.detail : (base ? base.detail ?? null : null),
      // The listing's own overview fields (HOURS PER WEEK, TYPE OF WORK, WAGE / SALARY) — W13.5 reads the
      // hours to turn an assumed 40 h/week month into a stated one.
      fields: u.fields !== undefined ? u.fields : (base ? base.fields ?? null : null),
      // The signature of the keyword lists the `detail` facts were derived under. A keyword verdict is
      // relative to the settings; when this stops matching, the stored facts may not be trusted and the
      // card falls back to its own text (D36).
      sk: u.sk !== undefined ? u.sk : (base ? base.sk ?? null : null),
    };
  }

  /** Has this listing moved since you last looked at it? Drives the ↑/↓ mark on the board. */
  function isChanged(rec) {
    return !!(rec && rec.prev != null && rec.seen === false);
  }

  /** Clear the mark. Returns a copy, or null when there was nothing to clear (so callers can skip the
   *  storage write entirely rather than writing an identical record). */
  function markSeen(rec) {
    if (!rec || rec.seen !== false) return null;
    return { ...rec, seen: true };
  }

  /**
   * djb2 over the two keyword lists: the signature that says "the keyword half of a record's facts is
   * still valid". Cheap on purpose — it is written on every record and read on every page load.
   */
  function settingsKey(settings) {
    const s = settings || {};
    const str = JSON.stringify([s.negative || [], s.positive || []]);
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h;
  }

  /**
   * Key-order-insensitive JSON, for comparing a record with the same record after a storage round trip.
   *
   * `chrome.storage.local` does not promise to hand an object's keys back in the order it was given them,
   * and it does not. So `JSON.stringify(before) === JSON.stringify(after)` is FALSE for a perfectly
   * unchanged record — and that comparison was both of the record store's questions ("is this echo mine?"
   * and "did anything change?"). Both then answered wrong, in the same direction: the echo was adopted as
   * another tab's write, the next pass compared the adopted record against the one it would have written,
   * found them different, and wrote again. Measured live: ~40 rule passes per second, forever, on a page
   * nobody was touching (the harness caught it as "33 rule passes in 816 ms for one inserted card").
   *
   * The replacer rebuilds every object with its keys sorted, recursively, so two orderings of the same data
   * serialize identically. Arrays are left alone: their order is data.
   */
  function canon(v) {
    return JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort())
      : x));
  }

  return { prune, apply, isChanged, markSeen, settingsKey, canon, HISTORY_DAYS, MAX_ENTRIES };
});
