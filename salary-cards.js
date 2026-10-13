/**
 * salary-cards.js — the APPLIER: fetch the live rates, put a figure on every card, mark the goals.
 *
 * Split from salary.js (which holds the pure parser and is unit-tested) for two reasons: the maths stays
 * testable in node without a browser, and content.js's 300-line ceiling pushed the panel out already —
 * one file per job is the rule here. It reads `self.OJCSalary` (pure) and `self.OJC` (content.js's API).
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage) return; // node: nothing to do
  const api = self.OJC;
  if (!api) return;
  const { perHour, payLine } = self.OJCPerHour;
  const { parseSalary, toPhp, ratePhp, goalInPhp, meetsGoal, goalBand, hoursPerWeekFrom, pickFresh } = self.OJCSalary;

  const FX_URL = 'https://api.frankfurter.dev/v2/rates'; // ECB reference rates (v1 is deprecated)
  const FX_TTL_MS = 24 * 3600 * 1000;   // the server refreshes daily; older than this is not used
  const FX_RETRY_MS = 3600 * 1000;      // after a failure, wait before asking again

  let running = false, pending = false, rates = null, ratesAt = 0, fxDate = null;

  /** Live rates, cached in chrome.storage.local. Never stale, never approximated. */
  async function loadRates(currencies) {
    const want = [...new Set(currencies)].filter(c => c && c !== 'PHP');
    if (!want.length) return {};
    // The in-memory copy is valid only while IT is inside the TTL. A bare `if (rates) return rates`
    // served a dead rate to every tab left open past the 24-hour mark — the module's own contract is
    // "no rate is ever cached past 24h", and a long-lived search tab broke it silently.
    if (rates && Date.now() - ratesAt <= FX_TTL_MS && want.every(c => c in rates)) return rates;
    const store = (await chrome.storage.local.get('fx')).fx || { rates: {}, failed: {} };
    const now = Date.now();
    const { fresh, needed } = pickFresh(store, want, now, FX_TTL_MS, FX_RETRY_MS);
    // pickFresh reports { rate, date } rows; the map every consumer multiplies against is currency →
    // NUMBER. Spreading the rows in left objects in the map, and `x * {…}` is NaN — measured live: a
    // whole board of "≈ ₱NaN - ₱NaN/mo" cards the moment the store held a fresh rate.
    const out = {};
    for (const cur of Object.keys(fresh)) {
      out[cur] = fresh[cur].rate;
      fxDate = fresh[cur].date || fxDate;
    }
    for (const cur of needed) {
      try {
        const res = await fetch(`${FX_URL}?base=${encodeURIComponent(cur)}&quotes=PHP`);
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        const row = Array.isArray(body) ? body[0] : null;
        if (!row || !Number.isFinite(row.rate)) throw new Error('no usable rate in response');
        out[cur] = row.rate;
        fxDate = row.date;
        store.rates[cur] = { rate: row.rate, date: row.date, at: now };
        delete store.failed[cur];
      } catch {
        store.failed[cur] = now;         // don't hammer it; no rate means no converted figure
      }
    }
    if (needed.length) await chrome.storage.local.set({ fx: store });
    rates = out;
    ratesAt = now;
    return out;
  }

  const rawSalary = (card) => {
    const d = card.querySelector(api.SELECTORS.cardSalary);
    if (!d) return '';
    const own = d.cloneNode(true);
    // Everything we injected into the salary cell goes, whatever it is called: the figure, the h/week
    // disclaimer. Missing the warning here once made a second rule pass read "40 h/week" as a second
    // salary figure and show a range of ₱50,186 - ₱401,485/mo.
    for (const injected of own.querySelectorAll('[class^="ojc-"]')) injected.remove();
    return own.textContent.trim();
  };

  // The weekly-hours basis comes from the card's OWN words ("20 hours per week", "Part Time") — or, once a
  // deep scan has read the listing, from its structured HOURS PER WEEK (W13.5). That is what makes the month
  // honest instead of assumed.
  //
  // What this deliberately does NOT do is change which goal judges the card: a part-time listing still goes
  // to the **hourly** goal (D13), because lower pay for far fewer hours is the whole point of part-time —
  // someone taking 15 h/week can hold two of them. The month is shown, labelled "part-time month at 15 h/week",
  // and never confused with a full-time month.
  //
  // Not `card.textContent`: our disclaimer says "assumes 40 h/week (full time)", so a second pass would read
  // the assumption we just wrote as if the listing had stated it — the disclaimer would then drop itself and
  // the goal would flip from monthly to hourly.
  const basisOf = (card) => {
    const info = self.OJCRecordsUI?.hoursInfoFor?.(card);
    return info ? { hours: info.hours, basis: 'detail', type: info.type }
                : hoursPerWeekFrom(api.ownText(card));
  };

  /** Was this listing's own page read by a scan? Then the hours are stated, not assumed. */
  const PART_TIME_RE = /part[\s-]?time|gig/i;

  /**
   * The listing's own weekly hours, on the card (W13.6/W13.7). Only a scan — or opening the listing
   * yourself — can know these, so this element exists only on cards the extension has actually read, and it
   * disappears again when the record does.
   *
   * Three forms, deliberately different, because they mean different things:
   *
   *     ⏱ 40 h/week                                 a stated full-time week
   *     ⏱ part-time month at 15 h/week               a month that exists, but is not a full-time month
   *     ⚠ 45 h/week — over the 40 h full-time week   longer than full time, flagged automatically
   *
   * The part-time wording is the user's own distinction: ₱27,000 for a 15 h week is not half of ₱54,000 for
   * a 40 h week, it is a different job — and someone can hold two of them.
   */
  function hoursBadges() {
    const records = self.OJCRecordsUI;
    for (const card of api.cards()) {
      const cell = card.querySelector(api.SELECTORS.cardSalary) || card;
      let el = cell.querySelector('.ojc-hours');
      const info = records?.hoursInfoFor?.(card);
      if (!info) { if (el) el.remove(); continue; }
      if (!el) {
        el = document.createElement('div');
        el.className = 'ojc-hours';
        // Above the site's own posted figure, like the salary note: appended instead, it landed *below* the
        // site's salary line and read as the first line of the description. Find the cell's first node that
        // is not ours and put the hours in front of it.
        const site = [...cell.childNodes].find(n =>
          !(n.nodeType === 1 && typeof n.className === 'string' && n.className.startsWith('ojc-')));
        cell.insertBefore(el, site || null);
      }
      const part = PART_TIME_RE.test(info.type || '');
      const over = info.hours > 40;
      el.classList.toggle('ojc-hours-over', over);
      const M = self.OJCLabels.mark;
      el.textContent = over ? M.overHours(info.hours) : part ? M.partHours(info.hours) : M.hours(info.hours);
      el.title = over
        ? `the listing's own HOURS PER WEEK says ${info.hours} — more than a full-time week`
        : 'stated by the listing itself (HOURS PER WEEK), not an assumption';
    }
  }

  async function annotate() {
    // COALESCE, never drop. A plain `if (running) return` looks harmless and is not: the first call is
    // async (it awaits the live ECB rates), and every pass that happened while it was in flight — including
    // the ones that arrived WITH the scan's `HOURS PER WEEK` — was thrown away. A listing then kept the
    // figure computed before its own hours were known, until something unrelated re-ran the pass. Measured
    // live: ten cards showing a rate-only figure while the record and the cache both held their real hours.
    if (running) { pending = true; return; }
    running = true;
    try {
      do {
        pending = false;
        await annotateOnce();
      } while (pending);
    } finally {
      running = false;
    }
  }

  async function annotateOnce() {
      const cards = api.cards();
      const parsed = cards
        .map(c => [c, parseSalary(rawSalary(c), basisOf(c).hours), basisOf(c)])
        .filter(([, p]) => p);
      const settings = api.getSettings();
      const cur = settings.currency || 'PHP';
      const liveRates = await loadRates([...parsed.map(([, p]) => p.currency), cur, ...(Number(settings.lowballHourly) > 0 ? ['USD'] : [])]);
      // D66: shown in the chosen currency, judged in pesos. No rate for it → pesos, and the goals are off.
      const disp = cur !== 'PHP' && liveRates[cur] ? { code: cur, rate: liveRates[cur] } : null;
      // Two goals, because they judge different cards: a monthly goal can only be applied where a month
      // exists (a stated period, or hourly + stated hours), and an hourly goal only to a posted rate.
      // Neither is ever derived from the other — that would assume a work week, which is the one thing
      // this module refuses to do.
      const goalMonthly = goalInPhp(settings.goalSalary, cur, liveRates);
      const goalHourly = goalInPhp(settings.goalHourly, cur, liveRates);

      // Where the hours came from, in the listing's own terms. 'detail' is the strongest of the three: the
      // scan read the listing's structured HOURS PER WEEK, so the month rests on a stated number.
      const HOURS_SOURCE = {
        stated: 'as stated on the card',
        detail: "the listing's own HOURS PER WEEK",
        'full-time': 'full time — the post states no number of hours',
        'part-time': 'part time',
        unstated: 'hours not stated',
      };
      const partTimeMonth = (basis) => basis.basis === 'detail' && PART_TIME_RE.test(basis.type || '');
      const hoursLine = (p, basis) => (p.hours
        ? `, at ${p.hours} h/week (${HOURS_SOURCE[basis.basis] || basis.basis})` +
          (partTimeMonth(basis) ? ' — a part-time month, not a full-time one' : '')
        : '');
      // The listing's own marker, or an honest admission that the figure was read from its magnitude.
      const fxBit = (p) => `${p.currency} → PHP at ${liveRates[p.currency]} (ECB reference, ${fxDate})`;
      const currencyLine = (p) => (p.explicit ? fxBit(p)
        : `${fxBit(p)} — the listing states no currency, so the figure was read as ${p.currency} from its size`);

      // Set when a goal mark changes, because the rule pass reads those marks to decide the reconsider
      // state — and this pass runs *after* it. The marks are async (they wait on the live ECB rates), so
      // on a page's first pass nothing is marked yet, and a listing that is good only because it pays
      // well would be hidden instead of yellow. Measured live before the fix: 11 cards owed a yellow
      // outline, 9 got one.
      let goalMarksChanged = false;
      for (const [card, p, basis] of parsed) {
        const php = toPhp(p, liveRates);        // a month's pay, only when the hours are known
        const rate = php ? null : ratePhp(p, liveRates);   // the posted rate itself
        const d = card.querySelector(api.SELECTORS.cardSalary);
        if (!d) continue;
        let note = d.querySelector('.ojc-salary-note');
        if (!note) {
          note = document.createElement('span');
          note.className = 'ojc-salary-note';
          d.insertBefore(note, d.firstChild);   // above the posted figures, not after them
        }
        // D71: no month is ever built on an assumed 40 h week any more, so the old "if full-time (40 h/wk)"
        // warning has nothing left to warn about — one left over from an earlier pass goes.
        d.querySelector('.ojc-salary-warn')?.remove();
        note.dataset.hours = p.hours ? String(p.hours) : '';
        // Which hours the figure rests on, and where they came from — read by tools/verify-live.mjs so it
        // checks the FIGURE against the input the extension declares, instead of guessing the input from the
        // card's prose (a guess that produced seven phantom failures the moment a scanned listing's own
        // HOURS PER WEEK differed from what its preview text happened to say).
        note.dataset.basis = basis.basis;
        // D70: per hour first, the month small beside it. A gig's price is the job's, not an hour's.
        const gig = (p.unit !== 'hour' && p.unit !== 'hour?') &&
          self.OJCPerHour.isJobPrice(card.querySelector(api.SELECTORS.cardType)?.textContent || basis.type, rawSalary(card));
        const ph = gig ? null : perHour(p, liveRates, basis);   // shown first, and what the hourly goal judges
        // D71.1: a month with no hourly figure yet is one whose hours the post's own page may state — Read posts
        // opens these first (scan.js), so every card can be compared per hour.
        const read = !!self.OJCRecordsUI?.recordFor?.(card);
        card.classList.toggle('ojc-needs-hours', !!php && !ph && !gig && !read);
        const line = payLine({ php, rate, unit: p.unit, ph, gig, read }, disp);
        const sub = line.sub ? Object.assign(document.createElement('small'), { className: 'ojc-salary-sub', textContent: line.sub }) : null;
        note.replaceChildren(...(line.main ? [line.main] : []), ...(line.main && sub ? [' ', sub] : []));
        note.classList.toggle('is-unknown', line.main === self.OJCPerHour.UNKNOWN);   // "? /hr" reads as a gap, not a figure
        if (php) {
          note.title = (p.currency === 'PHP'
            ? (p.explicit ? 'listed in PHP' : 'no currency in the listing — read as pesos from the figure itself') +
              ` (${p.min}${p.max === p.min ? '' : ' - ' + p.max} per month as posted)`
            : currencyLine(p)) + hoursLine(p, basis);
        } else if (rate) {
          note.title = `${currencyLine(p)}, posted per ${p.unit === 'day' ? 'day' : 'hour'}` +
            ' — the listing does not say how many hours a week, so no monthly figure is claimed';
        } else {
          note.title = p.perUnit
            ? 'paid per unit as posted — a per-unit rate has no honest monthly equivalent'
            : p.unit === 'hour?'
              ? 'a bare number with no unit — not enough to compute anything'
              : `${p.currency} figure shown as posted — no live ${p.currency}→PHP rate, so nothing is converted`;
        }
        // The rate actually used, whichever figure is shown — so the tooltip and any audit of the maths
        // (tools/verify-live.mjs recomputes it) can see it. PHP has no rate entry; it is the identity.
        note.dataset.rate = liveRates[p.currency] ? String(liveRates[p.currency]) : '';

        // ONE goal per card, chosen by what the post actually says (D71, replacing D13's "Full Time → monthly",
        // which rested on a 40 h week): an hourly figure — a posted rate, or the month over the post's OWN hours —
        // meets the hourly goal; a month with no stated hours meets the monthly goal, month against month.
        // Neither goal is ever derived from the other: that would assume someone else's work week.
        const hourlyPhp = ph ? { min: ph.min, max: ph.max } : null;
        const judgedMonthly = !hourlyPhp;
        const aboveMonthly = judgedMonthly && meetsGoal(php, goalMonthly);
        const aboveHourly = !judgedMonthly && meetsGoal(hourlyPhp, goalHourly);
        const wasGoal = card.classList.contains('ojc-goal');
        card.classList.toggle('ojc-goal', aboveMonthly || aboveHourly);
        if (wasGoal !== card.classList.contains('ojc-goal')) goalMarksChanged = true;
        if (self.OJCLowballUI?.mark(card, p, basis, liveRates)) goalMarksChanged = true;   // the lowball line (D67)
        if (aboveMonthly) note.dataset.goal = 'monthly';
        else if (aboveHourly) note.dataset.goal = 'hourly';
        else delete note.dataset.goal;
        // The margin over the goal that judges the card, judged on the same low end — this is the fact the
        // super-green rule reads (tiers.js: pay ≥ 150 % of the goal). On the card, not the note, so the
        // board and the live harness read the same attribute.
        // One fact, two consumers: the fraction the pay clears the goal by (null when it clears none) —
        // tiers.js reads it for the super-green rule, and the note's band shows it (the premium bands).
        const by = aboveMonthly && goalMonthly > 0 ? (php.min - goalMonthly) / goalMonthly
                 : aboveHourly && goalHourly > 0 ? (hourlyPhp.min - goalHourly) / goalHourly : null;
        if (by == null) delete card.dataset.goalBy; else card.dataset.goalBy = String(by);
        note.dataset.band = goalBand(by);
        // The sort key (D41, D71.2): per hour whenever an hour exists — the board's one measure — else the month or
        // day figure, each ranked in its own block (pay-sort.js). The LOW end of a range, like every goal.
        const ranked = ph || php || rate;
        if (ranked) { card.dataset.ojcPay = String(ranked.min); card.dataset.ojcPayUnit = ph ? 'hour' : php ? 'month' : p.unit; }
        else { delete card.dataset.ojcPay; delete card.dataset.ojcPayUnit; }
      }
      // One extra rule pass, and only when a mark actually moved. The `annotate()` this re-enters
      // returns immediately on the `running` guard above, so it cannot loop — and by then the marks
      // match the data, so the pass after it finds nothing changed and stops there.
      if (goalMarksChanged) api.refreshRules();
      hoursBadges();   // the listing's own hours, once a scan has read the page (W13.6)
      self.OJCPaySort?.resort?.();   // D41: the figures above are current — the one safe moment to reorder
  }

  self.OJCSalaryUI = { annotate, loadRates };
})();
