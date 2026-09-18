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
  const { parseSalary, toPhp, ratePhp, formatNote, formatRate, meetsGoal, hoursPerWeekFrom } = self.OJCSalary;

  const FX_URL = 'https://api.frankfurter.dev/v2/rates'; // ECB reference rates (v1 is deprecated)
  const FX_TTL_MS = 24 * 3600 * 1000;   // the server refreshes daily; older than this is not used
  const FX_RETRY_MS = 3600 * 1000;      // after a failure, wait before asking again

  let running = false, rates = null, fxDate = null;

  /** Live rates, cached in chrome.storage.local. Never stale, never approximated. */
  async function loadRates(currencies) {
    const want = [...new Set(currencies)].filter(c => c && c !== 'PHP');
    if (!want.length) return {};
    if (rates) return rates;
    const store = (await chrome.storage.local.get('fx')).fx || { rates: {}, failed: {} };
    const now = Date.now();
    const out = {}, needed = [];
    for (const cur of want) {
      const hit = store.rates[cur];
      if (hit && now - hit.at <= FX_TTL_MS) { out[cur] = hit.rate; fxDate = hit.date; }
      else if (!(store.failed[cur] && now - store.failed[cur] < FX_RETRY_MS)) needed.push(cur);
    }
    for (const cur of needed) {
      try {
        const res = await fetch(`${FX_URL}?base=${encodeURIComponent(cur)}&quotes=PHP`);
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        const row = Array.isArray(body) ? body[0] : null;
        if (!row || !row.rate) throw new Error('no rate in response');
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

  // The weekly-hours basis comes from the card's OWN words ("20 hours per week", "Part Time").
  // Not `card.textContent`: our disclaimer says "assumes 40 h/week (full time)", so a second pass would
  // read the assumption we just wrote as if the listing had stated it — the disclaimer would then drop
  // itself (basis 'stated' is not 'full-time') and the goal would flip from monthly to hourly. It only
  // survived because "40 h/week" happens not to match the stated-hours pattern; one word of rewording
  // away from a silent, self-erasing card.
  const basisOf = (card) => hoursPerWeekFrom(api.ownText(card));

  async function annotate() {
    if (running || !chrome.storage) return;
    running = true;
    try {
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

      const hoursLine = (p, basis) => (p.hours
        ? `, at ${p.hours} h/week (${basis.basis === 'stated' ? 'as stated'
            : basis.basis + ' listing — an assumption, verify with the employer'})`
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
        const judgedMonthly = basis.basis === 'full-time' || !hourlyPhp;
        const aboveMonthly = judgedMonthly && meetsGoal(php, goalMonthly);
        const aboveHourly = !judgedMonthly && meetsGoal(hourlyPhp, goalHourly);
        const wasGoal = card.classList.contains('ojc-goal');
        card.classList.toggle('ojc-goal', aboveMonthly || aboveHourly);
        if (wasGoal !== card.classList.contains('ojc-goal')) goalMarksChanged = true;
        if (aboveMonthly) note.dataset.goal = 'monthly';
        else if (aboveHourly) note.dataset.goal = 'hourly';
        else delete note.dataset.goal;
      }
      // One extra rule pass, and only when a mark actually moved. The `annotate()` this re-enters
      // returns immediately on the `running` guard above, so it cannot loop — and by then the marks
      // match the data, so the pass after it finds nothing changed and stops there.
      if (goalMarksChanged) api.refreshRules();
    } finally {
      running = false;
    }
  }

  self.OJCSalaryUI = { annotate, loadRates };
})();
