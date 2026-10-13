// test-presets.js — node tests for presets.js (run: node test-presets.js)
//
// A preset decides what a fresh install HIDES, so the table itself is checked, not just the merge maths.
const assert = require('assert');
const P = require('./presets.js');
const { matchKeywords } = require('./rules.js');
/** A keyword as plain text — its = and * markers dropped — to feed back through the matcher. */
const asText = (w) => w.replace(/^=/, '').replace(/\*$/, '');

// ── the table ─────────────────────────────────────────────────────────────
assert.ok(P.ARCHETYPES.length >= 12, 'every common kind of online worker has a preset');
const ids = P.ARCHETYPES.map(a => a.id);
assert.strictEqual(new Set(ids).size, ids.length, 'ids are unique');
for (const a of P.ARCHETYPES) {
  assert.ok(a.label && a.icon, `${a.id}: a label and an icon`);
  assert.ok(a.positive.length >= 8, `${a.id}: at least 8 words to be into`);
  assert.ok(a.negative.length >= 4, `${a.id}: at least 4 job types to hide`);
  for (const w of [...a.positive, ...a.negative]) {
    assert.strictEqual(w, w.trim().toLowerCase(), `${a.id}: "${w}" is trimmed lower case`);
    assert.ok(/^=?[^=*]+\*?$/.test(w), `${a.id}: "${w}" uses the syntax correctly (=word, word, word*)`);
  }
  assert.ok(!a.negative.some(w => w.endsWith('*')), `${a.id}: no BROAD hide word — those hide real jobs`);
  // Its own words must not be hidden by its own list, even as a phrase match ("graphic designer" vs "designer").
  for (const w of a.positive) {
    assert.deepStrictEqual(matchKeywords(asText(w), a.negative), [], `${a.id}: its word "${w}" trips its own hide list`);
  }
  assert.deepStrictEqual(P.merge([a.id]).negative, a.negative.filter((w, i, xs) => xs.indexOf(w) === i),
    `${a.id}: merging it alone drops none of its own hides`);
  for (const bad of ['crypto', 'unpaid trial', 'commission only']) {
    assert.ok(!a.negative.includes(bad), `${a.id}: "${bad}" stays a visible choice on setup's Instant no screen`);
  }
}

// The presets are the first lists a new user reads, so between them they SHOW the syntax (D69) — a `*` family and
// an `=` strict word — instead of only describing it.
const every = [...P.ARCHETYPES, ...P.LEVELS].flatMap(a => [...a.positive, ...a.negative]);
assert.ok(every.some(w => w.endsWith('*')) && every.some(w => w.startsWith('=')), 'presets demonstrate * and =');

// ── merge: a word any pick wants is never blocked ─────────────────────────
const ds = P.merge(['design', 'social']);
assert.ok(ds.positive.includes('graphic design*') && ds.positive.includes('social media'));
assert.ok(!ds.negative.includes('social media'), 'Graphic Designer does not hide Social Media for someone who picked both');
const sales = P.merge(['va', 'sales']);
assert.ok(sales.positive.includes('cold calling'));
assert.ok(!sales.negative.includes('cold calling'), "VA's outbound block is lifted when Sales is also picked");
assert.deepStrictEqual(P.merge([]), { positive: [], negative: [] });
assert.deepStrictEqual(P.merge(['nope']), { positive: [], negative: [] }, 'an unknown id adds nothing');
const va = P.merge(['va']);
assert.strictEqual(new Set(va.positive).size, va.positive.length, 'no duplicates');

// The matcher decides a clash, not the spelling: Writer hides "graphic designer", Graphic Designer wants
// "graphic design*" — picked together, designer jobs must stay.
const wd = P.merge(['writer', 'design']);
assert.ok(!wd.negative.includes('graphic designer'), 'a wanted `*` family covers a hide phrase');
assert.ok(wd.negative.includes('video editor'), "Writer's other hides stay");
assert.deepStrictEqual(matchKeywords('Senior Graphic Designers needed', wd.negative), []);
const sc = P.merge(['csr', 'lvl-senior']);
assert.ok(sc.positive.includes('=lead') && sc.negative.includes('lead generation'), 'a strict "=lead" leaves "lead generation" hidden');

