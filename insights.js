/**
 * insights.js — what the jobs you have seen actually pay, and where your minimum sits (spec.md D61).
 *
 * Built only from `jobRecords` on this device — every listing the extension has read in full — and only from
 * figures it can state honestly: a monthly figure for a full-time listing (its own HOURS PER WEEK, or the
 * 40-hour full-time week), and the posted rate for everything else. The same rule as the cards (D10/D13): two
 * charts, never one axis pretending a month and an hour are comparable.
 *
 * The pure half (exported for test-insights.js) does the statistics; the page half draws them on jobs.html.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCInsightsPure = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /** Linear-interpolated quantile of an ascending array. */
  function quantile(sorted, q) {
    if (!sorted.length) return null;
    const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  function summarize(values) {
    const s = values.filter(Number.isFinite).sort((a, b) => a - b);
    return { n: s.length, p25: quantile(s, 0.25), p50: quantile(s, 0.5), p75: quantile(s, 0.75), min: s[0] ?? null, max: s[s.length - 1] ?? null };
  }
  /** The share of listings paying LESS than `x` — "your minimum is above 64 % of them". */
  const shareBelow = (values, x) => (values.length ? values.filter(v => v < x).length / values.length : 0);
  /** Round-number bins over the bulk of the data (2nd–98th percentile); the tails fold into the end bins. */
  function bins(values, k = 10) {
    const s = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!s.length) return [];
    let lo = quantile(s, 0.02), hi = quantile(s, 0.98);
    if (hi <= lo) { lo = s[0]; hi = s[s.length - 1] + 1; }
    const raw = (hi - lo) / k, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(x => x >= raw);
    const start = Math.floor(lo / step) * step;
    const n = Math.max(1, Math.ceil((hi - start) / step));
    const out = Array.from({ length: n }, (_, i) => ({ lo: start + i * step, hi: start + (i + 1) * step, n: 0, openLo: i === 0, openHi: i === n - 1 }));
    for (const v of s) out[Math.min(n - 1, Math.max(0, Math.floor((v - start) / step)))].n++;
    return out;
  }
  return { quantile, summarize, shareBelow, bins };
});

