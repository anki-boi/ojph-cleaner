// test-lowball.js — node tests for lowball.js (run: node test-lowball.js)
//
// A lowball verdict can end in a report filed under the user's account, so the thing pinned hardest here is
// the benefit of the doubt: the top of a range, known hours only, a 4-week month, and no guessed rates.
const assert = require('assert');
const LB = require('./lowball.js');
const { parseSalary } = require('./salary.js');

const RATES = { USD: 58, AUD: 38 };   // pesos per unit
const FLOOR = 2.99;
/** Parse the way salary-cards.js does, then judge: the card's text and the weekly hours its basis knows. */
const rate = (text, hours) => LB.hourlyUsd(parseSalary(text, hours), hours, RATES);
const low = (text, hours) => LB.isLowball(rate(text, hours), FLOOR);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

// ── hourly figures: judged as posted ──────────────────────────────────────
assert.strictEqual(low('$2.50/hour'), true, '$2.50/hr is under the line');
assert.strictEqual(low('2.50'), true, 'a bare small number is read as a dollar rate (salary.js magnitude rule)');
assert.strictEqual(low('$2.99/hr'), true, 'AT the line is a lowball — the user chose $2.99 so that $3 is not');
assert.strictEqual(low('$3/hr'), false, '$3/hr is not, at a $2.99 line');
assert.strictEqual(low('$3.50'), false);
assert.strictEqual(low('$2-$4/hr'), false, 'the TOP of a range is judged: it might pay $4');
assert.strictEqual(low('$2-$2.75/hr'), true, 'a range that tops out under the line is a lowball');
near(rate('Php 100/hour'), 100 / 58);
assert.strictEqual(low('Php 100/hour'), true, '₱100/hr ≈ $1.72/hr');
assert.strictEqual(low('Php 200/hour'), false, '₱200/hr ≈ $3.45/hr');

// ── monthly figures: only with known hours ────────────────────────────────
assert.strictEqual(rate('$320'), null, 'a month with unknown hours has no hourly rate — it could be 10 h a week');
assert.strictEqual(low('$320'), false);
near(rate('$320', 40), 2);   // full time: 40 h × 4 weeks = 160 h
assert.strictEqual(low('$320', 40), true, '$320/mo full-time is $2/hr');
assert.strictEqual(low('$400/month', 40), true, '$400/mo full-time is $2.50/hr');
assert.strictEqual(low('$480/month', 40), false, '$480/mo full-time is exactly $3/hr');
assert.strictEqual(low('$320', 20), false, '$320/mo at 20 h/week is $4/hr');
assert.strictEqual(low('PHP 15,000/month', 40), true, '₱15,000/mo full-time ≈ $1.62/hr');
assert.strictEqual(low('$1,300.00 - $1,400.00', 40), false);
assert.strictEqual(low('$300/m base + $50-$100/refer, unlimited', 40), true, 'the base month is what is promised');

// ── a month needs the POST'S OWN hours: never the "Full Time" label, never an assumed week ──
// The user, on "$400/month" flagged at a guessed 40 h whose post said 25 h/week: "let's never base it off face value".
assert.strictEqual(LB.hoursFor({ hours: 40, basis: 'full-time' }), null, '"Full Time" is a label, not a number');
assert.strictEqual(LB.hoursFor({ hours: null, basis: 'unstated' }), null, 'no hours → no assumed week');
assert.strictEqual(LB.hoursFor({ hours: null, basis: 'part-time' }), null);
assert.strictEqual(LB.hoursFor(undefined), null);
assert.strictEqual(LB.hoursFor({ hours: 25, basis: 'detail' }), 25, "the listing's own HOURS PER WEEK counts");
assert.strictEqual(LB.hoursFor({ hours: 20, basis: 'stated' }), 20, 'a number of hours in the post\'s text counts');
const viaBasis = (text, basis) => LB.hourlyUsd(parseSalary(text, basis.hours), LB.hoursFor(basis), RATES);
assert.strictEqual(viaBasis('$400/month', { hours: 40, basis: 'full-time' }), null,
  '$400/month on a "Full Time" card is NOT judged until its hours are read');
near(viaBasis('$400/month', { hours: 25, basis: 'detail' }), 4);
assert.strictEqual(LB.isLowball(viaBasis('$400/month', { hours: 25, basis: 'detail' }), FLOOR), false,
  'the live false positive: $400/month at the post\'s own 25 h/week is $4/hr — not a lowball');
assert.strictEqual(LB.isLowball(viaBasis('$400/month', { hours: 40, basis: 'detail' }), FLOOR), true,
  '…and at its own 40 h/week it is $2.50/hr — a lowball');
near(viaBasis('$2.50/hr', { hours: null, basis: 'part-time' }), 2.5, 'a posted rate needs no hours at all');

// ── candidates: worth reading the hours for, never a verdict ──────────────
const cand = (text, basis) => LB.isCandidate(parseSalary(text, basis.hours), LB.hoursFor(basis), RATES, FLOOR);
assert.strictEqual(cand('$400/month', { hours: 40, basis: 'full-time' }), true, 'could be $2.50/hr — read its hours');
assert.strictEqual(cand('$700/month', { hours: null, basis: 'unstated' }), true, '$700 at a 60 h week is $2.92/hr');
assert.strictEqual(cand('$800/month', { hours: null, basis: 'unstated' }), false, '$800 is over the line even at 60 h');
assert.strictEqual(cand('$400/month', { hours: 25, basis: 'detail' }), false, 'hours known → a verdict, not a candidate');
assert.strictEqual(cand('$2.50/hr', { hours: null, basis: 'unstated' }), false, 'a rate is judged as posted');
assert.strictEqual(cand('$400/month', { hours: 40, basis: 'full-time' }) && LB.isLowball(
  viaBasis('$400/month', { hours: 40, basis: 'full-time' }), FLOOR), false, 'a candidate is never a lowball by itself');

