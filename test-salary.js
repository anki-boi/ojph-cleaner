// test-salary.js — node tests for salary.js's pure part (run: node test-salary.js).
//
// Two sources: the sibling repo's tests/test_salary.py (formats observed in real job data) and formats
// sampled from the live board on 2026-09-18. Where this port deliberately differs from the suite, the
// assertion says so.
//
// THE POLICY UNDER TEST: a monthly figure is only claimed when the listing gives a per-month/week/year
// amount, or an hourly rate plus stated weekly hours (or "full time", which means 40 h/week). No
// fallback exists for unstated hours — not 40, and not 20 for "Part Time", which states no number at all.
const assert = require('assert');
const {
  parseSalary, toPhp, ratePhp, formatNote, formatRate, meetsGoal, goalBand, hoursPerWeekFrom, pickFresh,
} = require('./salary.js');

/** [min, max, currency] of the monthly figure, or [null, null, null] when no month is claimed. */
const monthly = (text, hours) => {
  const p = parseSalary(text, hours);
  return p && p.monthly ? [p.min, p.max, p.currency] : [null, null, null];
};
const FT = 40;   // a listing that states full time

// ── ported from the suite's fixture corpus (hours supplied where the suite assumed a 160 h month) ──
assert.deepStrictEqual(monthly('40000-50000php'), [40000, 50000, 'PHP']);
assert.deepStrictEqual(monthly('Php40,000.00 - Php50,000.00'), [40000, 50000, 'PHP']);
assert.deepStrictEqual(monthly('$800-$1200/mo'), [800, 1200, 'USD']);
assert.deepStrictEqual(monthly('$6 to $15/hr', FT), [960, 2400, 'USD'], 'hourly × 40 h/week × 4');
assert.deepStrictEqual(monthly('12 USD per hour', FT), [1920, 1920, 'USD']);
assert.deepStrictEqual(monthly('42000'), [42000, 42000, 'PHP'], 'bare 5 digits = monthly pesos');
assert.deepStrictEqual(monthly('11-17', FT), [1760, 2720, 'USD'],
  'bare 1-2 digits = an hourly rate (and a foreign one: ₱11/hr is below any wage here)');
assert.deepStrictEqual(monthly('Circa Annual Salary - US$6000'), [500, 500, 'USD'], 'annual ÷ 12');
assert.deepStrictEqual(monthly('$400'), [400, 400, 'USD']);
assert.deepStrictEqual(monthly('Starting at $1,200 USD/month'), [1200, 1200, 'USD']);
assert.deepStrictEqual(monthly('$350$380/mo (Total Package)'), [350, 380, 'USD'], 'mojibake dash');
assert.deepStrictEqual(monthly('$7,5/hour', FT), [1200, 1200, 'USD'], 'PH decimal comma is .5, not 75');
assert.deepStrictEqual(monthly('47,000-170,000'), [47000, 170000, 'PHP'], 'thousands commas');
assert.deepStrictEqual(monthly('$1,055.00 per month (P60,300 php)'), [1055, 1055, 'USD'], 'aside dropped');
assert.deepStrictEqual(monthly('($2.00-$3.00) hourly', FT), [320, 480, 'USD'], 'aside kept when it is the only number');
assert.deepStrictEqual(monthly('$100/month'), [100, 100, 'USD'], 'explicit month ≠ hourly guess');
assert.deepStrictEqual(monthly('DOE'), [null, null, null]);
assert.deepStrictEqual(monthly(''), [null, null, null]);
assert.deepStrictEqual(monthly(null), [null, null, null]);
assert.deepStrictEqual(monthly('Negotiable'), [null, null, null]);
assert.deepStrictEqual(monthly('Commensurate with experience'), [null, null, null]);
assert.strictEqual(parseSalary('$200/Week + 5% commission').min, 866, 'weekly × 4.33; commission % is not a price');

