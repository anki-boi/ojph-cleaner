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

// ── which files are actual extension source ──────────────────────────────
// Recursive, so a source file in a subdirectory cannot escape the checks below
// (this used to readdirSync(root) only). tools/ is dev-only; docs/ is prose.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'docs', 'tools', 'icons', '.github']);
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out); continue; }
    out.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/'));
  }
  return out;
};
const allFiles = walk(root);
const sourceFiles = allFiles.filter(f => f.endsWith('.js') && !/(^|\/)test-/.test(f));
assert.ok(sourceFiles.length, 'no extension source files found');

// Files the package actually loads: content script entries, plus anything an HTML
// file pulls in with a <script src>.
const wired = new Set((manifest.content_scripts || []).flatMap(cs => cs.js || []));
for (const html of allFiles.filter(f => f.endsWith('.html'))) {
  const src = fs.readFileSync(path.join(root, html), 'utf8');
  for (const m of src.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) wired.add(m[1]);
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

// ── every source file is wired into the package ──────────────────────────
// A source file nothing loads is dead weight in a public repo; the reverse case
// (loaded but unlisted) would escape the permission check above.
const orphans = sourceFiles.filter(f => !wired.has(f) && !wired.has(path.basename(f)));
assert.deepStrictEqual(orphans, [],
  `source file(s) nothing loads: ${orphans.join(', ')} — add to manifest.json content_scripts or the HTML that needs them`);

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

// ── the in-page panel's field references must exist in its own markup ────
// This exact bug cost real time: fillPanel() read `#ojc-goal-hourly` before the field was added to
// the template, so opening the panel threw and Save silently did nothing (the only check that caught
// it was the live harness). A static check makes the class impossible. The panel lives in panel.js.
const panelSrc = fs.readFileSync(path.join(root, 'panel.js'), 'utf8');
const template = panelSrc.match(/panel\.innerHTML = `([\s\S]*?)`;/);
assert.ok(template, 'could not find the panel markup in panel.js');
const panelFields = [...new Set([...panelSrc.matchAll(/\$p\('#([\w-]+)'\)/g)].map(m => m[1]))];
assert.ok(panelFields.length, 'no panel field references found in panel.js');
const undefinedFields = panelFields.filter(id => !template[1].includes(`id="${id}"`));
assert.deepStrictEqual(undefinedFields, [],
  `panel.js reads field(s) its markup does not define: ${undefinedFields.join(', ')}`);

// ── no stale workaround left behind ──────────────────────────────────────
assert.ok(!fs.existsSync(path.join(root, 'background.js')),
  'background.js exists but the manifest no longer registers it — the storage proxy is dead code');

// ── both settings surfaces must cover every setting, on all three legs ────
// content.js's DEFAULTS is the single source of truth for the settings shape. Both the in-page panel
// (panel.js) and the standalone options page (options.js) write the WHOLE settings object on save, so a
// setting missing from a surface's DEFAULTS, its **load** or its save() is silently dropped back to the
// default — the "a setting that lies" bug class, and exactly what `rescueNegotiable` (0.12) shipped as:
// the panel had it, options.html had no field and no mention. The load leg matters as much as the other
// two and is the easy one to forget: a field the load forgets reads back as `undefined`, the user sees a
// checkbox off, and the next Save writes that off over their real setting.
const contentSrc = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const defaults = contentSrc.match(/const DEFAULTS = \{([\s\S]*?)\n  \};/);
assert.ok(defaults, 'could not find `const DEFAULTS = {...}` in content.js');
const settingKeys = [...defaults[1].matchAll(/^\s*([A-Za-z_]\w*):/gm)].map(m => m[1]);
const optionsSrc = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
const optDefaults = optionsSrc.match(/const DEFAULTS = \{([^}]*)\};/);
assert.ok(optDefaults, 'could not find `const DEFAULTS = {...}` in options.js');
// The standalone page keeps its own DEFAULTS because it merges them under whatever is in storage, so a
// key it does not know is a key a legacy settings object can lose.
for (const key of settingKeys) {
  assert.ok(optDefaults[1].includes(key + ':'),
    `options.js DEFAULTS is missing "${key}" — saving from the standalone page drops it`);
}
// Each surface's load block and save block; anchored on the distinct call each one makes, so the two
// cannot silently swap. `\bs\.<key>\b` is how both read a setting back after the merge.
const surfaces = [
  { name: 'panel.js', src: fs.readFileSync(path.join(root, 'panel.js'), 'utf8'),
    load: /function fillPanel\(\)[\s\S]*?\n  \}/, save: /api\.setSettings\(\{[\s\S]*?\n    \}\)/ },
  { name: 'options.js', src: optionsSrc,
    load: /chrome\.storage\.local\.get\('settings',[\s\S]*?\n  \}\)/, save: /const settings = \{[\s\S]*?\n    \};/ },
];
for (const { name, src, load, save } of surfaces) {
  const loadBlock = src.match(load);
  const saveBlock = src.match(save);
  assert.ok(loadBlock && saveBlock, `could not find the load/save blocks in ${name}`);
  for (const key of settingKeys) {
    assert.ok(new RegExp(`\\bs\\.${key}\\b`).test(loadBlock[0]),
      `${name} does not read "${key}" when filling its form — the field shows a default and the next save overwrites the setting with it`);
    assert.ok(saveBlock[0].includes(key + ':'),
      `${name} save() is missing "${key}" — saving from it drops the setting`);
  }
}
// Every field options.js reads or writes must exist in options.html, mirroring the panel check above.
const optHtml = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const optFields = [...new Set([...optionsSrc.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]))];
const missingOptFields = optFields.filter(id => !optHtml.includes(`id="${id}"`));
assert.deepStrictEqual(missingOptFields, [],
  `options.js references field(s) options.html does not define: ${missingOptFields.join(', ')}`);

console.log(`manifest: ok (${used.size} chrome APIs checked, ${sourceFiles.length} source files wired, ` +
  `${referenced.length} files verified, ${panelFields.length} panel fields declared)`);
