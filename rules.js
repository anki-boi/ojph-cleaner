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
   * The one place the "exact word or phrase" pattern is built (D24), so anything that needs the same
   * matching semantics — `matchKeywords` below, the detail page's highlighter — shares one definition
   * instead of a second copy that drifts. A leading `=` is accepted and dropped (legacy).
   *
   * Returns null for an empty keyword. Pass `'g'` to walk every occurrence with `exec`.
   */
  function keywordRegex(keyword, flags = '') {
    const raw = String(keyword ?? '').trim();
    const needle = (raw.startsWith('=') ? raw.slice(1) : raw).trim().toLowerCase();
    if (!needle) return null;
    // Lookarounds rather than \b: a boundary is "no word character either side", which is also right
    // for a needle that starts or ends with punctuation (`$5`, `c++`), where \b refuses to match.
    // The needle is escaped — a keyword is data, so a `.` in one is a literal dot.
    return new RegExp('(?<!\\w)' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\w)', flags);
  }

  /** The keyword as shown to the user: a leading `=` stripped, whitespace trimmed. */
  function cleanKeyword(keyword) {
    const raw = String(keyword ?? '').trim();
    return (raw.startsWith('=') ? raw.slice(1) : raw).trim();
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
   */
  function matchKeywords(text, keywords) {
    const t = (text || '').toLowerCase();
    const hits = [];
    for (const k of keywords || []) {
      const re = keywordRegex(k);
      if (re && re.test(t)) hits.push(cleanKeyword(k));
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

  /**
   * The two keyword lists as one text block, for moving them between devices (F3). The `#` lines are the
   * FORMAT, not comments: everything before `# highlight` hides, everything after highlights — so one
   * copy round-trips both lists, and a paste into any editor stays readable.
   */
  function listsToText(negative, positive) {
    return ['# hide', ...(negative || []), '# highlight', ...(positive || [])].join('\n') + '\n';
  }

  /**
   * The inverse of `listsToText`: a block back to `{ negative, positive }`. A line starting with `#` is a
   * section header, `# highlight` (case-insensitive) switches the mode; blank lines are skipped; the
   * first list to appear in a section wins nothing — duplicates are dropped, same as the panel's parser.
   */
  function textToLists(text) {
    const neg = [], pos = [];
    let mode = 'neg';
    for (const raw of (text || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#')) { if (/highlight/i.test(line)) mode = 'pos'; continue; }
      (mode === 'neg' ? neg : pos).push(line);
    }
    return { negative: [...new Set(neg)], positive: [...new Set(pos)] };
  }

  /**
   * Duplicate re-posts: the same job posted again under the same key (title + company). The newest
   * DATED card per key is the canonical one, and every other dated card sharing the key is the older
   * duplicate. A card with no readable date is never flagged, and a same-instant pair is not a re-post —
   * in the safe direction, the way the recency rule leaves an undateable card alone.
   * Pure: takes {key, at}[] (at = epoch ms or null) and returns the Set of indices that are duplicates.
   */
  function findDuplicates(items) {
    const newest = {};
    for (const it of items) {
      if (!it || !it.key || it.at == null) continue;
      if (newest[it.key] == null || it.at > newest[it.key]) newest[it.key] = it.at;
    }
    const dups = new Set();
    items.forEach((it, i) => { if (it && it.key && it.at != null && it.at < newest[it.key]) dups.add(i); });
    return dups;
  }

  return { hasSalary, matchKeywords, keywordRegex, cleanKeyword, parsePosted, isStale, findDuplicates, listsToText, textToLists,
           MANILA_OFFSET_MINUTES };
});