// ── bare numbers are read by magnitude (spec.md D12) ───────────────────
// 1-2 digits → hourly, 3-4 digits → monthly, 5+ digits → monthly pesos. All three come from live
// cards: `6.00`/`4`/`7` were foreign writing roles, `400-500`/`1000`/`2000` monthly USD rates.
const bare = (t, h) => { const p = parseSalary(t, h); return p ? [p.min, p.max, p.currency, p.unit] : null; };
assert.deepStrictEqual(bare('6.00'), [6, 6, 'USD', 'hour?']);
assert.deepStrictEqual(bare('400-500', FT), [400, 500, 'USD', 'month']);
assert.deepStrictEqual(bare('1000'), [1000, 1000, 'USD', 'month']);
assert.deepStrictEqual(bare('2000', FT), [2000, 2000, 'USD', 'month']);
assert.deepStrictEqual(bare('35000'), [35000, 35000, 'PHP', 'month']);
assert.deepStrictEqual(bare('1500 per month'), [1500, 1500, 'USD', 'month'],
  'a markerless monthly figure is read by magnitude too');
// but an explicit unit keeps the board's convention: pesos
assert.deepStrictEqual(bare('140 -175/ per hour', 20), [11200, 14000, 'PHP', 'hour']);
assert.deepStrictEqual(bare('1000/day'), [1000, 1000, 'PHP', 'day']);
// the magnitude reading is only a FALLBACK: a stated currency always wins, whatever the size
assert.deepStrictEqual(monthly('€450-550'), [450, 550, 'EUR'], '3-4 digits, but stated in €');
assert.deepStrictEqual(monthly('450-550 AUD'), [450, 550, 'AUD']);
assert.deepStrictEqual(monthly('Php 1,500'), [1500, 1500, 'PHP'], '4 digits, stated in pesos');
assert.deepStrictEqual(monthly('£2500'), [2500, 2500, 'GBP']);
assert.strictEqual(parseSalary('42000').assumedCurrency, true, 'the currency was inferred, and says so');
assert.strictEqual(parseSalary('Php 42000').assumedCurrency, false, 'a stated marker is never "assumed"');
assert.strictEqual(parseSalary('$400').assumedCurrency, false, 'a stated marker is not an inference');

assert.deepStrictEqual(monthly('$700/month ($175/week, paid weekly)'), [700, 700, 'USD'], 'aside dropped');
// ── THE POLICY: no hours stated → no monthly figure ─────────────────────
for (const text of ['$5/hour', '6/hr', '$8/hour', '8 USD per hour', 'Up to $4.50 p/hour', '140 -175/ per hour']) {
  const p = parseSalary(text);                       // no hours given
  assert.strictEqual(p.monthly, false, `${text}: no hours → no month may be claimed`);
  assert.strictEqual(p.unit, 'hour');
}
// a plural unit is still a time unit: "3/Hours" is live data and was read as a piece rate
assert.strictEqual(parseSalary('3/Hours').perUnit, false, 'plural "Hours" is not a piece rate');
assert.deepStrictEqual(monthly('3/Hours', FT), [480, 480, 'PHP'], '₱3/hour full time (stated unit → pesos)');
assert.strictEqual(parseSalary('Php 1000/days').perUnit, false);
// live card: the "+/-" is punctuation, so this is an hourly rate (part-time/full-time decides the month)
assert.strictEqual(parseSalary('$5+/- per hour US - depends on experience & skills').perUnit, false);
assert.deepStrictEqual(monthly('$5+/- per hour US - depends on experience & skills', FT), [800, 800, 'USD'],
  'full time → 5 × 160');
assert.strictEqual(toPhp(parseSalary('$5/hour'), { USD: 62.7 }), null, 'no hours → toPhp refuses');
assert.deepStrictEqual(ratePhp(parseSalary('$5/hour'), { USD: 62.7 }), { min: 314, max: 314 },
  'the posted rate itself is still converted and shown');
