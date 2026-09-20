// test-tiers.js — node tests for tiers.js (run: node test-tiers.js)
//
// The tier table is the whole feature's decision point, so it is pinned branch by branch, including the
// one property that makes the feature safe to ship: **with no deep-scan detail, it must reproduce the
// verdicts 0.8.0 shipped** (green / yellow / hidden), because that is what every live assertion in
// tools/verify-live.mjs already relies on.
const assert = require('assert');
const T = require('./tiers.js');
const { decide, isHidden, TIERS } = T;

const card = (o) => ({ pos: [], neg: [], goal: false, ...o });
const det = (o) => ({ pos: [], neg: [], flags: [], ...o });
const d = (o) => decide(o);

// ── UNSCANNED PARITY: the 0.8.0 verdicts, exactly ────────────────────────
// Card text only, no record. Anything else here is a regression the user would feel as
// "my keywords stopped working".
// PAY decides High yield (the user's rule): a positive keyword alone is a HIGHLIGHT, not a high-yield listing.
assert.strictEqual(d({ card: card({ pos: ['quickbooks'] }) }), 'pos');
assert.strictEqual(d({ card: card({ goal: true }) }), 'high', 'passing salary is what makes it high yield');
assert.strictEqual(d({ card: card({ goal: true, pos: ['quickbooks'] }) }), 'high',
  'passing salary WITH a keyword you like is still high yield');
assert.strictEqual(d({ card: card({}) }), 'none');
assert.strictEqual(d({ card: card({ pos: ['ai'], neg: ['crypto'] }) }), 'worth', 'looks good, hide keyword → yellow');
assert.strictEqual(d({ card: card({ goal: true, neg: ['crypto'] }) }), 'worth');
assert.strictEqual(d({ card: card({ neg: ['crypto'] }) }), 'kw');
assert.strictEqual(d({ card: card({}) }), 'none');
// A detail object that exists but found nothing must behave exactly like no scan at all.
assert.strictEqual(d({ card: card({ pos: ['ai'] }), detail: det({}) }), 'pos');
assert.strictEqual(d({ card: card({}), detail: det({}) }), 'none');

// ── THE FIRST THREE RULES OUTRANK EVERYTHING ─────────────────────────────
assert.strictEqual(d({ closed: true, card: card({ pos: ['ai'], goal: true }) }), 'closed');
assert.strictEqual(d({ stale: true, card: card({ pos: ['ai'] }) }), 'stale');
assert.strictEqual(d({ noSalary: true, card: card({ pos: ['ai'] }) }), 'nosal');
// W10's rescue reuses the same `good`, so a no-salary listing with a detail positive is rescued too.
assert.strictEqual(d({ noSalary: true, rescue: true, card: card({ pos: ['ai'] }) }), 'pos',
  'the rescue stops it being hidden; paying nothing still keeps it out of High yield');
assert.strictEqual(d({ noSalary: true, rescue: true, card: card({}), detail: det({ pos: ['x'] }) }), 'pos');
assert.strictEqual(d({ noSalary: true, rescue: true, card: card({ neg: ['crypto'] }) }), 'nosal',
  'the rescue needs `good`: with nothing to like, the no-salary branch (which precedes the keyword branch in 0.8.0, and still does) is what hides it');
assert.strictEqual(d({ noSalary: true, rescue: false, card: card({ pos: ['ai'] }) }), 'nosal',
  'rescue off means rescue off');

// ── THE PROMOTIONS THE DEEP SCAN BUYS ────────────────────────────────────
// White → green: the description says what the card's short text never did.
assert.strictEqual(d({ card: card({}), detail: det({ pos: ['quickbooks'] }) }), 'pos');
// Hidden → yellow: a description positive rescues a hide-keyword card.
assert.strictEqual(d({ card: card({ neg: ['crypto'] }), detail: det({ pos: ['quickbooks'] }) }), 'worth');
// A goal-only card stays good, so a description negative demotes it rather than hiding it.
assert.strictEqual(d({ card: card({ goal: true }), detail: det({ neg: ['crypto'] }) }), 'worth');

// ── THE DEMOTIONS ────────────────────────────────────────────────────────
// Green → yellow: a hide keyword the card text did not carry. That is the ONLY demotion there is.
assert.strictEqual(d({ card: card({ pos: ['ai'] }), detail: det({ neg: ['crypto'] }) }), 'worth');
// The description is a SUPERSET of the card text, so it can never un-match a card-level hit.
// This is not a limitation to work around — it is why a demotion is always explainable.
assert.strictEqual(d({ card: card({ pos: ['a'] }), detail: det({ pos: ['b'], neg: ['x'] }) }), 'worth');

// ── OFF-PLATFORM IS A TAG, NOT A GATE (the user's rule) ──────────────────
// Measured live before this changed: treating an off-platform ask as a demotion moved 176 of 227 scanned
// listings out of High yield. A tag informs; it must not decide.
assert.strictEqual(d({ card: card({ pos: ['ai'] }), detail: det({ flags: ['ask'] }) }), 'pos');
assert.strictEqual(d({ card: card({ goal: true }), detail: det({ flags: ['ask', 'url'] }) }), 'high');
assert.strictEqual(d({ card: card({}), detail: det({ flags: ['ask'] }) }), 'none');
assert.strictEqual(d({ card: card({}), detail: det({ flags: ['ask', 'email', 'redacted'] }) }), 'none');
assert.strictEqual(d({ card: card({ neg: ['crypto'] }), detail: det({ flags: ['ask'] }) }), 'kw');
assert.strictEqual(d({ card: card({ neg: ['crypto'] }), detail: det({ flags: ['ask'], pos: ['x'] }) }), 'worth');