// ── readings too weak to report on (both seen live, 2026-10-13) ───────────
assert.strictEqual(rate('3/hour'), null, 'no currency on a rate: read as ₱3 for display, never judged');
assert.strictEqual(rate('4 per hour'), null);
assert.strictEqual(rate('10-15/hr'), null);
// "Php36K" used to lose its "k" and read as ₱36 an hour; the parser now reads thousands.
near(rate('Php36K', 40), 36000 / 58 / 160);
assert.strictEqual(low('Php36K', 40), false, '₱36,000/mo at 40 h is $3.88/hr');
near(rate('Starts at 55k PHP', 40), 55000 / 58 / 160);
// The sanity floor: a rate under $0.20/hr is a figure the parser misread ("PHP 20.000/m" is ₱20), never a verdict.
assert.strictEqual(rate('PHP 20.000/m', 40), null, 'a dotted thousands figure read as ₱20 a month is not judged');
near(rate('$100/month', 50), 0.5);   // …while a real $100/month at 50 h, $0.50/hr, still is
assert.strictEqual(low('$100/month', 50), true);
assert.strictEqual(low('2.50'), true, 'a bare small number read as DOLLARS is still judged');
near(rate('25000', 40), 25000 / 58 / 160);   // a bare large number is a peso month by magnitude — judged

// ── gigs and whole-job prices: never judged ───────────────────────────────
// Live, 2026-10-14: "200.00 for the Gig", TYPE OF WORK Gig, HOURS PER WEEK 20 → read as a month → "$2.50/hr".
assert.strictEqual(LB.isGig('Gig', '200.00 for the Gig'), true);
assert.strictEqual(LB.isGig('Gig', '$400/month'), true, 'the type alone is enough');
assert.strictEqual(LB.isGig(' gig ', ''), true);
assert.strictEqual(LB.isGig('Any', '200.00 for the Gig'), true, 'so is a price quoted for the gig');
assert.strictEqual(LB.isGig('Full Time', '$300 per project'), true);
assert.strictEqual(LB.isGig('Any', '$150 fixed price'), true);
assert.strictEqual(LB.isGig('Full Time', '$400/month'), false);
assert.strictEqual(LB.isGig('Part Time', '$500/month + one-time signing bonus'), false, 'a bonus does not make a month a gig');
assert.strictEqual(LB.isGig('Full Time', 'Digital marketing — $3/hr'), false, 'never inside a word');
assert.strictEqual(LB.isGig(undefined, undefined), false);

// ── never judged ──────────────────────────────────────────────────────────
assert.strictEqual(rate('Php 500/day', 40), null, 'a day rate has no hourly rate without hours per day');
assert.strictEqual(rate('600-700/monthly', 40), null, 'a per-unit figure is never judged');
assert.strictEqual(LB.hourlyUsd(parseSalary('$2/hr'), null, {}), 2, 'a dollar rate needs no exchange rate');
assert.strictEqual(LB.hourlyUsd(parseSalary('Php 100/hour'), null, {}), null, 'no USD rate → no verdict, not a guess');
assert.strictEqual(LB.hourlyUsd(parseSalary('15 AUD per hour'), null, { AUD: 38 }), null, 'AUD needs the USD rate too');
near(LB.hourlyUsd(parseSalary('3 AUD per hour'), null, RATES), 3 * 38 / 58);
assert.strictEqual(LB.hourlyUsd(null, 40, RATES), null);

// ── the line ──────────────────────────────────────────────────────────────
assert.strictEqual(LB.isLowball(1, 0), false, 'a line of 0 is off');
assert.strictEqual(LB.isLowball(1, ''), false, 'an empty line is off');
assert.strictEqual(LB.isLowball(null, 2.99), false, 'no rate is never a lowball');
assert.strictEqual(LB.isLowball(2.994, 2.99), true, 'judged to the cent');
assert.strictEqual(LB.isLowball(2.996, 2.99), false);
assert.strictEqual(LB.isLowball(4.5, 5), true, 'configurable: a higher line reports more');

// ── the report's note ─────────────────────────────────────────────────────
assert.strictEqual(LB.REPORT_TYPE_SALARY, 1, 'OnlineJobs.ph\'s "Salary too low" reason');
assert.ok(LB.reportReason(2, 2.99).includes('$2.00/hour'));
assert.ok(LB.reportReason(2, 2.99).includes('$2.99/hour'));

// ── the log and the daily cap ─────────────────────────────────────────────
const H = 3600 * 1000, NOW = 1_800_000_000_000;
const log = { a: NOW - 1 * H, b: NOW - 23 * H, c: NOW - 25 * H, d: NOW - 200 * 24 * H };
assert.strictEqual(LB.remainingToday(log, NOW, 20), 18, 'the last 24 hours, not the calendar day');
assert.strictEqual(LB.remainingToday(log, NOW, 2), 0);
assert.strictEqual(LB.remainingToday(log, NOW, 1), 0, 'never negative');
assert.strictEqual(LB.remainingToday(log, NOW, 0), 0, 'a cap of 0 sends nothing');
assert.strictEqual(LB.remainingToday({}, NOW, 'x'), 0, 'a nonsense cap sends nothing');
assert.deepStrictEqual(Object.keys(LB.prune(log, NOW)).sort(), ['a', 'b', 'c'], 'pruned after 180 days');
assert.deepStrictEqual(LB.prune(undefined, NOW), {});

console.log('lowball: ok');
