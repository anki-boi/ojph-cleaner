/**
 * trust.js — the three trust tags on a card (spec.md W22): ⚠ risky N (D58), 🔁 posted N× in 30 days (D57), and
 * the post's hours in your time (D59). All three are TAGS: they never hide a listing and never move its tier.
 *
 * A card hook (content.js runs it after the verdict), so it reads what the pass already decided and only paints.
 * The "always hiring" memory is `chrome.storage.local.sightings = { "<company>|<title>": { "<jobId>": at } }`,
 * fed by every card the board shows you, pruned at 30 days — a re-post is only visible across visits.
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage || typeof document === 'undefined') return;
  const api = self.OJC;
  if (!api) return;
  const R = self.OJCRisk, SC = self.OJCSchedule;
  const WINDOW = 30 * 864e5, AGAIN = 3;
  const viewerZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();

  let sightings = {}, dirty = false, median = 0, medianAt = 0;

  const own = (el) => { if (!el) return ''; const o = el.cloneNode(true); o.querySelectorAll('[class^="ojc-"], [class*="badge"]').forEach(x => x.remove()); return o.textContent.replace(/\s+/g, ' ').trim(); };
  const companyOf = (card) => { const p = own(card.querySelector(api.SELECTORS.cardPosted)).split(/[•·]/); return p.length > 1 ? p[0].trim() : ''; };
  const titleKey = (card) => own(card.querySelector('dt h4')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const idOf = (card) => self.OJCRecordsUI?.idOf?.(card) || self.OJCTriage?.idOf?.(card) || null;

  /** The board's median monthly figure, recomputed at most once a second — the "too good" signal's yardstick. */
  function boardMedian(now) {
    if (now - medianAt < 1000) return median;
    medianAt = now;
    median = R.median(api.cards().filter(c => c.dataset.ojcPayUnit === 'month').map(c => Number(c.dataset.ojcPay)));
    return median;
  }

  function tag(box, cls, text, title) {
    const b = document.createElement('span');
    b.className = cls;
    b.textContent = text;
    b.title = title;
    box.appendChild(b);
  }

  function decorate(card, { box, now }) {
    box.querySelectorAll(':scope > .ojc-risk, :scope > .ojc-again, :scope > .ojc-sched').forEach(b => b.remove());
    const id = idOf(card), company = companyOf(card);
    // Sightings: every listed card counts, hidden or not — a re-post is a fact about the employer.
    const key = company && titleKey(card) ? `${company.toLowerCase()}|${titleKey(card)}` : null;
    if (key && id && !sightings[key]?.[id]) { sightings[key] = { ...(sightings[key] || {}), [id]: now }; dirty = true; }
    if (card.hidden) return;

    const desc = id ? self.OJCRecordsUI?.textFor?.(id) || '' : '';
    const text = `${api.ownText(card)}\n${desc}`;
    const r = R.score({ text, flags: self.OJCRecordsUI?.detailFor?.(card)?.flags || [], company,
      pay: card.dataset.ojcPayUnit === 'month' ? Number(card.dataset.ojcPay) : 0, median: boardMedian(now) });
    if (r.tagged) tag(box, 'ojc-risk', `⚠ risky ${r.score}`, 'Why: ' + r.reasons.map(x => `${x.why} (+${x.points})`).join('; ') +
      ' — a warning to read carefully, not a verdict. Nothing is hidden for it.');

    const seen = key ? Object.values(sightings[key] || {}).filter(t => now - t <= WINDOW).length : 0;
    if (seen >= AGAIN) tag(box, 'ojc-again', `🔁 posted ${seen}× in 30 days`, `${company} has posted this same title under ${seen} different listings in the last 30 days — always hiring can mean high turnover`);

    const found = SC.find(text);
    if (found) {
      const conv = SC.convert(found, viewerZone, new Date(now));
      const mine = SC.parseHours(api.getSettings().myHours);
      if (!conv.same || mine) {
        const f = mine ? SC.fit(conv, mine) : null;
        const mark = f === 'all' ? ' ✅' : f === 'some' ? ' ⚠' : f === 'none' ? ' ✗' : '';
        tag(box, 'ojc-sched', `${conv.night ? '🌙' : '🕘'} ${conv.text} your time${mark}`,
          `The post says "${found.raw}" in ${found.zone.replace(/_/g, ' ')}; that is ${conv.text} where you are (${viewerZone.replace(/_/g, ' ')}), today's daylight saving included.` +
          (f ? ` ${f === 'all' ? 'All of it is' : f === 'some' ? 'Only part of it is' : 'None of it is'} inside your working hours.` : ''));
      }
    }
  }
  api.addCardHook(decorate);

  // The sightings are written in the background, at most every few seconds, and only when a new one appeared.
  setInterval(() => {
    if (!dirty) return;
    dirty = false;
    const now = Date.now();
    const next = {};
    for (const [k, ids] of Object.entries(sightings)) {
      const kept = Object.fromEntries(Object.entries(ids).filter(([, t]) => now - t <= WINDOW));
      if (Object.keys(kept).length) next[k] = kept;
    }
    const keys = Object.keys(next);
    if (keys.length > 4000) for (const k of keys.slice(0, keys.length - 4000)) delete next[k];
    sightings = next;
    chrome.storage.local.set({ sightings });
  }, 3000);

  chrome.storage.local.get('sightings', (r) => { sightings = { ...(r.sightings || {}), ...sightings }; api.refreshRules(); });
})();
