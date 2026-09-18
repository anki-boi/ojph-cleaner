// test-manifest.js — static integrity checks for the extension package.
// Catches the class of bug where code calls an API the manifest never granted
// (e.g. chrome.storage with no "permissions": ["storage"]) — that failure is
// silent at build time and only shows up as a runtime error in the browser.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

// ── MV3 shape ────────────────────────────────────────────────────────────
assert.strictEqual(manifest.manifest_version, 3, 'manifest_version must be 3');
for (const k of ['name', 'version', 'description']) {
  assert.ok(manifest[k], `manifest is missing "${k}"`);
}

// ── permissions cover every chrome.* namespace the source uses ───────────
// null = needs no manifest permission.
const PERMISSION_FOR = {
  storage: ['storage'],
  alarms: ['alarms'],
  scripting: ['scripting'],
  notifications: ['notifications'],
  contextMenus: ['contextMenus'],
  cookies: ['cookies'],
  downloads: ['downloads'],
  idle: ['idle'],
  webRequest: ['webRequest'],
  declarativeNetRequest: ['declarativeNetRequest'],
  // chrome.tabs.query({url}) needs "tabs" OR a matching host permission.
  tabs: ['tabs', '<host_permissions>'],
  runtime: null,
  i18n: null,
  extension: null,
  action: null,
};

const sourceFiles = fs.readdirSync(root).filter(f => f.endsWith('.js') && !/^test-/.test(f));
assert.ok(sourceFiles.length, 'no extension source files found');

const used = new Set();
for (const f of sourceFiles) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of src.matchAll(/\bchrome\.([A-Za-z]+)/g)) used.add(m[1]);
}

const declared = new Set([...(manifest.permissions || []), ...(manifest.optional_permissions || [])]);
const hosts = manifest.host_permissions || [];

for (const ns of [...used].sort()) {
  assert.ok(ns in PERMISSION_FOR, `chrome.${ns} used in source but unknown to this test — add it to PERMISSION_FOR`);
  const needed = PERMISSION_FOR[ns];
  if (!needed) continue;
  const ok = needed.some(req => req === '<host_permissions>' ? hosts.length : declared.has(req));
  assert.ok(ok, `chrome.${ns} is used in ${sourceFiles.join(', ')} but manifest declares none of: ${needed.join(', ')}`);
}

// ── every file the manifest points at exists ─────────────────────────────
const referenced = [];
for (const cs of manifest.content_scripts || []) {
  assert.ok(Array.isArray(cs.js), 'content_scripts[].js must be an array');
  assert.ok(Array.isArray(cs.css), 'content_scripts[].css must be an array');
  assert.ok(Array.isArray(cs.matches) && cs.matches.length, 'content_scripts[].matches must be a non-empty array');
  referenced.push(...(cs.js || []), ...(cs.css || []));
}
referenced.push(...Object.values(manifest.icons || {}));
if (manifest.options_page) referenced.push(manifest.options_page);
if (manifest.background?.service_worker) referenced.push(manifest.background.service_worker);

for (const rel of referenced) {
  assert.ok(fs.existsSync(path.join(root, rel)), `manifest references missing file: ${rel}`);
}

// ── no stale workaround left behind ──────────────────────────────────────
assert.ok(!fs.existsSync(path.join(root, 'background.js')),
  'background.js exists but the manifest no longer registers it — the storage proxy is dead code');

console.log(`manifest: ok (${used.size} chrome APIs checked, ${referenced.length} files verified)`);
