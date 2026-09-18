// tools/check-readme.js — keeps README.md true (part of tools/gate.sh and CI).
//
// Three invariants, all of which have been false at least once in this repo's short life:
//   1. every setting the extension actually reads is documented in the README's settings table
//   2. every path the README points at exists on disk (files table + screenshot links)
//   3. no unfinished-work markers are shipped in the public face
//
// The setting keys are read from content.js's DEFAULTS, which is the shape of
// chrome.storage.local.settings — so adding a setting without documenting it fails the gate.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

// ── 1. settings keys ─────────────────────────────────────────────────────
const block = content.match(/const DEFAULTS = \{([\s\S]*?)\n  \};/);
if (!block) {
  console.error('check-readme: FAIL — could not find `const DEFAULTS = {...}` in content.js');
  process.exit(1);
}
const keys = [...block[1].matchAll(/^\s*([A-Za-z_]\w*):/gm)].map(m => m[1]);
if (!keys.length) {
  console.error('check-readme: FAIL — DEFAULTS parsed to zero keys');
  process.exit(1);
}
const undocumented = keys.filter(k => !readme.includes('`' + k + '`'));

// ── 2. referenced paths exist ────────────────────────────────────────────
const referenced = [
  // Files table rows — filtered to things that look like paths, so the settings table
  // (`negative`, `noSalary`, …) is not mistaken for files.
  ...[...readme.matchAll(/^\|\s*`([^`|]+)`\s*\|/gm)].map(m => m[1]).filter(p => /[./]/.test(p)),
  ...[...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]),   // screenshots
].map(p => p.trim().replace(/\/$/, ''));
const missing = [...new Set(referenced)].filter(p => p && !fs.existsSync(path.join(ROOT, p)));

// ── 3. no unfinished-work markers in the public face ─────────────────────
const markers = ['TODO', 'FIXME', 'coming soon', 'work in progress'].filter(m => readme.includes(m));

if (undocumented.length || missing.length || markers.length) {
  console.error('check-readme: FAIL');
  for (const k of undocumented) console.error(`  setting not documented in README: ${k}`);
  for (const p of missing) console.error(`  README points at a path that does not exist: ${p}`);
  for (const m of markers) console.error(`  unfinished-work marker in README: ${JSON.stringify(m)}`);
  process.exit(1);
}

console.log(`readme: ok (${keys.length} settings documented, ${new Set(referenced).size} paths verified)`);
