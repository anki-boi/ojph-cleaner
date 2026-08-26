// test-rules.js — node tests for rules.js (run: node test-rules.js)
const assert = require('assert');
const { hasSalary, matchKeywords } = require('./rules.js');

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

console.log('rules: all assertions passed');
