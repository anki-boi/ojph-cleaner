// test-labels.js — the vocabulary (spec.md D43): one table, and the old words gone from everything we ship.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('./labels.js');

// ── the table is complete and unambiguous ─────────────────────────────────
const strings = (o, at = '') => Object.entries(o).flatMap(([k, v]) =>
  typeof v === 'string' ? [[at + k, v]] : typeof v === 'object' && v ? strings(v, at + k + '.') : []);
for (const [k, v] of strings(L)) assert.ok(v.trim(), `label ${k} is empty`);
// No two controls on the bar may share a word (D46): the old panel had "All" next to "Show All".
const barWords = [L.tier.all, L.tier.high, L.tier.worth, L.tier.pos, L.btn.peek, L.btn.scan, L.btn.csv];
assert.strictEqual(new Set(barWords).size, barWords.length, 'two bar controls share a label');
for (const a of barWords) for (const b of barWords) {
  if (a !== b) assert.ok(!b.toLowerCase().includes(a.toLowerCase()), `"${b}" contains "${a}" — the D46 confusion again`);
}
assert.strictEqual(L.hiddenTotal(3, false), '3 hidden');
assert.strictEqual(L.hiddenTotal(3, true), '3 would be hidden');   // tools/verify-live.mjs asserts this wording
assert.strictEqual(L.mark.fit(29, 40), 'fits your resume 29/40');
assert.ok(/USD/.test(L.toast.currency('USD')) && /refreshed/.test(L.toast.currency('USD')), 'the currency toast says rates refresh');
assert.deepStrictEqual(Object.keys(L.currency), ['PHP', 'USD']);

// ── the old vocabulary is gone from every string we ship ──────────────────
// Comments may keep the history ("High yield" is what the tier used to be called); what a person can READ may
// not. So: string literals in .js, `content:` values in .css, and the text of .html — never comments.
const OLD = ['High yield', 'high yield', 'Worth considering', 'Worth Considering', 'worth considering', 'Show All',
  'Hide All', 'Keywords Matched', 'No Salary', 'Highlighted', '● fresh', '⚠ duplicate', '↑ promoted',
  '↓ demoted', 'at or above your', 'resume fit ', 'Deep scan', 'Salary goals', '⚠ off-platform',
  'verify with the employer'];
const SKIP = /^(test-|labels\.js$)/;
const stripJsComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
const literals = (src) => [...src.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map(m => m[0]);
const hits = [];
for (const f of fs.readdirSync(__dirname)) {
  if (SKIP.test(f) || !/\.(js|css|html)$/.test(f)) continue;
  const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
  let shown = [];
  if (f.endsWith('.js')) shown = literals(stripJsComments(src));
  else if (f.endsWith('.css')) shown = [...src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/content:\s*('[^']*'|"[^"]*")/g)].map(m => m[1]);
  else if (f.endsWith('.html')) shown = [src.replace(/<!--[\s\S]*?-->/g, '').replace(/<style>[\s\S]*?<\/style>/g, '')];
  for (const s of shown) for (const w of OLD) if (s.includes(w)) hits.push(`${f}: "${w}" in ${s.slice(0, 80)}`);
}
assert.deepStrictEqual(hits, [], 'old vocabulary still shown to the user:\n  ' + hits.join('\n  '));

console.log(`labels: ok (${strings(L).length} strings, ${OLD.length} retired words absent)`);
