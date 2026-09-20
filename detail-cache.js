/**
 * detail-cache.js — the fetched description of a listing you have scanned (spec.md W12, D3).
 *
 * IndexedDB, in the onlinejobs.ph origin, keyed by job id. It exists so that **changing a keyword is
 * free** (D36): every scanned listing's own words are kept, so re-deciding a page after a settings edit
 * costs one bounded read and zero requests. Without it, the only honest options would be "re-fetch
 * everything" or "your keyword edit does nothing until you rescan".
 *
 * Why not `chrome.storage.local`, where every other thing this extension remembers lives:
 * ~3.5 KB per listing × 1 000 listings is 3.5 MB of a 10 MB quota shared with the settings and the job
 * records, and that API rewrites the whole blob on every single write. IndexedDB stores one record per
 * write and has its own quota. (The same decision was made in spec.md D3 before either store existed.)
 *
 * The TTL and the cap are enforced on every write, lazily, through the `at` index — so a cache that is
 * never written to never grows, and a scan that runs for an hour cannot exceed the cap.
 *
 * # ponytail: no `getMany` batching and no cursor paging — a page holds ≤300 cards, one `getAll` over
 * the ids in memory is microseconds. Add paging if a page ever asks for thousands.
 */
(() => {
  'use strict';
  const DB_NAME = 'ojc';
  const DB_VERSION = 1;
  const STORE = 'details';
  const INDEX = 'at';
  /** A week: the board drops a closed listing in ~3 weeks, and a description can be edited any time. */
  const TTL_MS = 7 * 86400000;
  const MAX_ENTRIES = 1000;

  let dbPromise = null;

  const open = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex(INDEX, INDEX);   // lets the cap and the TTL delete by age without a full scan
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((err) => { dbPromise = null; throw err; });   // a failed open must be retryable, not sticky
    return dbPromise;
  };

  const tx = (db, mode, fn) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    fn(t.objectStore(STORE));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });

  /** One entry per write, oldest deleted first. Runs inside the same transaction as the put. */
  function trim(store, now) {
    const expired = store.index(INDEX).openCursor(IDBKeyRange.upperBound(now - TTL_MS));
    expired.onsuccess = () => {
      const cur = expired.result;
      if (!cur) return;
      cur.delete();
      cur.continue();
    };
    // The cap is checked after the deletes queue up behind them, so it cannot delete a record the TTL
    // pass is about to remove and then leave the store over the cap.
    const count = store.count();
    count.onsuccess = () => {
      const over = count.result - MAX_ENTRIES;
      if (over <= 0) return;
      let left = over;
      const oldest = store.index(INDEX).openCursor();   // ascending by `at`
      oldest.onsuccess = () => {
        const cur = oldest.result;
        if (!cur || left-- <= 0) return;
        cur.delete();
        cur.continue();
      };
    };
  }

  /**
   * The cached entries for these ids, fresher than the TTL. A stale entry is deleted on the way past:
   * the question "is this still good?" is only ever asked here.
   *
   * One `get` per id inside one transaction, not `getAll` over a key range: ids are arbitrary numbers
   * (1733870, 90210) so no single range covers the set, and reading the whole store to filter it in
   * memory would drag 3.5 MB through a rule pass to answer 300 questions.
   */
  async function getMany(ids) {
    const want = [...new Set((ids || []).map(String))].filter(Boolean);
    if (!want.length) return new Map();
    const db = await open();
    const rows = await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readonly');
      const store = t.objectStore(STORE);
      const out = [];
      let pending = want.length;
      for (const id of want) {
        const req = store.get(id);
        req.onsuccess = () => {
          if (req.result) out.push(req.result);
          if (--pending === 0) resolve(out);
        };
        req.onerror = () => reject(req.error);
      }
      t.onabort = () => reject(t.error);
    });
    const now = Date.now();
    const out = new Map();
    const dead = [];
    for (const row of rows) {
      if (now - Number(row.at || 0) > TTL_MS) { dead.push(row.id); continue; }
      out.set(String(row.id), row);
    }
    if (dead.length) await tx(db, 'readwrite', (store) => { for (const id of dead) store.delete(id); });
    return out;
  }

  /** Store one listing's own words. `entry` = `{ id, url, at, desc, fields, closed }`. */
  async function put(entry) {
    if (!entry || !entry.id) return null;
    const db = await open();
    const row = { ...entry, id: String(entry.id), at: Number(entry.at) || Date.now() };
    await tx(db, 'readwrite', (store) => { store.put(row); trim(store, Date.now()); });
    return row;
  }

  /** Forget these listings — used by a re-check that found the page unusable, and by the tests. */
  async function drop(ids) {
    const want = (ids || []).map(String).filter(Boolean);
    if (!want.length) return 0;
    const db = await open();
    await tx(db, 'readwrite', (store) => { for (const id of want) store.delete(id); });
    return want.length;
  }

  const count = async () => {
    const db = await open();
    const t = db.transaction(STORE, 'readonly');
    return new Promise((resolve, reject) => {
      const req = t.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };

  self.OJCDetailCache = { getMany, put, drop, count, open, TTL_MS, MAX_ENTRIES, DB_NAME, STORE };
})();
