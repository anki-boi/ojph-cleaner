/**
 * figures.js: a listing's figures bar and its highlighted words, shared by the listing's own page (detail.js) and
 * the Swipe card (swipe.js), so the two can never tell you different things about the same post (spec.md D85).
 *
 *   ⏱ 40 h/week   ≈ $8/hr (≈ $1,280/mo)   ✗ below your $8.76/hr minimum   ⚠ wants you off OLJ   2 ✓ keyword matches
 *
 * Split out of detail.js, unchanged in what it decides. It reads nothing itself: the caller hands it the post's
 * own fields (WAGE / SALARY, HOURS PER WEEK, TYPE OF WORK, from the page or from the kept copy), the settings and
 * the exchange rates, and gets back the bar's items and, for `highlight`, the marks it painted.
 */
(() => {
  'use strict';
  if (typeof document === 'undefined') return;
  const planner = self.OJCDetailText, salary = self.OJCSalary;
  if (!planner || !salary) return;

  const HL_CLASS = { pos: 'ojc-hl-pos', neg: 'ojc-hl-neg', warn: 'ojc-hl-warn' };
  /** Why a mark is there, on hover — every one of these is a claim, so each says which rule made it. */
  const HL_TITLE = {
    keyword: 'one of your keywords',
    url: 'a link that leaves OnlineJobs.ph',
    email: 'an email address — applying by email leaves the platform',
    ask: 'this asks you to apply somewhere other than OnlineJobs.ph',
    redacted: 'OnlineJobs.ph removed a link here: the poster tried to send you off-platform',
  };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  /** D66: the display currency, or null (pesos) while it has no rate. */
  const dispOf = (settings, rates) => (settings.currency && settings.currency !== 'PHP' && rates[settings.currency]
    ? { code: settings.currency, rate: rates[settings.currency] } : null);
  /** A figure is only real if both ends are numbers — NaN from a bad rate must read as "no figure", not "₱NaN". */
  const finite = (o) => (o && Number.isFinite(o.min) && Number.isFinite(o.max) ? o : null);

  // ── Highlighting ─────────────────────────────────────────────────────────
  /** Undo a previous run: our spans become text again, so the walk always starts from raw text. */
  function unwrap(root) {
    for (const span of root.querySelectorAll('[class^="ojc-hl-"]')) {
      span.parentNode.replaceChild(document.createTextNode(span.textContent), span);
    }
    root.normalize();   // rejoin the split text nodes, or every run fragments the paragraph further
  }

  /** Mark the words in `root`: keywords you like and block, and anything that sends you off the platform. */
  function highlight(root, settings) {
    unwrap(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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

  // ── The figures ──────────────────────────────────────────────────────────
  /**
   * The pay figure, and how much of it is real. `parseSalary` is the board's own parser, so a per-unit
   * rate ("5$ per thumbnail") is refused here exactly as it is there, and a part-time listing without
   * stated hours gets no month at all rather than an invented 40-hour one.
   */
  function facts({ posted, hoursRaw, typeRaw }, rates) {
    const hours = /^\d+$/.test(clean(hoursRaw)) ? Number(clean(hoursRaw)) : null;
    const partTime = /part[\s-]?time|gig/i.test(typeRaw || '');
    const fullTime = /full[\s-]?time/i.test(typeRaw || '');
    const assumed = false;                                    // D71: no 40 h week is ever assumed (was D28)
    const parsed = salary.parseSalary(posted, hours);
    const php = finite(parsed ? salary.toPhp(parsed, rates) : null);
    const rate = finite(parsed && !php ? salary.ratePhp(parsed, rates) : null);
    return { posted, hours, hoursRaw, partTime, fullTime, assumed, parsed, php, rate };
  }

  /** The tooltip that makes the figure auditable: where it came from and what it assumes. */
  function notes(f) {
    if (!f.parsed) return 'the listing posts no figure this extension can read';
    const rate = f.parsed.currency === 'PHP' ? '' : ` · ${f.parsed.currency}→PHP at the ECB reference rate`;
    const hours = f.hours !== null ? `, at the ${f.hours} h/week this listing states`
      : f.assumed ? `, at an assumed ${salary.FULL_TIME_HOURS} h/week` : '';
    return `as posted: ${f.posted}${hours}${rate}`;
  }

  /** The bar's items, in order: [{ cls, text, title }]. `marks` are highlight()'s counts; `closed` the site's notice. */
  function items(f, { settings, rates, marks = { warn: 0, pos: 0, neg: 0 }, closed = false }) {
    const out = [];
    const add = (cls, text, title) => out.push({ cls, text, title });
    const disp = dispOf(settings, rates);
    // A dead listing is the one fact that outranks every other number on this bar.
    if (closed) add('ojc-bar-closed', '⊘ this job has been closed', 'remembered: it will be hidden on the board from now on');

    if (f.hours !== null) add('ojc-bar-hours', `⏱ ${f.hours} h/week`, 'as stated in the listing');
    else add('ojc-bar-hours ojc-bar-unknown', `⏱ hours ${f.hoursRaw ? clean(f.hoursRaw) : 'not stated'}`,
      f.partTime ? 'part-time and no stated hours — a month cannot be computed honestly' : 'the listing does not state hours per week');

    // D70/D71: per hour first — the month over the listing's own HOURS PER WEEK, or nothing per hour at all.
    const ph = self.OJCPerHour?.perHour(f.parsed, rates, { hours: f.hours, basis: f.hours !== null ? 'detail' : 'unstated' });
    if (f.php) {
      // This IS the post, so "read": no hours here means the post states none.
      const line = self.OJCPerHour?.payLine({ php: f.php, ph, read: true }, disp) || { main: salary.formatNote(f.php, disp), sub: '' };
      add('ojc-bar-pay', line.main + (line.sub ? `  (${line.sub})` : ''), notes(f));
      if (f.assumed) add('ojc-bar-assumed', self.OJCLabels.mark.assumes(salary.FULL_TIME_HOURS), notes(f));
    } else if (f.rate) {
      add('ojc-bar-pay', salary.formatRate(f.rate, f.parsed.unit, disp) + ' (rate only)',
        'the listing states no hours per week, so no monthly figure is claimed');
    } else if (f.posted) {
      add('ojc-bar-pay ojc-bar-unknown', `pay: ${f.posted}`,
        f.parsed && f.parsed.perUnit ? 'paid per unit as posted — a per-unit rate has no monthly equivalent'
                                     : 'no figure this extension can convert honestly');
    }

    // The goal line, judged exactly like the board (W13.4, spec.md D13): a **Full Time** posting goes against
    // the MONTHLY goal, a **Part Time** or unstated one against the posted rate, and a month-only posting against
    // the monthly goal because there is no rate to compare against. Neither goal is ever derived from the other.
    const goalM = salary.goalInPhp(settings.goalSalary, settings.currency, rates),
      goalH = salary.goalInPhp(settings.goalHourly, settings.currency, rates);
    // The board's `hourlyPhp`, word for word: a posted rate exists whenever the listing quotes one.
    const postedRate = f.parsed && (f.parsed.unit === 'hour' || f.parsed.unit === 'hour?')
      ? finite(salary.ratePhp(f.parsed, rates)) : null;
    // Stated HOURS PER WEEK makes the board's basis 'detail', which is never monthly: a posting that stated its
    // hours and still quoted a rate is judged on the rate, because it chose to quote one.
    const judgeMonthly = f.hours === null ? (f.partTime ? false : (f.fullTime || !postedRate)) : !postedRate;
    const judgeHourly = !judgeMonthly && postedRate;
    if ((judgeMonthly && f.php && goalM > 0) || (judgeHourly && goalH > 0)) {
      const goal = judgeMonthly ? goalM : goalH;
      const met = judgeMonthly ? salary.meetsGoal(f.php, goalM) : salary.meetsGoal(postedRate, goalH);
      const unit = judgeMonthly ? '/mo' : '/hr';
      add(met ? 'ojc-bar-goal ojc-bar-met' : 'ojc-bar-goal',
        `${met ? '✔ meets' : '✗ below'} your ${salary.formatRate({ min: goal, max: goal }, 'hour', disp).replace(/^≈ /, '').replace(/\/hr$/, '')}${unit} minimum`,
        met ? 'at or above the minimum pay you set' : 'below the minimum pay you set');
    }

    if (marks.warn) add('ojc-bar-warn', self.OJCLabels.mark.offPlatform, 'this listing asks you to apply or contact outside OnlineJobs.ph');
    if (marks.pos || marks.neg) {
      add('ojc-bar-counts',
        [marks.pos ? `${marks.pos} ✓` : '', marks.neg ? `${marks.neg} ✗` : ''].filter(Boolean).join(' · ') + ' keyword match' + (marks.pos + marks.neg === 1 ? '' : 'es'),
        'highlighted in the description below');
    }
    return out;
  }

  /** The bar as an element: `<div class="ojc-figbar">` with one span per item. */
  function bar(list, id) {
    const b = document.createElement('div');
    if (id) b.id = id;
    b.className = 'ojc-figbar';
    for (const it of list) {
      const s = document.createElement('span');
      s.className = it.cls;
      s.textContent = it.text;
      if (it.title) s.title = it.title;
      b.appendChild(s);
    }
    return b;
  }

  /** The currencies a post's figure needs a rate for: its own, and the display currency. */
  function currencies(posted, settings) {
    const p = salary.parseSalary(posted, null);
    const want = p && p.currency !== 'PHP' ? [p.currency] : [];
    if (settings.currency && settings.currency !== 'PHP') want.push(settings.currency);   // D66: the display currency
    return want;
  }

  self.OJCFigures = { highlight, unwrap, facts, notes, items, bar, currencies, HL_CLASS, HL_TITLE };
})();
