// test-rules.js — node tests for rules.js (run: node test-rules.js)
const assert = require('assert');
const { hasSalary, matchKeywords, parsePosted, isStale, MANILA_OFFSET_MINUTES } = require('./rules.js');

// hasSalary: digit present
assert.strictEqual(hasSalary('$500/month'), true);
assert.strictEqual(hasSalary('PHP 30,000 - PHP 40,000'), true);
assert.strictEqual(hasSalary('$1,000/month (DOE)'), true);
assert.strictEqual(hasSalary('970'), true);
assert.strictEqual(hasSalary('$4-$10/hour'), true);

// hasSalary: label-only values must fail
for (const v of ['TBD', 'N/A', 'Negotiable', 'DOE', 'to be discussed', '', null, undefined]) {
  assert.strictEqual(hasSalary(v), false, `hasSalary(${JSON.stringify(v)}) should be false`);
}

// matchKeywords: substring, case-insensitive, returns matched list
assert.deepStrictEqual(matchKeywords('Data entry, insurance not needed', ['insurance']), ['insurance']);
assert.deepStrictEqual(matchKeywords('INSURANCE agent wanted', ['insurance']), ['insurance']);
assert.deepStrictEqual(matchKeywords('  REMOTE  work ', ['remote']), ['remote']);
assert.deepStrictEqual(matchKeywords('Data Entry VA', ['crypto', 'insurance']), []);
assert.deepStrictEqual(matchKeywords('Crypto & insurance hybrid', ['crypto', 'insurance']), ['crypto', 'insurance']);
assert.deepStrictEqual(matchKeywords(null, ['crypto']), []);
assert.deepStrictEqual(matchKeywords('anything', []), []);
assert.deepStrictEqual(matchKeywords('anything', ['', '   ', null]), []);

// ── parsePosted: the site's posted timestamp ─────────────────────────────
// Both attributes of the live sample the plan was built on (2026-09-18, virtual-assistant search):
//   data-temp="2026-09-19 01:33:33" (Asia/Manila wall clock) · data-temp-2="2026-09-18 17:33:33" (UTC)
// They are the SAME instant, which is the whole point of the second attribute and the reason this
// machine (America/Denver, UTC-6) must never parse the visible one as local time.
assert.strictEqual(parsePosted('2026-09-19 01:33:33'), Date.UTC(2026, 8, 19, 1, 33, 33));
assert.strictEqual(parsePosted('2026-09-18 17:33:33'), Date.UTC(2026, 8, 18, 17, 33, 33));
assert.strictEqual(parsePosted('2026-09-19 01:33:33', MANILA_OFFSET_MINUTES),
  parsePosted('2026-09-18 17:33:33'), 'the Manila reading must land on the UTC instant');
assert.strictEqual(MANILA_OFFSET_MINUTES, 480);
// The 8-hour gap is exactly 8 hours, not "some offset": a wrong constant is a wrong date.
assert.strictEqual(parsePosted('2026-09-19 01:33:33') - parsePosted('2026-09-19 01:33:33', MANILA_OFFSET_MINUTES),
  8 * 3600 * 1000);
// Fixed to UTC regardless of the machine's zone: `new Date('2026-09-19 01:33:33')` is local-time and
// would drift by 14 h here. An exact Date.UTC value is the same number on every machine.
assert.strictEqual(parsePosted('2026-09-19 01:33:33'), 1789781613000);

// Anything not exactly the site's shape is unreadable, and unreadable is never stale (rule D19).
for (const bad of [null, undefined, '', '   ', 'Posted on today', '2026-09-19', '2026-09-19 01:33',
  '2026-09-19T01:33:33Z', '19/09/2026 01:33:33', 'x2026-09-19 01:33:33', '2026-09-19 01:33:33x',
  20260919, {}, '2026-13-45 99:99:99', '2026-02-30 00:00:00', '2026-09-19 25:00:00',
  '2026-09-19 24:00:00', '2026-09-19 12:60:00']) {
  assert.strictEqual(parsePosted(bad), null, `parsePosted(${JSON.stringify(bad)}) should be null`);
}
// A rollover must be rejected, not silently accepted as some other real date.
assert.strictEqual(parsePosted('2026-02-30 00:00:00'), null);
// …while a real leap day is a real date.
assert.strictEqual(parsePosted('2028-02-29 12:00:00'), Date.UTC(2028, 1, 29, 12, 0, 0));

