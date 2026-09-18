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
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage) return;  // node: nothing to do
  const planner = self.OJCDetailText, salary = self.OJCSalary;
  if (!planner || !salary) return;

  const JOB_RE = /\/jobseekers\/job\/[^/]*-(\d+)\/?$/;   // .../job/some-slug-1733463
  const DESC_SEL = 'p#job-description';
  const DD_SEL = 'dl.row.no-gutters dd';
  const BAR_ID = 'ojc-detail-bar';
  const HL_CLASS = { pos: 'ojc-hl-pos', neg: 'ojc-hl-neg', warn: 'ojc-hl-warn' };
  /** Why a mark is there, on hover — every one of these is a claim, so each says which rule made it. */
  const HL_TITLE = {
    keyword: 'one of your keywords',
    url: 'a link that leaves OnlineJobs.ph',
    email: 'an email address — applying by email leaves the platform',
    ask: 'this asks you to apply somewhere other than OnlineJobs.ph',
    redacted: 'OnlineJobs.ph removed a link here: the poster tried to send you off-platform',
  };
  const DEFAULTS = { positive: [], negative: [], goalSalary: 0, goalHourly: 0 };
  let settings = { ...DEFAULTS };
  let rates = {};

  const isJobPage = () => JOB_RE.test(location.pathname);
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  /** The overview's own label/value pairs: `dd > h3` is the label, `dd > p` the value. */
  function overview(labelRe) {
    for (const dd of document.querySelectorAll(DD_SEL)) {
      const h = dd.querySelector('h3'), p = dd.querySelector('p');
      if (h && p && labelRe.test(clean(h.textContent))) return clean(p.textContent);
    }
    return null;
  }

  // ── Highlighting ─────────────────────────────────────────────────────────
  /** Undo a previous run: our spans become text again, so the walk always starts from raw text. */
  function unwrap(desc) {
    for (const span of desc.querySelectorAll('[class^="ojc-hl-"]')) {
      span.parentNode.replaceChild(document.createTextNode(span.textContent), span);
    }
    desc.normalize();   // rejoin the split text nodes, or every run fragments the paragraph further
  }

  function highlight(desc) {
    unwrap(desc);
    const walker = document.createTreeWalker(desc, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let warn = 0, pos = 0, neg = 0;
    for (const node of nodes) {
      const ranges = planner.plan(node.nodeValue, settings);
      if (!ranges.length) continue;
      const frag = document.createDocumentFragment();
      let at = 0;
      for (const r of ranges) {
        if (r.start > at) frag.appendChild(document.createTextNode(node.nodeValue.slice(at, r.start)));
        const span = document.createElement('span');
        span.className = HL_CLASS[r.kind];
        span.title = HL_TITLE[r.rule] || '';
        span.textContent = node.nodeValue.slice(r.start, r.end);
        frag.appendChild(span);
        at = r.end;
        if (r.kind === 'warn') warn++; else if (r.kind === 'pos') pos++; else neg++;
      }
      if (at < node.nodeValue.length) frag.appendChild(document.createTextNode(node.nodeValue.slice(at)));
      node.parentNode.replaceChild(frag, node);
    }
    return { warn, pos, neg };
  }

  // ── The bar ──────────────────────────────────────────────────────────────
  const item = (cls, text, title) => {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    if (title) s.title = title;
    return s;
  };

  /**
   * The pay figure, and how much of it is real. `parseSalary` is the board's own parser, so a per-unit
   * rate ("5$ per thumbnail") is refused here exactly as it is there, and a part-time listing without
   * stated hours gets no month at all rather than an invented 40-hour one.
   */
  function payFacts() {
    const posted = overview(/wage|salary/i);
    const hoursRaw = overview(/hours?\s*per\s*week/i);
    const typeRaw = overview(/type of work/i);
    const hours = /^\d+$/.test(clean(hoursRaw)) ? Number(clean(hoursRaw)) : null;
    const partTime = /part[\s-]?time|gig/i.test(typeRaw || '');
    const assumed = hours === null && !partTime;              // D28: only full-time/unstated may assume
    const basis = hours !== null ? hours : assumed ? salary.FULL_TIME_HOURS : null;
    const parsed = salary.parseSalary(posted, basis);
    const php = parsed ? salary.toPhp(parsed, rates) : null;
    const rate = parsed && !php ? salary.ratePhp(parsed, rates) : null;
    return { posted, hours, hoursRaw, partTime, assumed, parsed, php, rate };
  }

  function renderBar(marks) {
    const desc = document.querySelector(DESC_SEL);
    if (!desc || !desc.parentNode) return;
    const old = document.getElementById(BAR_ID);
    if (old) old.remove();                                    // rebuilt whole, so a stale state cannot linger

    const f = payFacts();
    const bar = document.createElement('div');
    bar.id = BAR_ID;

    if (f.hours !== null) bar.appendChild(item('ojc-bar-hours', `⏱ ${f.hours} h/week`, 'as stated in the listing'));
    else bar.appendChild(item('ojc-bar-hours ojc-bar-unknown', `⏱ hours ${f.hoursRaw ? clean(f.hoursRaw) : 'not stated'}`,
      f.partTime ? 'part-time and no stated hours — a month cannot be computed honestly'
                 : 'the listing does not state hours per week'));

    if (f.php) {
      const note = salary.formatNote(f.php);
      bar.appendChild(item('ojc-bar-pay', note, notes(f)));
      if (f.assumed) bar.appendChild(item('ojc-bar-assumed', `assumes ${salary.FULL_TIME_HOURS} h/week — verify`, notes(f)));
    } else if (f.rate) {
      bar.appendChild(item('ojc-bar-pay', salary.formatRate(f.rate, f.parsed.unit) + ' (rate only)',
        'the listing states no hours per week, so no monthly figure is claimed'));
    } else if (f.posted) {
      bar.appendChild(item('ojc-bar-pay ojc-bar-unknown', `pay: ${f.posted}`,
        f.parsed && f.parsed.perUnit ? 'paid per unit as posted — a per-unit rate has no monthly equivalent'
                                     : 'no figure this extension can convert honestly'));
    }

    const goalM = Number(settings.goalSalary) || 0, goalH = Number(settings.goalHourly) || 0;
    const judgeMonthly = f.php && goalM > 0;
    const judgeHourly = !f.php && f.rate && goalH > 0;
    if (judgeMonthly || judgeHourly) {
      const goal = judgeMonthly ? goalM : goalH;
      const met = judgeMonthly ? salary.meetsGoal(f.php, goalM) : salary.meetsGoal(f.rate, goalH);
      const unit = judgeMonthly ? '/mo' : '/hr';
      bar.appendChild(item(met ? 'ojc-bar-goal ojc-bar-met' : 'ojc-bar-goal',
        `${met ? '✔' : '✗'} your ₱${goal.toLocaleString('en-US')}${unit} goal`,
        met ? 'at or above the goal you set' : 'below the goal you set'));
    }

    if (marks.warn) bar.appendChild(item('ojc-bar-warn', '⚠ applies off-platform',
      'this listing asks you to apply or contact outside OnlineJobs.ph'));
    if (marks.pos || marks.neg) {
      bar.appendChild(item('ojc-bar-counts',
        [marks.pos ? `${marks.pos} ✓` : '', marks.neg ? `${marks.neg} ✗` : ''].filter(Boolean).join(' · ') + ' keyword match' + (marks.pos + marks.neg === 1 ? '' : 'es'),
        'highlighted in the description below'));
    }
    desc.parentNode.insertBefore(bar, desc);
  }

  /** The tooltip that makes the figure auditable: where it came from and what it assumes. */
  function notes(f) {
    if (!f.parsed) return 'the listing posts no figure this extension can read';
    const rate = f.parsed.currency === 'PHP' ? '' :
      ` · ${f.parsed.currency}→PHP at the ECB reference rate`;
    const hours = f.hours !== null ? `, at the ${f.hours} h/week this listing states`
      : f.assumed ? `, at an assumed ${salary.FULL_TIME_HOURS} h/week` : '' ;
    return `as posted: ${f.posted}${hours}${rate}`;
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  async function run() {
    if (!isJobPage()) return;
    const desc = document.querySelector(DESC_SEL);
    if (!desc) return;                                         // 2 of 20 sampled pages have none
    const marks = highlight(desc);
    // Rates only when the page needs one: a peso listing never pays for a fetch.
    const cur = (() => {
      const f = payFacts();
      return f.parsed && f.parsed.currency !== 'PHP' ? [f.parsed.currency] : [];
    })();
    if (cur.length && self.OJCSalaryUI?.loadRates) {
      try { rates = await self.OJCSalaryUI.loadRates(cur); } catch { rates = {}; }
    }
    renderBar(marks);
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
