/**
 * lowball.js — which listings pay less than a fair floor, and the bookkeeping for reporting them.
 *
 * Pure and UMD: no DOM, no storage, no network, so `node test-lowball.js` pins every branch offline.
 * The applier is lowball-cards.js.
 *
 * **A false report is the costly mistake here**, so every rounding goes the employer's way:
 *
 *   - The HIGH end of a range is judged, never the low end (the opposite of a minimum-pay goal): "$2-4/hr"
 *     might pay $4, so it is not a lowball at a $2.99 floor.
 *   - The line is per hour, strictly, so a month is turned into an hourly rate — but ONLY with the hours the
 *     post itself gives: its own HOURS PER WEEK (read from the listing's page) or a number of hours in its
 *     text. Never the "Full Time" label and never an assumed week. The user, after seeing "$400/month" flagged
 *     on a guessed 40 h: "let's never base it off face value. We really have to check the hours." $320/mo is
 *     $2/hr at 40 h and $8/hr at 10 h, so a month without its hours is not a verdict.
 *   - Such a month is a CANDIDATE when it would be a lowball at up to 60 h/week: the reader opens those
 *     listings first to fetch their hours (scan.js), and only then can one turn black.
 *   - A month is 4 weeks (160 h at full time), the same convention salary.js uses. 4.33 weeks would make
 *     every monthly rate look ~8 % worse; 4 keeps the benefit of the doubt with the employer.
 *   - Gigs and whole-job prices ("200.00 for the Gig", "$300 per project"), day rates, per-unit rates and
 *     figures with no live exchange rate are never judged.
 *
 * The floor is in US dollars per hour, whatever currency the board is shown in: it is the unit the
 * community argues about ("anything under $3/hr"), and it must not move when the peso does.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.OJCLowball = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** OnlineJobs.ph's own report reason "Salary too low" (GET /report-types, observed 2026-10-13). */
  const REPORT_TYPE_SALARY = 1;
  const WEEKS_PER_MONTH = 4;
  const MIN_PLAUSIBLE_USD = 0.2;  // below this an hourly rate is a misread figure ("PHP 20.000/m" = ₱20), not an offer
  const CANDIDATE_HOURS = 60;   // the longest week a month is checked against before its real hours are read
  const VERIFIED = new Set(['detail', 'stated']);   // salary.js bases that come from the post's own number
  const DAY_MS = 24 * 3600 * 1000;
  const KEEP_MS = 180 * DAY_MS;   // how long a "reported" mark is remembered, like the closed memory

  /** An amount in `currency` → US dollars. `rates` maps currency → pesos per unit (salary-cards' map). */
  function toUsd(amount, currency, rates) {
    if (!Number.isFinite(amount)) return null;
    if (currency === 'USD') return amount;
    const usd = rates && rates.USD;
    if (!(usd > 0)) return null;
    const php = currency === 'PHP' ? amount : (rates[currency] > 0 ? amount * rates[currency] : null);
    return php == null ? null : php / usd;
  }

  /**
   * The best hourly rate a parsed salary could mean, in USD — or null when it cannot honestly be said.
   * `parsed` is salary.js's parseSalary() result; `hours` is the weekly hours the card's basis knows (or null).
   */
  const plausible = (usd) => (usd == null || usd < MIN_PLAUSIBLE_USD ? null : usd);
  function hourlyUsd(parsed, hours, rates) {
    // `hours` is what the caller knows or assumes (hoursFor below); the month needs it, a rate does not.
    if (!parsed || parsed.perUnit) return null;
    // Two readings salary.js makes for display that are too weak to report on — both measured on the live
    // board, 2026-10-13, each turning a likely $3/hr into "$0.05/hr":
    //   - a rate with no currency marker ("3/hour", "10-15/hr") is read as PESOS by the board's convention;
    //   - a bare peso number with no unit ("Php36K", "55k PHP") loses its "k" and reads as ₱36 an hour.
    const rateUnit = parsed.unit === 'hour' || parsed.unit === 'hour?' || parsed.unit === 'day' || parsed.unit === 'week';
    if (rateUnit && parsed.assumedCurrency && parsed.currency !== 'USD') return null;
    if (parsed.unit === 'hour?' && parsed.currency !== 'USD') return null;
    const top = parsed.raw ? parsed.raw.max : parsed.max;
    if (parsed.unit === 'hour' || parsed.unit === 'hour?') return plausible(toUsd(top, parsed.currency, rates));
    if (parsed.unit === 'day') return null;
    const h = Number(hours) > 0 ? Number(hours) : null;
    if (!h || !parsed.monthly) return null;   // a month with unknown hours could be any rate
    const usdMonth = toUsd(parsed.max, parsed.currency, rates);   // parsed.max is already a month
    return plausible(usdMonth == null ? null : usdMonth / (h * WEEKS_PER_MONTH));
  }

  /** The weekly hours a month may be divided by: the post's own number, or null. `basis` is the
   *  { hours, basis } salary-cards.js builds — 'detail' (HOURS PER WEEK) or 'stated' (in the text) count;
   *  'full-time' is a label, not a number, and counts for nothing here. */
  function hoursFor(basis) {
    return basis && VERIFIED.has(basis.basis) && Number(basis.hours) > 0 ? Number(basis.hours) : null;
  }

  /** A month without its real hours that WOULD be a lowball at up to CANDIDATE_HOURS a week: worth reading the
   *  listing's own HOURS PER WEEK for. Never a verdict on its own. */
  function isCandidate(parsed, hours, rates, floorUsd) {
    if (!parsed || hours || parsed.unit === 'hour' || parsed.unit === 'hour?') return false;
    return isLowball(hourlyUsd(parsed, CANDIDATE_HOURS, rates), floorUsd);
  }

  /**
   * A gig, or pay quoted for the whole job: never judged (the user, on "200.00 for the Gig" at 20 h/week flagged
   * as $2.50/hr: "the lowball feature should simply skip gigs entirely"). A one-off price has no hourly rate —
   * dividing it by a week's hours invents one. `type` is the card's badge or the post's TYPE OF WORK.
   */
  const PER_JOB = /\bgigs?\b|\bper (?:project|task|job|piece)\b|\bfor the (?:project|job|task)\b|\bfixed[- ](?:price|rate|fee)\b/i;
  function isGig(type, salaryText) {
    return /\bgig\b/i.test(String(type || '')) || PER_JOB.test(String(salaryText || ''));
  }

  /** At or below the floor, to the cent. A floor of 0 (or anything not a positive number) is off. */
  function isLowball(rateUsd, floorUsd) {
    const f = Number(floorUsd);
    if (!(f > 0) || !Number.isFinite(rateUsd)) return false;
    return Math.round(rateUsd * 100) <= Math.round(f * 100);
  }

  const dollars = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2);

  /** The note sent with a report — the site makes it optional for this reason, so it only adds facts. */
  function reportReason(rateUsd, floorUsd) {
    return `Offered pay works out to about ${dollars(rateUsd)}/hour, at or below ${dollars(Number(floorUsd))}/hour. ` +
      'Reported with OJ.ph Cleaner.';
  }

  /** The reported-jobs log `{ id: at }`, minus anything older than the keep window. */
  function prune(log, now) {
    const out = {};
    for (const [id, at] of Object.entries(log || {})) if (Number.isFinite(at) && now - at < KEEP_MS) out[id] = at;
    return out;
  }

  /** How many more reports the daily cap allows: the last 24 hours, not the calendar day. */
  function remainingToday(log, now, cap) {
    const c = Math.max(0, Math.floor(Number(cap) || 0));
    const used = Object.values(log || {}).filter(at => Number.isFinite(at) && now - at < DAY_MS).length;
    return Math.max(0, c - used);
  }

  return { REPORT_TYPE_SALARY, toUsd, hourlyUsd, hoursFor, isCandidate, isGig, isLowball, reportReason, prune, remainingToday, dollars };
});
