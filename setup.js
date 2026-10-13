/**
 * setup.js — the first-run setup (spec.md D49/D50/D68, W19): five screens, each skippable.
 *
 *   0. What kind of work do you do?  → up to three archetypes (presets.js) fill BOTH keyword lists below
 *   1. How much experience?    → one level (presets.js LEVELS), its words ADDED to the archetypes' (D68.1)
 *   2. What are you hunting?   → the "I'm into" list, already filled from the picks (and a link to search OLJ)
 *   3. What's the least you'd take?  → the minimums, in PHP or USD; the hourly one suggested from the monthly
 *   4. Instant no?             → toggleable chips plus free text → the "Never show me" list, filled from the picks
 *
 * Shown only to a fresh install: no `ui.onboarded` AND no settings ever saved. An install that already has
 * settings (the owner's) is marked onboarded silently the first time it boots, so nobody who has configured
 * the extension is ever asked again. Skip keeps the shipped defaults; Finish replaces only what was answered,
 * and offers Undo. `⚙ → Run setup again` reopens it.
 *
 * The pure half (exported for test-setup.js) decides; the DOM half only asks.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCSetupPure = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /** 40 h × 52 weeks ÷ 12 months: the hours in a full-time month. Only ever used to SUGGEST the user's own hourly
   *  minimum from their monthly one — never to turn a listing's rate into a month (D10 stands). */
  const HOURS_PER_MONTH = 40 * 52 / 12;
  const suggestHourly = (monthly, cur = 'PHP') => {
    const m = Number(monthly) || 0;
    if (m <= 0) return 0;
    const h = m / HOURS_PER_MONTH;
    return cur === 'USD' && h < 100 ? Math.round(h * 100) / 100 : Math.round(h);
  };
  /** "quickbooks, xero\nremote" → ['quickbooks', 'xero', 'remote'] — commas or lines, trimmed, de-duplicated. */
  const parseWords = (text) => [...new Set(String(text || '').split(/[\n,]/).map(w => w.trim()).filter(Boolean))];
  /** Show it? Only when nothing says this install was ever set up. */
  const shouldShow = (ui, settings) => !(ui && ui.onboarded) && !settings;
  /** The settings Finish writes: the answers over the current settings, and nothing unanswered touched. */
  function applyAnswers(current, a) {
    const next = { ...current };
    if (a.positive && a.positive.length) next.positive = a.positive;
    if (a.negative && a.negative.length) next.negative = a.negative;
    if (a.currency) next.currency = a.currency;
    if (Number(a.monthly) > 0) next.goalSalary = Number(a.monthly);
    if (Number(a.hourly) > 0) next.goalHourly = Number(a.hourly);
    return next;
  }
  const NO_CHIPS = ['crypto', 'cold calling', 'commission only', 'appointment setter', 'unpaid trial', 'sales'];
  return { HOURS_PER_MONTH, suggestHourly, parseWords, shouldShow, applyAnswers, NO_CHIPS };
});

