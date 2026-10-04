// tools/reload.mjs — press the extension's Reload button without opening the extensions page.
//
//   node tools/reload.mjs               Edge on :9222 (the owner's browser)
//   node tools/reload.mjs --port=9333   any Chromium browser started with --remote-debugging-port
//
// Finds the extension by NAME (its id follows the folder it was loaded from — docs/HANDOFF.md §3.5), reloads
// it through the extensions page's own `chrome.developerPrivate`, and prints the version and folder it now
// runs from, so "did my change land?" has an answer. Only the extension is touched: no settings, no tabs
// beyond the one it opens and closes.
//
// Not for tools/sandbox.mjs's browser: an extension loaded over the debugging pipe is DISABLED by this call —
// the sandbox serves its own reload at http://127.0.0.1:<port+1>/reload.
import { withTab } from './cdp.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const PORT = +arg('port', process.env.OJC_CDP_PORT || 9222);
const NAME = arg('name', process.env.OJC_EXT_NAME || 'OJ.ph Cleaner');

let version;
try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); }
catch { console.error(`reload: FAIL — nothing listening on :${PORT} (start the browser with --remote-debugging-port=${PORT})`); process.exit(1); }
const page = /Edg\//.test(version.Browser) ? 'edge://extensions' : 'chrome://extensions';

const info = (t) => t.evaluate(`chrome.developerPrivate.getExtensionsInfo({includeDisabled:true}).then(xs => JSON.stringify(
  xs.filter(x => x.name === ${JSON.stringify(NAME)}).map(x => ({ id: x.id, version: x.version, state: x.state, path: x.path }))))`)
  .then(JSON.parse);

const out = await withTab(PORT, page, async (t) => {
  const found = await info(t);
  if (!found.length) return { error: `${NAME} is not installed in ${version.Browser} on :${PORT}` };
  await t.evaluate(`chrome.developerPrivate.reload(${JSON.stringify(found[0].id)}, { failQuietly: true }).then(() => 1)`);
  await new Promise(r => setTimeout(r, 1500));
  return { after: (await info(t))[0] };
}, 800);

if (out.error) { console.error('reload: FAIL — ' + out.error); process.exit(1); }
const a = out.after;
console.log(`reload: ${NAME} v${a.version} ${a.state} · ${version.Browser} :${PORT} · from ${a.path}`);
if (a.state !== 'ENABLED') process.exit(1);
