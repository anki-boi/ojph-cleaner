/**
 * dashboard-cards.js — the applier half of the bridge to the sibling repo (onlinejobs.ph-suite).
 *
 * Asks the local dashboard how well your resume fits the listings on this page, and puts the answer on
 * the card as a link back to that job in the dashboard. The maths and the request shape live in
 * dashboard-fit.js; this file only reads cards, fetches, and stamps.
 *
 * Three rules it will not break:
 *
 *   1. **One request per page of cards, not per card.** The suite caps a batch at 50 listings; a board
 *      of 20 cards is one localhost call.
 *   2. **Silent when the dashboard is not running.** It is optional software on your own machine. A tab
 *      that cannot reach it stops asking for the rest of that page load — no badges, no errors, no
 *      retry storm.
 *   3. **Never invent a score.** No profile loaded, no description read, no dashboard: the card says
 *      nothing. A fit number this extension made up would be the one number on the board you cannot
 *      trust.
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage) return; // node: nothing to do
  const api = self.OJC, pure = self.OJCDashboard, records = self.OJCRecordsUI;
  if (!api || !pure) return;

  let dead = false;      // this page load: the dashboard did not answer; do not ask again
  let running = false;

  const titleOf = (card) => {
    const h = card.querySelector('dt h4');
    if (!h) return '';
    const hh = h.cloneNode(true);
    hh.querySelectorAll('[class*="badge"]').forEach((b) => b.remove());
    return pure.clean(hh.textContent);
  };

  /** What the dashboard can score: the card's own title and salary line, plus the description a deep
   *  scan (or opening the listing) actually read. A card nobody scanned has no description to send. */
  /** The listing's own skill tags: the detail page's if a scan read it, the card's otherwise. */
  const skillsOf = (card, detail) => {
    if (detail?.skills?.length) return detail.skills;
    const parse = self.OJCDetailParse;
    return [...card.querySelectorAll(parse?.CARD_SKILL_SEL || '.job-tag a')]
      .map((a) => pure.clean(a.textContent)).filter(Boolean).slice(0, pure.MAX_SKILLS);
  };

  const itemFor = (card) => {
    const detail = records?.detailFor?.(card) || null;
    return pure.fitItem({
      title: titleOf(card),
      salary: api.cardSalary(card),
      description: detail ? detail.description : '',
      workType: detail ? detail.typeOfWork : '',
      skills: skillsOf(card, detail),
    });
  };

  const jobIdOf = (card) => {
    const a = card.querySelector('a[href*="/jobseekers/job/"]');
    return a ? self.OJCClosed.jobIdFrom(a.getAttribute('href')) : null;
  };

  /** The badge is the link: one element, showing the suite's number and opening that job in it. */
  function stamp(card, result, base) {
    const cell = card.querySelector(api.SELECTORS.cardSalary) || card;
    let el = cell.querySelector('.ojc-fit');
    const b = pure.badge(result);
    if (!b) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('a');
      el.className = 'ojc-fit';
      el.target = '_blank';
      el.rel = 'noopener';
      const site = [...cell.childNodes].find((n) =>
        !(n.nodeType === 1 && typeof n.className === 'string' && n.className.startsWith('ojc-')));
      cell.insertBefore(el, site || null);
    }
    const href = pure.linkFor(base, jobIdOf(card));
    if (href) el.href = href; else el.removeAttribute('href');
    el.textContent = b.text;
    el.title = b.title;
    el.dataset.fit = String(b.fit);
  }

  async function annotate() {
    if (running || dead) return;
    const base = (api.getSettings() || {}).dashboardUrl ?? pure.DEFAULT_DASHBOARD;
    if (!pure.enabled(base)) return;
    const cards = api.cards().filter((c) => titleOf(c));
    if (!cards.length) return;
    running = true;
    try {
      // chunk() batches the CARDS, so a score can only ever land on the card it was asked for.
      for (const batch of pure.chunk(cards)) {
        const res = await fetch(`${String(base).replace(/\/+$/, '')}/api/resume/fit`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobs: batch.map(itemFor) }),
        });
        if (!res.ok) throw new Error(`dashboard answered ${res.status}`);
        const body = await res.json();
        const results = Array.isArray(body.results) ? body.results : [];
        // A different number of scores is a dashboard that changed the contract, not one that scored
        // these listings: stamp nothing rather than pair a score with the wrong card.
        if (results.length !== batch.length) {
          throw new Error('dashboard returned a different number of scores than it was sent');
        }
        batch.forEach((card, i) => stamp(card, results[i], base));
      }
    } catch {
      dead = true;   // not running, not reachable, or not speaking this contract: stay quiet
    } finally {
      running = false;
    }
  }

  self.OJCDashboardUI = { annotate, isDead: () => dead };
})();
