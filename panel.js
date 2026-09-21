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
    // Three parts — a fixed head, a scrolling body, a fixed foot — because the form is taller than most
    // viewports: with one flat column the Save button sat below the fold, so the panel could not be
    // completed without scrolling the whole page. Sections group the ten controls into the four
    // questions they actually answer, and each hint carries what used to be a parenthetical inside the
    // label, which is what made every row wrap onto two lines.
    panel.innerHTML = `
      <div id="ojc-panel-head">
        <b>Settings</b>
        <button id="ojc-close" type="button" title="Close (Esc)">✕</button>
      </div>
      <div id="ojc-panel-body">
        <div class="ojc-sec">
          <i>Filters</i>
          <div class="ojc-field">
            <label for="ojc-maxAge">Hide jobs older than</label>
            <div class="ojc-input"><input type="number" id="ojc-maxAge" min="0" step="1" placeholder="7"><span>days</span></div>
            <p class="ojc-hint">0 = off · 7 = last week · 30 = last month</p>
          </div>
          <div class="ojc-field">
            <label for="ojc-neg">Hide jobs mentioning</label>
            <textarea id="ojc-neg" rows="3" spellcheck="false" placeholder="crypto&#10;video editor"></textarea>
            <p class="ojc-hint">One per line. Exact words, so <b>ai</b> never matches <em>email</em>.</p>
          </div>
          <div class="ojc-field">
            <label for="ojc-pos">Highlight jobs mentioning</label>
            <textarea id="ojc-pos" rows="3" spellcheck="false" placeholder="quickbooks&#10;ai"></textarea>
            <p class="ojc-hint">One per line, same rule — and never hidden.</p>
          </div>
          <div class="ojc-field">
            <div class="ojc-keyword-io">
              <button id="ojc-kw-copy" type="button">⧉ Copy lists</button>
              <button id="ojc-kw-paste" type="button">⎘ Paste lists</button>
            </div>
            <p class="ojc-hint">Move both lists to another device: copy takes them, paste fills both boxes — then press Save.</p>
          </div>
          <label class="ojc-check"><input type="checkbox" id="ojc-noSalary"><span>Hide jobs with no salary listed</span></label>
          <label class="ojc-check ojc-sub"><input type="checkbox" id="ojc-rescueNoSalary"><span>…but keep one that matches a keyword I like, or beats a goal</span></label>
          <label class="ojc-check ojc-sub"><input type="checkbox" id="ojc-rescueNegotiable"><span>…and show \u201cNegotiable\u201d/DOE listings that match a keyword I like</span></label>
          <label class="ojc-check"><input type="checkbox" id="ojc-showHidden"><span>Show hidden jobs</span></label>
        </div>
        <div class="ojc-sec">
          <i>Salary goals</i>
          <div class="ojc-grid">
            <div class="ojc-field">
              <label for="ojc-goal">Monthly</label>
              <div class="ojc-input"><span>₱</span><input type="number" id="ojc-goal" min="0" step="1000" placeholder="40000"></div>
            </div>
            <div class="ojc-field">
              <label for="ojc-goal-hourly">Hourly</label>
              <div class="ojc-input"><span>₱</span><input type="number" id="ojc-goal-hourly" min="0" step="10" placeholder="300"></div>
            </div>
          </div>
          <p class="ojc-hint">0 = off. A listing at or above either goal brightens up. A monthly goal cannot judge a listing that posts a rate — use the hourly one for those.</p>
        </div>
        <div class="ojc-sec">
          <i>Loading</i>
          <label class="ojc-check"><input type="checkbox" id="ojc-autoLoad"><span>Load more jobs when I scroll to the bottom</span></label>
        </div>
        <div class="ojc-sec">
          <i>Deep scan</i>
          <p class="ojc-hint">Opens each listing to re-decide it with its full description. 2 at a time, High yield first, and nothing is fetched until you press Scan.</p>
          <label class="ojc-check"><input type="checkbox" id="ojc-autoScan"><span>Scan this page as soon as it loads</span></label>
          <label class="ojc-check ojc-sub"><input type="checkbox" id="ojc-scanWorth"><span>…then the Worth considering listings too</span></label>
          <label class="ojc-check ojc-sub"><input type="checkbox" id="ojc-scanAll"><span>…and the unclassified ones, which this pass can promote</span></label>
        </div>
      </div>
      <div id="ojc-panel-foot">
        <button id="ojc-save" type="button">Save changes</button>
        <span id="ojc-saved">Saved ✓</span>
        <a href="${chrome.runtime.getURL('options.html')}" target="_blank">full options ↗</a>
      </div>`;
    panel.querySelector('#ojc-save').onclick = save;
    panel.querySelector('#ojc-close').onclick = () => open(false);
    // Moving the lists between devices (F3). Both directions go through the pure format in rules.js,
    // so what the other machine reads is byte-for-byte what this one wrote.
    panel.querySelector('#ojc-kw-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(self.OJRules.listsToText(
          fromLines($p('#ojc-neg').value), fromLines($p('#ojc-pos').value)));
      } catch { /* the clipboard write was refused: the lists stay where they are */ }
    };
    panel.querySelector('#ojc-kw-paste').onclick = async () => {
      try {
        const t = self.OJRules.textToLists(await navigator.clipboard.readText());
        $p('#ojc-neg').value = t.negative.join('\n');
        $p('#ojc-pos').value = t.positive.join('\n');
      } catch { /* reading the clipboard was refused: the boxes stay as they were */ }
    };
    document.body.appendChild(panel);
    return panel;
  }

  /**
   * Sit above the status panel, whatever height it has. The old fixed `bottom: 60px` was tuned for a
   * one-line chip; once the chip became a panel that grows with its rows (220px on a live page) the
   * settings panel opened *on top of it*, hiding both.
   */
  function place() {
    const chip = document.getElementById('ojc-chip');
    const gap = 24;
    const chipH = chip ? Math.round(chip.getBoundingClientRect().height) : 0;
    panel.style.bottom = `${chipH + gap}px`;
    panel.style.maxHeight = `calc(100vh - ${chipH + gap * 2}px)`;   // never taller than the viewport
  }

  function fillPanel() {
    const s = api.getSettings();
    $p('#ojc-maxAge').value = s.maxAgeDays ?? '';
    $p('#ojc-neg').value = toLines(s.negative);
    $p('#ojc-pos').value = toLines(s.positive);
    $p('#ojc-noSalary').checked = s.noSalary;
    $p('#ojc-rescueNoSalary').checked = s.rescueNoSalary;
    $p('#ojc-rescueNegotiable').checked = s.rescueNegotiable;
    $p('#ojc-showHidden').checked = s.showHidden;
    $p('#ojc-autoLoad').checked = s.autoLoad;
    $p('#ojc-goal').value = s.goalSalary || '';
    $p('#ojc-goal-hourly').value = s.goalHourly || '';
    $p('#ojc-autoScan').checked = s.autoScan;
    $p('#ojc-scanWorth').checked = s.scanWorth !== false;
    $p('#ojc-scanAll').checked = !!s.scanAll;
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
    if (!p.hidden) { fillPanel(); place(); }
  }

  /**
   * Save applies the rules immediately — the storage write is durability, not the trigger.
   */
  function save() {
    api.setSettings({
      maxAgeDays: num($p('#ojc-maxAge').value),
      negative: fromLines($p('#ojc-neg').value),
      positive: fromLines($p('#ojc-pos').value),
      noSalary: $p('#ojc-noSalary').checked,
      rescueNoSalary: $p('#ojc-rescueNoSalary').checked,
      rescueNegotiable: $p('#ojc-rescueNegotiable').checked,
      showHidden: $p('#ojc-showHidden').checked,
      autoLoad: $p('#ojc-autoLoad').checked,
      goalSalary: num($p('#ojc-goal').value),
      goalHourly: num($p('#ojc-goal-hourly').value),
      // The scan toggles hold no state beyond the checkbox itself, so the input IS the value — read
      // straight, like the rest of the form.
      autoScan: $p('#ojc-autoScan').checked,
      scanWorth: $p('#ojc-scanWorth').checked,
      scanAll: $p('#ojc-scanAll').checked,
    });
    api.refreshRules();
    api.persist();
    const el = $p('#ojc-saved');
    el.style.display = 'inline';
    clearTimeout(save.timer);
    save.timer = setTimeout(() => { el.style.display = 'none'; }, 1500);
  }

  // Esc closes the panel, like every other dialog the user has ever used. Only while it is open, so
  // this never competes with the site's own keyboard handling.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel && !panel.hidden) open(false);
  });

  self.OJCPanel = { open, sync, save };
})();