// ── repick: the presets' words swap, the user's own words stay ───────────
let lists = P.repick({ positive: [], negative: [] }, [], ['va']);
assert.deepStrictEqual(lists, P.merge(['va']));
lists = { positive: [...lists.positive, 'quickbooks online'], negative: [...lists.negative, 'MLM'] };   // typed by the user
const swapped = P.repick(lists, ['va'], ['books']);
assert.ok(swapped.positive.includes('quickbooks online') && swapped.negative.includes('MLM'), 'typed words survive');
assert.ok(!swapped.positive.includes('virtual assistant'), "the old pick's words are gone");
assert.ok(swapped.positive.includes('xero'), "the new pick's words are in");
assert.ok(!swapped.negative.includes('bookkeeper'), "VA's block on bookkeeper goes — Bookkeeper's bookkeep* wants it");
assert.deepStrictEqual(P.repick(swapped, ['books'], []), { positive: ['quickbooks online'], negative: ['MLM'] },
  'unpicking everything leaves exactly what the user typed');

// ── addTo (⚙ "Add words for…"): additive, case kept, wanted words unblocked ──
const mine = { positive: ['Remote'], negative: ['ICD-10', 'video editor', 'crypto'] };
const added = P.addTo(mine, 'video');
assert.strictEqual(added.positive[0], 'Remote', 'the user\'s own spelling is kept');
assert.ok(!added.positive.includes('remote'), 'deduplicated without regard to case');
assert.ok(added.negative.includes('ICD-10') && added.negative.includes('crypto'), 'nothing of theirs is removed…');
assert.ok(!added.negative.includes('video editor'), '…except a block on a word the preset wants');
assert.ok(added.positive.includes('capcut'));

// ── the experience layer (D68.1) ──────────────────────────────────────────
assert.deepStrictEqual(P.LEVELS.map(l => l.id), ['lvl-new', 'lvl-mid', 'lvl-senior']);
for (const lv of P.LEVELS) {
  assert.ok(lv.label && lv.icon && lv.hint, `${lv.id}: label, icon, hint`);
  assert.ok(lv.positive.length >= 8 && lv.negative.length >= 5, `${lv.id}: enough words both ways`);
  assert.deepStrictEqual(lv.negative.filter(w => lv.positive.includes(w)), [], `${lv.id}: never hides its own word`);
  for (const w of [...lv.positive, ...lv.negative]) assert.strictEqual(w, w.trim().toLowerCase());
  assert.ok(!lv.negative.some(w => w.endsWith('*')), `${lv.id}: no BROAD hide word`);
}
// The dangerous case: a level hiding an archetype's OWN job title, as a phrase match. "manager" would hide
// "Social Media Manager" for a newbie who picked Social Media — every pairing is checked, both directions.
for (const a of P.ARCHETYPES) {
  for (const lv of P.LEVELS) {
    const m = P.merge([a.id, lv.id]);
    for (const w of m.positive) {
      assert.deepStrictEqual(matchKeywords(asText(w), m.negative), [], `${a.id} + ${lv.id}: wanted "${w}" trips the merged hide list`);
    }
    for (const w of [...a.positive, ...lv.positive]) assert.ok(m.positive.includes(w), `${a.id} + ${lv.id}: keeps "${w}"`);
  }
}
const newbie = P.merge(['design', 'lvl-new']);
const hides = (text) => matchKeywords(text, newbie.negative).length > 0;
assert.strictEqual(hides('Senior Graphic Designer'), true, 'a newbie designer skips a senior role');
assert.strictEqual(hides('Must have 5+ years of experience in Photoshop'), true);
assert.strictEqual(hides('Graphic Designer, no experience needed, we will train'), false);
assert.deepStrictEqual(matchKeywords('Graphic Designer, no experience needed', newbie.positive).sort(),
  ['graphic design*', 'no experience'].sort(), 'and a beginner-friendly post is liked');
assert.ok(matchKeywords('Entry-level designers, will train', newbie.positive).includes('entry level'), 'hyphen and plural forgiven');
const senior = P.merge(['design', 'lvl-senior']);
assert.ok(matchKeywords('Entry-level graphic designer trainee', senior.negative).length > 0, 'a senior skips trainee posts');
assert.ok(!senior.negative.includes('senior') && senior.positive.includes('senior'));
// Switching level swaps only the level's words; the archetype's and the user's stay.
const withMine = { positive: [...newbie.positive, 'adobe express'], negative: newbie.negative };
const toSenior = P.repick(withMine, ['design', 'lvl-new'], ['design', 'lvl-senior']);
assert.ok(toSenior.positive.includes('adobe express') && toSenior.positive.includes('photoshop'));
assert.ok(!toSenior.positive.includes('no experience') && toSenior.negative.includes('no experience'));
assert.ok(!matchKeywords('team leads wanted', toSenior.positive).includes('lead'), '=lead does not like "leads"');
assert.ok(!toSenior.negative.includes('senior'));

console.log(`presets: ok (${P.ARCHETYPES.length} archetypes × ${P.LEVELS.length} levels, merge · repick · addTo)`);
