/**
 * resume-words.js: which job words are in your resume, and how many posts use each (spec.md D80). Pure and UMD.
 *
 * A resume is not mined word by word: "managed", "team" and "responsible" would flood the list. Instead the known
 * job words are checked against it. They come from two places:
 *   - the 15 kinds of work in presets.js (role names and tools, written in the matcher's own syntax), and
 *   - the skill tags OnlineJobs.ph puts on posts (QuickBooks, Canva, Data Entry…), as this computer has seen them.
 * A word is offered only when it is in the resume AND in at least one post this computer has seen, and the
 * matching is the same forgiving matcher the board uses (rules.js), so a word offered here matches cards the
 * same way once it is in "I'm into".
 *
 * A general skill nearly every post asks for (English, communication, attention to detail) would mark nearly every
 * card green, so it is shown but not ticked. That is a fixed list, not "in most posts seen": the posts this computer
 * has seen come from the person's own searches, so the words that fill them (bookkeeping, on a bookkeeper's board)
 * are the best words, not the emptiest. Nothing is added without the person pressing Add.
 */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./rules.js') : root.OJRules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCResumeWords = api;
})(typeof self !== 'undefined' ? self : this, function (rules) {
  'use strict';
  const MAX_SHOWN = 60;
  /** General skills: shown, not ticked. Words of a trade (customer service, data entry, research) are not on it. */
  const GENERAL = new Set(['english', 'filipino', 'tagalog', 'communication', 'communication skills', 'written communication',
    'verbal communication', 'english communication', 'attention to detail', 'detail oriented', 'organization', 'organisation',
    'organizational skills', 'time management', 'teamwork', 'team player', 'problem solving', 'multitasking', 'multi tasking',
    'computer skills', 'basic computer skills', 'internet', 'leadership', 'self motivated', 'fast learner', 'quick learner',
    'interpersonal skills', 'critical thinking', 'adaptability', 'creativity', 'reliability', 'hardworking', 'hard working']);

  const norm = (w) => String(w || '').toLowerCase().replace(/^=/, '').replace(/\*$/, '').replace(/[\s-]+/g, ' ').trim();
  /** A tag worth offering: has letters, a few words at most, not a sentence someone typed as a tag. */
  const usableTag = (t) => /[a-z]/i.test(t) && !/[,;\n]/.test(t) && t.length <= 40 && t.trim().split(/\s+/).length <= 4;

  /**
   * The known job words: `presets` is presets.js's ARCHETYPES, `tags` the skill tags seen on posts (any case).
   * Returns [{ word, label }], `word` as it would be added (lower case, preset syntax kept), `label` as shown.
   */
  function vocabulary(presets, tags) {
    const out = new Map();
    for (const a of presets || []) for (const w of a.positive || []) {
      const k = norm(w);
      if (k && !out.has(k)) out.set(k, { word: w, label: w.replace(/^=/, '') });
    }
    for (const t of tags || []) {
      const label = String(t || '').replace(/\s+/g, ' ').trim();
      const k = norm(label);
      if (k && usableTag(label) && !out.has(k)) out.set(k, { word: label.toLowerCase(), label });
    }
    return [...out.values()];
  }

  /** The first plain run of letters in a keyword: a cheap `includes` test before the real pattern runs. */
  const probe = (word) => (norm(word).split(' ')[0] || '').replace(/[^a-z0-9+#.]/g, '').slice(0, 6);

  /**
   * The suggestions. `resume` is text; `corpus` is one lower-cased text per post seen; `existing` the current
   * "I'm into" and "Never show me" lists, whose words are never offered again.
   * Returns rows sorted by posts, most first: { word, label, posts, share, general, ticked }.
   */
  function suggest({ resume, vocab, corpus, existing = [] }) {
    const text = String(resume || '').toLowerCase();
    if (!text.trim()) return [];
    const have = new Set(existing.map(norm));
    const posts = corpus || [];
    const rows = [];
    for (const v of vocab || []) {
      if (have.has(norm(v.word))) continue;
      const p = probe(v.word);
      if (p && !text.includes(p)) continue;
      const re = rules.keywordRegex(v.word);
      if (!re || !re.test(text)) continue;
      let n = 0;
      for (const doc of posts) if ((!p || doc.includes(p)) && re.test(doc)) n++;
      if (!n) continue;
      const general = GENERAL.has(norm(v.word));
      rows.push({ word: v.word, label: v.label, posts: n, share: posts.length ? n / posts.length : 0, general, ticked: !general });
    }
    // A longer phrase that holds a shorter one ("quickbooks online" and "quickbooks") are both kept: they match
    // different posts. Most-used first, then alphabetical so the order is stable.
    rows.sort((x, y) => y.posts - x.posts || x.label.localeCompare(y.label));
    return rows.slice(0, MAX_SHOWN);
  }

  return { vocabulary, suggest, norm, usableTag, GENERAL, MAX_SHOWN };
});
