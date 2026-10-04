// test-glance.js — at a glance (D60): the post's own words, from its own sections, or nothing.
const assert = require('assert');
const G = require('./glance.js');

const post = `A US irrigation and water company. The CFO needs a reliable right hand.

Hours: 40 per week. Your working hours must overlap US Central Time.

What you will do
- Post weekly Gusto payroll into QuickBooks Enterprise 24.0 (desktop).
- Post weekly 401(k) contributions on the John Hancock site.
- Reconcile a third-party general ledger into QB.
- Reconcile American Express and post by class.

What you need
- Real QuickBooks Desktop or Enterprise experience
- 3+ years of US bookkeeping
Nice to have:
- Gusto`;
const g = G.extract(post);
assert.deepStrictEqual(g.doing, [
  'Post weekly Gusto payroll into QuickBooks Enterprise 24.0 (desktop).',
  'Post weekly 401(k) contributions on the John Hancock site.',
  'Reconcile a third-party general ledger into QB.',
], 'three lines, in the post\'s own order and words');
assert.deepStrictEqual(g.want, ['Real QuickBooks Desktop or Enterprise experience', '3+ years of US bookkeeping'],
  'a new heading ("Nice to have") ends the section');

const inline = G.extract('Responsibilities: answer email and calendar\nRequirements: fast typing\n1. English C1\n2) Own laptop');
assert.deepStrictEqual(inline.doing, ['answer email and calendar']);
assert.deepStrictEqual(inline.want, ['fast typing', 'English C1', 'Own laptop']);

const none = G.extract('We are hiring a VA. Must be good. Apply now with your resume and rate.');
assert.ok(G.isEmpty(none), 'no headed sections → no glance, never a guess');
assert.ok(G.isEmpty(G.extract('')));

const long = G.extract('Duties\n- ' + 'word '.repeat(60));
assert.ok(long.doing[0].length <= 120 && long.doing[0].endsWith('…'), 'long lines are clipped at a word');

console.log('glance: ok (sections, inline headings, numbered lists, nothing without headings)');
