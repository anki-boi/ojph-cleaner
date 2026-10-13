// test-per-hour.js — node tests for per-hour.js (run: node test-per-hour.js)
//
// D70/D71: every figure per hour, and only ever over the post's OWN hours — the user: "the hourly salary MUST BASE
// ON SALARY DIVIDED BY ACTUAL HOURS". The "Full Time" label is not 40 hours.
const assert = require('assert');
const { parseSalary, toPhp, ratePhp } = require('./salary.js');
{
  const { perHour, formatHour, payLine } = require('./per-hour.js');
  const R = { USD: 58 };
  const ph = (text, basis) => perHour(parseSalary(text, basis && basis.hours), R, basis);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  near(ph('$400/month', { hours: 25, basis: 'detail' }).min, 400 * 58 / 100);
  assert.strictEqual(ph('$400/month', { hours: 25, basis: 'detail' }).hours, 25, "the post's own hours");
  near(ph('$400/month', { hours: 20, basis: 'stated' }).min, 400 * 58 / 80);
  // D71 — the user: "the hourly salary MUST BASE ON SALARY DIVIDED BY ACTUAL HOURS". No stated hours, no hour.
  assert.strictEqual(ph('$400/month', { hours: null, basis: 'full-time' }), null, 'a "Full Time" label is not 40 hours');
  assert.strictEqual(ph('$400/month', { hours: 40, basis: 'full-time' }), null, '…even if something hands it 40');
  assert.strictEqual(ph('$400/month', { hours: null, basis: 'unstated' }), null, 'no hours → no hourly figure');
  assert.strictEqual(ph('$400/month', { hours: null, basis: 'part-time' }), null, 'never 40 h for a part-time month');
  near(ph('$2.50/hr', { hours: null, basis: 'part-time' }).min, 2.5 * 58);
  assert.strictEqual(ph('$2.50/hr').posted, true, 'a posted rate is itself');
  assert.strictEqual(ph('Php 500/day', { hours: 40, basis: 'full-time' }), null, 'a day rate has no hour');
  assert.strictEqual(ph('$5 per thumbnail', {}), null, 'nor a per-unit rate');
  assert.strictEqual(perHour(parseSalary('$400/month', 40), {}, { hours: 40, basis: 'detail' }), null, 'no USD rate → nothing');
  assert.strictEqual(formatHour({ min: 157.2, max: 157.2 }), '≈ ₱157/hr');
  assert.strictEqual(formatHour({ min: 145, max: 232 }, { code: 'USD', rate: 58 }), '≈ $2.50 - $4/hr');
  assert.strictEqual(formatHour(null), null);
  // The card's pay line: hourly first, the month small beside it with the hours it rests on.
  const D = { code: 'USD', rate: 58 };
  const line = (text, basis, gig) => { const p = parseSalary(text, basis && basis.hours); const php = toPhp(p, R);
    return payLine({ php, rate: php ? null : ratePhp(p, R), unit: p.unit, ph: gig ? null : perHour(p, R, basis), gig }, D); };
  assert.deepStrictEqual(line('$400/month', { hours: 25, basis: 'detail' }), { main: '≈ $4/hr', sub: '≈ $400/mo · 25 h/wk' });
  // D71.2: the big slot is ALWAYS per hour — "? /hr" while no hour is known, never the month.
  const waiting = { main: '? /hr', sub: '≈ $400/mo · hours not read yet — Read posts gets them' };
  assert.deepStrictEqual(line('$400/month', { hours: null, basis: 'unstated' }), waiting);
  assert.deepStrictEqual(line('$400/month', { hours: null, basis: 'full-time' }), waiting, '"Full Time" is not 40 hours');
  assert.deepStrictEqual(line('$400/month', { hours: null, basis: 'part-time' }), waiting);
  assert.deepStrictEqual(line('$7.50/hour', { hours: 15, basis: 'detail' }), { main: '≈ $7.50/hr', sub: '≈ $450/mo' });
  assert.deepStrictEqual(line('$7.50/hour', { hours: null, basis: 'unstated' }), { main: '≈ $7.50/hr', sub: '' });
  assert.deepStrictEqual(line('200.00 for the Gig', { hours: 20, basis: 'detail' }, true),
    { main: '? /hr', sub: '≈ $200 for the job · a one-off price' });
  assert.deepStrictEqual(line('Php 500/day', { hours: null, basis: 'unstated' }),
    { main: '? /hr', sub: '≈ $8.62/day · hours per day not stated' });
  // D71.1: once the post has been read and states no hours, the card says so — no week is invented for it.
  const D2 = { code: 'USD', rate: 58 };
  assert.deepStrictEqual(payLine({ php: { min: 23200, max: 23200 }, ph: null, read: true }, D2),
    { main: '? /hr', sub: '≈ $400/mo · the post states no hours' });
  // A price for the whole job has no hour; a Gig that states a period is a rate like any other.
  const { isJobPrice } = require('./per-hour.js');
  assert.strictEqual(isJobPrice('Gig', '200.00 for the Gig'), true);
  assert.strictEqual(isJobPrice('Gig', '$150'), true, 'a gig price with no period');
  assert.strictEqual(isJobPrice('Full Time', '$300 per project'), true);
  assert.strictEqual(isJobPrice('Any', '$600/project + up to $600 bonus'), true);
  assert.strictEqual(isJobPrice('Gig', 'Php 190,000 / month'), false, 'a monthly gig is shown per hour');
  assert.strictEqual(isJobPrice('Gig', 'USD $7/hour'), false);
  assert.strictEqual(isJobPrice('Full Time', '$400/month'), false);
}

console.log('per-hour: ok (stated hours only, the hourly-first line, job prices)');
