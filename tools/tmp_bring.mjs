import { attach } from './cdp.mjs';
const ts = await (await fetch('http://127.0.0.1:9333/json')).json();
const ext = ts.find(t => t.url === 'chrome://extensions/');
const cdp = await attach(9333, ext.id);
await cdp.send('Page.bringToFront');
console.log('brought front');
process.exit(0);
