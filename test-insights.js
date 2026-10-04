// test-insights.js — the pay statistics behind My jobs (spec.md D61).
const assert = require('assert');
const I = require('./insights.js');

assert.strictEqual(I.quantile([10, 20, 30, 40], 0.5), 25);
assert.strictEqual(I.quantile([5], 0.9), 5);
assert.strictEqual(I.quantile([], 0.5), null);
assert.deepStrictEqual(I.summarize([40, 10, 30, 20, NaN]), { n: 4, p25: 17.5, p50: 25, p75: 32.5, min: 10, max: 40 });
assert.strictEqual(I.shareBelow([10, 20, 30, 40], 30), 0.5, 'strictly below: a job paying exactly your minimum meets it');
assert.strictEqual(I.shareBelow([], 30), 0);

// Bins: round edges, every value counted once, the tails folded into the end bins.
const vals = [...Array(100)].map((_, i) => 20000 + i * 600);   // 20,000 … 79,400
const b = I.bins([...vals, 900000], 10);                         // one wild outlier
assert.strictEqual(b.reduce((n, x) => n + x.n, 0), 101, 'every listing is in exactly one bin');
assert.ok(b.every(x => x.lo % 1000 === 0 && x.hi % 1000 === 0), 'round-number edges');
assert.ok(b.length <= 12, 'the outlier does not stretch the axis into hundreds of empty bins');
assert.ok(b[b.length - 1].openHi && b[0].openLo);
assert.deepStrictEqual(I.bins([]), []);
assert.strictEqual(I.bins([5, 5, 5]).reduce((n, x) => n + x.n, 0), 3, 'identical values still land somewhere');

console.log('insights: ok (quantiles, share below your minimum, histogram bins)');
