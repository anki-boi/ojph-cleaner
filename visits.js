/**
 * visits.js — "new since your last visit", per search (spec.md D54). Zero requests: it only remembers WHEN you
 * last looked at a search and compares that with each card's own posted time.
 *
 *   chrome.storage.local.visits = { "<searchKey>": { last, prev } }
 *
 * A visit is continuous use: a reload, or coming back within VISIT_GAP, is the same visit, so the marks you
 * were reading do not vanish under you. Coming back later starts a new visit whose cutoff is the end of the
 * previous one. The very first visit to a search marks nothing — everything would be "new", which says nothing.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCVisits = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VISIT_GAP = 30 * 60 * 1000;
  const KEEP_DAYS = 90, CAP = 200;

  /** The search, without its page offset: page 1 and page 4 of one search are one search. */
  function searchKey(href) {
    let u;
    try { u = new URL(href, 'https://www.onlinejobs.ph'); } catch { return null; }
    const path = u.pathname
      .replace(/^(\/jobseekers\/jobsearch)\/\d+\/?$/, '$1')
      .replace(/^(\/jobseekers\/search\/c\/[^/]+)\/\d+\/?$/, '$1')
      .replace(/\/$/, '');
    const q = [...u.searchParams.entries()].filter(([k]) => k !== 'offset')
      .map(([k, v]) => [k, v.trim().toLowerCase()]).sort((a, b) => a[0].localeCompare(b[0]));
    return path + (q.length ? '?' + q.map(([k, v]) => `${k}=${v}`).join('&') : '');
  }

  /** Opening a search: the cutoff to mark against, and the entry to store. */
  function open(entry, now) {
    if (!entry || !entry.last) return { cutoff: null, entry: { last: now, prev: null } };
    if (now - entry.last < VISIT_GAP) return { cutoff: entry.prev ?? null, entry: { ...entry, last: now } };
    return { cutoff: entry.last, entry: { prev: entry.last, last: now } };
  }

  /** Still here: keep the visit alive. */
  const touch = (entry, now) => ({ ...(entry || { prev: null }), last: now });

  const isNew = (postedAt, cutoff) => cutoff != null && postedAt != null && postedAt > cutoff;

  function prune(map, now) {
    let rows = Object.entries(map || {}).filter(([, e]) => now - (e.last || 0) <= KEEP_DAYS * 864e5);
    if (rows.length > CAP) rows = rows.sort((a, b) => b[1].last - a[1].last).slice(0, CAP);
    return Object.fromEntries(rows);
  }

  return { VISIT_GAP, searchKey, open, touch, isNew, prune };
});