assert.strictEqual(formatRate({ min: 314, max: 314 }, 'hour'), '≈ ₱314/hr');
assert.strictEqual(formatNote(null), null);
// with the hours, the same listing gets a month
assert.deepStrictEqual(monthly('$5/hour', 20), [400, 400, 'USD'], '20 h/week → ×80');
assert.deepStrictEqual(monthly('$5/hour', FT), [800, 800, 'USD'], 'full-time → ×160, unchanged from the suite');
assert.deepStrictEqual(monthly('140 -175/ per hour', 20), [11200, 14000, 'PHP'],
  'no currency marker on this board means PHP');

// ── "Part Time" states no number, so it must not become one ─────────────
assert.deepStrictEqual(hoursPerWeekFrom('Part Time'), { hours: null, basis: 'part-time' });
assert.deepStrictEqual(hoursPerWeekFrom('Full Time'), { hours: 40, basis: 'full-time' });
assert.deepStrictEqual(hoursPerWeekFrom('Part Time — some full time availability needed'),
  { hours: null, basis: 'part-time' }, 'part-time wins; prose must not hand it a 40-hour month');
assert.deepStrictEqual(hoursPerWeekFrom('20 hours per week'), { hours: 20, basis: 'stated' });
assert.deepStrictEqual(hoursPerWeekFrom('Hours per week: 30'), { hours: 30, basis: 'stated' });
assert.deepStrictEqual(hoursPerWeekFrom('Virtual assistant, no schedule given'), { hours: null, basis: 'unstated' });
assert.deepStrictEqual(hoursPerWeekFrom(''), { hours: null, basis: 'unstated' });
assert.deepStrictEqual(monthly('$5/hour', hoursPerWeekFrom('Part Time').hours), [null, null, null],
  'a part-time listing with no stated hours gets a rate, never a month');

// ── day rates: no days/week given, so never a month ─────────────────────
const day = parseSalary('Php 1000/day');
assert.strictEqual(day.monthly, false, 'the suite turned this into ₱30,000/mo by assuming 30 work days');
assert.strictEqual(day.unit, 'day');
assert.deepStrictEqual(monthly('Php 1000/day', FT), [null, null, null], 'even full time: days/week is unknown');
assert.strictEqual(formatRate(ratePhp(day, {}), 'day'), '≈ ₱1,000/day');

// ── currencies the board really uses (sampled live, 2026-09-18) ──────────
assert.deepStrictEqual(monthly('15-20 AUD per hour', FT), [2400, 3200, 'AUD'], 'not PHP');
assert.deepStrictEqual(monthly('GBP 450 per month'), [450, 450, 'GBP']);
assert.deepStrictEqual(monthly('1000€ /m'), [1000, 1000, 'EUR'], 'a foreign symbol is not PHP');
assert.deepStrictEqual(monthly('$10 - $13 CAD per hour', FT), [1600, 2080, 'CAD'], 'the code beats the $');
assert.deepStrictEqual(monthly('SGD $1500 to $2,000 excluding bonuses'), [1500, 2000, 'SGD']);
assert.strictEqual(parseSalary('15us per channel weekly').currency, 'USD', '"us" is USD');
assert.deepStrictEqual(monthly('350$ Month'), [350, 350, 'USD']);
assert.deepStrictEqual(monthly('PHP 240/hour, approx. PHP 40,000/mo'), [40000, 40000, 'PHP'],
  'the monthly segment beats the hourly one — the suite reads this as ₱38,400–₱6,400,000');
assert.deepStrictEqual(monthly('USD 1,250.00'), [1250, 1250, 'USD']);
// a currency code right after a digit is still a code: "400USD/mo" was shown as ₱400/mo (62× wrong)
assert.deepStrictEqual(monthly('400USD/mo'), [400, 400, 'USD']);
assert.deepStrictEqual(monthly('35,000PHP'), [35000, 35000, 'PHP']);
assert.deepStrictEqual(monthly('2500SGD per month'), [2500, 2500, 'SGD']);
assert.strictEqual(parseSalary('15us per hour').currency, 'USD', '"us" is a dollar');
assert.strictEqual(parseSalary('140 -175 per hour plus benefits').currency, 'PHP',
  '"plus" must not read as USD — a markerless hourly rate keeps the board\'s convention');

