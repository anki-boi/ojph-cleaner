/**
 * tiers.js — the verdict table (spec.md W12, D31).
 *
 * Pure: no DOM, no storage, no network. UMD, so `node test-tiers.js` can pin every branch offline.
 *
 * One function decides what every card is, and the order of its branches is the product:
 *
 *   closed → stale → no salary (unless rescued) → the two tiers → keyword-hide → off-platform flag
 *
 * The first three are unchanged from 0.8.0 and outrank everything: a listing you have seen close, one
 * outside your recency window and one that states no pay are facts about the listing, not opinions about
 * it. The last four are what a deep scan can move cards between.
 *
 * **The compatibility rule.** With no `detail` (no deep scan, no cache), the table reduces to the
 * verdicts 0.8.0 shipped: `good && !bad` → high (green), `good && bad` → worth (yellow), `bad` → hidden.
 * That is not a nice-to-have — every existing live assertion in tools/verify-live.mjs is written against
 * those counts, so a page the scan has never touched must behave exactly as it always did.
 *
 * What the scan can do to a card, in the terms the user asked for:
 *
 * | movement | how |
 * |---|---|
 * | promote white → high  | the scan's own `HOURS PER WEEK` turns an assumed month into a stated one, and the listing now meets your goal |
 * | promote pos → high    | the same: a listing you like the sound of, whose real hours put it over your goal |
 * | promote white → pos   | the description matches a positive keyword the card's short text does not have |
 * | promote hidden → worth | a positive keyword rescues a hide-keyword card |
 * | demote high → worth   | the description adds a hide keyword |
 * | demote high → pos     | …and nothing else about it looks good, so it is only highlighted |
 *
 * A description can never un-match a card-level hit: it is strictly more text, so a demotion is always
 * explainable ("the card already said crypto") and a promotion is always earned. Nothing here guesses.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.OJCTiers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /** Every verdict, in the order the rule pass evaluates them. */
  const TIERS = ['closed', 'stale', 'nosal', 'high', 'pos', 'worth', 'kw', 'none'];
  /** The verdicts that mean "off the board" (unless Show all is on). */
  const HIDDEN = new Set(['closed', 'stale', 'nosal', 'kw']);

  const has = (arr) => Array.isArray(arr) && arr.length > 0;

  /**
   * The verdict for one card. `detail` is `null`/absent on a page the scan has not reached — see the
   * compatibility rule above. The inputs are never mutated, because the caller's record is the thing
   * being written back, not a scratch pad.
   *
   * **PAY decides High yield, not keywords.** The user, after seeing a version where a positive keyword was
   * enough on its own: "having matched positive keywords does not make the job listing high-yield. It's
   * either passing salary, or passing salary with positive keywords." So the two tiers are:
   *
   *   `high`  — the listing meets one of your salary goals, and no keyword you asked to hide matched.
   *             Positive keywords are a bonus: they are badged, and they do not change the tier.
   *   `worth` — it looks good (a goal met, or a keyword you like) *and* a hide keyword matched.
   *
   * A keyword you like on a listing that pays below your goal is neither: it is `pos` — the green highlight
   * this extension has always drawn, with its `✓ kw` badge, and emphatically not a high-yield listing. It is
   * its own verdict because the chip has to count it, the views must not include it, and the old "good"
   * predicate conflated the two ideas.
   *
   * **Off-platform asks and long weeks are not part of this function either.** They are `detail.flags` and
   * `detail.warns`, shown as tags on the card. The user: "the off-platform application thing should just be
   * a tag, not a red gate as part of the filter". A tag informs; a gate decides.
   */
  function decide({ closed, stale, noSalary, rescue, card, detail } = {}) {
    const c = card || {};
    const pos = has(c.pos) || (detail && has(detail.pos));
    const neg = has(c.neg) || (detail && has(detail.neg));
    const money = !!c.goal;      // the goal mark salary-cards.js puts on a listing at or above your goal
    const good = money || pos;   // what the reconsider state and W10's rescue have always meant by "looks good"

    if (closed) return 'closed';
    if (stale) return 'stale';
    if (noSalary && !(rescue && good)) return 'nosal';
    if (money && !neg) return 'high';
    if (good && neg) return 'worth';
    if (pos) return 'pos';       // highlighted, never hidden, and not a high-yield listing
    if (neg) return 'kw';
    return 'none';
  }

  /** Is this verdict a card the board hides? An unknown verdict is NOT hidden — the safe direction is
   *  to show a listing, because a false hide costs the user a real job. */
  function isHidden(tier) {
    return HIDDEN.has(tier);
  }

  /** Card-text facts. Split out so `content.js` and the live harness assemble a verdict's inputs in one
   *  shape instead of two that can drift. `match` is `rules.matchKeywords` (injected, not imported). */
  function cardFacts(text, settings, match) {
    return {
      pos: match(text, (settings || {}).positive),
      neg: match(text, (settings || {}).negative),
    };
  }

  /**
   * Description facts: the keyword lists through the board's own matcher, the off-platform asks through
   * the detail page's own planner (W4, so the board and the listing's page can never disagree about whether
   * a sentence is an ask), and — when a scan read them — the listing's own weekly hours.
   *
   * **Both warning lists are display-only.** `flags` (off-platform asks) and `warns` (`overtime`: the
   * listing states more than a 40-hour week) are tags on the card and fields in the record; neither is an
   * input to `decide`. The user was explicit about the first one — a tag, not a gate — and the same
   * argument holds for the second: a 45-hour week is a real job, not a risk.
   *
   * Deduplicated and sorted: the same description hashed twice must produce the same facts, or the record
   * would look "changed" on every pass and rewrite storage forever.
   */
  function detailFacts(text, settings, match, plan, hours) {
    const t = typeof text === 'string' ? text : '';
    const cfg = { positive: (settings || {}).positive, negative: (settings || {}).negative };
    const warnings = plan ? plan(t, cfg) : [];
    return {
      pos: [...new Set(match(t, cfg.positive))].sort(),
      neg: [...new Set(match(t, cfg.negative))].sort(),
      flags: [...new Set(warnings.filter(r => r.kind === 'warn').map(r => r.rule))].sort(),
      warns: Number(hours) > 40 ? ['overtime'] : [],
    };
  }

  return { decide, isHidden, cardFacts, detailFacts, TIERS };
});
