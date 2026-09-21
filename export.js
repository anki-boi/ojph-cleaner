/**
 * export.js — the job memory out of the browser, as a CSV (F1).
 *
 * The records live in `chrome.storage.local.jobRecords`, which you cannot open from outside the
 * extension; the chip's Export button is the door. The string itself is built by `OJCRecords.toCsv`
 * (pure, unit-tested in test-records.js); this file only gathers the data and starts the download.
 *
 * URLs come from the detail cache, because records deliberately do not store them — a listing that was
 * cached away comes out with a blank URL, and a blank is honest while a guess is not.
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage) return; // node: nothing to do
  const records = self.OJCRecordsUI, cache = self.OJCDetailCache, pure = self.OJCRecords;
  if (!records || !pure) return;

  /** The CSV text and the file name, or null when there is nothing to export. */
  async function build() {
    const all = records.all();
    const ids = Object.keys(all);
    if (!ids.length) return null;
    const urls = {};
    if (cache) {
      try {
        const rows = await cache.getMany(ids);
        for (const [id, row] of rows) urls[id] = row.url || '';
      } catch { /* the cache being unavailable costs the URLs, not the export */ }
    }
    return { csv: pure.toCsv(all, urls), name: `ojph-scan-${new Date().toISOString().slice(0, 10)}.csv` };
  }

  async function run() {
    const out = await build();
    if (!out) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out.csv], { type: 'text/csv' }));
    a.download = out.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  self.OJCExport = { build, run };
})();