// ── piece rates: no monthly equivalent may be invented ──────────────────
assert.strictEqual(parseSalary('$5 per entry').perUnit, true);
assert.strictEqual(parseSalary('$5 per account that is verified').perUnit, true);
assert.strictEqual(parseSalary('$2/article').perUnit, true);
assert.strictEqual(parseSalary('15us per channel weekly').perUnit, true, 'per-unit beats the weekly unit');
assert.strictEqual(toPhp(parseSalary('$5 per entry', FT), { USD: 62.7 }), null,
  'a piece rate must never be shown as a monthly salary');
assert.strictEqual(ratePhp(parseSalary('$5 per entry'), { USD: 62.7 }), null, 'nor as a per-hour rate');
for (const timeUnit of ['Php200.00 - 210.00 Per Hour', 'Php 1000/day', '$5/hr', '$2,000/month',
                        'Php 190,000 / month', '1000€ /m', '40000-50000php']) {
  assert.strictEqual(parseSalary(timeUnit).perUnit, false, `${timeUnit} is a time unit, not a piece rate`);
}

// ── conversion, formatting, goal ────────────────────────────────────────
assert.deepStrictEqual(toPhp(parseSalary('Php 30,000'), {}), { min: 30000, max: 30000 }, 'PHP needs no rate');
assert.strictEqual(toPhp(parseSalary('$880'), {}), null, 'no rate → no converted figure, never a guess');
assert.deepStrictEqual(toPhp(parseSalary('$880'), { USD: 62.7 }), { min: 55176, max: 55176 });
assert.deepStrictEqual(toPhp(parseSalary('$10 - $13 CAD per hour', FT), { USD: 62.7 }), null,
  'a CAD card must not be converted with a USD rate');

assert.strictEqual(formatNote({ min: 30000, max: 30000 }), '≈ ₱30,000/mo');
assert.strictEqual(formatNote({ min: 11600, max: 17400 }), '≈ ₱11,600 - ₱17,400/mo');

assert.strictEqual(meetsGoal({ min: 40000, max: 45000 }, 40000), true, 'min at goal counts');
assert.strictEqual(meetsGoal({ min: 30000, max: 90000 }, 40000), false, 'a maybe is not a yes');
assert.strictEqual(meetsGoal({ min: 90000, max: 90000 }, 0), false, 'goal 0 = feature off');
assert.strictEqual(meetsGoal(null, 40000), false, 'no monthly figure → nothing to compare');

