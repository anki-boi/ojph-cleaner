/**
 * detail-text.js — what to highlight on a job's own page, as ranges (spec.md W4.1, D25–D27).
 *
 * Pure: no DOM, no chrome, no network. `plan(text, cfg)` returns `{ start, end, kind, rule }` for each
 * thing worth marking, sorted and non-overlapping, so the applier is a dumb text-node walk.
 *
 * The two judgements this file owns:
 *
 *   1. **Red beats green.** A positive keyword inside an off-platform ask ("send your AI portfolio") must
 *      not be able to hide the warning. Warnings are placed first, then negative keywords, then positive.
 *   2. **An ask is not a tool.** 3 of 7 phrase hits in a live 18-listing sample were Telegram mentioned as
 *      *job content* ("Help monitor Telegram accounts"), not as an application route. A messaging tool
 *      therefore only counts inside a sentence that also asks you to apply (D26).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./rules.js'));
  else root.OJCDetailText = factory(root.OJRules);
})(typeof self !== 'undefined' ? self : this, function (rules) {
  // ── Application asks: how a listing tells you to apply somewhere else ──────────────────────────
  // Deliberately about the *ask*, not the tooling. Anything added here must be a request to submit or
  // contact, never a mention of software the job uses.
  const ASK_PATTERNS = [
    /\b(?:to|how to)\s+apply\b/gi,
    /\bapply\s+(?:here|via|through|at|using|by|thru|below|now|today)\b/gi,
    /\bfill\s+(?:out|up)\b[^.!?\n]{0,40}?\bform\b/gi,
    /\bcomplete\s+(?:the|this|our|your|an?)\b[^.!?\n]{0,40}?\bform\b/gi,
    /\b(?:application|intake|google|job)\s+form\b/gi,
    // "send your resume", "email your CV to", "submit the application form" — the object is required, so
    // "submit all requested materials" is not matched and does not redden a normal requirement sentence.
    /\b(?:send|email|submit)\s+(?:your|us|me|over|in|the|it|all)\b[^.!?\n]{0,40}?\b(?:resume|cv|application|portfolio|demo|reel|video|links?|work|samples?|form|details)\b/gi,
    /\b(?:resume|cv|application)\s+to\b/gi,
    /\blink\s+(?:to|of)\s+(?:your|my|the|our)\b[^.!?\n]{0,40}?\b(?:portfolio|demo|reel|work|samples?|website|site|profile|drive|folder)\b/gi,
    /\b(?:link|form)\s+(?:below|provided|here|above)\b/gi,
    /\b(?:dm|pm|message)\s+me\b/gi,
    /\bcontact\s+(?:me|us)\s+(?:at|via|through|on)\b/gi,
  ];
  /** Messaging and booking tools. Only flagged next to an ask — see the guard in `plan`. */
  const TOOL_RE = /\b(?:whatsapp|telegram|viber|wechat|signal|skype|discord|calendly|book a call|schedule a call|google meet)\b/gi;

  // ── Links and addresses, as they actually appear: plain text, not hrefs ────────────────────────
  // 0 of 5 sampled descriptions carried an <a>; the link is prose ("fill out the form: forms.gle/xxx").
  // The TLD allowlist is why "e.g." and "i.e." are not links.
  const TLDS = 'com|net|org|ph|io|co|gle|ly|me|app|dev|xyz|info|biz|us|uk|site|page|link|tv|ai|so';
  const URL_RE = new RegExp(
    '(?:https?:\\/\\/|www\\.)[^\\s<>"\'()\\[\\]]+' +
    '|[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:' + TLDS + ')\\b(?:\\/[^\\s<>"\'()\\[\\]]*)?', 'gi');
  const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?![a-z0-9-])/gi;
  /** "bob (at) example (dot) com" — people write it this way to get past scrapers. */
  const EMAIL_OBFUSCATED_RE = /[a-z0-9._%+-]+\s*(?:\(at\)|\[at\])\s*[a-z0-9.-]+\s*(?:\(dot\)|\[dot\])\s*[a-z]{2,}/gi;
  /** What OJ.ph leaves behind when it removes an application link: "the form: ----------". */
  const REDACTED_RE = /-{6,}/g;
  /** Never ours to flag: the site's own support address and its own domain. */
  const OURSITE_RE = /onlinejobs\.ph/i;

  const PRIORITY = { warn: 0, neg: 1, pos: 2 };

  /** Sentence index per character, so a tool can be tied to the sentence that asks. */
  function sentenceMap(text) {
    const map = new Uint16Array(text.length);
    let s = 0;
    for (let i = 0; i < text.length; i++) {
      map[i] = s;
      if (text[i] === '.' || text[i] === '!' || text[i] === '?') s++;
    }
    return map;
  }

  /** Every occurrence of a global regex, with empty matches skipped so the walk always advances. */
  function eachMatch(text, re, fn) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (!m[0].length) { re.lastIndex++; continue; }
      fn(m.index, m.index + m[0].length, m[0]);
    }
  }

  /** A URL match keeps trailing sentence punctuation out of the highlight. */
  const trimTail = (s) => s.replace(/[.,;:!?\])]+$/, '');

  /**
   * `plan('Apply here: forms.gle/AbC', cfg)` → `[{ start, end, kind, rule }]`.
   *
   * `cfg.positive` / `cfg.negative` are the user's keyword lists (D24 semantics, via `rules.keywordRegex`,
   * so the page highlights exactly what the board hides). `cfg.detect` turns a signal off
   * (`{ url: false }`) — used by the tests and available to settings later.
   */
  function plan(text, cfg) {
    if (typeof text !== 'string' || !text) return [];
    const c = cfg || {};
    const detect = { url: true, email: true, ask: true, redacted: true, ...(c.detect || {}) };
    const cands = [];
    const add = (start, end, kind, rule) => { if (end > start) cands.push({ start, end, kind, rule }); };

    // 1. The asks, before anything else: the tool guard needs to know which sentences are asking.
    const askSents = new Set();
    let sents = null;
    if (detect.ask) {
      for (const re of ASK_PATTERNS) eachMatch(text, re, (s, e) => {
        add(s, e, 'warn', 'ask');
        if (sents === null) sents = sentenceMap(text);
        for (let i = s; i < e; i++) askSents.add(sents[i]);
      });
    }

    // 2. Tools, but only where the same sentence is asking you to apply (D26).
    if (detect.ask && askSents.size) {
      if (sents === null) sents = sentenceMap(text);
      eachMatch(text, TOOL_RE, (s, e) => {
        for (let i = s; i < e; i++) if (askSents.has(sents[i])) return add(s, e, 'warn', 'ask');
      });
    }

    // 3. Keywords, through the board's own matcher so both pages agree on what a match is.
    for (const [list, kind] of [[c.positive, 'pos'], [c.negative, 'neg']]) {
      for (const k of list || []) {
        const re = rules.keywordRegex(k, 'gi');
        if (re) eachMatch(text, re, (s, e) => add(s, e, kind, 'keyword'));
      }
    }

    // 4. Links, addresses, and the site's own redaction.
    if (detect.url) eachMatch(text, URL_RE, (s, e, m) => {
      const trimmed = trimTail(m);
      if (!OURSITE_RE.test(trimmed)) add(s, s + trimmed.length, 'warn', 'url');
    });
    if (detect.email) {
      eachMatch(text, EMAIL_RE, (s, e, m) => { if (!OURSITE_RE.test(m)) add(s, e, 'warn', 'email'); });
      eachMatch(text, EMAIL_OBFUSCATED_RE, (s, e, m) => { if (!OURSITE_RE.test(m)) add(s, e, 'warn', 'email'); });
    }
    if (detect.redacted) eachMatch(text, REDACTED_RE, (s, e) => add(s, e, 'warn', 'redacted'));

    // 5. Resolve overlaps: warnings first, then negative, then positive; earliest wins inside a kind, and
    //    the longer of two matches that start together. A red signal is never dropped in favour of green.
    // ponytail: O(n²) scan over the candidates of one text node — n is a handful, and a later text node
    // is a separate call, so nothing here is worth an interval tree.
    cands.sort((a, b) => (PRIORITY[a.kind] - PRIORITY[b.kind]) || (a.start - b.start) || (b.end - a.end));
    const kept = [];
    for (const cand of cands) {
      if (!kept.some(k => cand.start < k.end && cand.end > k.start)) kept.push(cand);
    }
    return kept.sort((a, b) => a.start - b.start);
  }

  return { plan, ASK_PATTERNS, TOOL_RE, URL_RE, EMAIL_RE, EMAIL_OBFUSCATED_RE, REDACTED_RE, PRIORITY };
});