(() => {
  'use strict';
  if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) return;
  const P = self.OJCInsightsPure, S = self.OJCSalary;
  if (!S) return;
  const FULL = /full/i;
  const NS = 'http://www.w3.org/2000/svg';

  const sv = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  /** Every honest figure in the memory: monthly (full-time) and hourly (everything else), in pesos. */
  function figures(records, rates) {
    const monthly = [], hourly = [];
    for (const r of Object.values(records || {})) {
      const f = r && r.fields;
      if (!f || !f.wage) continue;
      const full = FULL.test(f.typeOfWork || '');
      const hours = Number.isFinite(f.hoursPerWeek) ? f.hoursPerWeek : full ? S.FULL_TIME_HOURS : null;
      const p = S.parseSalary(f.wage, hours);
      if (!p) continue;
      if (full) { const m = S.toPhp(p, rates); if (m && Number.isFinite(m.min)) monthly.push(m.min); }
      else if (p.unit === 'hour' || p.unit === 'hour?') { const r1 = S.ratePhp(p, rates); if (r1 && Number.isFinite(r1.min)) hourly.push(r1.min); }
    }
    return { monthly, hourly };
  }

  function chart(title, values, goalPhp, money, unit) {
    const box = h('figure', 'ins-fig');
    box.append(h('figcaption', 'ins-cap', title));
    const st = P.summarize(values);
    if (st.n < 5) {
      box.append(h('p', 'ins-note', st.n ? `Only ${st.n} so far — read a few more posts and this fills in.` : 'Nothing yet — press Read posts on a search and come back.'));
      return box;
    }
    const line = h('p', 'ins-sum');
    line.append(`${st.n} jobs · middle half ${money(st.p25)}–${money(st.p75)}${unit} · median `, h('b', null, money(st.p50) + unit));
    box.append(line);
    if (goalPhp > 0) {
      const pct = Math.round(100 * P.shareBelow(values, goalPhp));
      box.append(h('p', 'ins-goal', `Your minimum (${money(goalPhp)}${unit}) is above ${pct}% of them.`));
    }
    // A histogram: one series, one hue, bars ≤ 24px with 4px rounded tops and 2px surface gaps, a hairline
    // baseline, and the minimum as a labelled ink line — not a second colour.
    const B = P.bins(values, 10);
    const W = 420, H = 140, PAD = { l: 8, r: 8, t: 18, b: 26 };
    const maxN = Math.max(...B.map(b => b.n));
    const slot = (W - PAD.l - PAD.r) / B.length, bw = Math.min(24, slot - 2);
    const x = (v) => PAD.l + ((v - B[0].lo) / (B[B.length - 1].hi - B[0].lo)) * (W - PAD.l - PAD.r);
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ins-svg', role: 'img', 'aria-label': `${title}: histogram of ${st.n} listings` });
    svg.append(sv('line', { x1: PAD.l, x2: W - PAD.r, y1: H - PAD.b, y2: H - PAD.b, class: 'ins-axis' }));
    const tip = h('div', 'ins-tip');
    tip.hidden = true;
    B.forEach((b, i) => {
      const bh = maxN ? ((H - PAD.t - PAD.b) * b.n) / maxN : 0;
      const cx = PAD.l + slot * i + slot / 2;
      const y = H - PAD.b - bh, r = Math.min(4, bh / 2, bw / 2);
      const path = bh > 0 ? `M${cx - bw / 2},${H - PAD.b} V${y + r} Q${cx - bw / 2},${y} ${cx - bw / 2 + r},${y} H${cx + bw / 2 - r} Q${cx + bw / 2},${y} ${cx + bw / 2},${y + r} V${H - PAD.b} Z` : '';
      if (path) svg.append(sv('path', { d: path, class: 'ins-bar' }));
      const label = `${b.openLo ? 'under ' + money(b.hi) : b.openHi ? money(b.lo) + ' and up' : money(b.lo) + '–' + money(b.hi)}${unit}: ${b.n} job${b.n === 1 ? '' : 's'}`;
      // The hit target is the whole slot, not the bar: a short bar must still be easy to point at.
      const hit = sv('rect', { x: PAD.l + slot * i, y: PAD.t, width: slot, height: H - PAD.t - PAD.b, class: 'ins-hit', tabindex: '0', 'aria-label': label });
      const show = () => { tip.textContent = label; tip.hidden = false; tip.style.left = `${(100 * cx) / W}%`; };
      hit.addEventListener('mouseenter', show); hit.addEventListener('focus', show);
      hit.addEventListener('mouseleave', () => { tip.hidden = true; }); hit.addEventListener('blur', () => { tip.hidden = true; });
      svg.append(hit);
      if (i === 0 || i === B.length - 1 || i === Math.floor(B.length / 2)) {
        svg.append(Object.assign(sv('text', { x: cx, y: H - 8, class: 'ins-tick', 'text-anchor': 'middle' }), { textContent: money(i === B.length - 1 ? b.lo : b.lo) }));
      }
    });
    if (goalPhp > 0 && goalPhp >= B[0].lo && goalPhp <= B[B.length - 1].hi) {
      const gx = x(goalPhp);
      svg.append(sv('line', { x1: gx, x2: gx, y1: PAD.t - 6, y2: H - PAD.b, class: 'ins-goal-line' }));
      const anchor = gx > W * 0.8 ? 'end' : gx < W * 0.2 ? 'start' : 'middle';   // never clipped at either edge
      svg.append(Object.assign(sv('text', { x: gx + (anchor === 'start' ? 4 : anchor === 'end' ? -4 : 0), y: PAD.t - 8, class: 'ins-goal-text', 'text-anchor': anchor }), { textContent: 'your minimum' }));
    }
    const wrap = h('div', 'ins-plot');
    wrap.append(svg, tip);
    box.append(wrap);
    // The table view: the same bins as rows, for anyone who would rather read than look.
    const det = h('details', 'ins-table');
    det.append(h('summary', null, 'Show as a table'));
    const tbl = h('table');
    tbl.append(Object.assign(h('tr'), { innerHTML: '<th>Pay</th><th>Jobs</th>' }));
    for (const b of B) {
      const tr = h('tr');
      tr.append(h('td', null, `${b.openLo ? 'under ' + money(b.hi) : b.openHi ? money(b.lo) + '+' : money(b.lo) + '–' + money(b.hi)}${unit}`), h('td', null, String(b.n)));
      tbl.append(tr);
    }
    det.append(tbl);
    box.append(det);
    return box;
  }

  async function render(host, settings) {
    if (!host) return;
    const { jobRecords, fx } = await chrome.storage.local.get(['jobRecords', 'fx']);
    const rates = Object.fromEntries(Object.entries(fx?.rates || {}).map(([k, v]) => [k, v.rate]));
    const { monthly, hourly } = figures(jobRecords, rates);
    const cur = settings.currency || 'PHP';
    const disp = cur !== 'PHP' && rates[cur] ? { code: cur, rate: rates[cur] } : null;
    const money = (php) => S.formatNote({ min: php, max: php }, disp).replace(/^≈ /, '').replace(/\/mo$/, '');
    host.innerHTML = '';
    host.append(h('h2', 'ins-h', 'What the jobs you have read pay'),
      // Said out loud because it bends every number below: Read posts reads your Top picks FIRST, so the memory
      // is mostly jobs that already met your minimum, and "your minimum beats 0 %" says that, not the market.
      h('p', 'ins-lede', 'From every post the extension has read in full on this computer — nothing here leaves it. ' +
        'Read posts opens your Top picks first, so these lean towards jobs that already meet your minimum; ' +
        'turn on “…then everything else” under ⚙ Advanced for a fuller picture.'));
    const grid = h('div', 'ins-grid');
    grid.append(
      chart('Full-time, per month', monthly, S.goalInPhp(settings.goalSalary, cur, rates), money, '/mo'),
      chart('Part-time and gigs, per hour', hourly, S.goalInPhp(settings.goalHourly, cur, rates), money, '/hr'));
    host.append(grid);
  }

  self.OJCInsights = { render, figures };
})();
