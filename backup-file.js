/**
 * backup-file.js: the backup file's shape (spec.md D79). Pure and UMD: backup.js builds and reads it in the page,
 * test-backup.js pins it in node.
 *
 * A backup is everything the extension keeps, so a new computer (or a reinstall) carries on where the old one
 * left off: every key in `chrome.storage.local` (settings, My jobs and its notes, the listing memory, closed and
 * reported listings, re-post sightings, visits, exchange rates) and every saved post in the IndexedDB cache.
 *
 *   { app: 'ojph-cleaner', format: 1, version: '0.20.0', at: 1761480000000, storage: { … }, posts: [ … ] }
 *
 * `unpack` refuses anything that is not one of these before a single byte is written, so a wrong file can never
 * wipe what is there. A newer format is refused too: a backup made by a later version may hold keys this version
 * would misread.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCBackupFile = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const APP = 'ojph-cleaner';
  const FORMAT = 1;

  const isMap = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

  function pack({ storage, posts, version, now }) {
    return { app: APP, format: FORMAT, version: String(version || ''), at: Number(now) || 0,
      storage: isMap(storage) ? storage : {}, posts: Array.isArray(posts) ? posts : [] };
  }

  const pad = (n) => String(n).padStart(2, '0');
  /** `ojph-cleaner-backup-2026-10-26.json`, in the viewer's own date. */
  function fileName(now) {
    const d = new Date(now);
    return `${APP}-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  }

  /** The parsed backup, or an Error saying why it is not one. Never throws. */
  function unpack(text) {
    let b;
    try { b = JSON.parse(String(text)); } catch { return new Error('not a backup file'); }
    if (!isMap(b) || b.app !== APP) return new Error('not a backup file');
    if (!(Number(b.format) >= 1)) return new Error('not a backup file');
    if (b.format > FORMAT) return new Error('made by a newer version: update the extension first');
    if (!isMap(b.storage)) return new Error('the file is damaged');
    const posts = Array.isArray(b.posts) ? b.posts.filter(p => isMap(p) && p.id != null) : [];
    return { at: Number(b.at) || 0, version: String(b.version || ''), storage: b.storage, posts };
  }

  /** What a person recognises in it: jobs in My jobs (not the passed ones), remembered listings, saved posts. */
  function summary(b) {
    const mine = isMap(b?.storage?.myJobs) ? Object.values(b.storage.myJobs) : [];
    return {
      jobs: mine.filter(e => e && e.state && e.state !== 'passed').length,
      records: isMap(b?.storage?.jobRecords) ? Object.keys(b.storage.jobRecords).length : 0,
      posts: Array.isArray(b?.posts) ? b.posts.length : 0,
    };
  }

  return { APP, FORMAT, pack, unpack, summary, fileName };
});
