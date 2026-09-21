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
  const { parseSalary, toPhp, ratePhp, formatNote, formatRate, meetsGoal, goalBand, hoursPerWeekFrom, pickFresh } = self.OJCSalary;

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
      el.textContent = over ? `⚠ ${info.hours} h/week — over the 40 h full-time week`
        : part ? `⏱ part-time month at ${info.hours} h/week`
        : `⏱ ${info.hours} h/week`;
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
      const liveRates = await loadRates(parsed.map(([, p]) => p.currency));
      const settings = api.getSettings();
      // Two goals, because they judge different cards: a monthly goal can only be applied where a month
      // exists (a stated period, or hourly + stated hours), and an hourly goal only to a posted rate.
      // Neither is ever derived from the other — that would assume a work week, which is the one thing
      // this module refuses to do.
      const goalMonthly = Number(settings.goalSalary) || 0;
      const goalHourly = Number(settings.goalHourly) || 0;

      // Where the hours came from, in the listing's own terms. 'detail' is the strongest of the three: the
      // scan read the listing's structured HOURS PER WEEK, so the month rests on a stated number.
      const HOURS_SOURCE = {
        stated: 'as stated on the card',
        detail: "the listing's own HOURS PER WEEK",
        'full-time': 'full time — an assumption, verify with the employer',
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
        // A month built from an hourly rate under the full-time definition rests on a 40 h/week
        // assumption, so the card says so instead of presenting it as fact (the user's rule: do not
        // trust the monthly blindly). A month from a stated period, or from stated hours, needs no
        // warning — neither of those is an assumption.
        const assumedWeek = !!php && (p.unit === 'hour' || p.unit === 'hour?') && basis.basis === 'full-time';
        let warn = d.querySelector('.ojc-salary-warn');
        if (assumedWeek) {
          if (!warn) {
            warn = document.createElement('em');
            warn.className = 'ojc-salary-warn';
            note.after(warn);
          }
          warn.textContent = `assumes ${p.hours} h/week (full time) — verify with the employer`;
        } else if (warn) {
          warn.remove();
        }
        note.dataset.hours = p.hours ? String(p.hours) : '';
        // Which hours the figure rests on, and where they came from — read by tools/verify-live.mjs so it
        // checks the FIGURE against the input the extension declares, instead of guessing the input from the
        // card's prose (a guess that produced seven phantom failures the moment a scanned listing's own
        // HOURS PER WEEK differed from what its preview text happened to say).
        note.dataset.basis = basis.basis;
        if (php) {
          note.textContent = formatNote(php);
          note.title = (p.currency === 'PHP'
            ? (p.explicit ? 'listed in PHP' : 'no currency in the listing — read as pesos from the figure itself') +
              ` (${p.min}${p.max === p.min ? '' : ' - ' + p.max} per month as posted)`
            : currencyLine(p)) + hoursLine(p, basis);
        } else if (rate) {
          note.textContent = formatRate(rate, p.unit);
          note.title = `${currencyLine(p)}, posted per ${p.unit === 'day' ? 'day' : 'hour'}` +
            ' — the listing does not say how many hours a week, so no monthly figure is claimed';
        } else {
          note.textContent = '';
          note.title = p.perUnit
            ? 'paid per unit as posted — a per-unit rate has no honest monthly equivalent'
            : p.unit === 'hour?'
              ? 'a bare number with no unit — not enough to compute anything'
              : `${p.currency} figure shown as posted — no live ${p.currency}→PHP rate, so nothing is converted`;
        }
        // The rate actually used, whichever figure is shown — so the tooltip and any audit of the maths
        // (tools/verify-live.mjs recomputes it) can see it. PHP has no rate entry; it is the identity.
        note.dataset.rate = liveRates[p.currency] ? String(liveRates[p.currency]) : '';

        // ONE goal per card (spec.md D13), chosen by employment type:
        //   Full Time            → the monthly goal (40 h/week is what full time means, so a month exists)
        //   Part Time / other    → the hourly goal, using the posted rate
        //   a month-only posting → the monthly goal, because there is no rate to compare against
        // Neither goal is ever derived from the other: deriving one would assume someone else's work week.
        const hourlyPhp = (p.unit === 'hour' || p.unit === 'hour?') ? ratePhp(p, liveRates) : null;
        // One goal per card (D13): a full-time listing is judged on a month, a part-time or unspecified one on
        // the posted rate. A month a scan made honest does NOT move a part-timer to the monthly goal — lower
        // pay for far fewer hours is what part-time means, and 15 h/week can be two jobs.
        const judgedMonthly = basis.basis === 'full-time' || !hourlyPhp;
        const aboveMonthly = judgedMonthly && meetsGoal(php, goalMonthly);
        const aboveHourly = !judgedMonthly && meetsGoal(hourlyPhp, goalHourly);
        const wasGoal = card.classList.contains('ojc-goal');
        card.classList.toggle('ojc-goal', aboveMonthly || aboveHourly);
        if (wasGoal !== card.classList.contains('ojc-goal')) goalMarksChanged = true;
        if (aboveMonthly) note.dataset.goal = 'monthly';
        else if (aboveHourly) note.dataset.goal = 'hourly';
        else delete note.dataset.goal;
        // The margin over the goal that judges the card, judged on the same low end — this is the fact the
        // super-green rule reads (tiers.js: pay ≥ 150 % of the goal). On the card, not the note, so the
        // board and the live harness read the same attribute.
        // One fact, two consumers: the fraction the pay clears the goal by (null when it clears none) —
        // tiers.js reads it for the super-green rule, and the note's band shows it (the premium bands).
        const by = aboveMonthly && goalMonthly > 0 ? (php.min - goalMonthly) / goalMonthly
                 : aboveHourly && goalHourly > 0 ? (hourlyPhp - goalHourly) / goalHourly : null;
        if (by == null) delete card.dataset.goalBy; else card.dataset.goalBy = String(by);
        note.dataset.band = goalBand(by);
      }
      // One extra rule pass, and only when a mark actually moved. The `annotate()` this re-enters
      // returns immediately on the `running` guard above, so it cannot loop — and by then the marks
      // match the data, so the pass after it finds nothing changed and stops there.
      if (goalMarksChanged) api.refreshRules();
      hoursBadges();   // the listing's own hours, once a scan has read the page (W13.6)
  }

  self.OJCSalaryUI = { annotate, loadRates };
})();
