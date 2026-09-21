// test-records.js — node tests for records.js (run: node test-records.js)
//
// The record is what the user asked for in one sentence: "the extension remembers the states and stats
// for each job listing link". The two properties that matter are that it can never grow without bound,
// and that re-deriving an unchanged card is a NO-OP — otherwise every rule pass writes storage, fires
// chrome.storage.onChanged, and re-runs itself forever.
const assert = require('assert');
const R = require('./records.js');
const { prune, apply, isChanged, markSeen, canon, toCsv, HISTORY_DAYS, MAX_ENTRIES } = R;

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
const rec = (o = {}) => ({ tier: 'high', prev: null, seen: true, changedAt: null, at: NOW,
  checkedAt: NOW, card: { pos: [], neg: [] }, detail: { pos: [], neg: [], flags: [] },
  fields: null, sk: null, ...o });

// ── pruning: 180 days, like the closed-listing memory ────────────────────
assert.strictEqual(HISTORY_DAYS, 180);
const old = { a: rec({ at: NOW - 181 * DAY }), b: rec({ at: NOW - 179 * DAY }), c: rec({ at: NOW }) };
assert.deepStrictEqual(Object.keys(prune(old, NOW, HISTORY_DAYS * DAY)), ['b', 'c']);
// Exactly on the boundary is kept (<=, like closed.js), so "180 days" is a window and not a 179-day one.
assert.deepStrictEqual(Object.keys(prune({ x: rec({ at: NOW - 180 * DAY }) }, NOW, HISTORY_DAYS * DAY)), ['x']);
// Malformed entries — a hand-edited profile, a half-written record — are dropped, not crashed on.
assert.deepStrictEqual(Object.keys(prune({ x: { at: 'yesterday' }, y: null, z: {}, w: rec() }, NOW, HISTORY_DAYS * DAY)), ['w']);
assert.deepStrictEqual(prune(undefined, NOW, DAY), {});
assert.deepStrictEqual(prune({ x: rec({ at: NOW - DAY }) }, NOW, 0), { x: rec({ at: NOW - DAY }) },
  'a zero/absent max age must not wipe the memory (0 means "off" everywhere else in this project)');

// ── the entry cap: oldest evicted, newest kept ───────────────────────────
const many = {};
for (let i = 0; i < MAX_ENTRIES + 5; i++) many['id' + i] = rec({ at: NOW - i * 1000 });
const capped = prune(many, NOW, HISTORY_DAYS * DAY);
assert.strictEqual(Object.keys(capped).length, MAX_ENTRIES, 'the map must not grow past the cap');
assert.ok('id0' in capped && 'id4' in capped, 'the newest entries survive');
assert.ok(!('id' + (MAX_ENTRIES + 4) in capped), 'the oldest entry is the one evicted');

// ── apply(): the change state machine ────────────────────────────────────
// A brand-new record is not a change: there is nothing to compare against, so no ↑/↓ mark.
const fresh = apply(null, { tier: 'worth', detail: { pos: [], neg: ['crypto'], flags: [] } }, NOW);
assert.deepStrictEqual(fresh, rec({ tier: 'worth', card: null, detail: { pos: [], neg: ['crypto'], flags: [] } }));

// Same tier, new facts → the facts update, the change state does not move.
const kept = apply(rec({ tier: 'high' }), { tier: 'high', detail: { pos: ['quickbooks'], neg: [], flags: [] } }, NOW + 1000);
assert.strictEqual(kept.tier, 'high');
assert.strictEqual(kept.prev, null);
assert.strictEqual(kept.seen, true);
assert.strictEqual(kept.changedAt, null);
assert.strictEqual(kept.checkedAt, NOW + 1000, 'checkedAt is the "when did we last look" stamp');
assert.deepStrictEqual(kept.detail, { pos: ['quickbooks'], neg: [], flags: [] });

// A move records where it came from and marks it unseen.
const moved = apply(rec({ tier: 'high' }), { tier: 'worth' }, NOW + 2000);
assert.strictEqual(moved.tier, 'worth');
assert.strictEqual(moved.prev, 'high');
assert.strictEqual(moved.seen, false);
assert.strictEqual(moved.changedAt, NOW + 2000);

// IDEMPOTENCE: re-deriving the same verdict again must not look like a fresh move. This is the
// property that keeps storage writes at zero on an idle page.
const again = apply(moved, { tier: 'worth' }, NOW + 3000);
assert.strictEqual(again.tier, moved.tier);
assert.strictEqual(again.prev, moved.prev);
assert.strictEqual(again.seen, moved.seen);
assert.strictEqual(again.changedAt, moved.changedAt, 'changedAt must not be touched by a no-op re-derivation');
assert.strictEqual(again.checkedAt, NOW + 3000, 'only the "last looked" stamp moves');

// Two moves before the card has been seen: the latest move wins, and the mark stays unseen.
const twice = apply(moved, { tier: 'high' }, NOW + 4000);
assert.strictEqual(twice.tier, 'high');
assert.strictEqual(twice.prev, 'worth');
assert.strictEqual(twice.seen, false);

// A scan re-writes the description facts and stamps `at` (when the text was fetched).
const scanned = apply(rec({ tier: 'high' }), { tier: 'high', scannedAt: NOW + 5000, card: { pos: ['ai'], neg: [] } }, NOW + 5000);
assert.strictEqual(scanned.at, NOW + 5000);
assert.deepStrictEqual(scanned.card, { pos: ['ai'], neg: [] });
// …and a later card-level-only update must NOT wipe the scan stamp.
assert.strictEqual(apply(scanned, { tier: 'high', card: { pos: [], neg: [] } }, NOW + 6000).at, NOW + 5000);
assert.deepStrictEqual(apply(scanned, { tier: 'high' }, NOW + 6000).detail, rec().detail,
  'an update that omits `detail` leaves the stored one alone');

