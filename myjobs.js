/**
 * myjobs.js — what YOU decided about a listing (spec.md D51, D56, D64): saved, applied, interview, offer, passed.
 *
 * Kept apart from `jobRecords` on purpose: those are the extension's verdicts, re-derived and rewritten on every
 * scan, and a re-derivation must never be able to overwrite a decision a person made. Kept apart from `settings`
 * for the reason Appendix C gives: the panel's Save writes the whole settings object, and a key in there is a key
 * a Save can drop.
 *
 *   chrome.storage.local.myJobs = { "<jobId>": { state, at, history: [{ state, at }], title, company, url, pay, note } }
 *
 * Pure: every function takes the map and returns a NEW map, so Undo can keep the old one (D48).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCMyJobsPure = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const STATES = ['saved', 'applied', 'interview', 'offer', 'passed'];
  const DAY = 24 * 3600 * 1000;
  const FOLLOW_UP_DAYS = 5;          // D56: an application with no reply for this long gets a nudge
  const KEEP_DAYS = 365, CAP = 3000; // a year of job hunting, and a hard cap so storage stays small

  /** Move a listing to `state` (or clear it with null). Facts about the listing (title, pay…) merge in. */
  function set(map, id, state, now, facts = {}) {
    const next = { ...(map || {}) };
    if (!id) return next;
    if (state == null) { delete next[id]; return next; }
    if (!STATES.includes(state)) throw new Error('unknown state ' + state);
    const prev = next[id];
    const keep = {};
    // `sig` is the listing's terms (suggest.js) — what D53 counts; without it a pass teaches nothing.
    for (const k of ['title', 'company', 'url', 'pay', 'note', 'sig']) {
      const v = facts[k] ?? prev?.[k];
      if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) keep[k] = v;
    }
    const history = [...(prev?.history || [])];
    if (!prev || prev.state !== state) history.push({ state, at: now });
    next[id] = { ...keep, state, at: prev && prev.state === state ? prev.at : now, history: history.slice(-20) };
    return next;
  }

  /** A note is not a move: it changes nothing else, and an empty note removes the field. */
  function note(map, id, text) {
    if (!map?.[id]) return { ...(map || {}) };
    const e = { ...map[id] };
    if (text && String(text).trim()) e.note = String(text).trim(); else delete e.note;
    return { ...map, [id]: e };
  }

  const stateOf = (map, id) => (map && id && map[id] ? map[id].state : null);
  const isPassed = (map, id) => stateOf(map, id) === 'passed';

  function counts(map) {
    const c = Object.fromEntries(STATES.map(s => [s, 0]));
    for (const e of Object.values(map || {})) if (c[e.state] !== undefined) c[e.state]++;
    return c;
  }

  /** Applied, and nothing has happened for FOLLOW_UP_DAYS: worth a follow-up message. */
  const needsFollowUp = (e, now) => !!e && e.state === 'applied' && now - e.at >= FOLLOW_UP_DAYS * DAY;

  /** Oldest out first, past a year or past the cap — except anything still in play (applied/interview/offer). */
  function prune(map, now) {
    const live = new Set(['applied', 'interview', 'offer']);
    let rows = Object.entries(map || {}).filter(([, e]) => live.has(e.state) || now - e.at <= KEEP_DAYS * DAY);
    if (rows.length > CAP) rows = rows.sort((a, b) => b[1].at - a[1].at).slice(0, CAP);
    return Object.fromEntries(rows);
  }

  /**
   * The streak (D64), from the applied moves in every history: how many days in a row, ending today or
   * yesterday, had at least one application, and how many applications this week (Monday-based). Days are
   * the viewer's local days — `dayKey` is injected so the test can pin a timezone.
   */
  const localDay = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  function streak(map, now, dayKey = localDay) {
    const applied = [];
    for (const e of Object.values(map || {})) for (const h of e.history || []) if (h.state === 'applied') applied.push(h.at);
    const days = new Set(applied.map(dayKey));
    let run = 0;
    let t = now;
    if (!days.has(dayKey(t))) t -= DAY;            // today not done yet: a streak through yesterday still counts
    while (days.has(dayKey(t))) { run++; t -= DAY; }
    const d = new Date(now);
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
    const week = applied.filter(a => a >= monday && a <= now).length;
    return { days: run, week };
  }

  return { STATES, FOLLOW_UP_DAYS, set, note, stateOf, isPassed, counts, needsFollowUp, prune, streak, localDay };
});
