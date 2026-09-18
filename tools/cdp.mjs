// tools/cdp.mjs — minimal CDP client (no dependencies).
// Talks to a Chromium browser started with --remote-debugging-port.
const rpc = (ws) => {
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id === undefined) {                       // CDP event, not a response
      (handlers.get(m.method) || []).forEach(fn => fn(m.params));
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async expression =>
    (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
  const ready = () => evaluate(`new Promise(r=>{document.readyState==='complete'?r(1):addEventListener('load',()=>r(1),{once:true})})`);
  /** Subscribe to a CDP event — used to count real network requests, which a page-world
   *  fetch patch cannot see (the content script runs in an isolated world). */
  const on = (method, fn) => handlers.set(method, [...(handlers.get(method) || []), fn]);
  return { send, evaluate, ready, on };
};

const targetList = (port) => fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
const versionInfo = (port) => fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json());

/** Open a WebSocket, failing loudly instead of hanging forever. */
async function openWs(url, timeoutMs = 5000) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out opening ${url}`)), timeoutMs);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error(`cannot open ${url}`)); };
  });
  return ws;
}

/** Attach to the first target matching `match` (or the first real page). */
export async function connect(port, match) {
  const list = await targetList(port);
  const pages = list.filter(t => t.type === 'page' && !t.url.startsWith('devtools://'));
  const target = (match && list.find(match)) || pages[0];
  if (!target) throw new Error(`no page target on :${port}`);
  const ws = await openWs(target.webSocketDebuggerUrl);
  return { ...rpc(ws), target, close: () => { try { ws.close(); } catch {} } };
}

/** Attach to a specific target id, waiting for it to appear. */
export async function attach(port, targetId, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const target = (await targetList(port)).find(t => t.id === targetId);
    if (target) {
      const ws = await openWs(target.webSocketDebuggerUrl);
      return { ...rpc(ws), target, close: () => { try { ws.close(); } catch {} } };
    }
    if (Date.now() > deadline) throw new Error(`target ${targetId} never appeared`);
    await new Promise(r => setTimeout(r, 250));
  }
}

/** Open a tab, run `fn(session)`, then close it. Always closes the tab. */
export async function withTab(port, url, fn, settleMs = 1500) {
  // Use the browser-level endpoint: picking "some page target" breaks as soon as
  // the previously closed tab is still listed in /json/list.
  const { webSocketDebuggerUrl } = await versionInfo(port);
  const browserWs = await openWs(webSocketDebuggerUrl);
  const browser = rpc(browserWs);
  const { targetId } = await browser.send('Target.createTarget', { url });
  const session = await attach(port, targetId);
  await new Promise(r => setTimeout(r, settleMs));
  try {
    return await fn(session);
  } finally {
    session.close();
    try { await browser.send('Target.closeTarget', { targetId }); } catch {}
    browserWs.close();
  }
}
