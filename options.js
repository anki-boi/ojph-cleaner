// options.js — load/save settings in chrome.storage.local
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const DEFAULTS = { negative: [], positive: [], noSalary: true, showHidden: false, autoScan: false, autoLoad: true, goalSalary: 0, goalHourly: 0, maxAgeDays: 7 };
  const toLines = (arr) => (arr || []).join('\n');
  const fromLines = (s) => [...new Set(s.split('\n').map(x => x.trim()).filter(Boolean))];

  chrome.storage.local.get('settings', (res) => {
    const s = { ...DEFAULTS, ...(res.settings || {}) };
    $('maxAgeDays').value = s.maxAgeDays ?? '';
    $('neg').value = toLines(s.negative);
    $('pos').value = toLines(s.positive);
    $('noSalary').checked = s.noSalary;
    $('showHidden').checked = s.showHidden;
    $('autoLoad').checked = s.autoLoad;
    $('goalSalary').value = s.goalSalary || '';
    $('goalHourly').value = s.goalHourly || '';
    $('autoScan').checked = s.autoScan;
  });

  $('save').onclick = () => {
    const settings = {
      maxAgeDays: Math.max(0, Math.round(Number($('maxAgeDays').value) || 0)),
      negative: fromLines($('neg').value),
      positive: fromLines($('pos').value),
      noSalary: $('noSalary').checked,
      showHidden: $('showHidden').checked,
      autoLoad: $('autoLoad').checked,
      goalSalary: Math.max(0, Math.round(Number($('goalSalary').value) || 0)),
      goalHourly: Math.max(0, Math.round(Number($('goalHourly').value) || 0)),
      autoScan: $('autoScan').checked,
    };
    chrome.storage.local.set({ settings }, () => {
      const el = $('saved');
      el.style.display = '';
      setTimeout(() => { el.style.display = 'none'; }, 1500);
    });
  };
})();
