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

// ── UNSCANNED PARITY: the 0.8.0 verdicts, with one deliberate exception ───
// Card text only, no record. A page the scan has never touched still gets 0.8.0's green/yellow/hidden,
// except for the one case the user closed on purpose (D40): a listing that matched BOTH a keyword you like
// and one you asked to hide, below your goal, used to be yellow and is now hidden. The goal is a hard
// filter — a keyword you like can still highlight a listing, and it can never rescue one.
// PAY decides High yield (the user's rule): a positive keyword alone is a HIGHLIGHT, not a high-yield listing.
assert.strictEqual(d({ card: card({ pos: ['quickbooks'] }) }), 'pos', 'liked keyword below the goal → highlighted');
assert.strictEqual(d({ card: card({ goal: true }) }), 'high', 'passing salary is what makes it high yield');
assert.strictEqual(d({ card: card({ goal: true, pos: ['quickbooks'] }) }), 'high',
  'passing salary WITH a keyword you like is still high yield');
assert.strictEqual(d({ card: card({}) }), 'none');
assert.strictEqual(d({ card: card({ pos: ['ai'], neg: ['crypto'] }) }), 'kw',
  'both sides, below the goal → HIDDEN: a keyword you like cannot un-hide a keyword you asked to hide (D40)');
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
// The negotiable rescue (0.12): no figure, but the listing says its pay is negotiable — it stays when it
// otherwise looks good, and it is still hidden when it does not, or when the toggle is off.
assert.strictEqual(d({ noSalary: true, rescueNeg: true, negotiable: true, card: card({ pos: ['ai'] }) }), 'pos',
  'a negotiable listing that looks good is rescued, like the plain rescue');
assert.strictEqual(d({ noSalary: true, rescueNeg: true, negotiable: true, card: card({}) }), 'nosal',
  'the negotiable rescue needs good too — "negotiable" alone is no verdict');
assert.strictEqual(d({ noSalary: true, rescueNeg: true, negotiable: false, card: card({ pos: ['ai'] }) }), 'nosal',
  'TBD and N/A are not negotiable — only the word says so');
assert.strictEqual(d({ noSalary: true, rescueNeg: false, negotiable: true, card: card({ pos: ['ai'] }) }), 'nosal',
  'the toggle is opt-in, so the default behaviour is unchanged');
assert.strictEqual(d({ noSalary: true, rescueNeg: true, negotiable: true, card: card({ neg: ['crypto'], pos: ['ai'] }) }), 'kw',
  'rescued, but the hide keyword still wins: the rescue answers the missing figure, it does not out-vote a hide');
assert.strictEqual(d({ noSalary: true, rescue: true, rescueNeg: true, negotiable: true, card: card({ pos: ['ai'] }) }), 'pos',
  'the rescues compose — either one is enough');

// ── THE PROMOTIONS THE DEEP SCAN BUYS ───────────────────────────────────
// White → green: the description says what the card's short text never did.
assert.strictEqual(d({ card: card({}), detail: det({ pos: ['quickbooks'] }) }), 'pos');
// A description positive does NOT rescue a hide-keyword card (D40): below the goal the hide keyword wins.
assert.strictEqual(d({ card: card({ neg: ['crypto'] }), detail: det({ pos: ['quickbooks'] }) }), 'kw',
  'a keyword you like, found only by the scan, still cannot un-hide a keyword you asked to hide');
// …but PAY does, which is the whole point of the scan being able to move a card: it reads the listing's own
// HOURS PER WEEK, so a listing whose real week clears the goal becomes yellow rather than hidden.
assert.strictEqual(d({ card: card({ goal: true, neg: ['crypto'] }), detail: det({ pos: ['quickbooks'] }) }), 'worth',
  'paying at the goal with a hide keyword → yellow, however the positive got there');
// A goal-only card stays good, so a description negative demotes it rather than hiding it.
assert.strictEqual(d({ card: card({ goal: true }), detail: det({ neg: ['crypto'] }) }), 'worth');

// ── SUPER GREEN: yellow → high yield, but only when it is unambiguous ──────────
// The user's rule: significantly more positive keywords than negative (+ salary significantly
// higher than the goal) → high yield, not yellow. Pinned as: strictly more distinct positives, and
// the margin over the goal ≥ 50 %. Every branch of both conditions:
assert.strictEqual(d({ card: card({ goal: true, goalBy: 0.5, pos: ['a', 'b'], neg: ['x'] }) }), 'high',
  'two positives against one, exactly 50 % above the goal');
assert.strictEqual(d({ card: card({ goal: true, goalBy: 1.2, pos: ['a'], neg: ['x', 'y'] }) }), 'worth',
  'fewer positives than negatives, whatever the pay');
