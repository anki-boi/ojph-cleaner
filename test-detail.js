/**
 * test-detail.js — the detail page's highlight planner (W4.1).
 *
 * Pure: no DOM, no chrome, no network. `plan(text, cfg)` returns the ranges to wrap, and the rules
 * about which of two overlapping signals wins are the thing under test — that is where a highlighter
 * silently stops explaining itself.
 */
const assert = require('node:assert');
const { plan, ASK_PATTERNS, TOOL_RE } = require('./detail-text.js');

/** "kind:text" for each planned range, so a failure reads as the highlight it would have painted. */
const hits = (text, cfg) => plan(text, cfg || {}).map(r => r.kind + ':' + text.slice(r.start, r.end));
const rulesOf = (text, cfg, rule) => plan(text, cfg || {}).filter(r => r.rule === rule).length;

// ── keywords: the same exact-word semantics as the cards (D24), now pointing at positions ────────
assert.deepStrictEqual(hits('We use AI tools', { positive: ['AI'] }), ['pos:AI']);
assert.deepStrictEqual(hits('Check your email daily', { positive: ['ai'] }), [], 'never inside a word');
assert.deepStrictEqual(hits('AI and ads', { negative: ['ads'] }), ['neg:ads']);
assert.deepStrictEqual(hits('ai TOOLS', { positive: ['AI'] }), ['pos:ai'], 'case-insensitive, matched text as written');
assert.deepStrictEqual(hits('AI tools', { positive: ['=ai'] }), ['pos:AI'], 'the legacy leading = still works');
assert.deepStrictEqual(hits('AI, then AI again', { positive: ['AI'] }), ['pos:AI', 'pos:AI'], 'every occurrence');
assert.deepStrictEqual(hits('editors wanted', { negative: ['editor'] }), [], 'plural is a different word');
// Index correctness, not just the substring.
assert.deepStrictEqual(plan('We use AI tools', { positive: ['AI'] })[0], { start: 7, end: 9, kind: 'pos', rule: 'keyword' });

// ── off-platform: bare domains in prose (links here are plain text, not <a>) ─────────────────────
assert.deepStrictEqual(hits('Apply here: forms.gle/VL1hbhWz8FpRDNrFA', {}),
  ['warn:Apply here', 'warn:forms.gle/VL1hbhWz8FpRDNrFA']);
assert.deepStrictEqual(hits('Files: drive.google.com/drive/folders/1urU1wy', {}), ['warn:drive.google.com/drive/folders/1urU1wy']);
assert.deepStrictEqual(hits('See https://bit.ly/xyz for details', {}), ['warn:https://bit.ly/xyz']);
assert.deepStrictEqual(hits('tools, e.g. Photoshop', {}), [], '"e.g." is not a domain');
assert.deepStrictEqual(hits('the report, i.e. the summary', {}), [], '"i.e." is not a domain');
assert.strictEqual(rulesOf('apply via onlinejobs.ph', {}, 'url'), 0, 'the site itself is never off-platform');
assert.strictEqual(rulesOf('forms.gle/abc', { detect: { url: false } }, 'url'), 0, 'detection can be turned off');

// ── emails, including the site's own and the sentence-punctuation trap ──────────────────────────
assert.deepStrictEqual(hits('Write to hr@jumpermedia.co. ps', {}), ['warn:hr@jumpermedia.co'], 'the trailing ". ps" is not part of it');
assert.deepStrictEqual(hits('email Lockanahi0203@gmail.com)', {}), ['warn:Lockanahi0203@gmail.com']);
assert.deepStrictEqual(hits('Contact support@onlinejobs.ph', {}), [], 'the site address is not off-platform');
assert.deepStrictEqual(hits('reach me at bob (at) example (dot) com', {}), ['warn:bob (at) example (dot) com'], 'obfuscated form');

// ── application asks, and the tool guard that keeps normal job content out of it (D26) ──────────
assert.deepStrictEqual(hits('Help monitor Telegram accounts and sessions', {}), [], 'a tool is not an application route');
assert.deepStrictEqual(hits('Send your resume to hr@acme.com. We use Telegram daily.', {}),
  ['warn:Send your resume', 'warn:hr@acme.com'], 'the ask in the NEXT sentence does not drag the tool in');
assert.deepStrictEqual(hits('Send your resume on Telegram', {}), ['warn:Send your resume', 'warn:Telegram'],
  'the tool counts when the sentence is asking you to apply');
assert.deepStrictEqual(hits('fill out the form', {}), ['warn:fill out the form']);
assert.deepStrictEqual(hits('👉 Apply here, fill out the form carefully: ----------', {}),
  ['warn:Apply here', 'warn:fill out the form', 'warn:----------'], 'the emoji is a boundary, not part of the match');
assert.deepStrictEqual(hits('To apply, please complete this short application form in English: ----------', {}),
  ['warn:To apply', 'warn:complete this short application form', 'warn:----------'],
  'the longer ask wins over the "application form" inside it');
assert.deepStrictEqual(hits('Send over your Resume along with a link to your Portfolio', {}),
  ['warn:Send over your Resume', 'warn:link to your Portfolio']);
assert.deepStrictEqual(hits('email your resume to jobs@acme.com', {}), ['warn:email your resume', 'warn:jobs@acme.com']);
assert.deepStrictEqual(hits('How to Apply: DM me', {}), ['warn:How to Apply', 'warn:DM me']);

// ── overlap: a warning is never hidden by an endorsement (D25) ──────────────────────────────────
assert.deepStrictEqual(hits('fill out the form', { positive: ['form'] }), ['warn:fill out the form'],
  'red beats green: the word "form" is inside the ask');
assert.deepStrictEqual(hits('the AI form is online', { positive: ['AI'], negative: ['form'] }),
  ['pos:AI', 'neg:form'], 'disjoint matches all survive');

// ── the shape every consumer relies on: sorted, disjoint, and complete ──────────────────────────
const shape = plan('AI work: apply here at forms.gle/AbC, or send your CV to a@b.co — ads galore ----------',
  { positive: ['AI'], negative: ['ads'] });
for (let i = 0; i < shape.length; i++) {
  assert.ok(shape[i].end > shape[i].start, 'non-empty range');
  if (i) assert.ok(shape[i].start >= shape[i - 1].end, 'ranges are disjoint and in document order');
  assert.ok(['pos', 'neg', 'warn'].includes(shape[i].kind), 'a known kind');
  assert.ok(['keyword', 'url', 'email', 'ask', 'redacted'].includes(shape[i].rule), 'a known rule');
}
assert.ok(shape.length >= 5, 'the busy sentence still yields every signal');

// ── degenerate input never throws ───────────────────────────────────────────────────────────────
assert.deepStrictEqual(plan('', { positive: ['ai'] }), []);
assert.deepStrictEqual(plan(null, { positive: ['ai'] }), []);
assert.deepStrictEqual(plan('AI', {}), []);
for (const re of ASK_PATTERNS) assert.ok(re instanceof RegExp, 'the ask list is regexes');
assert.ok(TOOL_RE instanceof RegExp);

console.log('detail-text: all assertions passed');