// ── pickFresh: which cached FX rates are still alive (long-lived tabs, 2026-09-21) ──
// A tab left open past the 24-hour TTL must not keep converting with a dead rate: the split between
// servable and stale is exactly at the TTL, and a failed currency is not retried inside its window.
{
  const TTL = 86400000, RETRY = 3600000, now = 1000000000000;
  const store = {
    rates: {
      USD: { rate: 58.1, date: '2026-09-20', at: now - (TTL - 1000) },  // inside the TTL
      EUR: { rate: 61.2, date: '2026-09-19', at: now - TTL },          // exactly at the TTL boundary
      JPY: { rate: 0.37, date: '2026-09-18', at: now - (TTL + 1000) }, // one ms past it
    },
    failed: { GBP: now - 60000 },  // failed a minute ago: inside the retry window
  };
  const p = pickFresh(store, ['USD', 'EUR', 'JPY', 'GBP', 'CAD'], now, TTL, RETRY);
  assert.deepStrictEqual(p.fresh.USD, { rate: 58.1, date: '2026-09-20' }, 'a live rate is kept');
  assert.deepStrictEqual(p.fresh.EUR, { rate: 61.2, date: '2026-09-19' }, 'a rate exactly at the TTL is still servable');
  assert.ok(!('JPY' in p.fresh), 'one ms past the 24-hour TTL is stale');
  assert.ok(!('GBP' in p.fresh), 'a failed currency has no rate');
  assert.deepStrictEqual(p.needed, ['JPY', 'CAD'], 'stale and unknown go back to the network');
  assert.ok(!p.needed.includes('GBP'), 'a currency that just failed is not retried inside its window');
  const p2 = pickFresh(store, ['GBP'], now + RETRY, TTL, RETRY);
  assert.deepStrictEqual(p2.needed, ['GBP'], 'after the retry window the failed currency is tried again');
  assert.deepStrictEqual(pickFresh(null, ['AUD'], now, TTL, RETRY), { fresh: {}, needed: ['AUD'] },
    'no store at all is an empty cache, not an error');
  // A NaN stored by an older build must not be served: NaN != null is true, so the old guard passed it.
  const bad = { rates: { USD: { rate: NaN, date: '2026-09-20', at: now - 1000 } } };
  assert.deepStrictEqual(pickFresh(bad, ['USD'], now, TTL, RETRY), { fresh: {}, needed: ['USD'] },
    'a stored NaN rate is stale, not servable');
}

// ── the thousands comma, however the poster grouped it (live bug, 2026-09-19) ──
// A LIVE listing wrote `35,0000 - 40,0000` — a mis-typed 350 000. Reading the 4-digit group as decimals made
// the number 35, which then read as "$35/hour" and showed ₱395,249/mo for a ₱350,000/month job. The user
// spotted it at once: "this is obviously already in pesos since the salary stated is 5 digits and above".
const livePhp = { USD: 62.738 };
assert.deepStrictEqual(
  (() => { const p = parseSalary('35,0000 - 40,0000', null); return { min: p.min, max: p.max, currency: p.currency, unit: p.unit }; })(),
  { min: 350000, max: 400000, currency: 'PHP', unit: 'month' },
  'a 5-6 digit peso figure must survive a misplaced comma and stay pesos');
assert.deepStrictEqual(
  (() => { const p = parseSalary('35,000', null); return { min: p.min, currency: p.currency }; })(),
  { min: 35000, currency: 'PHP' }, 'the ordinary case still works');
// A 1-2 digit group after the comma is still a decimal comma (the European convention).
assert.strictEqual(parseSalary('7,5', null).min, 7.5);
assert.strictEqual(parseSalary('1,50', null).min, 1.5);
assert.strictEqual(parseSalary('1,500', null).min, 1500, 'three digits is still thousands');
assert.strictEqual(parseSalary('1,2345', null).min, 12345, 'and so is four, when a poster groups it that way');
assert.strictEqual(parseSalary('2,000,000', null).min, 2000000);
// The whole shape of the bug: the figure the user actually saw on the card.
assert.deepStrictEqual(
  (() => { const p = parseSalary('35,0000 - 40,0000', null); return toPhp(p, livePhp); })(),
  { min: 350000, max: 400000 }, 'and it converts as pesos, not as dollars');

// The premium bands (0.12): stepped on the margin over the goal, null- and NaN-safe in the safe
// direction (no readable margin is no band, never a guessed one).
assert.strictEqual(goalBand(0.24), '', 'just under a quarter is no band');
assert.strictEqual(goalBand(0.25), 'b25', 'a quarter exactly is the lower band');
assert.strictEqual(goalBand(0.49), 'b25');
assert.strictEqual(goalBand(0.5), 'b50', 'half again exactly is the upper band');
assert.strictEqual(goalBand(2), 'b50');
assert.strictEqual(goalBand(null), '');
assert.strictEqual(goalBand(NaN), '');
assert.strictEqual(goalBand(undefined), '');

console.log('salary: all assertions passed');