assert.strictEqual(d({ card: card({ goal: true, goalBy: 0.4, pos: ['a', 'b'], neg: ['x'] }) }), 'worth',
  '40 % above the goal is not 50 %');
assert.strictEqual(d({ card: card({ goal: true, goalBy: 0.5, pos: ['a'], neg: ['x'] }) }), 'worth',
  'equal counts do not promote');
assert.strictEqual(d({ card: card({ goal: true, pos: ['a', 'b'], neg: ['x'] }) }), 'worth',
  'no readable margin → no promotion (a margin that cannot be proven is not one)');
assert.strictEqual(d({ card: card({ goal: true, goalBy: 0.5, neg: ['x'] }) }), 'worth',
  'zero positives can never outnumber');
assert.strictEqual(d({ card: card({ pos: ['a', 'b'], neg: ['x'] }) }), 'kw',
  'more positives but the salary bar is not cleared → HIDDEN (D40): the likes do not buy the promotion');
// The counts merge card and description, and a keyword matched on both sides counts once.
assert.strictEqual(d({ card: card({ goal: true, goalBy: 0.5, neg: ['x'] }), detail: det({ pos: ['a', 'b'] }) }), 'high',
  'description positives alone can tip the count');
assert.strictEqual(d({ card: card({ goal: true, goalBy: 0.5, pos: ['a', 'b'], neg: ['x', 'y'] }), detail: det({ pos: ['a'] }) }), 'worth',
  'the shared keyword counts once, so 2 vs 2 is not more');

// ── THE DEMOTIONS ────────────────────────────────────────────────────────
// Green → yellow: a hide keyword the card text did not carry, on a listing that pays.
assert.strictEqual(d({ card: card({ goal: true, pos: ['ai'] }), detail: det({ neg: ['crypto'] }) }), 'worth');
// Green → hidden: the same description negative on a listing BELOW the goal. Pay is the only thing that
// keeps a hide-keyword listing on the board, so a keyword you like does not soften this into a yellow (D40).
assert.strictEqual(d({ card: card({ pos: ['ai'] }), detail: det({ neg: ['crypto'] }) }), 'kw',
  'below the goal, a scanned hide keyword hides the card instead of turning it yellow');
// The description is a SUPERSET of the card text, so it can never un-match a card-level hit.
// This is not a limitation to work around — it is why a demotion is always explainable.
assert.strictEqual(d({ card: card({ pos: ['a'] }), detail: det({ pos: ['b'], neg: ['x'] }) }), 'kw',
  'a second keyword you like does not outweigh the hide keyword below the goal either');

// ── OFF-PLATFORM IS A TAG, NOT A GATE (the user's rule) ──────────────────
// Measured live before this changed: treating an off-platform ask as a demotion moved 176 of 227 scanned
// listings out of High yield. A tag informs; it must not decide.
assert.strictEqual(d({ card: card({ pos: ['ai'] }), detail: det({ flags: ['ask'] }) }), 'pos');
assert.strictEqual(d({ card: card({ goal: true }), detail: det({ flags: ['ask', 'url'] }) }), 'high');
assert.strictEqual(d({ card: card({}), detail: det({ flags: ['ask'] }) }), 'none');
assert.strictEqual(d({ card: card({}), detail: det({ flags: ['ask', 'email', 'redacted'] }) }), 'none');
assert.strictEqual(d({ card: card({ neg: ['crypto'] }), detail: det({ flags: ['ask'] }) }), 'kw');
assert.strictEqual(d({ card: card({ neg: ['crypto'] }), detail: det({ flags: ['ask'], pos: ['x'] }) }), 'kw',
  'an off-platform tag and a keyword you like together still do not un-hide a hide keyword (D40)');
assert.strictEqual(d({ card: card({ goal: true, neg: ['crypto'] }), detail: det({ flags: ['ask'], pos: ['x'] }) }), 'worth',
  'the pay is what keeps it, and the tag still does not move it');

// ── HIDDEN / VISIBLE, AND THE COUNT BUCKETS THE CHIP USES ────────────────
for (const t of ['closed', 'stale', 'nosal', 'kw']) assert.strictEqual(isHidden(t), true, t);
for (const t of ['high', 'pos', 'worth', 'none']) assert.strictEqual(isHidden(t), false, t);
assert.deepStrictEqual(TIERS, ['closed', 'stale', 'nosal', 'high', 'pos', 'worth', 'kw', 'none']);
// An unknown verdict must not be treated as hidden: the safe direction for this extension is
// "show it", because a false hide costs a real job listing.
assert.strictEqual(isHidden('nonsense'), false);
assert.strictEqual(decide({ card: card({ pos: ['a'], neg: ['b'] }), detail: det({ flags: ['ask'] }) }), 'kw');