// ── the ↑/↓ mark ─────────────────────────────────────────────────────────
assert.strictEqual(isChanged(fresh), false, 'a first sighting is not a change');
assert.strictEqual(isChanged(moved), true);
assert.strictEqual(isChanged(markSeen(moved)), false);
assert.strictEqual(markSeen(fresh), null, 'nothing to mark on an unchanged record — no write');
assert.strictEqual(markSeen(null), null);
assert.strictEqual(isChanged({ prev: 'high', seen: true }), false);
assert.strictEqual(isChanged({ prev: null, seen: false }), false, 'unseen is meaningless without a previous tier');
assert.strictEqual(isChanged(null), false);

// markSeen returns a COPY: the rule pass is holding the map it reads.
const before = markSeen(moved);
assert.notStrictEqual(before, moved);
assert.strictEqual(moved.seen, false, 'the input record must not be mutated');

// ── the settings signature (D36) ─────────────────────────────────────────
// A keyword verdict is relative to the keyword lists, so the record carries a signature of the lists it
// was derived under. Same lists → same signature; anything else → the stored keyword facts may not be
// trusted, and the card falls back to its own text.
assert.strictEqual(R.settingsKey({ negative: ['a'], positive: ['b'] }), R.settingsKey({ negative: ['a'], positive: ['b'] }));
assert.notStrictEqual(R.settingsKey({ negative: ['a'], positive: ['b'] }), R.settingsKey({ negative: ['a'], positive: ['c'] }));
assert.notStrictEqual(R.settingsKey({ negative: ['ab'] }), R.settingsKey({ negative: ['a', 'b'] }),
  'the signature must distinguish one keyword from two');
assert.strictEqual(typeof R.settingsKey({}), 'number');
assert.strictEqual(R.settingsKey({}), R.settingsKey(undefined));

// ── fields and sk ride along, and are only replaced when given ───────────
assert.deepStrictEqual(apply(rec({ fields: { hoursPerWeek: 15 } }), { tier: 'high' }, NOW).fields,
  { hoursPerWeek: 15 }, 'an update that omits `fields` must not wipe the scanned hours');
assert.deepStrictEqual(apply(rec(), { tier: 'high', fields: { hoursPerWeek: 20 } }, NOW).fields,
  { hoursPerWeek: 20 });
assert.strictEqual(apply(rec({ sk: 7 }), { tier: 'high' }, NOW).sk, 7);
assert.strictEqual(apply(rec({ sk: 7 }), { tier: 'high', sk: 9 }, NOW).sk, 9);

// ── canon: key order is not data (D36, and a 40-pass/second loop) ──────
// chrome.storage.local hands keys back in its own order, so the record store's "has anything changed?"
// and "is this echo mine?" comparisons must not depend on that order.
assert.strictEqual(canon({ a: 1, b: 2 }), canon({ b: 2, a: 1 }));
assert.strictEqual(canon({ x: { p: 1, q: 2 } }), canon({ x: { q: 2, p: 1 } }), 'nested objects too');
assert.strictEqual(canon([1, 2]), '[1,2]', 'array order IS data and must be preserved');
assert.notStrictEqual(canon([1, 2]), canon([2, 1]));
assert.notStrictEqual(canon({ a: 1 }), canon({ a: 2 }));
assert.strictEqual(canon(null), 'null');
assert.strictEqual(canon(undefined), undefined);
assert.strictEqual(canon({ tier: 'high', detail: { pos: ['a', 'b'], flags: [] } }),
  canon({ detail: { flags: [], pos: ['a', 'b'] }, tier: 'high' }), 'a whole record, reordered');

// ── toCsv: the memory's export (F1) ────────────────────────────────────
{
  const recs = {
    '111': rec({ tier: 'high', prev: 'worth', seen: false,
      fields: { hoursPerWeek: 40, typeOfWork: 'Full Time', wage: 'PHP 30,000/mo' },
      card: { pos: ['quickbooks'], neg: [] },
      detail: { pos: ['quickbooks'], neg: [], flags: ['ask'] } }),
    '222': rec({ tier: 'kw', prev: null, seen: true, card: { pos: [], neg: ['crypto'] }, detail: null }),
  };
  const urls = { '111': 'https://www.onlinejobs.ph/jobseekers/job/111' };
  const lines = toCsv(recs, urls).split('\n');
  assert.strictEqual(lines[0], 'id,url,tier,prev,changed,checked,hours,type,wage,flags,pos,neg');
  assert.strictEqual(lines[1],
    '111,https://www.onlinejobs.ph/jobseekers/job/111,high,worth,yes,2026-09-18,40,Full Time,"PHP 30,000/mo",ask,quickbooks,');
  assert.strictEqual(lines[2], '222,,kw,,no,2026-09-18,,,,,,crypto');
  assert.strictEqual(lines[3], '', 'trailing newline');
  // A keyword containing a quote or a comma must survive a spreadsheet round trip.
  const csv2 = toCsv({ '9': rec({ card: { pos: ['a,"b'], neg: [] } }) }, {});
  assert.ok(csv2.includes('"a,""b"'), 'the quote is doubled and the field quoted');
  // An empty memory is still a valid CSV: the header row alone.
  assert.strictEqual(toCsv({}, {}), 'id,url,tier,prev,changed,checked,hours,type,wage,flags,pos,neg\n');
}

console.log('test-records: ok (prune · cap · apply · idempotence · change mark · csv export)');