// ── isStale ──────────────────────────────────────────────────────────────
const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);
const dayAgo = (d) => NOW - d * 86400000;
assert.strictEqual(isStale(dayAgo(6.9), NOW, 7), false);
assert.strictEqual(isStale(dayAgo(7), NOW, 7), false, 'exactly 7 days old is within the last 7 days');
assert.strictEqual(isStale(dayAgo(7) - 1, NOW, 7), true, 'one millisecond past the window is stale');
assert.strictEqual(isStale(dayAgo(40), NOW, 7), true);
assert.strictEqual(isStale(dayAgo(0.2), NOW, 7), false);
assert.strictEqual(isStale(NOW + 3600000, NOW, 7), false, 'a future timestamp is never stale');
// Off, and unreadable, both mean "not stale" — 0 is the off switch, never "hide everything".
for (const off of [0, undefined, null, '', 'x', -1]) {
  assert.strictEqual(isStale(dayAgo(400), NOW, off), false, `maxAgeDays=${JSON.stringify(off)} is off`);
}
assert.strictEqual(isStale(null, NOW, 7), false, 'an unreadable date must never hide a listing');
assert.strictEqual(isStale(parsePosted('nonsense'), NOW, 7), false);
assert.strictEqual(isStale(dayAgo(40), NOW, '7'), true, 'a numeric string still counts as days');

assert.deepStrictEqual(matchKeywords('anything', ['', '   ', null]), []);

// ── matchKeywords: EVERY keyword is an exact word (or exact phrase) ──────────────────────────
// The user's rule: "if I put AI, it only ever means AI and nothing else". Substring matching is not a
// feature here — it is the bug that made their positive keyword `AI` match 30 of 30 live cards through
// `daily`, `email`, `main`, `paid`, `thumbnail` and `management`, which (with the yellow reconsider
// rule) silently turned their whole negative list into a no-op. Word boundaries both sides:
assert.deepStrictEqual(matchKeywords('AI tools wanted', ['ai']), ['ai'], 'case-insensitive');
assert.deepStrictEqual(matchKeywords('Use AI-powered tooling', ['ai']), ['ai'], 'a hyphen is a boundary');
assert.deepStrictEqual(matchKeywords('Daily AI digest', ['AI']), ['AI'], 'the keyword is returned as written');
assert.deepStrictEqual(matchKeywords('Check your email daily', ['ai']), [], 'the whole point: never inside a word');
assert.deepStrictEqual(matchKeywords('daily', ['ai']), []);
assert.deepStrictEqual(matchKeywords('RemoteWorker', ['remote']), [], 'no boundary, no match');
assert.deepStrictEqual(matchKeywords('  REMOTE  work ', ['remote']), ['remote']);
assert.deepStrictEqual(matchKeywords('paid ads run', ['ads']), ['ads']);
assert.deepStrictEqual(matchKeywords('advertisements', ['ads']), []);
assert.deepStrictEqual(matchKeywords('editors wanted', ['editor']), [], 'plural is a different word — add it to the list');
// Phrases are exact too, and still match inside a sentence.
assert.deepStrictEqual(matchKeywords('we need a video editor now', ['video editor']), ['video editor']);
assert.deepStrictEqual(matchKeywords('we need video editors now', ['video editor']), []);
// A needle is data, never a pattern.
assert.deepStrictEqual(matchKeywords('a c++ developer', ['c++']), ['c++']);
assert.deepStrictEqual(matchKeywords('axb', ['a.b']), [], 'a dot in a keyword is a dot');
assert.deepStrictEqual(matchKeywords('cost is $5 (approx)', ['$5']), ['$5']);
// The leading `=` from the one release that made whole-word opt-in is accepted and ignored, so a saved
// `=ai` keeps working instead of quietly matching nothing.
assert.deepStrictEqual(matchKeywords('AI tools', ['=ai']), ['ai']);
assert.deepStrictEqual(matchKeywords('email', ['=ai']), []);
// Empties and duplicates behave.
assert.deepStrictEqual(matchKeywords('anything', ['', '   ', null]), []);
assert.deepStrictEqual(matchKeywords('ai and ai', ['ai', 'ai']), ['ai', 'ai']);
assert.deepStrictEqual(matchKeywords('email', ['ai', 'email']), ['email']);

console.log('rules: all assertions passed');
