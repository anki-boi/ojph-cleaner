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
   * The one place a keyword's pattern is built (D24, D69), so everything that needs the same matching — 
   * `matchKeywords` below and the detail page's highlighter — shares one definition. Three modes, chosen by
   * how the keyword is written:
   *
   *   video editor   FORGIVING (the default): whole words, never inside another word — and tolerant of the
   *                  spellings of the SAME words: a plural on the last word (editor → editors), a space,
   *                  hyphen or nothing between words (entry level = entry-level = entrylevel), and spaces
   *                  around a "+" after a number (5+ years = 5 + years).
   *   design*        BROAD: the last word may continue (designer, designing, designs). Opt-in, because a broad
   *                  hide word hides real jobs ("intern*" would take "internal" and "international").
   *   =lead          STRICT: exactly this, no plural ("=lead" never matches "leads") — the pre-D69 behaviour.
   *
   * Never inside a word in any mode: `ai` still never matches `email` or `daily` (the defect D24 fixed — `AI`
   * as a substring matched 30 of 30 live cards). Returns null for an empty keyword. Pass `'g'` to walk every
   * occurrence with `exec`.
   */
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function keywordRegex(keyword, flags = '') {
    const raw = String(keyword ?? '').trim().toLowerCase();
    const strict = raw.startsWith('=');
    let needle = (strict ? raw.slice(1) : raw).trim();
    const broad = !strict && needle.length > 1 && needle.endsWith('*');
    if (broad) needle = needle.slice(0, -1).trim();
    if (!needle) return null;
    let body;
    if (strict) body = esc(needle);
    else {
      // Words split on spaces and hyphens, rejoined so any of those (or nothing) may sit between them.
      const words = needle.split(/[\s-]+/).filter(Boolean)
        .map(w => esc(w).replace(/(\d)\\\+/g, '$1\\s*\\+'));
      body = words.join('[\\s-]*');
      if (broad) body += '\\w*';
      else if (/[a-z]$/.test(needle)) body += '(?:e?s)?';   // one plural on the last word, nothing more
    }
    // Lookarounds rather than \b: a boundary is "no word character either side", which is also right for a
    // needle that starts or ends with punctuation (`$5`, `c++`), where \b refuses to match.
    return new RegExp('(?<!\\w)' + body + '(?!\\w)', flags);
  }

  /** The keyword as shown to the user: whitespace trimmed, a leading `=` dropped (the `*` stays — it says how
   *  the word matched). */
  function cleanKeyword(keyword) {
    const raw = String(keyword ?? '').trim();
    return (raw.startsWith('=') ? raw.slice(1) : raw).trim();
  }

  /**
   * Case-insensitive keyword match in the three modes above. Returns the keywords that matched, as written
   * (minus a leading `=`); an empty array is no match.
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

  /**
   * Does the salary text say the pay is negotiable rather than state a figure — the two words the board
   * actually uses, 'Negotiable' and 'DOE'? Word-bounded, so an 'anode' or 'road' never matches. Pairs
   * with hasSalary, which says a digit is absent: this says WHY nothing is there (the negotiable rescue).
   */
  const isNegotiable = (text) => /(^|[^a-z])(negotiable|doe)([^a-z]|$)/i.test(String(text || ''));

  return { hasSalary, matchKeywords, keywordRegex, cleanKeyword, parsePosted, isStale, findDuplicates, isNegotiable, listsToText, textToLists,
           MANILA_OFFSET_MINUTES };
});
