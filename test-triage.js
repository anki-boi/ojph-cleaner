// test-triage.js — suggested block words (D53) and new-since-last-visit (D54).
const assert = require('assert');
const { suggest, terms } = require('./suggest.js');
const V = require('./visits.js');

// ── terms: content words and adjacent pairs, never glue ──
const t = terms('We are looking for a Cold Calling expert to join our team!');
assert.ok(t.has('cold calling') && t.has('cold') && t.has('calling') && t.has('expert'));
assert.ok(!t.has('looking') && !t.has('our') && !t.has('team'), 'stop words never become suggestions');
const board = terms('Acme Corp • Posted on 2026-10-04 Full-Time ... See More');
assert.ok(!board.has('posted') && !board.has('full-time') && !board.has('more'), "the board's own furniture is never a suggestion");

// ── suggest: 12 passes, 9 of them cold calling, the kept ones never ──
const passed = [
  ...Array(9).fill(0).map((_, i) => `Appointment setter needed, cold calling ${i} leads daily, commission only`),
  'Data entry clerk for spreadsheets', 'Bookkeeper for a small firm', 'Graphic design gig',
];
const kept = ['QuickBooks bookkeeper, remote', 'Virtual assistant for email and calendar', 'Xero accountant',
  'Executive assistant, scheduling'];
const s = suggest({ passed, kept, existing: ['crypto'] });
assert.strictEqual(s.length, 3, 'three suggestions, the cap');
assert.ok(s.some(x => x.word === 'cold calling'), 'the phrase is offered');
assert.ok(!s.some(x => x.word === 'cold' || x.word === 'calling'), 'its words are not offered beside it');
assert.deepStrictEqual(s.find(x => x.word === 'cold calling'), { word: 'cold calling', seen: 9, of: 12 });
assert.deepStrictEqual(suggest({ passed: passed.slice(0, 7), kept }), [], 'fewer than 8 passes: nothing yet');
assert.ok(!suggest({ passed, kept, existing: ['calling'] }).some(x => x.word.includes('calling')),
  'a word already on a list is never suggested again, alone or in a phrase');
assert.ok(!suggest({ passed, kept, dismissed: ['cold calling'] }).some(x => x.word === 'cold calling'), 'dismissed stays dismissed');
// A word that is also in what you KEEP is not something you dislike.
const keptToo = suggest({ passed, kept: [...kept, 'cold calling for our own clients'] , existing: [] });
assert.ok(!keptToo.some(x => x.word === 'cold calling'), '1 of 5 kept (20 %) is over the 10 % line');

// Signatures (what myJobs keeps) count exactly like the texts they came from.
const { signature } = require('./suggest.js');
assert.deepStrictEqual(suggest({ passed: passed.map(x => signature(x)), kept: kept.map(x => signature(x)), existing: ['crypto'] }), s);
assert.ok(signature('a '.repeat(10) + passed[0]).length <= 40);

// ── visits ──
assert.strictEqual(V.searchKey('https://www.onlinejobs.ph/jobseekers/jobsearch/30?jobkeyword=Bookkeeper'),
  '/jobseekers/jobsearch?jobkeyword=bookkeeper', 'the offset is not part of the search');
assert.strictEqual(V.searchKey('https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=bookkeeper'),
  '/jobseekers/jobsearch?jobkeyword=bookkeeper');
assert.strictEqual(V.searchKey('/jobseekers/search/c/virtual-assistant/60'), '/jobseekers/search/c/virtual-assistant');
assert.strictEqual(V.toSearchKey('Virtual Assistant'), '/jobseekers/jobsearch?jobkeyword=virtual assistant');
assert.strictEqual(V.toSearchKey('https://www.onlinejobs.ph/jobseekers/jobsearch/60?jobkeyword=xero'), '/jobseekers/jobsearch?jobkeyword=xero');
assert.strictEqual(V.toSearchKey('  '), null);
const H = 3600e3, T = 1e12;
const first = V.open(undefined, T);
assert.strictEqual(first.cutoff, null, 'the first visit marks nothing');
const reload = V.open(first.entry, T + 5 * 60e3);
assert.strictEqual(reload.cutoff, null, 'a reload is the same visit');
const back = V.open(V.touch(reload.entry, T + 10 * 60e3), T + 5 * H);
assert.strictEqual(back.cutoff, T + 10 * 60e3, 'a new visit marks everything after the end of the last one');
const reload2 = V.open(back.entry, T + 5 * H + 60e3);
assert.strictEqual(reload2.cutoff, T + 10 * 60e3, 'and a reload keeps that cutoff, so the marks do not vanish');
assert.ok(V.isNew(T + H, T) && !V.isNew(T - H, T) && !V.isNew(T + H, null) && !V.isNew(null, T));
assert.deepStrictEqual(Object.keys(V.prune({ a: { last: T }, b: { last: T - 100 * 864e5 } }, T)), ['a']);

console.log('triage: ok (block-word suggestions, new since last visit)');
