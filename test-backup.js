// test-backup.js: the backup file (spec.md D79): what goes in, and that a wrong file is refused before anything is written.
const assert = require('assert');
const F = require('./backup-file.js');
const NOW = new Date(2026, 9, 26, 9, 30).getTime();   // 26 Oct 2026, local

const storage = {
  settings: { negative: ['crypto'], goalSalary: 60000, askApplied: false },
  myJobs: { '1': { state: 'applied', via: 'forms.gle', note: 'sent portfolio' }, '2': { state: 'passed' }, '3': { state: 'saved' } },
  jobRecords: { '1': { tier: 'high' }, '9': { tier: 'worth' } },
  closedJobs: { '7': 1 }, fx: { rates: {} }, sightings: {}, visits: {}, reportedJobs: {}, ui: { onboarded: true },
};
const posts = [{ id: '1', at: NOW, desc: 'the post' }, { id: '9', at: NOW, desc: 'another' }];

// pack → JSON → unpack gives back exactly what went in
const file = F.pack({ storage, posts, version: '0.20.0', now: NOW });
assert.strictEqual(file.app, 'ojph-cleaner');
assert.strictEqual(file.format, F.FORMAT);
const back = F.unpack(JSON.stringify(file));
assert.ok(!(back instanceof Error));
assert.deepStrictEqual(back.storage, storage, 'every key round-trips: settings, My jobs with notes and where, memory, the rest');
assert.deepStrictEqual(back.posts, posts);
assert.strictEqual(back.at, NOW);
assert.strictEqual(back.version, '0.20.0');

// what the restore question says it holds
assert.deepStrictEqual(F.summary(back), { jobs: 2, records: 2, posts: 2 }, 'passed jobs are not counted as "in My jobs"');
assert.deepStrictEqual(F.summary(F.unpack(JSON.stringify(F.pack({ storage: {}, posts: null, now: NOW })))), { jobs: 0, records: 0, posts: 0 });

// the file name, in the viewer's own date
assert.strictEqual(F.fileName(NOW), 'ojph-cleaner-backup-2026-10-26.json');

// refused before a byte is written
const refused = (text, re) => { const r = F.unpack(text); assert.ok(r instanceof Error, `accepted: ${String(text).slice(0, 40)}`); assert.ok(re.test(r.message), r.message); };
refused('not json at all', /not a backup/);
refused('[]', /not a backup/);
refused(JSON.stringify({ app: 'something-else', format: 1, storage: {} }), /not a backup/);
refused(JSON.stringify({ app: 'ojph-cleaner', storage: {} }), /not a backup/);
refused(JSON.stringify({ ...file, format: F.FORMAT + 1 }), /newer version/);
refused(JSON.stringify({ ...file, storage: [] }), /damaged/);
refused(null, /not a backup/);
// damaged post rows are dropped, not fatal
assert.deepStrictEqual(F.unpack(JSON.stringify({ ...file, posts: [{ id: '1' }, null, 'x', { desc: 'no id' }] })).posts, [{ id: '1' }]);

console.log('backup: ok (round trip, summary, file name, refusals)');
