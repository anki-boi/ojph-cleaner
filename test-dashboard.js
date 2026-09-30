// test-dashboard.js — node tests for dashboard-fit.js, the pure half of the bridge to the
// sibling repo (onlinejobs.ph-suite). The applier (dashboard-cards.js) needs a DOM and a
// chrome, so everything that decides anything lives here.
const assert = require('assert');
const d = require('./dashboard-fit.js');

// ── the request shape the suite's POST /api/resume/fit accepts ───────────
const item = d.fitItem({ title: '  Executive   Assistant ', description: 'x'.repeat(2000),
                         salary: '₱40,000 /month', workType: 'Full Time' });
assert.strictEqual(item.title, 'Executive Assistant', 'whitespace is not part of a title');
assert.strictEqual(item.description.length, d.MAX_DESC, 'a description is sent trimmed, not whole');
assert.strictEqual(item.salary, '₱40,000 /month');
assert.strictEqual(d.fitItem({}).title, '', 'a card with no title sends an empty one, not undefined');

// ── the skills a score is built from: the listing's own tags, nothing invented ──
const tagged = d.fitItem({ title: 'T', skills: [' Excel ', 'Excel', 'PowerPoint', '', null] });
assert.deepStrictEqual(tagged.skills, ['Excel', 'PowerPoint'], 'deduped, trimmed, empties dropped');
assert.strictEqual(d.fitItem({}).skills.length, 0, 'a listing with no tags sends an empty list, not a guess');
assert.strictEqual(d.fitItem({ skills: Array.from({ length: 60 }, (_, i) => 'skill' + i) }).skills.length,
  d.MAX_SKILLS, 'a tag list is capped, not dumped');

// ── batches: the suite caps a request at 50 listings ────────────────────
const cards = Array.from({ length: 120 }, (_, i) => i);
const batches = d.chunk(cards);
assert.deepStrictEqual(batches.map((b) => b.length), [50, 50, 20], 'one request per 50 cards');
assert.strictEqual(batches[1][0], 50, 'a batch is a slice, in order — a score must land on its own card');
assert.deepStrictEqual(d.chunk([]), [], 'an empty board sends no request at all');
assert.deepStrictEqual(d.chunk(cards, 0).map((b) => b.length), [50, 50, 20],
  'a zero size falls back to the cap instead of spinning forever');

// ── the badge: the suite's number, on the scale the suite could actually score ──
const b = d.badge({ fit: 28.6, total: 64, hygiene: 36, fit_max: 40, profile: 'master' });
assert.strictEqual(b.fit, 29, 'rounded, not floored, not invented');
assert.strictEqual(d.badge({ fit: 28.4, total: 64, fit_max: 40 }).fit, 28, 'rounded, not ceiled');
assert.strictEqual(b.text, 'resume fit 29/40', 'the denominator says what was scorable');
assert.match(b.title, /29\/40/, 'or 29 means nothing');
assert.match(b.title, /profile: master/, 'which resume was scored is part of the answer');
assert.strictEqual(d.badge({ fit: 0, fit_max: 0 }), null,
  'nothing scorable is nothing said — 0/0 would read as a bad fit');
assert.strictEqual(d.badge({ profile: 'master', fit: null, fit_max: 40 }), null, 'no score, no badge');
assert.strictEqual(d.badge(null), null);
assert.strictEqual(d.badge({ fit: 900, total: 900, fit_max: 40 }).fit, 40,
  'a score is clamped to the scale it claims');
assert.strictEqual(d.badge({ fit: 55, total: 90, fit_max: 60 }).fit, 55);

// ── the deep link: the dashboard keys jobs by the SITE's id ──────────────
assert.strictEqual(d.linkFor('http://127.0.0.1:8372/', '1570005'),
  'http://127.0.0.1:8372/?job=1570005', 'a trailing slash would make a path nobody serves');
assert.strictEqual(d.linkFor('', '1'), null, 'bridge off, no link');
assert.strictEqual(d.linkFor('http://127.0.0.1:8372', null), null, 'a card with no job id links nowhere');
assert.strictEqual(d.enabled(''), false, 'off is an empty URL');
assert.strictEqual(d.enabled('   '), false);
assert.strictEqual(d.enabled('http://127.0.0.1:8372'), true);

console.log(`dashboard: ok (${d.MAX_BATCH} per request, ${d.FIT_MAX}-point scale, ${d.MAX_SKILLS} tags)`);
