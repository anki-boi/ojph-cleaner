// test-trust.js — the scam radar (D58) and the schedule in your time (D59).
const assert = require('assert');
const R = require('./risk.js');
const S = require('./schedule.js');

// ── risk: each signal alone scores its weight; nothing scores without a reason ──
const one = (input) => R.score(input);
assert.deepStrictEqual(one({ text: 'Great bookkeeping role, QuickBooks.', company: 'Acme' }), { score: 0, reasons: [], tagged: false });
assert.strictEqual(one({ text: 'A small registration fee of $20 is required.', company: 'X' }).score, 40);
assert.ok(one({ text: 'A small registration fee of $20 is required.', company: 'X' }).tagged, 'a fee alone is enough to tag');
assert.strictEqual(one({ text: 'apply below', flags: ['ask'], company: 'X' }).score, 25);
assert.strictEqual(one({ text: 'send it to ----------', flags: [], company: 'X' }).score, 25, 'a redaction run counts even without the flag');
assert.strictEqual(one({ text: 'x', flags: ['ask', 'redacted'], company: 'X' }).score, 30, 'an ask and the redaction of its link are one fact, not two');
assert.ok(!one({ text: 'x', flags: ['ask', 'redacted'], company: 'X' }).tagged, '"email us" alone is a tag on the card, not a risk mark');
assert.ok(!one({ text: 'x', flags: ['ask', 'redacted'], company: '' }).tagged, 'nor with no company name (35): anonymous posts are common here');
assert.ok(one({ text: 'unpaid trial week first', flags: ['ask'], company: 'X' }).tagged, 'an ask plus an unpaid trial (45) is');
assert.strictEqual(one({ text: 'There is an unpaid trial week first.', company: 'X' }).score, 20);
assert.strictEqual(one({ text: 'Help us trade crypto and forex.', company: 'X' }).score, 20);
assert.strictEqual(one({ text: 'x', pay: 300000, median: 60000, company: 'X' }).score, 15);
assert.strictEqual(one({ text: 'x', pay: 150000, median: 60000, company: 'X' }).score, 0, '2.5× is a good job, not a red flag');
assert.strictEqual(one({ text: 'x', company: '' }).score, 5);
assert.strictEqual(one({ text: 'x' }).score, 0, 'unknown company is not "no company"');
const all = one({ text: 'You must buy a starter kit, unpaid trial, bitcoin, ----------', flags: ['ask'], company: '', pay: 9e5, median: 5e4 });
assert.strictEqual(all.score, 100, 'capped at 100');
assert.strictEqual(all.reasons.length, 7, 'fee, ask, redactedToo, trial, crypto, too good, no company');
assert.ok(all.reasons.every(r => r.why && r.points > 0), 'every point has a readable reason');
assert.strictEqual(one({ text: 'We will pay the fee for your certification', company: 'X' }).score, 0, '"pay the fee" for you is not a fee asked of you');
assert.strictEqual(one({ text: 'We cover the registration fee. Apply now.', company: 'X' }).score, 0, 'the employer paying is a perk');
assert.strictEqual(one({ text: 'You must pay a one-time fee before training.', company: 'X' }).score, 40);
// Measured live: a bookkeeping job's DUTIES are full of fees. None of these is a fee asked of you.
for (const duty of ['Properly account for platform fees, refunds, chargebacks, returns, and payment-processing fees',
  'Strong understanding of inventory, COGS, refunds, platform fees, and ecommerce payment processing',
  'Track membership fees and registration fees for our clients in Xero.']) {
  assert.strictEqual(one({ text: duty, company: 'X' }).score, 0, `a duty is not a scam: ${duty}`);
}
assert.strictEqual(one({ text: 'Applicants pay a $15 training fee before starting.', company: 'X' }).score, 40);
assert.strictEqual(R.median([5, 1, 3]), 3);
assert.strictEqual(R.median([4, 1, 3, 2]), 2.5);
assert.strictEqual(R.median([]), 0);

// ── schedule: find a zoned range ──
const f1 = S.find('Schedule: Fixed Daily Block: 6:00 AM to 9:00 AM Philippine Time, Monday to Friday');
assert.deepStrictEqual([f1.start, f1.end, f1.zone], [360, 540, 'Asia/Manila']);
const f2 = S.find('Hours are 9-5 EST');
assert.deepStrictEqual([f2.start, f2.end, f2.zone], [540, 1020, 'America/New_York'], '"9-5" is the office day');
const f3 = S.find('Shift: 8am – 5pm (PST)');
assert.deepStrictEqual([f3.start, f3.end, f3.zone], [480, 1020, 'America/Los_Angeles']);
const f4 = S.find('Work 10PM to 7AM Manila time');
assert.deepStrictEqual([f4.start, f4.end], [1320, 420]);
assert.strictEqual(S.find('We work 9 to 5, flexible.'), null, 'no zone → nothing, never a guess');
assert.strictEqual(S.find('Pay is 300-500 per hour PHT'), null, 'a pay range is not a schedule');
assert.strictEqual(S.find('Hours: 40 per week, US Central Time'), null, 'a zone with no times is not a range');

// ── convert: Intl offsets, daylight saving right on the day ──
const jan = new Date(Date.UTC(2026, 0, 15, 12)), jul = new Date(Date.UTC(2026, 6, 15, 12));
assert.strictEqual(S.offsetOf('Asia/Manila', jan), 480);
assert.strictEqual(S.offsetOf('America/New_York', jan), -300);
assert.strictEqual(S.offsetOf('America/New_York', jul), -240, 'EDT in July');
const est = S.convert(f2, 'Asia/Manila', jan);
assert.deepStrictEqual([est.text, est.night], ['10 PM–6 AM', true], '9-5 New York in January is a night shift in Manila');
assert.strictEqual(S.convert(f2, 'Asia/Manila', jul).text, '9 PM–5 AM', 'one hour earlier in July (EDT)');
const same = S.convert(f1, 'Asia/Manila', jan);
assert.deepStrictEqual([same.text, same.same, same.night], ['6 AM–9 AM', true, false]);

// ── your hours ──
assert.deepStrictEqual(S.parseHours('08:00-18:00'), { start: 480, end: 1080 });
assert.deepStrictEqual(S.parseHours('8-17'), { start: 480, end: 1020 });
assert.strictEqual(S.parseHours('whenever'), null);
const mine = S.parseHours('08:00-18:00');
assert.strictEqual(S.fit(same, mine), 'some', '6–9 AM against 8 AM–6 PM: partly');
assert.strictEqual(S.fit({ start: 540, end: 1020 }, mine), 'all');
assert.strictEqual(S.fit(est, mine), 'none');
assert.strictEqual(S.fit({ start: 1380, end: 60 }, S.parseHours('22:00-02:00')), 'all', 'both across midnight');

console.log('trust: ok (risk signals, zoned ranges, DST-correct conversion, your hours)');
