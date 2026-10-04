/**
 * searches.js — your saved searches, checked as one board (spec.md D63, W24).
 *
 * ☆ Save search keeps the search you are on. 🔎 Check N searches then walks your OTHER saved searches and adds
 * their new listings to this board — de-duplicated by job, each marked with the search it came from — so
 * "bookkeeper", "quickbooks" and "accountant" read as one list that the rules, the tiers and the pay sort all
 * treat like any other card.
 *
 * Only ever on a button press (§8: no paging nobody asked for), and inside the same budget the deep scan keeps
 * (D33): one request at a time, ≥ 600 ms apart, at most 10 pages and 300 listings across ALL searches together,
 * each search stopping at your recency window, everything stopping at the first 429.
 */
(() => {
  'use strict';
  if (typeof document === 'undefined' || typeof chrome === 'undefined') return;
  const api = self.OJC;
  if (!api || !api.LIST_RE.test(location.pathname)) return;
  const P = self.OJCPager, V = self.OJCVisits;
  const MAX_PAGES = 10, MAX_CARDS = 300, GAP_MS = 600;

  const here = () => V.searchKey(location.href);
  const saved = () => (api.getSettings().searches || []).map(s => V.toSearchKey(s)).filter(Boolean);
  const others = () => saved().filter(k => k !== here());
  const label = (key) => {
    const u = new URL(key, location.origin);
    return u.searchParams.get('jobkeyword') || decodeURIComponent((u.pathname.match(/\/c\/([^/]+)/) || [])[1] || key).replace(/-/g, ' ');
  };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  let run = null;   // { stop, done, of, pages, added, note }

  function persist(list) {
    const s = { ...api.getSettings(), searches: list };
    api.setSettings(s);
    api.persist();
    api.refreshRules();
  }
  function toggleSave() {
    const k = here();
    const list = saved();
    if (list.includes(k)) { persist(list.filter(x => x !== k)); self.OJCToast?.show(`Removed "${label(k)}" from your saved searches`); }
    else { persist([...list, k]); self.OJCToast?.show(`Saved "${label(k)}" — 🔎 checks all your saved searches at once`); }
  }

  async function check() {
    if (run) { run.stop = true; return; }
    const targets = others();
    if (!targets.length) return;
    run = { stop: false, done: 0, of: targets.length, pages: 0, added: 0, why: '' };
    const container = api.cards()[0]?.parentElement;
    if (!container) { run = null; return; }
    const have = new Set(api.cards().map(c => P.jobKeyOf(c, api.ownText)));
    const days = Number(api.getSettings().maxAgeDays) || 0;
    api.refreshRules();
    try {
      for (const [n, key] of targets.entries()) {
        if (run.stop) { run.why = 'stopped'; break; }
        // A fair share of what is left: measured live, a 14-day "quickbooks" search took all 10 pages and the next
        // saved search got none. Each search now gets (pages left ÷ searches left), at least one.
        const share = Math.max(1, Math.floor((MAX_PAGES - run.pages) / (targets.length - n)));
        let offset = 0, mine = 0;
        for (;;) {
          if (run.pages >= MAX_PAGES) { run.why = `stopped at the ${MAX_PAGES}-page cap`; break; }
          if (mine >= share) break;
          if (run.added >= MAX_CARDS) { run.why = `stopped at ${MAX_CARDS} listings`; break; }
          if (run.stop) break;
          const url = offset ? P.nextPageUrl(location.origin + key, offset) : location.origin + key;
          api.setNote(`Checking "${label(key)}" — page ${offset / 30 + 1} · ${run.added} new so far`);
          const res = await fetch(url, { credentials: 'same-origin' });
          run.pages++;
          mine++;
          if (res.status === 429) { run.why = 'the site asked us to slow down (HTTP 429)'; run.stop = true; break; }
          if (!res.ok) break;
          const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
          const found = [...doc.querySelectorAll(P.SELECTOR)];
          if (!found.length) break;
          const sentinel = document.getElementById('ojc-sentinel');
          for (const c of found) {
            const k = P.jobKeyOf(c, api.ownText);
            if (have.has(k)) continue;
            have.add(k);
            const card = document.importNode(c, true);
            card.dataset.ojcFrom = label(key);
            container.insertBefore(card, sentinel && sentinel.parentElement === container ? sentinel : null);
            run.added++;
          }
          api.refreshRules();
          offset += found.length;
          // Newest-first: once a page's cards are all past your window, every later page is too.
          if (P.pastHorizon(found.map(c => api.postedAt(c)), Date.now(), days) || found.length < 30) break;
          await sleep(GAP_MS);
        }
        if (mine) run.done++;   // "checked" means it got at least one page, not that the loop passed it
        if (run.stop) break;
      }
    } catch (e) {
      run.why = `stopped: ${(e && e.message) || e}`;
    } finally {
      const r = run;
      run = null;
      api.setNote(`Checked ${r.done} of ${r.of} saved search${r.of === 1 ? '' : 'es'}: ${r.added} new listing${r.added === 1 ? '' : 's'} added` +
        ` · ${r.pages} page${r.pages === 1 ? '' : 's'}${r.why ? ' — ' + r.why : ''}`);
      self.OJCPaySort?.afterScan?.();
      api.refreshRules();
    }
  }

  // Imported cards say where they came from: a quiet tag in the badge row.
  api.addCardHook((card, { box }) => {
    box.querySelector(':scope > .ojc-from')?.remove();
    if (!card.dataset.ojcFrom || card.hidden) return;
    const b = document.createElement('span');
    b.className = 'ojc-from';
    b.textContent = `🔎 ${card.dataset.ojcFrom}`;
    b.title = `added from your saved search "${card.dataset.ojcFrom}"`;
    box.prepend(b);
  });

  const bar = self.OJCChip;
  bar?.addAction({ id: 'ojc-btn-savesearch', order: 7,
    text: () => (saved().includes(here()) ? '★ Saved' : '☆ Save'),
    title: 'save this search, so 🔎 can check it together with your others (click again to forget it)',
    onClick: toggleSave });
  bar?.addAction({ id: 'ojc-btn-check', order: 8,
    text: () => (run ? `Stop · ${run.done}/${run.of}` : `🔎 ${others().length}`),
    hidden: () => !run && !others().length,
    title: 'add the new listings from your other saved searches to this board (one request at a time, capped)',
    onClick: check });

  self.OJCSearches = { check, toggleSave, saved, others };
})();
