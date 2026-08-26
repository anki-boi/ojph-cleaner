// options.js — load/save settings in chrome.storage.local
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const DEFAULTS = { negative: [], positive: [], noSalary: true, showHidden: false, autoScan: false };
  const toLines = (arr) => (arr || []).join('\n');
  const fromLines = (s) => [...new Set(s.split('\n').map(x => x.trim()).filter(Boolean))];

  chrome.storage.local.get('settings', (res) => {
    const s = { ...DEFAULTS, ...(res.settings || {}) };
    $('neg').value = toLines(s.negative);
    $('pos').value = toLines(s.positive);
    $('noSalary').checked = s.noSalary;
    $('showHidden').checked = s.showHidden;
    $('autoScan').checked = s.autoScan;
  });

  $('save').onclick = () => {
    const settings = {
      negative: fromLines($('neg').value),
      positive: fromLines($('pos').value),
      noSalary: $('noSalary').checked,
      showHidden: $('showHidden').checked,
      autoScan: $('autoScan').checked,
    };
    chrome.storage.local.set({ settings }, () => {
      const el = $('saved');
      el.style.display = '';
      setTimeout(() => { el.style.display = 'none'; }, 1500);
    });
  };
})();
