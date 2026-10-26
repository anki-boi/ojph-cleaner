// test-myjobs.js — your own decisions per listing (spec.md D51, D56, D64).
const assert = require('assert');
const M = require('./myjobs.js');
const DAY = 864e5;
const T0 = new Date(2026, 9, 5, 10, 0).getTime();   // Monday 5 Oct 2026, 10:00 local

// set: a new map every time, history of moves, facts kept across moves
let m = {};
const m1 = M.set(m, '101', 'saved', T0, { title: 'VA', pay: '≈ ₱40,000/mo' });
assert.notStrictEqual(m1, m, 'pure: a new map');
assert.deepStrictEqual(m, {}, 'the old map is untouched — Undo depends on it');
const m2 = M.set(m1, '101', 'applied', T0 + DAY);
assert.strictEqual(m2['101'].state, 'applied');
assert.strictEqual(m2['101'].title, 'VA', 'facts survive a move');
assert.deepStrictEqual(M.set({}, '9', 'passed', T0, { sig: ['cold calling', 'cold'] })['9'].sig, ['cold calling', 'cold'],
  'the term signature is kept — the block-word suggestions count it');
assert.ok(!('sig' in M.set({}, '9', 'passed', T0, { sig: [] })['9']), 'an empty one is not');
assert.deepStrictEqual(m2['101'].history.map(h => h.state), ['saved', 'applied']);
const m3 = M.set(m2, '101', 'applied', T0 + 3 * DAY);
assert.strictEqual(m3['101'].at, T0 + DAY, 'the same state again is not a new move');
assert.strictEqual(m3['101'].history.length, 2);
assert.deepStrictEqual(M.set(m3, '101', null, T0), {}, 'null clears');
assert.throws(() => M.set({}, '1', 'hired', T0), /unknown state/);

// passed
const p = M.set({}, '7', 'passed', T0);
assert.ok(M.isPassed(p, '7'));
assert.ok(!M.isPassed(p, '8'));
assert.strictEqual(M.stateOf(p, '8'), null);

// notes
assert.strictEqual(M.note(m2, '101', '  called them ')['101'].note, 'called them');
assert.ok(!('note' in M.note(M.note(m2, '101', 'x'), '101', '')['101']));
assert.deepStrictEqual(M.note({}, 'nope', 'x'), {});

// counts
assert.deepStrictEqual(M.counts({ ...m2, ...p }), { saved: 0, applied: 1, interview: 0, offer: 0, passed: 1 });

// follow-up nudge at 5 days after applying, and only while still "applied"
assert.ok(!M.needsFollowUp(m2['101'], T0 + 5 * DAY));
assert.ok(M.needsFollowUp(m2['101'], T0 + 6 * DAY));
assert.ok(!M.needsFollowUp(M.set(m2, '101', 'interview', T0 + 2 * DAY)['101'], T0 + 30 * DAY));

// prune: a year, except what is still in play
const old = { a: { state: 'passed', at: T0 - 400 * DAY, history: [] }, b: { state: 'applied', at: T0 - 400 * DAY, history: [] },
  c: { state: 'saved', at: T0 - 10 * DAY, history: [] } };
assert.deepStrictEqual(Object.keys(M.prune(old, T0)).sort(), ['b', 'c']);

// streak: consecutive local days with an application, ending today (or yesterday); and this week's count
let s = {};
s = M.set(s, '1', 'applied', T0 - 2 * DAY);   // Saturday
s = M.set(s, '2', 'applied', T0 - DAY);       // Sunday
s = M.set(s, '3', 'applied', T0);             // Monday
s = M.set(s, '4', 'applied', T0 + 3600e3);    // Monday again
assert.deepStrictEqual(M.streak(s, T0 + 7200e3), { days: 3, week: 2 }, 'Sat+Sun+Mon; the week starts Monday');
assert.deepStrictEqual(M.streak(s, T0 + DAY + 3600e3), { days: 3, week: 2 }, 'nothing yet today keeps yesterday\'s streak');
assert.deepStrictEqual(M.streak(s, T0 + 2 * DAY + 3600e3), { days: 0, week: 2 }, 'a missed day ends it');
assert.deepStrictEqual(M.streak({}, T0), { days: 0, week: 0 });

