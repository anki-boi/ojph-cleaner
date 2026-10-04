// test-setup.js — the first-run setup's decisions (spec.md D49/D50).
const assert = require('assert');
const S = require('./setup.js');

// D50: the suggested hourly minimum is the monthly one over a full-time month (40 h × 52 ÷ 12 ≈ 173.3 h).
assert.strictEqual(S.suggestHourly(60000), 346);
assert.strictEqual(S.suggestHourly(40000), 231);
assert.strictEqual(S.suggestHourly(1000, 'USD'), 5.77, 'dollars keep their cents');
assert.strictEqual(S.suggestHourly(0), 0);
assert.strictEqual(S.suggestHourly('abc'), 0);

assert.deepStrictEqual(S.parseWords('quickbooks, xero\nremote,, quickbooks '), ['quickbooks', 'xero', 'remote']);
assert.deepStrictEqual(S.parseWords(''), []);

// D49: shown to a fresh install only — never to one that has saved settings or finished it before.
assert.strictEqual(S.shouldShow(undefined, undefined), true);
assert.strictEqual(S.shouldShow({}, undefined), true);
assert.strictEqual(S.shouldShow(undefined, { negative: [] }), false, 'saved settings = a configured install');
assert.strictEqual(S.shouldShow({ onboarded: true }, undefined), false);

// Finish writes only what was answered; everything else is the current settings, untouched.
const cur = { positive: ['a'], negative: ['b'], goalSalary: 60000, goalHourly: 1000, currency: 'PHP', maxAgeDays: 60 };
assert.deepStrictEqual(S.applyAnswers(cur, { positive: [], negative: [], monthly: 0, hourly: 0 }),
  { ...cur, currency: 'PHP' }, 'nothing answered = nothing changed');
const next = S.applyAnswers(cur, { positive: ['va'], negative: ['crypto'], currency: 'USD', monthly: 1000, hourly: 5.77 });
assert.deepStrictEqual(next, { positive: ['va'], negative: ['crypto'], goalSalary: 1000, goalHourly: 5.77, currency: 'USD', maxAgeDays: 60 });
assert.notStrictEqual(next, cur, 'a new object — Undo needs the old one intact');
assert.deepStrictEqual(cur.positive, ['a']);

console.log('setup: ok (suggested hourly, word parsing, who sees it, what Finish writes)');
