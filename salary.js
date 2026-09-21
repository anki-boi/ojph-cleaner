/**
 * salary.js — what a listing actually pays, in monthly terms (spec.md W7).
 *
 * Ported from the sibling repo's scraper/salary.py, with two corrections the live data forced
 * (62 distinct salary strings sampled 2026-09-18):
 *
 *   1. Currency is detected properly. The suite assumes "no marker → PHP", which turns
 *      "15-20 AUD per hour" into PHP and "1000€ /m" into ₱1,000. Here a 3-letter code wins over a
 *      symbol ("$10 - $13 CAD per hour" is CAD, "SGD $1500" is SGD) and a foreign symbol is read as
 *      itself. Only a markerless number falls back to PHP, which is this board's convention.
 *   2. A trailing monthly figure beats a leading hourly one. "PHP 240/hour, approx. PHP 40,000/mo"
 *      is ₱40,000/mo; the suite reads it as ₱38,400–₱6,400,000 because it takes the first two numbers
 *      and the first unit it finds.
 *
 * Money is never approximated silently: parseSalary returns null rather than a guess when there are
 * no numbers, and a currency whose live rate is unknown yields no converted figure at all (no rate is
 * ever cached past 24h — a stale ₱ number is a wrong number).
 *
 * Pure, and unit-tested by test-salary.js. The loader — the live ECB rate, the card annotations, the
 * goal marks — lives in salary-cards.js, the split this repo applies to every feature: the maths
 * stays testable in node, and the DOM stays out of it.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.OJCSalary = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const WEEKS_PER_MONTH = 4.33;
  const FULL_TIME_HOURS = 40;    // what "full time" means — the board's 160 h month is 40 × 4

  // 3-letter codes are checked before symbols: "$10 - $13 CAD per hour" is CAD, not USD. The lookbehind
  // allows a digit in front ("400USD/mo", "35,000PHP") but not a letter (so "plus" is not "us").
  const CODE_RE = /(?<![a-z])(php|peso|usd|us|eur|gbp|aud|cad|sgd|nzd|jpy|yen)\b/;
  const CODE_MAP = { php: 'PHP', peso: 'PHP', usd: 'USD', us: 'USD', eur: 'EUR', gbp: 'GBP',
                     aud: 'AUD', cad: 'CAD', sgd: 'SGD', nzd: 'NZD', jpy: 'JPY', yen: 'JPY' };
  const SYMBOLS = [[/₱/, 'PHP'], [/€/, 'EUR'], [/£/, 'GBP'], [/¥/, 'JPY'], [/\$/, 'USD']];
  const MONTHLY = /month|\/m\b|\/mo\b/;
  const TIME_UNIT = /annual|year|hour|\/hr|per hr|week|day/;
  // Reading a bare number (spec.md D12). Sampled live 2026-09-18: of 11 bare-number cards, `6.00`,
  // `4`, `7`, `6-7` were hourly rates on foreign writing roles ($4-7/hr) and `400-500`, `600`, `1000`,
  // `2000` were monthly USD rates — every one of them on a U.S./foreign-facing listing. A ₱400/month
  // salary does not exist and a $40,000/month one does not either, so magnitude answers both questions:
  //   1-2 digits  → an hourly rate, in dollars
  //   3-4 digits  → a monthly rate, in dollars
  //   5+ digits   → a monthly rate, in pesos
  // It applies only when the listing states neither a currency nor a unit; an explicit "140-175/hour"
  // keeps the board's own convention (pesos).
  const BARE_HOURLY_MAX = 99;
  const BARE_PHP_MIN = 10000;
  // A rate tied to a non-time unit ("$5 per entry", "per account", "$2/article") has no monthly
  // equivalent. Guessing one from the tiny-number heuristic produced ₱50,186/mo for "$5 per entry"
  // on a live card — the one thing this feature must never do.
  // A `+/-` or a free-standing `/` is punctuation, not a per-unit marker: the slash form only counts when
  // a unit word follows it, or "$5+/- per hour" (a live card) is read as a piece rate and loses its month.
  const PIECE_RATE = /\bper\s+(?!\s*(?:hour|hr|day|week|month|year|annum)s?\b)|\/(?=[a-z])(?!\s*(?:per\s+)?(?:hr|hour|day|week|month|mo|m|year)s?\b)/;

  /**
   * Hours per week a listing states. Sampled live: 12 of 60 cards quoted an hourly rate and 7 of
   * those were part-time, so assuming 40 h/week for every hourly figure nearly doubles a part-timer's
   * month. Precedence, and nothing else: an explicit "N hours per week" → a "full time" listing
   * (40 h/week is what that means) → null.
   *
   * "Part time" deliberately yields null: part-time has no fixed number, and inventing 20 would be the
   * same error as inventing 40. Those listings keep their hourly rate and get no monthly figure.
   */
  function hoursPerWeekFrom(text) {
    const s = (text || '').toLowerCase();
    const stated = s.match(/(\d{1,3})\s*(?:hours?|hrs?)\s*(?:\/|per\s+)?\s*(?:week|wk)/)
                || s.match(/(?:hours?|hrs?)\s*(?:per|\/)?\s*(?:week|wk)\s*[:\-]?\s*(\d{1,3})/);
    if (stated) {
      const n = Number(stated[1]);
      if (n > 0 && n <= 80) return { hours: n, basis: 'stated' };
    }
    // Part-time is checked BEFORE full-time and wins: a part-time card whose prose mentions "full time
    // availability" must not be handed a 40-hour month. Cheap, and it failed live ($6/hour → ₱60,223/mo).
    if (/part[\s-]?time/.test(s)) return { hours: null, basis: 'part-time' };
    if (/full[\s-]?time/.test(s)) return { hours: FULL_TIME_HOURS, basis: 'full-time' };
    return { hours: null, basis: 'unstated' };
  }

  const currencyOf = (s) => {
    const code = s.match(CODE_RE);
    if (code) return CODE_MAP[code[1]];
    for (const [re, cur] of SYMBOLS) if (re.test(s)) return cur;
    return null;
  };

  /**
   * '40,000' → 40000 · '7,5' → 7.5 (a European decimal comma) · '1,50' → 1.5 · '35,0000' → 350000.
   *
   * A comma group of ONE OR TWO digits is a decimal comma; anything longer is a thousands separator,
   * however the poster grouped it. That last case is not hypothetical: the live board carries
   * `35,0000 - 40,0000` (a mis-typed 350 000), and reading a 4-digit group as decimals turned a
   * ₱350,000/month job into "$35/hour" — ₱395,249/mo after conversion, which the user spotted at once:
   * "this is obviously already in pesos since the salary stated is 5 digits and above". Magnitude is what
   * the currency heuristic reads (D12), so losing it here loses the whole judgement.
   */
  function num(tok) {
    return parseFloat(tok.replace(/,(\d+)/g, (_, d) => (d.length <= 2 ? '.' + d : d)));
  }

  /**
   * Free-text salary → { min, max, currency, perUnit, unit, hours, monthly } or null when there is no
   * number to read.
   *
   * `monthly` is the honesty flag: it is true only when the figures in `min`/`max` really are a month's
   * pay — a per-month/week/year amount, or an hourly rate whose weekly hours the listing states. A rate
   * per hour or per day without stated hours is left as the posted rate and **no month is claimed**:
   * every fallback here would be inventing someone else's work week.
   */
  function parseSalary(text, hoursPerWeek) {
    if (!text || typeof text !== 'string') return null;
    let s = text.toLowerCase().replace(/\d+\s*%/g, ' ');   // "5% commission" is not a price

    // Parenthetical asides carry comparison figures ("$700/mo ($175/week)"), not the salary — but
    // keep them when they hold the only number ("($2.00-$3.00) hourly").
    const outside = s.replace(/\([^)]*\)/g, ' ');
    if (/\d/.test(outside)) s = outside;

    // A segment with an explicit monthly unit beats the rest: "PHP 240/hour, approx. PHP 40,000/mo".
    // Split on separators between figures — but NOT on a thousands comma, or "Starting at $1,200"
    // would be cut into "$1" and "200".
    const parts = s.split(/;|\+|,(?!\d{3}(?!\d))|\band\b/);
    if (parts.length > 1) {
      const monthly = parts.filter(p => MONTHLY.test(p) && /\d/.test(p));
      if (monthly.length) s = monthly.join(' ');
    }

    const numbers = [...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(m => num(m[0])).filter(n => n > 0).slice(0, 2);
    if (!numbers.length) return null;

    const [lo, hi] = [Math.min(...numbers), Math.max(...numbers)];
    const hours = Number(hoursPerWeek) > 0 ? Number(hoursPerWeek) : null;
    const cur = currencyOf(s);
    const marksUnit = TIME_UNIT.test(s) || MONTHLY.test(s);
    let unit, factor = 1, monthly = true;

    if (marksUnit) {
      if (/annual|year/.test(s)) { unit = 'year'; factor = 1 / 12; }
      else if (/hour|\/hr|per hr/.test(s)) unit = 'hour';
      else if (/week/.test(s)) { unit = 'week'; factor = WEEKS_PER_MONTH; }
      else if (/day/.test(s)) unit = 'day';
      else unit = 'month';
    } else {
      unit = hi <= BARE_HOURLY_MAX ? 'hour?' : 'month';   // magnitude reads the period
    }

    if (unit === 'hour' || unit === 'hour?') {
      if (hours) factor = hours * 4;        // the same 4-week month as the 160 h convention
      else monthly = false;                 // no stated hours → no month, not even a full-time one
    } else if (unit === 'day') {
      monthly = false;                      // a day rate has no monthly equivalent without days/week
    }

    // Currency: a stated marker always wins. Otherwise an hourly/daily/weekly rate is read as pesos
    // (the board's convention), while a monthly figure is read by magnitude — the one case where
    // "no marker means pesos" would produce a number no employer would ever pay.
    let currency = cur, assumedCurrency = false;
    if (!currency) {
      const byMagnitude = !marksUnit || unit === 'month';
      assumedCurrency = true;
      currency = byMagnitude && hi < BARE_PHP_MIN ? 'USD' : 'PHP';
    }

    const round = (n) => Math.round(n * factor * 10) / 10;
    const perUnit = PIECE_RATE.test(s);
    return { min: round(lo), max: round(hi), raw: { min: lo, max: hi }, currency, explicit: !!cur,
             assumedCurrency, perUnit, unit, hours, monthly: monthly && !perUnit };
  }

  /** Monthly PHP for a parsed salary, or null when it cannot honestly be computed. */
  function toPhp(parsed, rates) {
    if (!parsed || parsed.perUnit || !parsed.monthly) return null;  // no month claimed, or none exists
    return convert({ min: parsed.min, max: parsed.max }, parsed.currency, rates);
  }

  /** The posted per-unit amount in PHP (per hour, per day) — even when a month is also computable. */
  function ratePhp(parsed, rates) {
    if (!parsed || parsed.perUnit) return null;
    if (parsed.unit !== 'hour' && parsed.unit !== 'day') return null; // `hour?` states no unit at all
    return convert(parsed.raw, parsed.currency, rates);
  }

  function convert(amount, currency, rates) {
    if (currency === 'PHP') return { min: amount.min, max: amount.max };
    const rate = rates && rates[currency];
    if (!rate) return null;
    return { min: Math.round(amount.min * rate), max: Math.round(amount.max * rate) };
  }

  const money = (n) => '₱' + Math.round(n).toLocaleString('en-US');
  const span = (v) => (v.min === v.max ? money(v.min) : `${money(v.min)} - ${money(v.max)}`);

  /** "≈ ₱26,700 - ₱34,000/mo" — no currency code, no decimals above 1,000. */
  function formatNote(php) {
    return php ? `≈ ${span(php)}/mo` : null;
  }

  /** "≈ ₱1,882/hr" — a rate that is true on its own, with no month claimed. */
  function formatRate(php, unit) {
    if (!php) return null;
    return `≈ ${span(php)}/${unit === 'day' ? 'day' : 'hr'}`;
  }

  /** Above-goal is judged on the LOW end of the range: a "maybe" must not count as a yes. */
  const meetsGoal = (php, goalPhp) => !!php && goalPhp > 0 && php.min >= goalPhp;

  /**
   * Which cached FX rates are still alive, against the two clocks the loader uses: a rate is servable
   * until it is `ttlMs` old (the 24-hour TTL — the split is exactly AT the TTL, not just below it), and a
   * failed currency is not retried again until `retryMs` has passed (so a currency that failed this
   * morning still shows nothing rather than hammering a dead endpoint all day). `store` is the
   * on-disk shape `{ rates: {CUR: {rate, date, at}}, failed: {CUR: at} }`. Clock-injected, so the
   * boundary is testable: this is what a long-lived tab asks before trusting its in-memory copy.
   */
  function pickFresh(store, wanted, now, ttlMs, retryMs) {
    store = store || {};
    const fresh = {};
    const needed = [];
    for (const cur of wanted || []) {
      const hit = store.rates?.[cur];
      // Number.isFinite, not `!= null`: a NaN stored by an older build passes `!= null` and NaNs every
      // figure computed from it (measured live: a detail bar showing "≈ ₱NaN - ₱NaN/mo").
      if (hit && Number.isFinite(hit.rate) && now - hit.at <= ttlMs) { fresh[cur] = { rate: hit.rate, date: hit.date }; continue; }
      if (store.failed?.[cur] != null && now - store.failed[cur] < retryMs) continue;  // just failed: no figure, no retry
      needed.push(cur);
    }
    return { fresh, needed };
  }

  return { parseSalary, toPhp, ratePhp, formatNote, formatRate, meetsGoal, hoursPerWeekFrom, pickFresh,
           WEEKS_PER_MONTH, FULL_TIME_HOURS };
});
