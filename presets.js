/**
 * presets.js — starter keyword lists for each kind of online worker (D68), and a second layer by experience.
 *
 * `merge`, `repick` and `addTo` take archetype AND level ids alike (levels are `lvl-…`), so the two layers
 * combine by one rule.
 *
 * The first-run setup opens on "What kind of work do you do?": picking one to three archetypes fills the two
 * keyword lists, which the next screens show filled in and editable. ⚙ Settings offers the same table as
 * "Add words for…". Pure and UMD: setup.js and panel.js read `self.OJCPresets`, test-presets.js requires it.
 *
 * How the words are chosen, because they decide what a fresh install hides:
 *   - `positive` are words a listing for that work actually uses in its title or card — tools of the trade and
 *     role names, never vague praise. They are written in the matcher's own syntax (rules.js, D69) ON PURPOSE,
 *     because a preset is the first list a new user reads: plain words (plurals and hyphens included),
 *     `design*` where a family of words is meant, `=lead` where the plural means something else ("leads").
 *   - `negative` are OTHER job families that a person in this line of work does not want, plus the outbound
 *     sales roles almost no one on a non-sales hunt wants. Universal red flags (crypto, unpaid trial,
 *     commission only) stay on setup's own "Instant no?" chips, so the user sees them as a choice.
 *   - A hide never beats a goal: a blocked word on a listing that meets the minimum is a 🤔 Maybe (D40).
 *
 * Merging several archetypes: positives are the union, and **a word any picked archetype wants is never
 * blocked** — Graphic Designer + Social Media must not hide "graphic designer" because Social Media's list
 * blocks it. That rule is the one `merge` exists for.
 */
