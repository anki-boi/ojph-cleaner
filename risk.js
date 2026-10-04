/**
 * risk.js — the scam radar (spec.md D58): a 0–100 score from fixed, listed signals, shown as a tag with its
 * reasons. A TAG, never a gate — it never hides a listing and never moves its tier (the D38 rule: "it should just
 * be a tag"). Deterministic on purpose: the same post always scores the same, and every point has a reason the
 * user can read and disagree with. No model, nothing sent anywhere (§8).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCRisk = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FEE = /\b(training|registration|application|membership|starter)\s+fees?\b|\byou\s+(will\s+|must\s+|need\s+to\s+|have\s+to\s+)?pay\s+(a|the|an)\s+(small\s+|one-time\s+)?fee\b|\bstarter\s+kit\b|\brefundable\s+deposit\b/i;
  // …and only when the sentence puts that fee on the APPLICANT. Bookkeeping posts are full of fees ("account for
  // platform fees, refunds and payment-processing fees" put a live bookkeeping job at "risky 70"): a fee is a red
  // flag when someone has to pay it to get or start the job.
  const ON_YOU = /\b(you|your|applicants?|candidates?)\b|\b(required|upfront|up-front|one-time|before\s+(you\s+)?start(ing)?)\b|[$₱]\s?\d|\b(php|usd)\s?\d/i;
  // "We cover the registration fee" is a perk, not a scam: a sentence where the employer pays is not a fee asked of you.
  const EMPLOYER_PAYS = /\b(we|company|employer|client)\s+(will\s+)?(pay|pays|cover|covers|shoulder|shoulders|reimburse|reimburses|handle|handles)\b/i;
  const sentences = (t) => String(t || '').split(/(?<=[.!?\n])\s+/);
  const asks = (i) => (i.flags || []).some(f => f !== 'redacted');
  const redacted = (i) => (i.flags || []).includes('redacted') || /-{8,}/.test(i.text);
  const SIGNALS = [
    // [id, points, why, test(input)]
    ['fee', 40, 'asks YOU to pay (a training, registration or starter fee)',
      (i) => sentences(i.text).some(s => FEE.test(s) && ON_YOU.test(s) && !EMPLOYER_PAYS.test(s))],
    ['offPlatform', 25, 'wants you to apply or talk outside OnlineJobs.ph', (i) => asks(i)],
    // A redaction is the SAME fact as an off-platform ask (the site removed the link the ask pointed at). It
    // counts fully only when it is the only trace of one — measured live: counting both put 17 of 30 cards at
    // "risky 60" for nothing more than "email us", which is a tag, not a scam (D38).
    ['redacted', 25, 'OnlineJobs.ph removed a link from the post — someone tried to send you off the site',
      (i) => redacted(i) && !asks(i)],
    ['redactedToo', 5, 'and OnlineJobs.ph had to remove a link from it',
      (i) => redacted(i) && asks(i)],
    ['unpaidTrial', 20, 'expects unpaid trial work or a free test task',
      (i) => /\bunpaid\s+(trial|test|training|task)|\bfree\s+(trial|test|sample)\s+(task|work|project|article)|\btrial\s+(period|task|week)\s+(is\s+)?(unpaid|not\s+paid|without\s+pay)/i.test(i.text)],
    ['crypto', 20, 'mentions crypto, forex or an "investment opportunity"',
      (i) => /\b(crypto(currency)?|bitcoin|forex|binary\s+options?|nfts?|investment\s+opportunit(y|ies))\b/i.test(i.text)],
    ['tooGood', 15, 'pays 3× or more what similar jobs on this board pay',
      (i) => i.pay > 0 && i.median > 0 && i.pay >= 3 * i.median],
    // Weak on this board: many legitimate employers post without a name (measured: most of the 21 cards at 40 were
    // "email us" + its redaction + no name). A nudge, never enough to tag on its own or with an ask.
    ['noCompany', 5, 'no company name on the post',
      (i) => i.company !== undefined && !String(i.company || '').trim()],
  ];
  const THRESHOLD = 40;   // a tag at 40+: one serious signal, or two smaller ones together

  /**
   * @param input { text, flags, company, pay, median } — text: the listing's own words (card + description);
   *   flags: detail-text's off-platform rules; pay/median: monthly pesos (this card / the board), 0 if unknown.
   * @returns { score, reasons: [{ id, points, why }], tagged }
   */
  function score(input) {
    const i = { text: '', flags: [], pay: 0, median: 0, ...input };
    const reasons = SIGNALS.filter(([, , , t]) => t(i)).map(([id, points, why]) => ({ id, points, why }));
    const s = Math.min(100, reasons.reduce((n, r) => n + r.points, 0));
    return { score: s, reasons, tagged: s >= THRESHOLD };
  }

  const median = (xs) => {
    const s = xs.filter(x => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
    if (!s.length) return 0;
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  return { score, median, SIGNALS: SIGNALS.map(([id, points, why]) => ({ id, points, why })), THRESHOLD };
});
