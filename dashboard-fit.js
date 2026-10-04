/**
 * dashboard-fit.js — the pure half of the bridge to the sibling repo (onlinejobs.ph-suite).
 *
 * The suite is a local dashboard with your saved jobs, your resume profiles and a deterministic
 * resume-fit score. This module is the shape of the conversation with it; dashboard-cards.js is the
 * half that talks. Nothing here touches chrome or the DOM, so the whole contract is unit-testable
 * (test-dashboard.js) — the same pure/applier split as salary.js / salary-cards.js.
 *
 * The one thing worth being strict about: the fit number is the suite's, not ours. This extension has
 * no resume and no scorer; it asks, and it shows what it is told, including "no profile loaded".
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.OJCDashboard = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const DEFAULT_DASHBOARD = 'http://127.0.0.1:8371';   // main.py's own default port (8372 is its documented second-instance port)
  const MAX_BATCH = 50;          // the suite's own per-request cap
  const MAX_DESC = 1200;         // a fit score is built from the first screen of a description
  const MAX_SKILLS = 20;
  const FIT_MAX = 60;            // the suite's job-dependent half: skills (40) + keywords (20)

  /** Off is a URL the user typed as empty, not a missing setting. */
  const enabled = (url) => typeof url === 'string' && url.trim() !== '';

  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  /** One listing, in the shape the suite's POST /api/resume/fit expects. */
  const fitItem = ({ title, description, salary, workType, skills }) => ({
    title: clean(title),
    description: clean(description).slice(0, MAX_DESC),
    salary: clean(salary),
    work_type: clean(workType),
    // The listing's own tags, deduped. A score is only as honest as the skills it was given,
    // and these are the only ones either side of the bridge can know.
    skills: [...new Set((skills || []).map(clean).filter(Boolean))].slice(0, MAX_SKILLS),
  });

  /** Batches the suite will accept: never more than its cap, never an empty batch. */
  const chunk = (items, size = MAX_BATCH) => {
    const n = Number.isFinite(size) && size > 0 ? size : MAX_BATCH;   // a 0 here would spin forever
    const out = [];
    for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
    return out.filter((b) => b.length);
  };

  /**
   * The badge for one result, or null when there is nothing honest to say.
   * `fit` is out of 60 (skills + keywords); `total` adds the resume's own hygiene, which is the same
   * for every listing, so the badge shows the half that actually differs between jobs.
   */
  const badge = (result) => {
    // fit_max is the suite saying how much of the scale it could actually score: a listing
    // it never harvested has no search keyword, so only the skill half (40) is real.
    const max = Number.isFinite(result?.fit_max) && result.fit_max > 0 ? result.fit_max : 0;
    if (!max || !Number.isFinite(result.fit)) return null;   // no data, no number
    const fit = Math.max(0, Math.min(max, Math.round(result.fit)));
    const profile = result.profile ? ` · profile: ${result.profile}` : '';
    return {
      fit, max,
      text: `fits your resume ${fit}/${max}`,
      title: `Your resume matches this listing ${fit}/${max} on the skills and keywords it `
             + `states (total ${result.total}/100 with resume formatting)${profile}`,
    };
  };

  /** The deep link back into the dashboard: the suite keys jobs by the site's id, not its own row id. */
  const linkFor = (base, jobId) => {
    if (!enabled(base) || !jobId) return null;
    return `${String(base).replace(/\/+$/, '')}/?job=${encodeURIComponent(jobId)}`;
  };

  return { DEFAULT_DASHBOARD, MAX_BATCH, MAX_DESC, MAX_SKILLS, FIT_MAX, enabled, clean, fitItem, chunk, badge, linkFor };
});
