/**
 * rules.js — pure rule functions, shared by the content script and node tests.
 * UMD: loads as `self.OJRules` in the browser, `module.exports` under Node.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.OJRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * "Has salary" = the salary text contains at least one digit.
   * Passes: "$500/month", "PHP 30,000 - PHP 40,000", "$1,000/month (DOE)".
   * Fails:  "TBD", "N/A", "Negotiable", "DOE", "to be discussed", "", null.
   */
  function hasSalary(text) {
    return /\d/.test(text || '');
  }

  /**
   * Case-insensitive keyword match, **exact by default**: every keyword is a whole word or a whole
   * phrase. `ai` matches "AI tools" and "AI-powered" but never `email` or `daily`; `video editor`
   * matches that phrase and not `video editors` — add the forms you want to the list instead of
   * relying on a substring to catch them. Returns the keywords that matched, as written (empty array
   * = no match).
   *
   * Exact-not-substring is not a preference, it is the fix for a real defect: `AI` as a substring
   * matched 30 of 30 cards on the live board, through `daily`, `email`, `main`, `paid`, `thumbnail`
   * and `management` — and because the yellow reconsider rule rescues every negative match, that
   * silently turned the user's entire negative-keyword list into a no-op.
   *
   * A leading `=` is accepted and ignored, so a keyword saved as `=ai` by the one release that made
   * whole-word opt-in keeps working rather than quietly matching nothing.
   */
  function matchKeywords(text, keywords) {
    const t = (text || '').toLowerCase();
    const hits = [];
    for (const k of keywords || []) {
      if (!k || !String(k).trim()) continue;
      const raw = String(k).trim();
      const needle = (raw.startsWith('=') ? raw.slice(1) : raw).trim().toLowerCase();
      if (!needle) continue;
      // Lookarounds rather than \b: a boundary is "no word character either side", which is also right
      // for a needle that starts or ends with punctuation (`$5`, `c++`), where \b refuses to match.
      // The needle is escaped — a keyword is data, so a `.` in one is a literal dot.
      const re = new RegExp('(?<!\\w)' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\w)');
      if (re.test(t)) hits.push(needle === raw.toLowerCase() ? raw : raw.slice(1).trim());
    }
    return hits;
  }

  /**
   * Asia/Manila is UTC+8, and `p[data-temp]` is rendered in that wall clock while `data-temp-2`
   * carries the same instant in UTC (verified live 2026-09-18: `2026-09-19 01:33:33` /
   * `2026-09-18 17:33:33`). Pass this as `wallClockOffsetMinutes` for the fallback attribute.
   */
  const MANILA_OFFSET_MINUTES = 8 * 60;

  /**
   * `"2026-09-19 01:33:33"` → epoch ms, or **null** when the string is not exactly the site's shape.
   *
   * `wallClockOffsetMinutes` is the zone those digits are written in: 0 (the default) means UTC —
   * `data-temp-2` — and `MANILA_OFFSET_MINUTES` means the site's own display zone, `data-temp`.
   * Never the viewer's local zone: `new Date('2026-09-19 01:33:33')` is local time, which on this
   * machine reads the card 14 hours off, and on any non-PH machine is simply wrong.
   *
   * Anything else — a missing time, an ISO `Z`, a real-looking `2026-02-30` — is null rather than a
   * nearby date: a garbage timestamp that parsed "close enough" could hide a fresh listing.
   */
  function parsePosted(value, wallClockOffsetMinutes = 0) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(value ?? '').trim());
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m.map(Number);
    const ms = Date.UTC(y, mo - 1, d, h, mi, s);
    const back = new Date(ms);
    // Date.UTC rolls overflow over instead of failing (Feb 30 → Mar 2), so round-trip the parts.
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d ||
        back.getUTCHours() !== h || back.getUTCMinutes() !== mi || back.getUTCSeconds() !== s) return null;
    return ms - wallClockOffsetMinutes * 60000;
  }

  /**
   * Older than `maxAgeDays`? Strict, so 7 means "posted within the last 7 days" (a rolling week,
   * not a calendar one). `maxAgeDays` of 0 — or anything non-numeric — is off, and an unreadable
   * timestamp (`null`) is never stale: the recency rule must not be the thing that loses a job.
   */
  function isStale(postedMs, nowMs, maxAgeDays) {
    const max = Number(maxAgeDays);
    if (!(max > 0) || postedMs == null) return false;
    return (nowMs - postedMs) / 86400000 > max;
  }

  return { hasSalary, matchKeywords, parsePosted, isStale, MANILA_OFFSET_MINUTES };
});
