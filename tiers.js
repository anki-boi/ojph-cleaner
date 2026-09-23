/**
 * tiers.js — the verdict table (spec.md W12, D31).
 *
 * Pure: no DOM, no storage, no network. UMD, so `node test-tiers.js` can pin every branch offline.
 *
 * One function decides what every card is, and the order of its branches is the product:
 *
 *   closed → stale → no salary (unless rescued) → HIGH YIELD → worth considering → keyword-hide → highlighted → nothing
 *
 * The first three are unchanged from 0.8.0 and outrank everything: a listing you have seen close, one
 * outside your recency window and one that states no pay are facts about the listing, not opinions about
 * it. The rest is what a deep scan can move cards between.
 *
 * **The compatibility rule, with one deliberate exception (D40).** With no `detail` (no deep scan, no
 * cache) the table reduces to the verdicts 0.8.0 shipped — green / yellow / hidden — with the green split
 * into `high` (the goal met) and `pos` (a keyword you like, below the goal) so the chip can count them
 * apart. The exception: a listing that matched BOTH a keyword you like and one you asked to hide while
 * below a goal. 0.8.0 showed that yellow and this hides it, because the goal is a hard filter. Every other
 * case is unchanged, and the live harness recomputes its expectations through this same function, so the
 * two cannot drift.
 *
 * What the scan can do to a card, in the terms the user asked for:
 *
 * | movement | how |
 * |---|---|
 * | promote white → high  | the scan's own `HOURS PER WEEK` turns an assumed month into a stated one, and the listing now meets your goal |
 * | promote pos → high    | the same: a listing you like the sound of, whose real hours put it over your goal |
 * | promote white → pos   | the description matches a positive keyword the card's short text does not have |
 * | promote hidden → worth | the scan's stated hours put a hide-keyword listing at or above a goal — PAY earns this, a keyword cannot (D40) |
 * | demote high → worth   | the description adds a hide keyword, and the listing still meets a goal |
 * | demote high → pos     | …the stated hours no longer meet the goal, so it is only highlighted |
 * | demote pos → hidden   | the description adds a hide keyword on a listing below a goal: the hide wins (D40) |
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
   *             A yellow card that is unambiguously a keeper (the super green case, see the table above)
   *             so high can carry a hide keyword — that is why such a card badges both sides.
   *   `worth` — it meets one of your salary goals *and* a hide keyword matched, and it is not the
   *             super-green case above. Pay is the only thing that earns this tier: a keyword you like
   *             cannot, because the goal is a hard filter (D40).
   *
   * A keyword you like on a listing that pays below your goal is neither: it is `pos` — the green highlight
   * this extension has always drawn, with its `✓ kw` badge, and emphatically not a high-yield listing. It is
   * its own verdict because the chip has to count it, the views must not include it, and the old "good"
   * predicate conflated the two ideas.
   *
   * **Off-platform asks are not part of this function either.** They are `detail.flags`, shown as tags on
   * the card; a week longer than 40 hours is flagged on the card by salary-cards.js from the record's own
   * `fields.hoursPerWeek`. The user: "the off-platform application thing should just be a tag, not a red
   * gate as part of the filter". A tag informs; a gate decides.
   */
  /** How far the listing clears the goal that judges it, as a fraction: 0.5 means "50 % above your goal".
   *  `null` when there is no mark and no margin to read — and `null` never promotes, because a margin
   *  that cannot be proven is not one. */
  const goalBy = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  function decide({ closed, stale, noSalary, rescue, card, detail, negotiable = false, rescueNeg = false } = {}) {
    const c = card || {};
    // The card's text and the description are the same keyword vocabulary, so the counts merge — the
    // same union the badges show. A keyword matched on both sides counts once.
    const posN = new Set([...(c.pos || []), ...((detail || {}).pos || [])]).size;
    const negN = new Set([...(c.neg || []), ...((detail || {}).neg || [])]).size;
    const pos = posN > 0;
    const neg = negN > 0;
    const money = !!c.goal;      // the goal mark salary-cards.js puts on a listing at or above your goal
    const by = goalBy(c.goalBy); // how far above, 0.5 = 50 % over — null when unprovable
    // What W10's and the negotiable rescue mean by "looks good" — the two doors a no-figure listing can come
    // in through. The reconsider tier does NOT use this any more: it needs `money` (D40).
    const good = money || pos;

    if (closed) return 'closed';
    if (stale) return 'stale';
    // The no-salary hide, with two opt-in rescues that both need `good`: the plain rescue (W10), and the
    // negotiable one (0.12) — a listing that says its pay is negotiable and otherwise looks good stays on
    // the board with a ⚠ negotiable tag, instead of hiding. `good` is the RESCUE's predicate only: for a
    // no-figure listing `money` can never be true, so these two doors are keyword doors by construction.
    if (noSalary && !(good && (rescue || (negotiable && rescueNeg)))) return 'nosal';
    if (money && !neg) return 'high';
    if (money && neg) {
      // Super green: it would be yellow, but it is unambiguously a keeper — more keywords you like than
      // you hate, and the pay clears your goal by more than half again. The user: "significantly more
      // positive keywords than negative (+ salary significantly higher) → high yield, not yellow".
      if (by >= 0.5 && posN > negN) return 'high';
      return 'worth';
    }
    // **The goal is a hard filter, so this test comes BEFORE `pos` (D40).** Below a goal — or with no figure
    // to clear one — a hide keyword wins outright: a keyword you like highlights a listing, and it never
    // rescues one. The user, on finding this tier reachable by keywords alone: "you might have promoted a
    // lot of listings to worth considering due to the presence of positive keywords being more than the
    // negative keywords, but do not forget that the goal salary is a hard filter." Ordering it the other
    // way would show those listings GREEN, which is worse than the yellow it replaces.
    if (neg) return 'kw';
    if (pos) return 'pos';
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
   * Description facts: the keyword lists through the board's own matcher, and the off-platform asks through
   * the detail page's own planner (W4, so the board and the listing's page can never disagree about whether
   * a sentence is an ask).
   *
   * **`flags` is display-only.** Off-platform asks are tags on the card and fields in the record; they are
   * never an input to `decide` — the user was explicit, a tag not a gate. A week longer than 40 hours is the
   * same shape of signal, but it lives with the hours in `fields.hoursPerWeek` (salary-cards.js prints it in
   * the warning colour), not here: a 45-hour week is a real job, not a risk.
   *
   * Deduplicated and sorted: the same description hashed twice must produce the same facts, or the record
   * would look "changed" on every pass and rewrite storage forever.
   */
  function detailFacts(text, settings, match, plan) {
    const t = typeof text === 'string' ? text : '';
    const cfg = { positive: (settings || {}).positive, negative: (settings || {}).negative };
    const warnings = plan ? plan(t, cfg) : [];
    return {
      pos: [...new Set(match(t, cfg.positive))].sort(),
      neg: [...new Set(match(t, cfg.negative))].sort(),
      flags: [...new Set(warnings.filter(r => r.kind === 'warn').map(r => r.rule))].sort(),
    };
  }

  return { decide, isHidden, cardFacts, detailFacts, TIERS };
});
