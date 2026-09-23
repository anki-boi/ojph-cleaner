// test-paysort.js — node tests for pay-sort.js's pure half (run: node test-paysort.js)
//
// The ordering rule is the feature, and it is a rule about what the extension REFUSES to assume: a month
// and an hourly rate are not the same quantity, and converting one into the other needs a work week — which
// salary.js refuses to assume everywhere else (D13), so it refuses here too. Hence three blocks, and the
// card's own figure decides which one it is in.
const assert = require('assert');
const { rankOrder, keyOf } = require('./pay-sort.js');

/** A board of cards, given as [pay, unit] pairs in the site's own order. */
const board = (pairs) => pairs.map(([pay, unit], index) => ({ card: 'c' + index, pay, unit, index }));
const order = (pairs) => rankOrder(board(pairs)).map(it => it.card);

// ── THE BLOCKS: a month, then a rate, then a card with no figure ───────────
assert.deepStrictEqual(
  order([[null, ''], ['500', 'hour'], ['40000', 'month'], ['120', 'hour'], ['18000', 'month']]),
  ['c2', 'c4', 'c1', 'c3', 'c0'],
  'months (desc) → rates (desc) → no figure');
// The rule the user chose, stated as a test because it is the surprising one: a cheap month outranks a
// rich hourly rate. Converting ₱500/hr into a month would need a 40-hour week, and this module will not
// invent one to make a list look tidier.
assert.deepStrictEqual(order([['500', 'hour'], ['5000', 'month']]), ['c1', 'c0'],
  'a ₱5,000/mo listing still outranks a ₱500/hr one — no work week is assumed to compare them');
// A day rate is a rate, ordered by the number the listing posted. ₱5,000/day is not "more" than ₱500/hr
// without also assuming hours per day, so the two are not converted into each other either.
assert.deepStrictEqual(order([['500', 'hour'], ['5000', 'day']]), ['c1', 'c0'],
  'rate against rate: by the posted number, hour and day alike');

// ── ORDER WITHIN A BLOCK, AND THE SITE'S OWN ORDER INSIDE A TIE ────────────
assert.deepStrictEqual(order([['10000', 'month'], ['30000', 'month'], ['20000', 'month']]),
  ['c1', 'c2', 'c0'], 'a month block is highest first');
assert.deepStrictEqual(order([['30000', 'month'], ['30000', 'month'], ['30000', 'month']]),
  ['c0', 'c1', 'c2'], 'equal pay keeps the site order — the sort is stable by index, not by engine luck');
assert.deepStrictEqual(order([['null', ''], ['', ''], [undefined, '']]), ['c0', 'c1', 'c2'],
  'cards with no figure keep the site order among themselves');
// The blocks are ordered, so adding an unpriceable card never reorders the priced ones.
assert.deepStrictEqual(order([['9000', 'month'], [null, ''], ['20000', 'month']]), ['c2', 'c0', 'c1'],
  'an unpriceable card is a block of its own, not a 0 ₱ month');

// ── WHAT COUNTS AS A FIGURE: the mapping, including what it rejects ────────
assert.strictEqual(keyOf('40000', 'month', 0).block, 0);
assert.strictEqual(keyOf('400', 'hour', 0).block, 1);
assert.strictEqual(keyOf('400', 'day', 0).block, 1);
assert.strictEqual(keyOf('40000', 'month', 3).pay, 40000, 'the key carries the low end of the range');
assert.strictEqual(keyOf('40000', 'month', 3).index, 3, 'and where the card was, so ties can be broken');
// Defensive: the dataset is a string on a page we do not control. Anything that is not a positive number
// with a unit we understand is "no figure" — never a ranked 0, which would sort the unpriceable to the top
// of the month block (or, worse, below nothing at all).
for (const [pay, unit] of [['', 'month'], ['0', 'month'], ['-5', 'month'], ['abc', 'month'],
  [undefined, 'month'], ['40000', ''], ['40000', null], ['40000', 'hr'], ['40000', 'week'],
  ['40000', 'unit'], ['NaN', 'hour']]) {
  assert.strictEqual(keyOf(pay, unit, 0).block, 2, `${pay}/${unit} is not a figure`);
}
assert.strictEqual(keyOf('', '', 0).pay, 0, 'an unranked key carries a 0, so the comparator never sees NaN');
assert.deepStrictEqual(rankOrder([]), [], 'an empty board sorts to an empty board');
assert.deepStrictEqual(rankOrder(board([['7', 'month']])).length, 1, 'one card is already in order');
// The input array is not mutated: the caller's `cards()` order is the tie-break, so losing it would make
// the site order inside a tie depend on how many times the sort had run.
const input = board([['1', 'month'], ['2', 'month']]);
const copy = input.map(it => it.card);
rankOrder(input);
assert.deepStrictEqual(input.map(it => it.card), copy, 'rankOrder returns a new array and leaves the input alone');

console.log('test-paysort: ok (3 blocks + ties + what counts as a figure)');
