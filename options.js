// options.js — load/save settings in chrome.storage.local (the full-page twin of panel.js)
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const DEFAULTS = {
    negative: ['editor', 'cold calling', 'cold call', 'graphic', 'aws', 'azure', 'bookkeeper',
      'book keeper', 'accounting', 'medical coding', 'medical billing', 'billing', 'onboarding',
      'marketing', 'social media', 'legal', 'paralegal', 'plumbing', 'video editor', 'graphic designer',
      'medical coder', 'ICD-10'],
    positive: ['aud', 'australia', 'australian', 'remote', 'flexible', 'ai', 'automation', 'claude',
      'chatgpt', 'gemini', 'generation', 'vibe'],
    noSalary: true, rescueNoSalary: true, rescueNegotiable: true, showHidden: false, autoScan: true,
    scanWorth: true, scanAll: false, autoLoad: true, goalSalary: 60000, goalHourly: 1000,
    maxAgeDays: 60, sortByPay: true, dashboardUrl: 'http://127.0.0.1:8371', currency: 'PHP', weeklyApplyGoal: 0,
  };
  const toLines = (arr) => (arr || []).join('\n');
  const fromLines = (s) => [...new Set(s.split('\n').map(x => x.trim()).filter(Boolean))];
  // Pesos are whole numbers; dollars keep their cents (D66).
  const num = (v, cur) => { const n = Math.max(0, Number(v) || 0); return cur === 'USD' && n < 100 ? Math.round(n * 100) / 100 : Math.round(n); };
  let loadedCurrency = 'PHP';

  chrome.storage.local.get('settings', (res) => {
    const s = { ...DEFAULTS, ...(res.settings || {}) };
    $('maxAgeDays').value = s.maxAgeDays ?? '';
    $('neg').value = toLines(s.negative);
    $('pos').value = toLines(s.positive);
    $('noSalary').checked = s.noSalary;
    $('rescueNoSalary').checked = s.rescueNoSalary;
    $('rescueNegotiable').checked = s.rescueNegotiable;
    $('showHidden').checked = s.showHidden;
    $('autoLoad').checked = s.autoLoad;
    $('goalSalary').value = s.goalSalary || '';
    $('goalHourly').value = s.goalHourly || '';
    $('autoScan').checked = s.autoScan;
    $('scanWorth').checked = s.scanWorth !== false;
    $('scanAll').checked = !!s.scanAll;
    $('sortByPay').checked = !!s.sortByPay;
    $('dashboardUrl').value = s.dashboardUrl ?? '';
    $('currency').value = loadedCurrency = s.currency || 'PHP';
    $('weeklyApplyGoal').value = s.weeklyApplyGoal || '';
  });

  // Switching the currency converts the two minimums in the form at the cached ECB rate (the content script
  // keeps it fresh), so the floor means the same thing in either currency.
  let formCurrency = null;
  $('currency').onchange = async () => {
    const from = formCurrency || loadedCurrency, to = $('currency').value;
    formCurrency = to;
    const fx = (await chrome.storage.local.get('fx')).fx;
    const rate = fx?.rates?.USD?.rate;
    if (!rate) { $('curHint').textContent = `No exchange rate saved yet — type your minimums in ${to}.`; return; }
    for (const id of ['goalSalary', 'goalHourly']) {
      const v = Number($(id).value);
      if (!v) continue;
      const php = from === 'PHP' ? v : v * rate;
      $(id).value = String(num(to === 'PHP' ? php : php / rate, to));
    }
    $('curHint').textContent = `Converted at the ECB rate of ${fx.rates.USD.date || 'the last refresh'} (₱${rate.toFixed(2)} per $1). Check them, then Save.`;
  };

  $('save').onclick = () => {
    const cur = $('currency').value;
    const settings = {
      maxAgeDays: Math.max(0, Math.round(Number($('maxAgeDays').value) || 0)),
      negative: fromLines($('neg').value),
      positive: fromLines($('pos').value),
      noSalary: $('noSalary').checked,
      rescueNoSalary: $('rescueNoSalary').checked,
      rescueNegotiable: $('rescueNegotiable').checked,
      showHidden: $('showHidden').checked,
      autoLoad: $('autoLoad').checked,
      goalSalary: num($('goalSalary').value, cur),
      goalHourly: num($('goalHourly').value, cur),
      autoScan: $('autoScan').checked,
      scanWorth: $('scanWorth').checked,
      scanAll: $('scanAll').checked,
      sortByPay: $('sortByPay').checked,
      dashboardUrl: $('dashboardUrl').value.trim(),
      currency: cur,
      weeklyApplyGoal: Math.max(0, Math.round(Number($('weeklyApplyGoal').value) || 0)),
    };
    chrome.storage.local.set({ settings }, () => {
      const el = $('saved');
      el.textContent = cur !== loadedCurrency ? self.OJCLabels.toast.currency(cur) : 'Saved ✓';
      loadedCurrency = cur;
      el.style.display = '';
      setTimeout(() => { el.style.display = 'none'; }, 4000);
    });
  };
})();