// ── D40: THE GOAL IS A HARD FILTER ───────────────────────────────────────
// The user, on finding the yellow tier reachable by keywords alone: "you might have promoted a lot of
// listings to worth considering due to the presence of positive keywords being more than the negative
// keywords, but do not forget that the goal salary is a hard filter." So the two pay tiers are the only
// two places a listing can be *kept* against a hide keyword, and `money` (the goal mark salary-cards.js
// puts on a listing at or above a goal) is the only thing that earns it. Pinned as a table, because the
// whole point is which way the branch order falls.
const goal = (o) => d({ card: card(o) });
assert.strictEqual(goal({ goal: true, neg: ['x'] }), 'worth', 'at the goal → yellow');
assert.strictEqual(goal({ goal: true, goalBy: 0.5, pos: ['a', 'b'], neg: ['x'] }), 'high', 'well over the goal, more likes → super green');
assert.strictEqual(goal({ goal: true, pos: ['a'], neg: ['x'] }), 'worth', 'at the goal, one like vs one hate → yellow, not green');
assert.strictEqual(goal({ pos: ['a'], neg: ['x'] }), 'kw', 'below the goal → hidden, however many likes');
assert.strictEqual(goal({ pos: ['a', 'b', 'c'], neg: ['x'] }), 'kw', 'three likes against one hate, below the goal → still hidden');
assert.strictEqual(goal({ pos: ['a'] }), 'pos', 'below the goal with no hide keyword → still highlighted (the green outline is unchanged)');
assert.strictEqual(goal({ neg: ['x'] }), 'kw', 'below the goal, hide keyword only → hidden');
assert.strictEqual(goal({}), 'none');
// The counts merge card and description, so the same three cases have to hold whichever side the keyword
// was found on — a scan must not be able to buy a promotion the card text could not.
assert.strictEqual(d({ card: card({ neg: ['x'] }), detail: det({ pos: ['a', 'b', 'c'] }) }), 'kw',
  'the description cannot out-vote a hide keyword below the goal either');
assert.strictEqual(d({ card: card({ goal: true }), detail: det({ pos: ['a'], neg: ['x'] }) }), 'worth',
  'and with the goal met, a description positive still leaves it yellow, not green');

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
assert.deepStrictEqual(T.detailFacts('', settings, rules.matchKeywords, planner.plan), { pos: [], neg: [], flags: [] });
assert.deepStrictEqual(T.detailFacts(null, settings, rules.matchKeywords, planner.plan), { pos: [], neg: [], flags: [] });

// A detail text with a bare link is flagged `url`; a Telegram mention with no ask is NOT a flag (D26).
assert.deepStrictEqual(
  T.detailFacts('portfolio at example.com', settings, rules.matchKeywords, planner.plan).flags, ['url']);
assert.deepStrictEqual(
  T.detailFacts('monitor our telegram channels', settings, rules.matchKeywords, planner.plan).flags, []);

// ── a week longer than 40 h is shown, never a verdict (W13.7, D39) ──────
// The listing's own HOURS PER WEEK lives in the record's `fields.hoursPerWeek` and is printed on the card
// by salary-cards.js (⚠ 45 h/week — over the 40 h full-time week). It is deliberately NOT one of the
// description facts above — overtime is not an off-platform flag — so a long week can never demote a card.
// A 45-hour week is a real job, not a risk, and measured live a demoting version moved 22 of 27 scanned
// listings out of High yield, which is a filter that stopped filtering.
assert.deepStrictEqual(
  T.detailFacts('a quiet description', settings, rules.matchKeywords, planner.plan).flags,
  [], 'a long week is not an off-platform flag');
// …and an off-platform ask still composes with the other detectors, sorted for a stable record.
// (A form link is both an ask and a URL — the planner's two detectors, not one.)
assert.deepStrictEqual(
  T.detailFacts('Apply here: forms.gle/x', settings, rules.matchKeywords, planner.plan).flags,
  ['ask', 'url']);
// The tier is untouched by a long week: a highlighted card stays highlighted, a plain one stays plain —
// `decide` never sees the hours at all.
assert.strictEqual(d({ card: card({ pos: ['quickbooks'] }), detail: det({}) }), 'pos', 'a long week on a highlighted card is still just highlighted');
assert.strictEqual(d({ card: card({}), detail: det({}) }), 'none');

console.log('test-tiers: ok (' + 8 + ' branches + facts builders)');
