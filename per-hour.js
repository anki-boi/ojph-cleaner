/**
 * per-hour.js — every figure normalized per hour (D70). The user: "Everything must have normalization by hour …
 * hourly rate is primarily what is being shown, and then beside it on a smaller font, put the monthly rate."
 *
 * Pure and UMD, beside salary.js (whose parser and converter it uses): salary-cards.js draws the card's pay line
 * from `payLine`, detail.js the listing page's figures bar, and test-salary.js pins both.
 *
 * A posted rate is itself. A month is divided by the post's OWN weekly hours × 4 — never anything else (D71, the
 * user: "the hourly salary MUST BASE ON SALARY DIVIDED BY ACTUAL HOURS"). The "Full Time" label is not a number,
 * so a month without stated hours has no hourly figure. Nor does a per-unit rate, a day rate, a gig's one-off
 * price, or a figure with no live exchange rate.
 */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./salary.js') : root.OJCSalary);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCPerHour = api;
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';
  const WEEKS = 4;   // a month is 4 weeks when it becomes an hour — the same 160 h the parser uses

  /** { min, max } pesos per hour, plus where the hours came from — or null when no honest hour exists.
   *  `basis` is hoursPerWeekFrom()'s { hours, basis }, or the scan's { hours, basis: 'detail' }. */
  function perHour(parsed, rates, basis) {
    if (!parsed || parsed.perUnit) return null;
    if (parsed.unit === 'hour' || parsed.unit === 'hour?') {
      const r = S.convert(parsed.raw || parsed, parsed.currency, rates);
      return r ? { min: r.min, max: r.max, hours: null, posted: true } : null;
    }
    if (parsed.unit === 'day' || !parsed.monthly) return null;
    const hours = basis && (basis.basis === 'detail' || basis.basis === 'stated') && Number(basis.hours) > 0
      ? Number(basis.hours) : null;
    if (!hours) return null;   // no stated hours, no hour — never a 40 h week
    const m = S.convert({ min: parsed.min, max: parsed.max }, parsed.currency, rates);
    if (!m) return null;
    return { min: m.min / (hours * WEEKS), max: m.max / (hours * WEEKS), hours, posted: false };
  }

  /**
   * A price for the whole job, which has no hour: pay quoted per project/task ("$300 per project", "200.00 for the
   * Gig"), or a Gig whose pay states no period. A Gig that says "/ month" is a monthly rate like any other and is
   * shown per hour. (lowball.js is stricter — it skips every gig, the user's call for reporting.)
   */
  const PER_JOB = /\bper (?:project|task|job)\b|\bfor the (?:gig|project|job|task)\b|\bfixed[- ](?:price|rate|fee)\b|\/(?:project|gig)\b/i;
  const PERIOD = /month|\/m\b|\/mo\b|week|year|annual|hour|\/hr\b|\bhr\b|day/i;
  const isJobPrice = (type, text) => PER_JOB.test(String(text || '')) ||
    (/\bgig\b/i.test(String(type || '')) && !PERIOD.test(String(text || '')));

  /** "≈ ₱157/hr" — whole pesos, dollars with cents (salary.js's own formatter). */
  const formatHour = (ph, disp) => (ph ? S.formatRate(ph, 'hour', disp) : null);
  const UNKNOWN = '? /hr';   // the hourly slot, when no hour can be known yet — never filled with a month

  /**
   * The card's pay line, { main, sub }: the big figure and the small one beside it. Per hour first whenever an
   * hour exists; the month moves into `sub` with the post's own hours it rests on.
   */
  function payLine({ php, rate, unit, ph, gig, read = false }, disp) {
    // D71.2 — the user: "hourly rate [is] the whole bible … It has to be the very first thing seen. Not the monthly
    // rate." So the big slot is ALWAYS per hour: the figure when one exists, and `? /hr` when it does not, with the
    // month (or day, or job price) small beside it and the reason no hour exists yet.
    if (ph) {
      const month = php ? S.formatNote(php, disp) : '';
      const hrs = ph.posted ? '' : ` · ${ph.hours} h/wk`;
      return { main: formatHour(ph, disp), sub: month ? month + hrs : '' };
    }
    const why = read ? 'the post states no hours' : 'hours not read yet — Read posts gets them';
    if (gig && php) return { main: UNKNOWN, sub: `${S.formatNote(php, disp).replace(/\/mo$/, ' for the job')} · a one-off price` };
    if (php) return { main: UNKNOWN, sub: `${S.formatNote(php, disp)} · ${why}` };
    if (rate) return { main: UNKNOWN, sub: `${S.formatRate(rate, unit, disp)} · ${unit === 'day' ? 'hours per day not stated' : why}` };
    return { main: '', sub: '' };
  }

  return { perHour, formatHour, payLine, isJobPrice, UNKNOWN };
});