(() => {
  'use strict';
  if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) return;
  const api = self.OJC;
  if (!api) return;
  const P = self.OJCSetupPure, L = self.OJCLabels, PR = self.OJCPresets;
  const LAST = 4;
  /** Every preset id in play — archetypes and the level — so one repick swaps either layer's words. */
  const presetIds = (a) => [...a.picks, ...(a.level ? [a.level] : [])];

  let node = null, step = 0, answers = null, hourlyTouched = false;

  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v; else if (k.startsWith('on')) n[k] = v; else n.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k);
    return n;
  };

  /** The matching guide (D69), shown where the user first edits a list. `open` on the first of the two screens;
   *  on the hide screen it carries the one warning that matters there (a broad hide word hides real jobs). */
  function matchGuide(open, warn) {
    const M = L.match;
    const d = h('details', { class: 'ojc-setup-guide' }, h('summary', {}, M.title),
      h('ul', {}, M.rows.map(([k, t]) => h('li', {}, h('code', {}, k), ' ', t))),
      h('p', {}, warn ? M.noBroad : M.never));
    d.open = open;
    return d;
  }

  function screen() {
    const s = api.getSettings();
    const sym = L.currency[answers.currency]?.symbol || '₱';
    if (step === 0) {
      // D68: an archetype fills both lists. Changing the picks swaps only the presets' own words (PR.repick), so
      // anything typed on the later screens survives a trip Back here.
      const grid = h('div', { class: 'ojc-setup-arche' }, PR.ARCHETYPES.map(a => {
        const on = answers.picks.includes(a.id);
        const full = !on && answers.picks.length >= PR.MAX_PICKS;
        const b = h('button', { type: 'button', class: 'ojc-archebtn' + (on ? ' is-on' : ''), 'aria-pressed': String(on),
          title: full ? `Pick up to ${PR.MAX_PICKS} — unpick one first` : `Into: ${a.positive.slice(0, 6).join(', ')}…` },
          h('span', { class: 'ojc-arche-icon' }, a.icon), a.label);
        if (full) b.disabled = true;
        b.onclick = () => {
          const next = on ? answers.picks.filter(x => x !== a.id) : [...answers.picks, a.id];
          Object.assign(answers, PR.repick(answers, presetIds(answers), presetIds({ ...answers, picks: next })), { picks: next });
          render();
        };
        return b;
      }));
      const n = answers.picks.length;
      return [h('h2', {}, 'What kind of work do you do?'),
        h('p', {}, `Pick up to ${PR.MAX_PICKS}. Each one fills in words you're into and job types to hide — you'll see and edit them next.`),
        grid, h('p', { class: 'ojc-setup-hint' }, n
          ? `${answers.positive.length} words you're into, ${answers.negative.length} to hide — from ${n} pick${n === 1 ? '' : 's'}.`
          : 'None fit? Skip this and type your own on the next screen.')];
    }
    if (step === 1) {
      const opts = h('div', { class: 'ojc-setup-levels' }, PR.LEVELS.map(lv => {
        const on = answers.level === lv.id;
        const b = h('button', { type: 'button', class: 'ojc-archebtn ojc-levelbtn' + (on ? ' is-on' : ''), 'aria-pressed': String(on) },
          h('span', { class: 'ojc-arche-icon' }, lv.icon),
          h('span', {}, h('b', {}, lv.label), h('small', {}, lv.hint)));
        b.onclick = () => {
          const next = on ? null : lv.id;   // one level, or none: clicking the picked one clears it
          Object.assign(answers, PR.repick(answers, presetIds(answers), presetIds({ ...answers, level: next })), { level: next });
          render();
        };
        return b;
      }));
      return [h('h2', {}, 'How much experience do you have?'),
        h('p', {}, 'Its words are added to your kind of work, so jobs that ask for far more (or far less) than you have get out of the way.'),
        opts, h('p', { class: 'ojc-setup-hint' }, answers.level
          ? `${answers.positive.length} words you're into, ${answers.negative.length} to hide, so far.`
          : 'Skip it to judge jobs on your kind of work alone.')];
    }
    if (step === 2) {
      const box = h('textarea', { id: 'ojc-setup-pos', rows: '3', placeholder: 'virtual assistant, quickbooks, remote' });
      box.value = answers.positive.join(', ');
      box.oninput = () => { answers.positive = P.parseWords(box.value); };
      const first = () => answers.positive[0] || 'virtual assistant';
      const link = h('a', { href: '#', target: '_blank' }, 'Search OnlineJobs for it ↗');
      link.onmouseenter = link.onfocus = () => { link.href = `/jobseekers/jobsearch?jobkeyword=${encodeURIComponent(first())}`; };
      return [h('h2', {}, 'What are you hunting?'),
        h('p', {}, 'Job titles, tools or words you want to see. Matching jobs get a green badge — these never hide anything.'),
        box, h('p', { class: 'ojc-setup-hint' }, 'Separate with commas or new lines. ', link), matchGuide(true, false)];
    }
    if (step === 3) {
      const cur = h('select', { id: 'ojc-setup-cur' },
        h('option', { value: 'PHP' }, '₱ PHP'), h('option', { value: 'USD' }, '$ USD'));
      cur.value = answers.currency;
      const m = h('input', { id: 'ojc-setup-month', type: 'number', min: '0', step: 'any', placeholder: answers.currency === 'USD' ? '1000' : '40000' });
      const hr = h('input', { id: 'ojc-setup-hour', type: 'number', min: '0', step: 'any' });
      m.value = answers.monthly || '';
      hr.value = answers.hourly || '';
      m.oninput = () => {
        answers.monthly = Number(m.value) || 0;
        if (!hourlyTouched) { answers.hourly = P.suggestHourly(answers.monthly, answers.currency); hr.value = answers.hourly || ''; }
      };
      hr.oninput = () => { hourlyTouched = true; answers.hourly = Number(hr.value) || 0; };
      cur.onchange = () => { answers.currency = cur.value; render(); };
      return [h('h2', {}, "What's the least you'd take?"),
        h('p', {}, 'Jobs that pay at least this become ⭐ Top picks. Full-time jobs are judged per month, everything else per hour.'),
        h('div', { class: 'ojc-setup-row' }, h('label', {}, 'Currency', cur)),
        h('div', { class: 'ojc-setup-row' },
          h('label', {}, 'Per month', h('span', { class: 'ojc-setup-money' }, sym, m)),
          h('label', {}, 'Per hour', h('span', { class: 'ojc-setup-money' }, sym, hr))),
        h('p', { class: 'ojc-setup-hint' }, hourlyTouched ? ' ' : 'Per hour is suggested from your monthly (a 40-hour week) — change it if you like.')];
    }
    const chips = h('div', { class: 'ojc-setup-chips' }, P.NO_CHIPS.map(w => {
      const b = h('button', { type: 'button', class: 'ojc-chipbtn' + (answers.negative.includes(w) ? ' is-on' : ''), 'aria-pressed': String(answers.negative.includes(w)) }, w);
      b.onclick = () => {
        answers.negative = answers.negative.includes(w) ? answers.negative.filter(x => x !== w) : [...answers.negative, w];
        render();
      };
      return b;
    }));
    const extra = h('textarea', { id: 'ojc-setup-neg', rows: '2', placeholder: 'anything else, comma-separated' });
    extra.value = answers.negative.filter(w => !P.NO_CHIPS.includes(w)).join(', ');
    extra.oninput = () => {
      answers.negative = [...answers.negative.filter(w => P.NO_CHIPS.includes(w)), ...P.parseWords(extra.value)];
    };
    return [h('h2', {}, 'Instant no?'),
      h('p', {}, `Jobs that mention these are hidden — unless they meet your minimum pay, then they show up as ${L.icon.worth} Maybe.`),
      chips, extra, matchGuide(false, true), h('p', { class: 'ojc-setup-hint' }, s.negative?.length ? 'Leave everything off to keep the current list.' : ' ')];
  }

  function render() {
    const body = node.querySelector('.ojc-setup-body');
    body.innerHTML = '';
    body.append(...screen());
    node.querySelectorAll('.ojc-setup-dots i').forEach((d, i) => d.classList.toggle('is-on', i === step));
    node.querySelector('#ojc-setup-back').hidden = step === 0;
    node.querySelector('#ojc-setup-next').textContent = step === LAST ? 'Finish' : 'Next';
    body.querySelector('textarea, input')?.focus({ preventScroll: true });
  }

  async function done(save) {
    node.remove();
    node = null;
    await chrome.storage.local.set({ ui: { ...((await chrome.storage.local.get('ui')).ui || {}), onboarded: true } });
    if (!save) return;
    const before = { ...api.getSettings() };
    api.setSettings(P.applyAnswers(before, answers));
    api.refreshRules();
    api.persist();
    self.OJCToast?.show("You're set. Change any of it later under ⚙.", { action: { label: L.btn.undo, run: () => {
      api.setSettings(before); api.refreshRules(); api.persist();
    } } });
  }

  function open() {
    if (node) return;
    const s = api.getSettings();
    answers = { picks: [], level: null, positive: [], negative: [], currency: s.currency || 'PHP', monthly: 0, hourly: 0 };
    step = 0;
    hourlyTouched = false;
    node = h('div', { id: 'ojc-setup', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Set up OJ.ph Cleaner' },
      h('div', { class: 'ojc-setup-card' },
        h('div', { class: 'ojc-setup-top' }, h('b', {}, 'OJ.ph Cleaner'),
          h('span', { class: 'ojc-setup-dots' }, h('i'), h('i'), h('i'), h('i'), h('i')),
          h('button', { type: 'button', id: 'ojc-setup-skip', onclick: () => done(false) }, 'Skip setup')),
        h('div', { class: 'ojc-setup-body' }),
        h('div', { class: 'ojc-setup-foot' },
          h('button', { type: 'button', id: 'ojc-setup-back', onclick: () => { step--; render(); } }, 'Back'),
          h('button', { type: 'button', id: 'ojc-setup-next', class: 'is-primary', onclick: () => { if (step < LAST) { step++; render(); } else done(true); } }, 'Next'))));
    node.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(false); });
    document.body.appendChild(node);
    render();
  }

  // Only on a job list page, where the result of answering is visible at once.
  if (api.LIST_RE.test(location.pathname)) {
    chrome.storage.local.get(['ui', 'settings'], (res) => {
      if (res.ui?.onboarded) return;
      if (!P.shouldShow(res.ui, res.settings)) { chrome.storage.local.set({ ui: { ...(res.ui || {}), onboarded: true } }); return; }
      setTimeout(open, 600);
    });
  }

  self.OJCSetup = { open };
})();