// ── HIDDEN / VISIBLE, AND THE COUNT BUCKETS THE CHIP USES ────────────────
for (const t of ['closed', 'stale', 'nosal', 'kw']) assert.strictEqual(isHidden(t), true, t);
for (const t of ['high', 'pos', 'worth', 'none']) assert.strictEqual(isHidden(t), false, t);
assert.deepStrictEqual(TIERS, ['closed', 'stale', 'nosal', 'high', 'pos', 'worth', 'kw', 'none']);
// An unknown verdict must not be treated as hidden: the safe direction for this extension is
// "show it", because a false hide costs a real job listing.
assert.strictEqual(isHidden('nonsense'), false);
assert.strictEqual(decide({ card: card({ pos: ['a'], neg: ['b'] }), detail: det({ flags: ['ask'] }) }), 'worth');

// ── THE FACTS BUILDERS ───────────────────────────────────────────────────
// cardFacts / detailFacts are the only places a verdict's inputs are assembled, so they are
// pinned here rather than trusted by inspection.
const rules = require('./rules.js');
const planner = require('./detail-text.js');
const settings = { positive: ['quickbooks'], negative: ['crypto'] };
assert.deepStrictEqual(T.cardFacts('QuickBooks expert, no crypto', settings, rules.matchKeywords),
  { pos: ['quickbooks'], neg: ['crypto'] });
assert.deepStrictEqual(T.cardFacts('nothing here', settings, rules.matchKeywords), { pos: [], neg: [] });
assert.deepStrictEqual(T.cardFacts(null, settings, rules.matchKeywords), { pos: [], neg: [] });

const f = T.detailFacts('Apply here: forms.gle/x — QuickBooks crypto', settings, rules.matchKeywords, planner.plan);
assert.deepStrictEqual(f.pos, ['quickbooks']);
assert.deepStrictEqual(f.neg, ['crypto']);
assert.ok(f.flags.includes('ask'), 'the off-platform ask is a flag');
// Deduplicated and sorted for a stable record: the same text twice in two passes must write the same
// facts, or the record would look "changed" on every rule pass and rewrite storage forever.
const many = T.detailFacts('crypto crypto apply here apply here crypto', settings, rules.matchKeywords, planner.plan);
assert.deepStrictEqual(many.neg, ['crypto']);
assert.strictEqual(many.flags.filter(x => x === 'ask').length, 1);
assert.deepStrictEqual(T.detailFacts('', settings, rules.matchKeywords, planner.plan), { pos: [], neg: [], flags: [], warns: [] });
assert.deepStrictEqual(T.detailFacts(null, settings, rules.matchKeywords, planner.plan), { pos: [], neg: [], flags: [], warns: [] });

// A detail text with a bare link is flagged `url`; a Telegram mention with no ask is NOT a flag (D26).
assert.deepStrictEqual(
  T.detailFacts('portfolio at example.com', settings, rules.matchKeywords, planner.plan).flags, ['url']);
assert.deepStrictEqual(
  T.detailFacts('monitor our telegram channels', settings, rules.matchKeywords, planner.plan).flags, []);

// ── the stated week: over 40 h is flagged automatically (W13.7) ──────────
// The user's rule: a listing whose own HOURS PER WEEK is longer than full time is flagged. The flag is
// SHOWN (salary-cards.js prints the hours in the warning colour) and deliberately does NOT demote — a
// 45-hour week is a real job, not a risk, and measured live a demoting version moved 22 of 27 scanned
// listings out of High yield, which is a filter that stopped filtering.
const hours = (h) => T.detailFacts('a quiet description', settings, rules.matchKeywords, planner.plan, h);
assert.deepStrictEqual(hours(40).warns, [], 'a 40 h week is full time, not a warning');
assert.deepStrictEqual(hours(35).warns, [], 'anything shorter is not a warning either');
assert.deepStrictEqual(hours(41).warns, ['overtime'], 'one hour over is already over');
assert.deepStrictEqual(hours(60).warns, ['overtime']);
assert.deepStrictEqual(hours(null).warns, [], 'hours unknown is not a warning');
assert.deepStrictEqual(hours(0).warns, []);
assert.deepStrictEqual(hours(undefined).warns, []);
assert.deepStrictEqual(hours(50).flags, [], 'overtime is not an off-platform flag, so it never demotes');
// …and it composes with an off-platform ask without either being lost, sorted for a stable record.
// (A form link is both an ask and a URL — the planner's two detectors, not one.)
assert.deepStrictEqual(
  T.detailFacts('Apply here: forms.gle/x', settings, rules.matchKeywords, planner.plan, 50).flags,
  ['ask', 'url']);
assert.strictEqual(
  T.detailFacts('Apply here: forms.gle/x', settings, rules.matchKeywords, planner.plan, 50).warns.includes('overtime'),
  true);
// The tier is untouched by a long week: a highlighted card stays highlighted, a plain one stays plain.
assert.strictEqual(d({ card: card({ pos: ['quickbooks'] }), detail: hours(50) }), 'pos', 'a long week on a highlighted card is still just highlighted');
assert.strictEqual(d({ card: card({}), detail: hours(50) }), 'none');
assert.strictEqual(d({ card: card({ pos: ['quickbooks'] }), detail: hours(40) }), 'pos');

console.log('test-tiers: ok (' + 8 + ' branches + facts builders)');
