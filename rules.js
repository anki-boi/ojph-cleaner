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
   * Case-insensitive substring keyword match.
   * Returns the list of keywords that matched (empty array = no match).
   */
  function matchKeywords(text, keywords) {
    const t = (text || '').toLowerCase();
    return (keywords || []).filter(k => k && k.trim() && t.includes(k.trim().toLowerCase()));
  }

  return { hasSalary, matchKeywords };
});
