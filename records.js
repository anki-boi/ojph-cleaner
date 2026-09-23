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
  /**
   * A stored card's facts, completed to the shape a live card always has.
   *
   * Every card on the board carries `pos`, `neg`, `goal` and `goalBy` — `content.js`'s `cardFactsOf` sets
   * all four, `goalBy` to `null` when there is no margin to read. A record written before one of those
   * facts existed (or by a path that did not have it) simply omits the key, and `canon` — which is
   * `JSON.stringify`, so it DROPS an absent key and KEEPS an explicit `null` — then reads the two as
   * different for ever.
   *
   * That difference is not cosmetic: `sameFacts` saw a change on every rule pass, wrote `jobRecords`, and
   * the write's own `chrome.storage.onChanged` echo re-ran the pass. Measured live on a search page: 45
   * passes per second, forever, with 48 of 221 stored records stuck omitting `goalBy`. Completing the shape
   * on both sides of the comparison is what ends it.
   */
  const cardShape = (c) => (c == null ? c : { pos: [], neg: [], goal: false, goalBy: null, ...c });

  /**
   * Was this record materially different from the last one? Timestamps do not count — if they did, every
   * pass would look like a change and storage would be rewritten forever. Nor does KEY ORDER: a record that
   * comes back from `chrome.storage.local` is the same record with its keys in Chrome's order, and comparing
   * those two with a plain stringify is false for a byte-identical record. Measured live, that single
   * comparison produced 2 184 record writes and ~75 rule passes per second, forever, on an idle page.
   *
   * Nor does a MISSING KEY mean a different value — see `cardShape`. This predicate is the one that decides
   * whether the page writes storage, so it is pure and lives here with the rest of the state machine, where
   * `test-records.js` can pin it, rather than inside the storage glue that uses it.
   */
  const sameFacts = (a, b) => a.tier === b.tier && a.prev === b.prev && a.seen === b.seen &&
    a.sk === b.sk && canon(cardShape(a.card)) === canon(cardShape(b.card)) &&
    canon(a.detail) === canon(b.detail) && canon(a.fields) === canon(b.fields);

  /**
   * Apply a pass to one record. Pure: it reads nothing, writes nothing, and never mutates its inputs — the
   * caller owns storage, and a mutation here would silently rewrite the memory behind its back.
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
      card: cardShape(u.card !== undefined ? u.card : (base ? base.card ?? null : null)),
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

  /**
   * The memory as a CSV (F1): one row per remembered listing. `records` is the `jobRecords` map, `urls`
   *  an id → listing-URL map (records do not store URLs — the export fills them from the detail cache,
   *  and an unknown one comes out blank rather than guessed). The row says what the board says: the tier
   *  it was judged to, where it moved from, the keywords and off-platform flags behind it, the listing's
   *  own hours/type/wage, and when it was last checked. Pure, so the escaping is tested here, not in the
   *  browser: a wage like `PHP 30,000/mo` must survive a spreadsheet.
   */
  function toCsv(records, urls) {
    const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
    const list = (a) => (a || []).join('; ');
    const rows = ['id,url,tier,prev,changed,checked,hours,type,wage,flags,pos,neg'];
    for (const [id, r] of Object.entries(records || {})) {
      rows.push([
        cell(id),
        cell(urls ? urls[id] || '' : ''),
        cell(r?.tier),
        cell(r?.prev),
        cell(isChanged(r) ? 'yes' : 'no'),
        cell(day(r?.checkedAt)),
        cell(r?.fields?.hoursPerWeek),
        cell(r?.fields?.typeOfWork),
        cell(r?.fields?.wage),
        cell(list(r?.detail?.flags)),
        cell(list(r?.card?.pos)),
        cell(list(r?.card?.neg)),
      ].join(','));
    }
    return rows.join('\n') + '\n';
  }

  return { prune, apply, isChanged, markSeen, sameFacts, settingsKey, canon, cardShape, toCsv, HISTORY_DAYS, MAX_ENTRIES };
});
