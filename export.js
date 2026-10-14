/**
 * export.js — the job memory out of the browser, as a CSV (F1, D75).
 *
 * The records live in `chrome.storage.local.jobRecords`, which you cannot open from outside the
 * extension; ⚙'s ⬇ CSV is the door. It opens a small chooser — ☑ ⭐ Top picks ☑ 🤔 Maybe ☑ 💚 Liked — and the file
 * holds those categories only, sorted by category, then by hourly rate (the user: "That way the export is more
 * refined … sorted by category first, hourly salary second").
 *
 * The string itself is built by `OJCRecords.toCsv` (pure, unit-tested in test-records.js); this file gathers the
 * data, works out each listing's hourly rate with per-hour.js and the live exchange rate — the same figure its card
 * leads with, from the post's OWN stated hours, never a guessed week — and starts the download.
 *
 * URLs come from the detail cache, because records deliberately do not store them — a listing that was
 * cached away comes out with a blank URL, and a blank is honest while a guess is not.
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage) return; // node: nothing to do
  const records = self.OJCRecordsUI, cache = self.OJCDetailCache, pure = self.OJCRecords;
  if (!records || !pure) return;
  const L = self.OJCLabels;
  const one = (s) => String(s).replace(/\s+/g, ' ').trim();   // a wage written over several lines, on one
  const CHOICES = [['high', '⭐', 'Top picks'], ['worth', '🤔', 'Maybe'], ['pos', '💚', 'Liked']];

  /** { id: { value, currency, basis } } — the hourly rate in the display currency, or a reason there is none. */
  async function hourlyOf(all) {
    const S = self.OJCSalary, PH = self.OJCPerHour;
    if (!S || !PH) return {};
    const cur = self.OJC?.getSettings?.().currency || 'PHP';
    const parsed = {};
    for (const [id, r] of Object.entries(all)) {
      const f = r && r.fields;
      if (!f || !f.wage) continue;
      const hours = Number(f.hoursPerWeek) > 0 ? Number(f.hoursPerWeek) : null;
      const p = S.parseSalary(f.wage, hours);
      if (p) parsed[id] = { p, f, hours };
    }
    let rates = {};
    try { rates = await self.OJCSalaryUI?.loadRates?.([...new Set(Object.values(parsed).map(x => x.p.currency)), cur, 'USD']) || {}; }
    catch { rates = {}; }
    const out = {};
    for (const [id, { p, f, hours }] of Object.entries(parsed)) {
      const posted = p.unit === 'hour' || p.unit === 'hour?';
      if (!posted && PH.isJobPrice(f.typeOfWork, f.wage)) { out[id] = { basis: 'a one-off price — no hourly rate' }; continue; }
      const ph = PH.perHour(p, rates, { hours, basis: hours ? 'detail' : 'unstated' });
      if (!ph) {
        out[id] = { basis: p.unit === 'day' ? 'a day rate — hours per day not stated' : 'the post states no hours' };
        continue;
      }
      const value = cur === 'PHP' ? ph.min : rates[cur] > 0 ? ph.min / rates[cur] : NaN;
      out[id] = {
        value: Math.round(value * 100) / 100,
        currency: Number.isFinite(value) ? cur : '',
        basis: ph.posted ? `posted per hour (${one(f.wage)})` : `${one(f.wage)} ÷ ${ph.hours} h/wk`,
      };
    }
    return out;
  }

  /** The CSV text and the file name, or null when there is nothing to export. `tiers` — see toCsv. */
  async function build(tiers) {
    const all = records.all();
    const ids = Object.keys(all);
    if (!ids.length) return null;
    const urls = {};
    if (cache) {
      try {
        const rows = await cache.getMany(ids);
        for (const [id, row] of rows) urls[id] = row.url || '';
      } catch { /* the cache being unavailable costs the URLs, not the export */ }
    }
    const opts = tiers ? { tiers, hourly: await hourlyOf(all) } : {};
    return { csv: pure.toCsv(all, urls, opts), name: `ojph-jobs-${new Date().toISOString().slice(0, 10)}.csv` };
  }

  async function run(tiers) {
    const out = await build(tiers);
    if (!out) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out.csv], { type: 'text/csv' }));
    a.download = out.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /** The chooser, under the ⬇ CSV button: one box per category (all ticked), each with its count, then Download. */
  function choose(anchor) {
    document.getElementById('ojc-export-pick')?.remove();
    const counts = {};
    for (const r of Object.values(records.all())) counts[r?.tier] = (counts[r?.tier] || 0) + 1;
    const box = document.createElement('div');
    box.id = 'ojc-export-pick';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', L.exportPick.title);
    const head = document.createElement('b');
    head.textContent = L.exportPick.title;
    box.appendChild(head);
    for (const [tier, icon, label] of CHOICES) {
      const row = document.createElement('label');
      const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: true, value: tier });
      row.append(cb, ` ${icon} ${label} (${counts[tier] || 0})`);
      box.appendChild(row);
    }
    const hint = document.createElement('small');
    hint.textContent = L.exportPick.hint;
    const go = Object.assign(document.createElement('button'), { type: 'button', className: 'ojc-export-go', textContent: L.exportPick.go });
    const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'ojc-quiet', textContent: L.exportPick.cancel });
    go.onclick = async () => {
      const tiers = [...box.querySelectorAll('input:checked')].map(i => i.value);
      if (!tiers.length) { hint.textContent = L.exportPick.none; return; }
      box.remove();
      await run(tiers);
    };
    cancel.onclick = () => box.remove();
    const btns = document.createElement('div');
    btns.append(go, cancel);
    box.append(hint, btns);
    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(r.left, innerWidth - box.offsetWidth - 8)) + 'px';
    box.style.top = Math.max(8, r.top - box.offsetHeight - 8) + 'px';
  }

  self.OJCExport = { build, run, choose };
})();
