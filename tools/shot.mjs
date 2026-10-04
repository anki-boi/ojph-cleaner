// tools/shot.mjs — screenshot a page in a CDP browser after an optional script, for eyeballing UI changes.
//
//   node tools/shot.mjs --out=shot.png [--url=…] [--port=9444] [--width=1280] [--height=900] [--wait=4000]
//                       [--eval="document.querySelector('#ojc-gear').click()"] [--full]
//
// Prints anything the --eval expression returns. Meant for the sandbox (tools/sandbox.mjs); it opens its own
// tab and closes it.
import { withTab } from './cdp.mjs';
import fs from 'node:fs';

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const PORT = +arg('port', process.env.OJC_CDP_PORT || 9444);
const URL_ = arg('url', 'https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=bookkeeper');
const OUT = arg('out', 'shot.png');
const W = +arg('width', 1280), H = +arg('height', 900);
const WAIT = +arg('wait', 4000);
const EVAL = arg('eval', '');
const FULL = process.argv.includes('--full');

await withTab(PORT, URL_, async (t) => {
  await t.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 600 });
  await t.ready();
  await new Promise(r => setTimeout(r, WAIT));
  if (EVAL) {
    const out = await t.evaluate(`(async () => { ${EVAL.includes('return') ? EVAL : 'return ' + EVAL} })()`);
    if (out !== undefined) console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
    await new Promise(r => setTimeout(r, 800));
  }
  const { data } = await t.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: FULL });
  fs.writeFileSync(OUT, Buffer.from(data, 'base64'));
}, 500);
console.log('shot: ' + OUT);
