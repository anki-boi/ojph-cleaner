// options.js — load/save settings in chrome.storage.local
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
    maxAgeDays: 60, sortByPay: true,
  };
  const toLines = (arr) => (arr || []).join('\n');
  const fromLines = (s) => [...new Set(s.split('\n').map(x => x.trim()).filter(Boolean))];

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
  });

  $('save').onclick = () => {
    const settings = {
      maxAgeDays: Math.max(0, Math.round(Number($('maxAgeDays').value) || 0)),
      negative: fromLines($('neg').value),
      positive: fromLines($('pos').value),
      noSalary: $('noSalary').checked,
      rescueNoSalary: $('rescueNoSalary').checked,
      rescueNegotiable: $('rescueNegotiable').checked,
      showHidden: $('showHidden').checked,
      autoLoad: $('autoLoad').checked,
      goalSalary: Math.max(0, Math.round(Number($('goalSalary').value) || 0)),
      goalHourly: Math.max(0, Math.round(Number($('goalHourly').value) || 0)),
      autoScan: $('autoScan').checked,
      scanWorth: $('scanWorth').checked,
      scanAll: $('scanAll').checked,
      sortByPay: $('sortByPay').checked,
    };
    chrome.storage.local.set({ settings }, () => {
      const el = $('saved');
      el.style.display = '';
      setTimeout(() => { el.style.display = 'none'; }, 1500);
    });
  };
})();
