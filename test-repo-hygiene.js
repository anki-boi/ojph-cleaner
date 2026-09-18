// test-repo-hygiene.js — repo invariants that must hold for every clone.
// Mirrors the sibling repo's tests/test_repo_hygiene.py: the public face, the license
// stance, and the wiring that makes tools/gate.sh unskippable.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// ── license stance (spec.md D1): public to read, no license granted ──────
assert.ok(!exists('LICENSE') && !exists('LICENSE.txt'),
  'a LICENSE file appeared — that contradicts the "all rights reserved" stance in README.md and SECURITY.md');
assert.ok(read('README.md').includes('All rights reserved'),
  'README.md must state the license stance ("All rights reserved") so nobody assumes reuse is permitted');

// ── files that make the repo legible and consistent ──────────────────────
for (const f of ['README.md', 'SECURITY.md', '.editorconfig', '.gitattributes', 'spec.md',
                 'docs/architecture.md', 'docs/scraping.md', 'docs/HANDOFF.md',
                 '.github/ISSUE_TEMPLATE/bug_report.md', '.github/ISSUE_TEMPLATE/feature_request.md']) {
  assert.ok(exists(f), `required file missing: ${f}`);
}

// ── the gate must be wired, and must survive a Windows checkout ──────────
const hook = read('.githooks/pre-push');
assert.ok(hook.includes('tools/gate.sh'), '.githooks/pre-push no longer runs tools/gate.sh');
assert.ok(!hook.includes('\r') && !read('tools/gate.sh').includes('\r'),
  'gate.sh or the pre-push hook contains CRLF — `sh` will fail on a Windows checkout (see .gitattributes)');
assert.ok(read('.gitattributes').includes('eol=lf'),
  '.gitattributes no longer pins line endings; a Windows clone will get CRLF in the shell scripts');

console.log('hygiene: ok (license stance, required files, gate wiring, line endings)');
