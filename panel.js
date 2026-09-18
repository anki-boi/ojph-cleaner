/**
 * panel.js — the in-page options panel (the ⚙ in the chip).
 *
 * A third content script, for the same reason salary.js and pagination.js are separate: content.js holds
 * the rule pass and the chip and was at the gate's 300-line ceiling, and the panel is a self-contained
 * surface — a form plus the storage write and a confirmation flash.
 *
 * It talks to content.js through `self.OJC` only: read the settings, replace them, persist, re-run the
 * rules. It owns no rule logic, so a change here can never alter which listings are hidden.
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage) return; // node: nothing to do
  const api = self.OJC;
  if (!api) return;

  const toLines = (arr) => (arr || []).join('\n');
  const fromLines = (s) => [...new Set(s.split('\n').map(x => x.trim()).filter(Boolean))];
  const num = (v) => Math.max(0, Math.round(Number(v) || 0));

  let panel = null;
  const $p = (sel) => ensurePanel().querySelector(sel);

  function ensurePanel() {
    if (panel?.isConnected) return panel;
    panel = document.createElement('div');
    panel.id = 'ojc-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <label for="ojc-neg">Hide jobs mentioning… (one per line)</label>
      <textarea id="ojc-neg" rows="3" placeholder="crypto&#10;insurance"></textarea>
      <label for="ojc-pos">Highlight jobs mentioning… (one per line)</label>
      <textarea id="ojc-pos" rows="3" placeholder="quickbooks"></textarea>
      <label class="ojc-check"><input type="checkbox" id="ojc-noSalary"> Hide jobs with no salary listed</label>
      <label class="ojc-check"><input type="checkbox" id="ojc-showHidden"> Show hidden jobs</label>
      <label class="ojc-check"><input type="checkbox" id="ojc-autoLoad"> Load more jobs when I scroll to the bottom</label>
      <label for="ojc-goal">Brighten jobs paying at least this much per month (₱, 0 = off)</label>
      <input type="number" id="ojc-goal" min="0" step="1000" placeholder="e.g. 40000">
      <label for="ojc-goal-hourly">…or at least this much per hour (₱, 0 = off) — for listings that post a rate</label>
      <input type="number" id="ojc-goal-hourly" min="0" step="10" placeholder="e.g. 300">
      <label class="ojc-check" title="Saved now, acted on once the deep scan ships (spec.md W3)">
        <input type="checkbox" id="ojc-autoScan" disabled> Auto deep-scan this page
        <em class="ojc-soon">— not built yet</em>
      </label>
      <div class="ojc-row">
        <button id="ojc-save">Save</button>
        <span id="ojc-saved">Saved ✓</span>
        <a href="${chrome.runtime.getURL('options.html')}" target="_blank">full options ↗</a>
      </div>`;
    panel.querySelector('#ojc-save').onclick = save;
    document.body.appendChild(panel);
    return panel;
  }

  function fillPanel() {
    const s = api.getSettings();
    $p('#ojc-neg').value = toLines(s.negative);
    $p('#ojc-pos').value = toLines(s.positive);
    $p('#ojc-noSalary').checked = s.noSalary;
    $p('#ojc-showHidden').checked = s.showHidden;
    $p('#ojc-autoLoad').checked = s.autoLoad;
    $p('#ojc-goal').value = s.goalSalary || '';
    $p('#ojc-goal-hourly').value = s.goalHourly || '';
    $p('#ojc-autoScan').checked = s.autoScan;
  }

  /** Mirror settings into an open panel without clobbering a field being typed in. */
  function sync() {
    if (!panel || panel.hidden) return;
    if (panel.contains(document.activeElement)) $p('#ojc-showHidden').checked = api.getSettings().showHidden;
    else fillPanel();
  }

  function open(openTo) {
    const p = ensurePanel();
    p.hidden = !(openTo ?? p.hidden);
    if (!p.hidden) fillPanel();
  }

  /** Save applies the rules immediately — the storage write is durability, not the trigger. */
  function save() {
    const current = api.getSettings();
    api.setSettings({
      negative: fromLines($p('#ojc-neg').value),
      positive: fromLines($p('#ojc-pos').value),
      noSalary: $p('#ojc-noSalary').checked,
      showHidden: $p('#ojc-showHidden').checked,
      autoLoad: $p('#ojc-autoLoad').checked,
      goalSalary: num($p('#ojc-goal').value),
      goalHourly: num($p('#ojc-goal-hourly').value),
      // Read from settings, not the input: the control is disabled until W3, and a disabled checkbox
      // would otherwise silently reset a stored value to false.
      autoScan: current.autoScan,
    });
    api.refreshRules();
    api.persist();
    const el = $p('#ojc-saved');
    el.style.display = 'inline';
    clearTimeout(save.timer);
    save.timer = setTimeout(() => { el.style.display = 'none'; }, 1500);
  }

  self.OJCPanel = { open, sync, save };
})();
