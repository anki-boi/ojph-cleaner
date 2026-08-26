// content.js — OJ.ph Cleaner content script.
// Phase 1 (skeleton): load settings, react to changes. Feature phases build on this.
(() => {
  'use strict';
  const rules = self.OJRules;

  const DEFAULTS = {
    negative: [],    // keyword list (strings) → hide
    positive: [],    // keyword list (strings) → highlight
    noSalary: true,  // hide cards whose salary text has no digit
    showHidden: false,
    autoScan: false, // auto deep-scan on search page loads (current page only)
  };

  let settings = { ...DEFAULTS };

  function applySettings(next) {
    settings = { ...DEFAULTS, ...(next || {}) };
    // Hook points filled in by later phases:
    if (typeof refreshRules === 'function') refreshRules();
  }

  chrome.storage.local.get('settings', (res) => {
    applySettings(res.settings);
    console.log('[OJ Cleaner] active', settings);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      applySettings(changes.settings.newValue);
      console.log('[OJ Cleaner] settings updated');
    }
  });
})();