// D76: where you applied is kept like any other fact, and survives later moves
let v = M.set({}, '20', 'applied', T0, { title: 'VA', via: 'forms.gle' });
assert.strictEqual(v['20'].via, 'forms.gle');
v = M.set(v, '20', 'interview', T0 + DAY);
assert.strictEqual(v['20'].via, 'forms.gle', 'via survives a move');
assert.ok(!('via' in M.set({}, '21', 'applied', T0, { via: '' })['21']), 'an empty via is not stored');

// D77: applied and further along are "done"; the applied date is the first applied move
assert.ok(M.isDone(v['20']) && !M.isDone(M.set({}, '1', 'saved', T0)['1']) && !M.isDone(null));
assert.strictEqual(M.appliedAt(v['20']), T0, 'moving to Interview keeps the day you applied');
assert.strictEqual(M.appliedAt(M.set({}, '1', 'interview', T0 + 5)['1']), T0 + 5, 'no applied move: the entry\'s own time');

// D78: a repost of a role you applied to
const LONG = 'Senior Video Editor for Long-Form Video (Only Apply if You\'re Hungry to Grow)';
let r = {};
r = M.set(r, '500', 'applied', T0, { title: LONG });
r = M.set(r, '501', 'applied', T0, { title: 'Virtual Assistant', company: 'Acme' });
r = M.set(r, '502', 'saved', T0, { title: 'Bookkeeper for a Small Accounting Firm' });
r = M.set(r, '503', 'applied', T0 + DAY, { title: LONG });
assert.strictEqual(M.titleKey(LONG), 'senior video editor for long form video only apply if you re hungry to grow');
const hit = M.repostOf(r, '999', 'senior video editor for long-form video (only apply if you\'re hungry to grow)', '');
assert.strictEqual(hit.id, '500', 'the earliest application wins');
assert.strictEqual(hit.sameCompany, false);
assert.strictEqual(M.repostOf({ '500': r['500'] }, '500', LONG, ''), null, 'a listing never matches itself');
assert.strictEqual(M.repostOf(r, '999', 'Virtual Assistant', ''), null, 'a short title needs the company');
assert.strictEqual(M.repostOf(r, '999', 'Virtual Assistant', 'acme ').sameCompany, true, 'same company, any title length');
assert.strictEqual(M.repostOf(r, '999', 'Virtual Assistant', 'Other Co'), null, 'two named companies are two jobs');
assert.strictEqual(M.repostOf(r, '999', LONG, 'Some Co').id, '500', 'one side names no company: the long title decides');
assert.strictEqual(M.repostOf(r, '999', 'Bookkeeper for a Small Accounting Firm', ''), null, 'saved is not applied');
assert.strictEqual(M.repostOf(r, '999', '', ''), null);

// D76: where copied text points
assert.deepStrictEqual(M.whereFrom('Send your CV to hr.team@acme.com.au today'), { kind: 'email', via: 'hr.team@acme.com.au' });
assert.deepStrictEqual(M.whereFrom('https://forms.gle/AbC123'), { kind: 'link', via: 'forms.gle' });
assert.deepStrictEqual(M.whereFrom('www.acme.com/careers'), { kind: 'link', via: 'acme.com' });
assert.deepStrictEqual(M.whereFrom('docs.google.com/forms/d/xyz'), { kind: 'link', via: 'docs.google.com' });
assert.deepStrictEqual(M.whereFrom('experience with Node.js and React'), { kind: 'copy', via: null }, 'Node.js is not an address');
assert.deepStrictEqual(M.whereFrom('PURPLE ELEPHANT'), { kind: 'copy', via: null });

console.log('myjobs: ok (moves, history, passed, notes, follow-up, prune, streak, via, applied date, reposts)');
