/**
 * dealbreakers.js: four more things a post can ask that some people will not do (spec.md D87), found the way
 * media-ask.js finds a video or voice ask: in the post's own words, as a tag on the card, never as a reason to hide
 * or demote anything.
 *
 *   🧪 test   a test or trial task before hiring: a skills, typing, DISC or personality test, an assessment, a paid
 *             or unpaid trial task, a test on TestGorilla or Kolbe. Not a job's duties ("test the software", "QA
 *             testing", "patient assessments") and not a probation ("3-month trial period").
 *   🌙 night  night, graveyard or overnight shifts, as the post says them. Never "day shift" or "no night shift".
 *             "US business hours" with no times is NOT tagged: it was on 13 of 107 live posts beside the 16 that say
 *             night outright, and a tag on everything is noise (D86's lesson). A post that gives the hours as a zoned
 *             range already gets trust.js's "🌙 … your time" tag, which converts them to this computer's clock.
 *   📅 weekend  weekend work: "must be available on weekends", "Monday to Saturday", "6 days a week". Never
 *             "weekends off" or "no weekends".
 *   🗣 language  a language other than English (or the Philippines' own) that the job requires: "fluent in Spanish",
 *             "native German speaker", "Spanish-speaking". Not when it is only "a plus".
 *   🏢 agency  the post is from a recruitment or staffing agency: "on behalf of our client", "our client is a…",
 *             "we are a staffing agency", "we place VAs with our clients". Not "no agencies" or "we are not an agency".
 *
 * Sentence by sentence, with the same split media-ask.js uses, so a quote is the post's own sentence. Pure and UMD:
 * trust.js tags cards, figures.js puts them on the bar, test-dealbreakers.js pins them on real wording.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCDealbreakers = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /** A "no", "not" or "without" just before the match turns it around ("no night shifts", "not an agency"). */
  const NEGATED = /\b(?:no|not|never|without|non|zero|free\s+from|except|excluding|aren'?t|isn'?t|don'?t)\b[^.\n]{0,18}$/;

  // ── 🧪 a test before hiring ─────────────────────────────────────────────
  const TEST_SELF = [
    /\b(?:skills?|typing|aptitude|personality|disc|iq|english|grammar|proficiency|written|writing|technical|coding|cognitive|logic|math|excel|practical|paid)\s+(?:tests?|assessments?|exams?|quiz(?:zes)?|challenge)\b/,
    /\b(?:paid|unpaid|short|small|quick|sample|test|trial)\s+(?:test\s+)?(?:tasks?|projects?|assignments?)\b/,
    /\b(?:paid|unpaid)\s+(?:\d+[- ]?(?:day|week|hour)s?\s+|short\s+)?(?:test|trial)s?\b(?!\s+period)/,
    /\btest\s+(?:tasks?|projects?|assignments?|run)\b/,
    /\b(?:testgorilla|test\s+gorilla|kolbe|wonderlic|ccat|criteria\s+cognitive|vervoe|hireselect|16\s*personalities|myers[- ]briggs|mbti|predictive\s+index)\b/,
    /\bdisc\s+(?:profile|personality)\b/,
  ];
  const TEST_ASKED = [
    /\b(?:complete|take|pass|undergo|answer|finish|do)\s+(?:a|an|our|the|this|these|two|three|\d)?\s*(?:short\s+|quick\s+|brief\s+|small\s+|simple\s+|online\s+|written\s+)?(?:tests?|assessments?|quiz(?:zes)?|exams?|evaluations?)\b/,
    /\b(?:tests?|assessments?|quiz(?:zes)?|exams?)\s+(?:will\s+be\s+)?(?:sent|given|required|link)\b/,
  ];
  const TEST_CTX = /\b(?:apply|applying|applications?|applicants?|candidates?|shortlisted|selected|qualified|hiring\s+process|interview|before|next\s+step|stage|round|screening|required|must)\b/;
  /** A recruiter's or coordinator's DUTY around tests ("send and track test assignments"), right before the match. */
  const TEST_DUTY = /\b(?:send|sending|track|tracking|follow\s+up\s+on|manage|managing|administer\w*|grade|grading|review|reviewing|create|creating|design|designing|coordinat\w+|schedul\w+|organi[sz]\w*|facilitat\w+|conduct\w*|observ\w*|train\w*|verif\w*|evaluat\w*|arrang\w*|host|hosting|book|booking|run|running|proctor\w*)\b[^.\n]{0,40}$/;
  const NOT_A_TEST = /\btrial\s+period\b|\bprobation|\b(?:qa|quality\s+assurance|software|unit|usability|a\/b|user)\s+test|\btest(?:ing)?\s+(?:software|apps?|features?|cases?|scripts?|automation|environments?)\b|\b(?:patient|clinical|risk|needs|nursing|health)\s+assessments?\b|\bassessments?\s+(?:coordinator|officer|specialist|manager|lead|centre|center)\b/;

  // ── 🌙 nights · 📅 weekends ─────────────────────────────────────────────
  const NIGHT = [
    /\b(?:night|graveyard|overnight|nightshift|late[- ]night)\s*[- ]?\s*shifts?\b/,
    /\bgraveyard\b/,
    /\b(?:night|overnight)\s+(?:hours|schedule|work|coverage)\b/,
    /\bwork(?:ing)?\s+(?:at|during\s+the)\s+night\b/,
  ];
  const US_HOURS = /\b(?:us|usa|u\.s\.?|american|north\s+american|eastern|central|pacific|mountain|est|edt|cst|cdt|pst|pdt|mst|mdt|et|ct|pt)\s+(?:business\s+|working\s+|office\s+|work\s+)?(?:hours|time\s*zones?|timezones?|shift)\b/;
  const WEEKEND = [
    /\bweekend\s+(?:shifts?|work|availability|coverage|support|hours|duty|schedule)\b/,
    /\b(?:work|working|available|availability|shifts?|cover|coverage|including|includes?|required|scheduled)\b[^.\n]{0,30}\bweekends?\b/,
    /\bweekends?\b[^.\n]{0,25}\b(?:required|a\s+must|included|needed|mandatory|as\s+needed)\b/,
    /\bmon(?:day)?\s*(?:-|–|to|through|thru)\s*(?:sat(?:urday)?|sun(?:day)?)\b/,
    /\b(?:6|six|7|seven)\s+days\s+(?:a|per|each)\s+week\b/,
    /\b(?:saturdays?|sundays?)\b[^.\n]{0,20}\b(?:required|shift|work|included|half[- ]day)\b/,
  ];
  const WEEKEND_OFF = /\bweekends?\s+(?:off|free)\b|\bfree\s+weekends?\b|\bweekdays?\s+only\b|\bno\s+weekends?\b|\bnot\s+(?:on\s+)?weekends?\b|\bexcept\s+(?:on\s+)?weekends?\b|\bexcluding\s+weekends?\b|\bmon(?:day)?\s*(?:-|–|to|through|thru)\s*fri(?:day)?\b(?![^.\n]{0,25}\b(?:sat|sun|weekend))/;

  // ── 🗣 a language besides English ───────────────────────────────────────
  const LANGS = ['Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Dutch', 'Japanese', 'Korean', 'Mandarin', 'Chinese',
    'Cantonese', 'Arabic', 'Hebrew', 'Russian', 'Polish', 'Turkish', 'Vietnamese', 'Thai', 'Indonesian', 'Bahasa', 'Malay', 'Hindi',
    'Urdu', 'Swedish', 'Norwegian', 'Danish', 'Finnish', 'Greek', 'Czech', 'Romanian', 'Hungarian', 'Ukrainian', 'Persian', 'Farsi'];
  const LANG_RE = new RegExp(`\\b(${LANGS.join('|')})\\b`, 'gi');
  // What asks it of the candidate: a fluency word, "speak/know <language>", or "<language> is required". A bare
  // "required" elsewhere in the sentence is not enough ("where Dutch support is required" is about the business).
  const L_ = LANGS.join('|');
  const LANG_NEED = new RegExp(String.raw`\b(?:fluent|fluency|native|bilingual|trilingual|proficien\w*|conversational|business[- ]level|c1|c2|b2)\b` +
    String.raw`|\b(?:speak|speaks|speaking|know|knows|read|write)\s+(?:fluent\s+|good\s+|excellent\s+)?(?:${L_})\b` +
    String.raw`|\b(?:${L_})\s+(?:language\s+)?(?:is\s+|are\s+)?(?:required|a\s+must|mandatory|needed)\b|\bmust\s+(?:speak|know|be\s+fluent)\b|\b(?:knowledge|command)\s+of\s+(?:${L_})\b`, 'i');
  const LANG_ABOUT = new RegExp(`\\b(?:${LANGS.join('|')})\\s+(?:market|clients?|customers?|company|companies|accent|team|speaking\\s+clients?|owned)\\b`, 'i');
  // "<language>-speaking" only when it describes the person hired ("Spanish-speaking VA"), never a market,
  // a country or a workplace ("French-speaking Canada", "a French-speaking environment").
  const LANG_SPEAKING = new RegExp(String.raw`\b(?:${L_})[- ]speaking\s+(?:virtual\s+assistants?|va|assistants?|customer\s+(?:care|service|support)|csrs?|representatives?|reps?|agents?|candidates?|applicants?|specialists?|appointment\s+setters?|recruiters?|sales|staff|team\s+members?|professionals?|coordinators?|admins?)\b` +
    String.raw`|\b(?:${L_})\s+speakers?\s+(?:needed|wanted|required|only)\b`, 'i');
  const LANG_OPTIONAL = /\b(?:a\s+plus|plus\b|bonus|preferred|nice\s+to\s+have|advantage|advantageous|optional|beneficial|not\s+required|not\s+expected)\b|\bif\s+you\s+(?:speak|know|are)\b/;

  // ── 🏢 a recruitment agency ─────────────────────────────────────────────
  const AGENCY = [
    /\bon\s+behalf\s+of\s+(?:our|a|the|one\s+of\s+our)\s+clients?\b/,
    /\bour\s+client(?:\s*,|\s+(?:is|was|who|based|in|located|seeks|is\s+seeking|is\s+looking|needs|requires|wants|a|an|has|specializes|operates|runs))\b/,
    /\b(?:hiring|recruiting|looking)\s+for\s+(?:a|our|one\s+of\s+our)\s+clients?\b/,
    // "a VA for one of our clients", "for our client in Sydney": singular, or one of several. "For our clients"
    // (plural) is how a business talks about its own customers, so it is left alone.
    /\b(?:for|with|at|to)\s+one\s+of\s+our\s+clients\b/,
    /\bfor\s+our\s+client\b(?!s)/,
    /\b(?:we\s+are|we're|as)\s+(?:a|an)\s+[^.\n]{0,50}?\b(?:va|virtual\s+assistant|recruitment|recruiting|staffing|placement|manpower|headhunting|outsourcing|talent\s+acquisition)\b[^.\n]{0,40}?\b(?:agency|firm|company|partner)\b/,
    /\b(?:place|placing|placed|match|matching|matched|deploy|deploying)\b[^.\n]{0,40}\bwith\s+(?:our|one\s+of\s+our)\s+clients?\b/,
  ];
  const NOT_AGENCY = /\b(?:no|not\s+an?|never\s+an?|not\s+working\s+with)\s+(?:recruitment\s+|staffing\s+)?agenc|\bagencies\s+(?:need\s+not|please\s+don|will\s+be\s+ignored)|\bno\s+agencies\b/;

  const split = (text) => String(text || '').split(/\n+|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const quote = (s) => (s.length > 140 ? s.slice(0, 139).trimEnd() + '…' : s);
  const hit = (seg, res) => {
    for (const re of res) {
      const m = re.exec(seg);
      if (m && !NEGATED.test(seg.slice(Math.max(0, m.index - 30), m.index))) return m;
    }
    return null;
  };

  /**
   * { test, night, weekend, agency: [sentence…], language: { langs: ['Spanish'…], quotes: [sentence…] }, usHours: [sentence…] }
   * `usHours` is kept apart from `night`: whether US hours are night depends on where the viewer is (see tagsOf).
   */
  function find(text) {
    const raw = split(text), segs = raw.map(s => s.toLowerCase());
    const out = { test: [], night: [], usHours: [], weekend: [], agency: [], language: { langs: [], quotes: [] } };
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i], ctx = `${segs[i - 2] || ''} ${segs[i - 1] || ''} ${seg}`;
      const t = !NOT_A_TEST.test(seg) && (hit(seg, TEST_SELF) || (TEST_CTX.test(ctx) && hit(seg, TEST_ASKED)));
      if (t && !TEST_DUTY.test(seg.slice(Math.max(0, t.index - 60), t.index))) out.test.push(quote(raw[i]));
      if (hit(seg, NIGHT)) out.night.push(quote(raw[i]));
      else if (hit(seg, [US_HOURS])) out.usHours.push(quote(raw[i]));
      if (!WEEKEND_OFF.test(seg) && hit(seg, WEEKEND)) out.weekend.push(quote(raw[i]));
      if (!NOT_AGENCY.test(seg) && hit(seg, AGENCY)) out.agency.push(quote(raw[i]));
      const langs = [...raw[i].matchAll(LANG_RE)].map(m => m[1][0].toUpperCase() + m[1].slice(1).toLowerCase());
      // Required: asked for with a word that asks ("fluent", "native", "must"), and not a market or a nationality
      // ("our Spanish clients"); or "<language>-speaking". Never when the same sentence calls it a plus.
      const required = (LANG_NEED.test(seg) && !LANG_ABOUT.test(seg)) || LANG_SPEAKING.test(seg);
      if (langs.length && required && !LANG_OPTIONAL.test(seg)) {
        for (const l of langs) if (!out.language.langs.includes(l)) out.language.langs.push(l);
        out.language.quotes.push(quote(raw[i]));
      }
    }
    // Mandarin and Cantonese are Chinese: name the one the post names, once.
    if (out.language.langs.some(l => l === 'Mandarin' || l === 'Cantonese')) out.language.langs = out.language.langs.filter(l => l !== 'Chinese');
    return out;
  }

  /**
   * The tags a post gets, in order: [{ key, kind, quotes, langs? }]. Keys: test, hours (kind night | weekend | both),
   * language, agency. `usHours` is found but not tagged (see the header).
   */
  function tagsOf(r) {
    if (!r) return [];
    const tags = [];
    if (r.test.length) tags.push({ key: 'test', quotes: r.test });
    const night = r.night;
    if (night.length || r.weekend.length) {
      tags.push({ key: 'hours', kind: night.length && r.weekend.length ? 'both' : night.length ? 'night' : 'weekend',
        quotes: [...night, ...r.weekend] });
    }
    if (r.language.langs.length) tags.push({ key: 'language', langs: r.language.langs, quotes: r.language.quotes });
    if (r.agency.length) tags.push({ key: 'agency', quotes: r.agency });
    return tags;
  }

  return { find, tagsOf, LANGS };
});
