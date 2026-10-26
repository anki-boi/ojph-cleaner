/**
 * skill-tags.js: the posts this computer has seen, as the resume picker needs them (spec.md D80).
 *
 * OnlineJobs.ph puts skill tags on every card (QuickBooks, Canva, Data Entry…). They are the job words employers
 * really use, so they are what a resume is matched against. A card hook keeps each listing's title and tags in
 * `chrome.storage.local.jobTags = { "<jobId>": { at, t: title, g: [tags] } }`, 60 days and 2 000 listings at most,
 * written in the background a few seconds after something new appears (like trust.js's sightings).
 *
 * `gather()` builds what resume-words.js reads: every tag seen, and one lower-cased text per post, from the kept
 * titles and tags, the cards on this board, and the saved posts (their full descriptions) in IndexedDB.
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage || typeof document === 'undefined') return;
  const api = self.OJC;
  if (!api) return;
  const KEY = 'jobTags', KEEP_MS = 60 * 864e5, CAP = 2000;
  const TAG_SEL = self.OJCDetailParse?.CARD_SKILL_SEL || '.job-tag a';
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const titleOf = (card) => { const h = card.querySelector('dt h4'); if (!h) return ''; const o = h.cloneNode(true); o.querySelectorAll('[class^="ojc-"], [class*="badge"]').forEach(x => x.remove()); return clean(o.textContent); };
  const tagsOf = (card) => [...new Set([...card.querySelectorAll(TAG_SEL)].map(a => clean(a.textContent)).filter(Boolean))];
  const idOf = (card) => self.OJCTriage?.idOf?.(card) || null;

  let held = {}, dirty = false;

  api.addCardHook((card, { now }) => {
    const id = idOf(card);
    if (!id || held[id]) return;
    const g = tagsOf(card), t = titleOf(card);
    if (!g.length && !t) return;
    held[id] = { at: now, t, g };
    dirty = true;
  });

  const prune = (m, now) => {
    let rows = Object.entries(m || {}).filter(([, e]) => e && now - e.at <= KEEP_MS);
    if (rows.length > CAP) rows = rows.sort((a, b) => b[1].at - a[1].at).slice(0, CAP);
    return Object.fromEntries(rows);
  };
  // Merged with what is stored, so two tabs never drop each other's listings.
  setInterval(async () => {
    if (!dirty || self.OJCBackup?.restoring) return;   // D79: a restore is replacing this key
    dirty = false;
    const stored = (await chrome.storage.local.get(KEY))[KEY] || {};
    held = prune({ ...stored, ...held }, Date.now());
    await chrome.storage.local.set({ [KEY]: held });
  }, 5000);
  chrome.storage.local.get(KEY, (r) => { held = { ...(r[KEY] || {}), ...held }; });

  /** { tags: [labels], corpus: [lower-cased text per post] } from everything this computer has seen. */
  async function gather() {
    const docs = new Map(), tags = new Set();
    const add = (id, text) => { if (id && text) docs.set(String(id), (docs.get(String(id)) || '') + '\n' + text.toLowerCase()); };
    for (const [id, e] of Object.entries(held)) { for (const g of e.g || []) tags.add(g); add(id, `${e.t || ''}\n${(e.g || []).join('\n')}`); }
    for (const card of api.cards?.() || []) {
      const id = idOf(card);
      for (const g of tagsOf(card)) tags.add(g);
      if (!held[id]) add(id, `${api.ownText(card)}\n${tagsOf(card).join('\n')}`);
    }
    try { for (const row of (await self.OJCDetailCache?.all?.()) || []) add(row.id, row.desc || ''); } catch { /* no saved posts: titles and tags still count */ }
    return { tags: [...tags], corpus: [...docs.values()] };
  }

  self.OJCSkillTags = { gather };
})();
