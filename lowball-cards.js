/**
 * lowball-cards.js — the APPLIER for lowball.js (D67): marks the listings that pay at or below your line, paints
 * the black ⚫ Lowball tier, and reports them to OnlineJobs.ph as "Salary too low" when you say so.
 *
 * **The one place this extension writes to OnlineJobs.ph.** Everything else only reads. A report is the same
 * request the site's own REPORT button makes (POST /report-job/store, `type_id` 1, observed 2026-10-13), sent
 * from the signed-in tab, under the user's own account — so it is never sent without a click and a confirm,
 * one at a time with a gap, under a daily cap the user sets. A card's tag and the batch each ask once ("report
 * this for low salary?") before anything is sent. docs/scraping.md records the change.
 *
 * Three doors into the rest of the extension, none of which can change why a card got its tier:
 *   - `mark()`, called by salary-cards.js per card (it owns the parsed figure and the live rates), toggles
 *     `.ojc-low` — the input content.js reads, exactly like the goal mark `.ojc-goal`;
 *   - a card hook (after the verdict) for the tag that is also the one-click Report button, and the
 *     `⚫? checking hours` tag on a month the reader still has to open;
 *   - a bar action for "⚫ Report N lowball".
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage || typeof document === 'undefined') return;
  const api = self.OJC;
  if (!api) return;
  const LB = self.OJCLowball, L = self.OJCLabels;
  const JOB_LINK = 'a[href*="/jobseekers/job/"]';
  const GAP_MS = 3000;   // between two reports in a batch: a person clicking, not a script hammering

  let log = {};          // reportedJobs: { jobId: reportedAt }
  let busy = false;
  const sending = new Set();   // job ids with a report in flight

  const idOf = (card) => {
    const a = card.querySelector(JOB_LINK);
    return a ? self.OJClosed.jobIdFrom(a.getAttribute('href')) : null;
  };
  const isReported = (id) => !!id && id in log;
  const floor = () => Number(api.getSettings().lowballHourly) || 0;
  const signedIn = () => !!document.querySelector('a[href*="logout"]');

  // ── the mark ─────────────────────────────────────────────────────────────
  /** Decide one card. Returns true when the mark moved, so salary-cards.js asks for one more rule pass.
   *  `.ojc-low` is a verdict (the post's own rate, or its month over its own hours); `.ojc-low-check` is a month
   *  whose hours are not known yet but could make it one — the reader opens those first (scan.js). */
  function mark(card, parsed, basis, rates) {
    const hours = LB.hoursFor(basis);
    const rate = LB.hourlyUsd(parsed, hours, rates);
    const low = LB.isLowball(rate, floor());
    const check = !low && LB.isCandidate(parsed, hours, rates, floor());
    const was = card.classList.contains('ojc-low');
    card.classList.toggle('ojc-low', low);
    card.classList.toggle('ojc-low-check', check);
    if (low) card.dataset.ojcLowRate = String(Math.round(rate * 100) / 100);
    else delete card.dataset.ojcLowRate;
    // Only a month leans on the hours; a posted hourly rate is the rate whatever the week is.
    if (low && hours && parsed.unit !== 'hour' && parsed.unit !== 'hour?') card.dataset.ojcLowHours = String(hours);
    else delete card.dataset.ojcLowHours;
    return was !== low;
  }

  // ── the card hook ────────────────────────────────────────────────────────
  /** The tag IS the button (the user: "turn that into a button that automatically reports"): a click asks once,
   *  then files the report, and the tag turns into `⚫ reported`. Kept
   *  across passes, because a pass that replaced it between mousedown and mouseup would lose the click. */
  function tagFor(card, box) {
    let tag = box.querySelector('.ojc-low-badge');
    if (!tag) {
      tag = document.createElement('button');
      tag.type = 'button';
      tag.className = 'ojc-low-badge';
      tag.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();   // the site's card navigates on click
        reportOne(card, tag);
      });
    }
    if (box.firstChild !== tag) box.prepend(tag);
    return tag;
  }

  function decorate(card, { tier, box, counts }) {
    nudgeSoon();   // debounced: one look at the whole board after the pass settles
    box.querySelector('.ojc-low-check-badge')?.remove();
    if (tier !== 'low') {
      box.querySelector('.ojc-low-badge')?.remove();
      if (!card.hidden && card.classList.contains('ojc-low-check')) {
        const b = document.createElement('span');
        b.className = 'ojc-low-check-badge';
        b.textContent = L.low.check;
        b.title = L.low.checkTip(LB.dollars(floor()));
        box.prepend(b);
      }
      return;
    }
    counts.low = (counts.low || 0) + 1;
    const id = idOf(card);
    const tag = tagFor(card, box);
    if (sending.has(id)) return;   // "reporting…" until the answer comes back
    const rate = LB.dollars(Number(card.dataset.ojcLowRate));
    const done = isReported(id);
    tag.disabled = done || busy;
    tag.classList.toggle('is-done', done);
    tag.textContent = done ? L.low.reported : L.low.badge(rate);
    tag.title = done ? L.low.reportedTip : L.low.badgeTip(rate, LB.dollars(floor()), card.dataset.ojcLowHours);
  }

  // ── leading people into reporting: the glow and the one prompt ─────────────
  let nudgeTimer = 0;
  const NUDGE_KEY = () => 'ojc-low-nudged:' + location.pathname + location.search;
  function nudgeSoon() {
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => {
      const n = openCards().length;
      // The pill and the bar button pulse while anything is left to report, and go still when it is all done.
      document.querySelector('#ojc-chip .ojc-view-low')?.classList.toggle('ojc-glow', n > 0);
      document.getElementById('ojc-report-low')?.classList.toggle('ojc-glow', n > 0);
      let seen = false;
      try { seen = sessionStorage.getItem(NUDGE_KEY()) === '1'; } catch { /* storage blocked: prompt anyway */ }
      if (!n || busy || seen || self.OJCScan?.isRunning?.()) return;
      try { sessionStorage.setItem(NUDGE_KEY(), '1'); } catch { /* once per page load, then */ }
      self.OJCToast?.show(L.low.nudge(n), { action: { label: L.low.nudgeBtn, run: reportAll }, ms: 20000 });
    }, 1500);
  }

  // ── sending ──────────────────────────────────────────────────────────────
  /** One report. Resolves to null on success, or a reason it was not sent. */
  async function send(id, rateUsd) {
    if (!signedIn()) return L.low.signedOut;
    let res;
    try {
      res = await fetch(new URL('/report-job/store', location.origin), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams({ job_id: id, type_id: String(LB.REPORT_TYPE_SALARY), reason: LB.reportReason(rateUsd, floor()) }),
      });
    } catch { return 'no connection'; }
    if (res.redirected) return L.low.signedOut;   // a session that expired is sent to the login page
    if (!res.ok) return `the site answered ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.success === false) return body.message || 'the site refused it';
    } catch { /* a 2xx without JSON is what the site's own button treats as success too */ }
    return null;
  }

  async function remember(id) {
    log = LB.prune({ ...log, [id]: Date.now() }, Date.now());
    await chrome.storage.local.set({ reportedJobs: log });
  }

  /** The reports the cap still allows, or null after saying why there are none. */
  function allowance() {
    const cap = Number(api.getSettings().reportDailyCap) || 0;
    if (cap <= 0) { self.OJCToast?.show(L.low.off); return null; }
    const left = LB.remainingToday(log, Date.now(), cap);
    if (!left) { self.OJCToast?.show(L.low.capped(cap)); return null; }
    return left;
  }

  /** One listing: the tag asks "report this for low salary?" first (the user: "when I click the black button, it
   *  prompts me if we should report"), then sends at once. */
  async function reportOne(card, tag) {
    const id = idOf(card);
    if (busy || !id || isReported(id) || sending.has(id) || !allowance()) return;
    const rate = Number(card.dataset.ojcLowRate);
    if (!confirm(L.low.confirmOne(LB.dollars(rate), card.dataset.ojcLowHours, LB.dollars(floor())))) return;
    sending.add(id);
    tag.disabled = true;
    tag.textContent = L.low.sending;
    try {
      const why = await send(id, rate);
      if (why) { self.OJCToast?.show(L.low.failed(why)); return; }
      await remember(id);
      self.OJCToast?.show(L.low.done(1));
    } finally { sending.delete(id); api.refreshRules(); }
  }

  /** Every lowball card on the board that has not been reported yet. */
  const openCards = () => api.cards().filter(c => api.tierOf(c) === 'low' && !isReported(idOf(c)));

  async function reportAll() {
    if (busy) return;
    const list = openCards();
    const left = list.length ? allowance() : null;
    if (!left) return;
    if (!confirm(L.low.confirm(list.length, LB.dollars(floor()), left))) return;
    busy = true;
    let sent = 0;
    try {
      for (const card of list.slice(0, left)) {
        const id = idOf(card);
        if (!id || isReported(id) || sending.has(id)) continue;
        if (sent) await new Promise(r => setTimeout(r, GAP_MS));
        api.setNote(L.low.progress(sent + 1, Math.min(list.length, left)));
        const why = await send(id, Number(card.dataset.ojcLowRate));
        if (why) { self.OJCToast?.show(L.low.failed(why)); break; }   // stop on the first refusal, never retry
        await remember(id);
        sent++;
        api.refreshRules();
      }
    } finally {
      busy = false;
      api.setNote('');
      if (sent) self.OJCToast?.show(L.low.done(sent));
      api.refreshRules();
    }
  }

  self.OJCChip?.addAction({
    id: 'ojc-report-low', order: 5,
    text: () => L.low.bulk(openCards().length),
    title: L.low.bulkTip,
    hidden: () => busy || !openCards().length,
    onClick: reportAll,
  });
  api.addCardHook(decorate);

  chrome.storage.local.get('reportedJobs', (res) => {
    log = LB.prune(res.reportedJobs, Date.now());
    api.refreshRules();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.reportedJobs) { log = changes.reportedJobs.newValue || {}; api.refreshRules(); }
  });

  self.OJCLowballUI = { mark, isReported };
})();