(function (root, factory) {
  // The clash test is the matcher itself (rules.js loads first in the manifest; node requires it).
  const api = factory(typeof module === 'object' && module.exports ? require('./rules.js') : root.OJRules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCPresets = api;
})(typeof self !== 'undefined' ? self : this, function (rules) {
  'use strict';

  const OUTBOUND = ['cold calling', 'cold call', 'appointment setter', 'telemarketing'];

  const ARCHETYPES = [
    { id: 'va', icon: '🗂️', label: 'General VA / Admin',
      positive: ['virtual assistant', 'executive assistant', 'personal assistant', 'admin assistant', 'administrative',
        'email management', 'calendar management', 'scheduling', 'inbox', 'google workspace', 'research'],
      negative: [...OUTBOUND, 'graphic designer', 'video editor', 'developer', 'programmer', 'bookkeeper',
        'medical billing', 'medical coding'] },
    { id: 'csr', icon: '🎧', label: 'Customer Support',
      positive: ['customer support', 'customer service', 'chat support', 'email support', 'live chat', 'csr',
        'help desk', 'zendesk', 'gorgias', 'freshdesk', 'ticketing'],
      negative: [...OUTBOUND, 'outbound', 'lead generation', 'graphic designer', 'video editor', 'developer',
        'bookkeeper', 'seo'] },
    { id: 'social', icon: '📱', label: 'Social Media',
      positive: ['social media', 'social media manager', 'content creator', 'community manager', 'instagram',
        'tiktok', 'facebook', 'meta ads', 'content calendar', 'canva', 'engagement'],
      negative: [...OUTBOUND, 'bookkeeper', 'accounting', 'developer', 'programmer', 'medical billing',
        'medical coding', 'data entry'] },
    { id: 'design', icon: '🎨', label: 'Graphic Designer',
      positive: ['graphic design*', 'photoshop', 'illustrat*', 'canva', 'figma', 'branding',
        'logo', 'brand identity', 'layout', 'packaging'],
      negative: [...OUTBOUND, 'bookkeeper', 'accounting', 'customer service', 'data entry', 'medical billing',
        'lead generation'] },
    { id: 'video', icon: '🎬', label: 'Video Editor',
      positive: ['video edit*', 'premiere pro', 'after effects', 'capcut', 'davinci resolve',
        'final cut', 'youtube', 'reels', 'short-form', 'motion graphics', 'thumbnail'],
      negative: [...OUTBOUND, 'bookkeeper', 'accounting', 'customer service', 'data entry', 'medical billing',
        'lead generation'] },
    { id: 'dev', icon: '💻', label: 'Web / Software Developer',
      positive: ['developer', 'web developer', 'programmer', 'software engineer', 'full stack', 'front end',
        'back end', 'javascript', '=react', 'php', 'python', 'laravel', 'wordpress', 'shopify developer'],
      negative: [...OUTBOUND, 'virtual assistant', 'customer service', 'data entry', 'bookkeeper',
        'medical billing', 'social media manager'] },
    { id: 'books', icon: '📒', label: 'Bookkeeper / Accounting',
      positive: ['bookkeep*', 'accounting', 'accountant', 'quickbooks', 'xero',
        'accounts payable', 'accounts receivable', 'reconciliation', 'payroll', 'cpa'],
      negative: [...OUTBOUND, 'graphic designer', 'video editor', 'social media', 'developer', 'lead generation'] },
    { id: 'writer', icon: '✍️', label: 'Writer / SEO',
      positive: ['content writer', 'copywrit*', 'writer', 'seo', 'blog', 'article', 'ghostwriter',
        'proofread*', 'technical writer'],
      negative: [...OUTBOUND, 'bookkeeper', 'accounting', 'customer service', 'video editor', 'graphic designer',
        'medical billing'] },
    { id: 'sales', icon: '📞', label: 'Sales / Lead Gen',
      positive: ['appointment setter', 'lead generation', 'sales', 'cold calling', 'cold call', 'outbound', 'sdr',
        'setter', 'closer', 'crm', 'gohighlevel', 'linkedin outreach'],
      negative: ['graphic designer', 'video editor', 'developer', 'programmer', 'bookkeeper', 'accounting',
        'medical billing', 'medical coding'] },
    { id: 'ecom', icon: '🛒', label: 'E-commerce / Amazon / Shopify',
      positive: ['shopify', 'amazon', 'e-commerce', 'amazon fba', 'product listing', 'etsy', 'ebay',
        'woocommerce', 'order processing', 'inventory', 'product research'],
      negative: [...OUTBOUND, 'medical billing', 'medical coding', 'developer', 'programmer', 'real estate'] },
    { id: 'medical', icon: '🩺', label: 'Medical VA / Healthcare',
      positive: ['medical virtual assistant', 'medical va', 'medical billing', 'medical coding', 'medical scribe',
        'healthcare', 'insurance verification', 'prior authorization', 'ehr', 'emr', 'hipaa', 'dental'],
      negative: [...OUTBOUND, 'graphic designer', 'video editor', 'developer', 'seo', 'social media'] },
    { id: 'realestate', icon: '🏠', label: 'Real Estate VA',
      positive: ['real estate', 'transaction coordinator', 'property management', 'listing coordinator', 'realtor',
        'mls', 'airbnb', 'short-term rental', 'tenant', 'leasing'],
      negative: ['graphic designer', 'video editor', 'developer', 'programmer', 'medical billing', 'medical coding',
        'seo'] },
    { id: 'automation', icon: '⚙️', label: 'Automation / AI / Tech VA',
      positive: ['automation', 'zapier', 'make.com', 'n8n', 'gohighlevel', 'ghl', 'ai', 'chatgpt', 'claude', 'api',
        'crm', 'workflow', 'clickup', '=notion', 'airtable'],
      negative: [...OUTBOUND, 'medical billing', 'medical coding', 'bookkeeper', 'graphic designer', 'video editor'] },
    { id: 'pm', icon: '📋', label: 'Project / Operations Manager',
      positive: ['project manag*', 'operations manager', 'online business manager', 'obm',
        'operations', 'asana', 'clickup', 'monday.com', 'team lead', 'sop'],
      negative: [...OUTBOUND, 'medical billing', 'medical coding', 'graphic designer', 'video editor', 'data entry'] },
    { id: 'data', icon: '🔎', label: 'Data Entry / Research',
      positive: ['data entry', 'research', 'lead research', 'web research', 'spreadsheet', '=excel', 'google sheets',
        'data cleaning', 'transcription', 'typing'],
      negative: [...OUTBOUND, 'sales', 'developer', 'programmer', 'graphic designer', 'video editor'] },
  ];
  /**
   * The second layer: experience (D68.1). One level (or none) is picked on top of the archetypes and merged by
   * the same rule. Experience is mostly written as a phrase in the DESCRIPTION ("5+ years of experience"), so
   * Read posts is what finds most of these. The matcher's default covers plurals and hyphens ("entry level" =
   * "entry-level"), but a number is a number: "10+ years" is listed apart from "5+ years".
   *
   * The hides are deliberately specific: a broad word like "manager" would hide "Social Media Manager" for a
   * newbie who picked Social Media, and test-presets.js fails if any level ever hides an archetype's own word.
   */
  const NEWBIE = ['no experience', 'entry level', 'beginner', 'will train', 'training provided', 'trainee',
    'fresh grad*', 'junior', 'newbie', 'zero experience'];
  const LEVELS = [
    { id: 'lvl-new', icon: '🌱', label: 'New to online work',
      hint: 'Shows "no experience needed" and "will train" jobs; hides ones asking for years of experience.',
      positive: NEWBIE,
      negative: ['senior', 'expert', 'highly experienced', 'seasoned', 'proven track record', 'head of', 'director',
        '2+ years', '3+ years', '4+ years', '5+ years', '6+ years', '7+ years', '8+ years', '10+ years',
        '2 years', '3 years', '4 years', '5 years', '7 years', '10 years'] },
    { id: 'lvl-mid', icon: '🌿', label: 'Some experience (1–4 years)',
      hint: 'Shows jobs asking for 1–3 years; hides only the very senior ones.',
      positive: ['1+ year', '1 year', '2+ years', '2 years', '3+ years', '3 years', 'mid level', 'intermediate',
        'experienced'],
      negative: ['7+ years', '8+ years', '10+ years', '10 years', '15+ years', 'director', 'head of', '=vp'] },
    { id: 'lvl-senior', icon: '🌳', label: 'Seasoned (5+ years)',
      hint: 'Shows senior, expert and lead roles; hides entry-level and trainee posts.',
      positive: ['senior', 'expert', '=lead', 'specialist', 'highly experienced', 'seasoned', 'strategist',
        'consultant', 'head of', '5+ years', '5 years', '7+ years', '10+ years'],
      negative: ['no experience', 'zero experience', 'entry level', 'beginner', 'trainee', 'intern', 'internship',
        'fresh graduate', 'newbie', 'will train'] },
  ];
  const BY_ID = new Map([...ARCHETYPES, ...LEVELS].map(a => [a.id, a]));
  const MAX_PICKS = 3;

  // Matching is case-insensitive (rules.js), so lists are compared by lower case — but a word keeps the spelling it
  // first had: "ICD-10" in someone's own list must not come back as "icd-10" because a preset was added.
  /** The word a keyword is ABOUT — case, a leading `=` (strict) and a trailing `*` (broad) aside — so "=lead" and
   *  "lead" are one word for de-duplicating and for the never-block-a-wanted-word rule. */
  const low = (w) => String(w).trim().toLowerCase().replace(/^=\s*/, '').replace(/\s*\*$/, '');
  function uniq(xs) {
    const seen = new Set(), out = [];
    for (const x of xs) { const w = String(x).trim(), k = low(w); if (k && !seen.has(k)) { seen.add(k); out.push(w); } }
    return out;
  }
  const without = (xs, drop) => { const d = new Set(drop.map(low)); return xs.filter(w => !d.has(low(w))); };
  /**
   * The merge rule: a word any list wants is never blocked — judged by the MATCHER, not by spelling, now that
   * a preset can want `graphic design*`. A hide word goes when it would match a wanted phrase ("manager" would
   * hide "social media manager"), or when a wanted `*` family covers it ("graphic design*" covers "graphic
   * designer"). A strict or plain wanted word does not reach into a longer hide phrase: "=lead" leaves
   * "lead generation" blocked.
   */
  const clashes = (neg, pos) => rules.matchKeywords(low(pos), [neg]).length > 0 ||
    (/\*$/.test(String(pos).trim()) && rules.matchKeywords(low(neg), [pos]).length > 0);
  const settle = (positive, negative) => {
    const p = uniq(positive);
    return { positive: p, negative: uniq(negative).filter(n => !p.some(w => clashes(n, w))) };
  };

  /** The lists for a set of archetype ids: positives unioned; negatives unioned minus anything wanted. */
  function merge(ids) {
    const picked = (ids || []).map(id => BY_ID.get(id)).filter(Boolean);
    return settle(picked.flatMap(a => a.positive), picked.flatMap(a => a.negative));
  }

  /**
   * Change the picked archetypes without losing what the user typed: the words the OLD picks contributed come
   * out, the NEW picks' words go in, and every word nobody's preset owns stays. Then the merge rule again.
   */
  function repick(lists, oldIds, newIds) {
    const was = merge(oldIds), now = merge(newIds);
    return settle([...without(lists.positive || [], was.positive), ...now.positive],
      [...without(lists.negative || [], was.negative), ...now.negative]);
  }

  /** Add one archetype's words to existing lists (⚙ "Add words for…"): nothing of the user's is removed except a
   *  block on a word this archetype wants. */
  function addTo(lists, id) {
    const p = merge([id]);
    return settle([...(lists.positive || []), ...p.positive], [...(lists.negative || []), ...p.negative]);
  }

  /** Add words of the person's own (from a resume, D80) by the same rule: a block on one of THESE words goes, and
   *  says which, so the toast can tell them. Blocks that only clash with older words are theirs to keep. */
  function addWords(lists, words) {
    const old = lists.negative || [];
    const negative = old.filter(n => !(words || []).some(w => clashes(n, w)));
    return { positive: uniq([...(lists.positive || []), ...(words || [])]), negative, unblocked: old.filter(n => !negative.includes(n)) };
  }

  return { ARCHETYPES, LEVELS, MAX_PICKS, merge, repick, addTo, addWords };
});
