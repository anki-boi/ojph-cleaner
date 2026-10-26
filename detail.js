/**
 * detail.js — the job's own page (spec.md W4.2/W4.3).
 *
 * Three jobs: mark the description with what the board's rules would have told you, put the figures the
 * page finally makes available next to them, and flag anything that pushes you off OnlineJobs.ph.
 *
 * The page is where `HOURS PER WEEK` finally exists as a number — a structured field, not prose — so the
 * monthly figure here is computed from the real hours instead of the board's 40 h/week assumption. When
 * the field says TBD the assumption comes back, and it says so on the bar (D28).
 *
 * Reads only. Nothing is hidden, nothing is fetched: the description and the overview are already in the
 * markup, and the exchange rate comes from `salary-cards.js`'s cache (which the board warms anyway).
 *
 * What the bar says and what gets marked is figures.js, shared with the Swipe card (D85); this file reads the
 * page and places them.
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage) return;  // node: nothing to do
  const dp = self.OJCDetailParse, F = self.OJCFigures;
  if (!dp || !F) return;

  // One reader for a listing's own page, shared with the board's deep scan: the description, the overview
  // fields and the job id exist in exactly one place (detail-parse.js).
  const { JOB_RE, DESC_SEL } = dp;
  const BAR_ID = 'ojc-detail-bar';
  const DEFAULTS = {
    positive: ['aud', 'australia', 'australian', 'remote', 'flexible', 'ai', 'automation', 'claude',
      'chatgpt', 'gemini', 'generation', 'vibe'],
    negative: ['editor', 'cold calling', 'cold call', 'graphic', 'aws', 'azure', 'bookkeeper',
      'book keeper', 'accounting', 'medical coding', 'medical billing', 'billing', 'onboarding',
      'marketing', 'social media', 'legal', 'paralegal', 'plumbing', 'video editor', 'graphic designer',
      'medical coder', 'ICD-10'],
    goalSalary: 60000, goalHourly: 1000, currency: 'PHP' };
  let settings = { ...DEFAULTS };
  let rates = {};

  const isJobPage = () => JOB_RE.test(location.pathname);

  /** The overview's own label/value pairs, read by the shared parser so the scan and this page cannot drift. */
  const overview = (labelRe) => dp.overview(document, labelRe);

  // ── The bar and the marks: figures.js, shared with the Swipe card (D85) ───
  /** The post's own fields, read by the shared parser so the scan and this page cannot drift. */
  const payFacts = () => F.facts({ posted: overview(/wage|salary/i), hoursRaw: overview(/hours?\s*per\s*week/i),
    typeRaw: overview(/type of work/i) }, rates);
  const highlight = (desc) => F.highlight(desc, settings);

  function renderBar(marks) {
    const desc = document.querySelector(DESC_SEL);
    if (!desc || !desc.parentNode) return;
    document.getElementById(BAR_ID)?.remove();                // rebuilt whole, so a stale state cannot linger
    const media = self.OJCMediaAsk?.find(dp.textOf(desc));   // D86
    const bar = F.bar(F.items(payFacts(), { settings, rates, marks, media, closed: !!self.OJCClosed?.pageSaysClosed() }), BAR_ID);
    desc.parentNode.insertBefore(bar, desc);
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  async function run() {
    if (!isJobPage()) return;
    const desc = document.querySelector(DESC_SEL);
    if (!desc) return;                                         // 2 of 20 sampled pages have none
    const marks = highlight(desc);
    // Rates only when the page needs one: a peso listing never pays for a fetch.
    const cur = F.currencies(overview(/wage|salary/i), settings);
    if (cur.length && self.OJCSalaryUI?.loadRates) {
      try { rates = await self.OJCSalaryUI.loadRates(cur); } catch { rates = {}; }
    }
    renderBar(marks);
    // Tell the memory what this listing says now (W12/D35): re-derive it, record a move if there was one, and
    // clear the mark - you are looking at the listing, so there is nothing left to tell you about it.
    try { await self.OJCRecordsUI?.recheck?.(document); } catch (e) { console.warn("[OJ Cleaner] re-check failed", e); }
  }

  chrome.storage.local.get('settings', (res) => {
    settings = { ...DEFAULTS, ...(res?.settings || {}) };
    run();
    console.log('[OJ Cleaner] detail page active', { job: JOB_RE.exec(location.pathname)?.[1] });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
      run();
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => run());
  else if (!document.querySelector(DESC_SEL)) {
    // The description can land after document_idle on a slow response; one short retry is enough.
    let tries = 0;
    const t = setInterval(() => { if (document.querySelector(DESC_SEL) || ++tries > 20) { clearInterval(t); run(); } }, 250);
  }
})();
