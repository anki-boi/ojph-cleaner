// tools/sandbox.mjs — a throwaway Chrome with THIS checkout's extension loaded, for testing without a human.
//
//   node tools/sandbox.mjs            start it (headless) and print the port; stays running until killed
//   node tools/sandbox.mjs --headed   the same, with a window
//
// Why: the live harness (verify-live.mjs) drives the owner's daily browser on :9333, which needs that browser
// open with a debug port and only ever tests the folder the extension was loaded from by hand. This starts a
// separate Chrome on a fresh profile (nothing of the owner's is read or written) and loads the extension from
// the folder this file lives in — a worktree tests its own code.
//
// `--load-extension` is a no-op on branded Chrome since 137 (docs/HANDOFF.md §3.1). What still works is
// CDP's `Extensions.loadUnpacked`, which Chrome only accepts over `--remote-debugging-pipe` with
// `--enable-unsafe-extension-debugging`. So the browser gets both: the pipe (fd 3/4) for the one load call,
// and a port for every other tool here (cdp.mjs, verify-live.mjs via OJC_CDP_PORT) to attach to.
//
// Env: OJC_SANDBOX_PORT (default 9444), CHROME (path to chrome.exe).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const EXT_DIR = path.resolve(HERE, '..');
const PORT = +(process.env.OJC_SANDBOX_PORT || 9444);
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find(p => fs.existsSync(p));
if (!CHROME) { console.error('sandbox: FAIL — no Chrome found; set CHROME'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ojc-sandbox-'));
const args = [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--remote-debugging-pipe',
  '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check',
  '--window-size=1280,900', '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  ...(process.argv.includes('--headed') ? [] : ['--headless=new']), 'about:blank',
];
const chrome = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const toChrome = chrome.stdio[3], fromChrome = chrome.stdio[4];

// The pipe protocol: one JSON message per NUL-terminated frame.
let buf = '';
const waiting = new Map();
fromChrome.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    const w = waiting.get(m.id);
    if (w) { waiting.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result); }
  }
});
let n = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++n; waiting.set(id, { resolve, reject });
  toChrome.write(JSON.stringify({ id, method, params }) + '\0');
});

const cleanup = () => { try { chrome.kill(); } catch {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
chrome.on('exit', () => { console.log('sandbox: chrome exited'); process.exit(0); });

try {
  const { id } = await send('Extensions.loadUnpacked', { path: EXT_DIR });
  console.log(`sandbox: ready on :${PORT} · extension ${id} from ${EXT_DIR}`);
} catch (e) {
  console.error('sandbox: FAIL — ' + e.message); cleanup(); process.exit(1);
}

// Reloading. `chrome.developerPrivate.reload` — what verify-live uses on the owner's browser — DISABLES an
// extension that was loaded over the pipe (measured: state ENABLED → DISABLED, every page of it then
// ERR_BLOCKED_BY_CLIENT). Loading the same folder again is the reload that works, and only this process
// holds the pipe, so it serves it: GET http://127.0.0.1:<PORT+1>/reload → `{ id }`. verify-live.mjs and
// capture-screens.js call it when OJC_RELOAD_URL is set.
http.createServer(async (req, res) => {
  if (req.url !== '/reload') { res.writeHead(404).end(); return; }
  try {
    const out = await send('Extensions.loadUnpacked', { path: EXT_DIR });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  } catch (e) { res.writeHead(500).end(e.message); }
}).listen(PORT + 1, '127.0.0.1', () => console.log(`sandbox: reload at http://127.0.0.1:${PORT + 1}/reload`));
