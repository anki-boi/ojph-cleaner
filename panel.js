/**
 * panel.js — the settings drawer (the bar's ⚙), spec.md D47/D48/D66.
 *
 * Basics up front — the four things everyone sets: words to block, words you're into, your minimum pay, how
 * old is too old. Everything else folds under Advanced. Save applies to the board at once (the storage write
 * is durability, not the trigger), then offers one step of Undo.
 *
 * The currency (D66) is a display choice: the minimums are typed in it, and switching it converts the two
 * fields in the form on the spot at the live ECB rate, so a ₱60,000 floor stays the same floor in dollars.
 *
 * It talks to content.js through `self.OJC` only, and owns no rule logic.
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage) return; // node: nothing to do
  const api = self.OJC;
  if (!api) return;
  const L = self.OJCLabels;

  const toLines = (arr) => (arr || []).join('\n');
  const fromLines = (s) => [...new Set(s.split('\n').map(x => x.trim()).filter(Boolean))];
  /** Whole numbers, except a small dollar amount keeps its cents ($5.50/hr is a real minimum; $638.67/mo is noise). */
  const num = (v, cur) => {
    const n = Math.max(0, Number(v) || 0);
    return cur === 'USD' && n < 100 ? Math.round(n * 100) / 100 : Math.round(n);
  };

  let panel = null;
  const $p = (sel) => ensurePanel().querySelector(sel);

  function ensurePanel() {
    if (panel?.isConnected) return panel;
    panel = document.createElement('div');
    panel.id = 'ojc-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'OJ.ph Cleaner settings');
    panel.innerHTML = `
      <div id="ojc-panel-head">
        <b>Settings</b>
        <button id="ojc-close" type="button" title="Close (Esc)" aria-label="Close">✕</button>
      </div>
      <div id="ojc-panel-body">
        <div class="ojc-sec">
          <div class="ojc-field">
            <label for="ojc-neg">Never show me jobs that mention</label>
            <textarea id="ojc-neg" rows="3" spellcheck="false" placeholder="crypto&#10;cold calling"></textarea>
            <span class="ojc-hint">One per line. Whole words only, so <b>ai</b> never matches <em>email</em>.</span>
          </div>
          <div class="ojc-field">
            <label for="ojc-pos">I'm into</label>
            <textarea id="ojc-pos" rows="3" spellcheck="false" placeholder="quickbooks&#10;remote"></textarea>
            <span class="ojc-hint">One per line. These get a green badge — they never hide anything.</span>
          </div>
          <div class="ojc-field">
            <div class="ojc-keyword-io">
              <button id="ojc-kw-copy" type="button">⧉ Copy both lists</button>
              <button id="ojc-kw-paste" type="button">⎘ Paste both lists</button>
            </div>
          </div>
        </div>
        <div class="ojc-sec">
          <i>My minimum pay</i>
          <div class="ojc-field">
            <label for="ojc-currency">Show pay in</label>
            <select id="ojc-currency">
              <option value="PHP">₱ PHP — Philippine peso</option>
              <option value="USD">$ USD — US dollar</option>
            </select>
          </div>
          <div class="ojc-grid ojc-field">
            <div>
              <label for="ojc-goal">Per month</label>
              <div class="ojc-input"><span class="ojc-cur-sym">₱</span><input type="number" id="ojc-goal" min="0" step="any" placeholder="40000"></div>
            </div>
            <div>
              <label for="ojc-goal-hourly">Per hour</label>
              <div class="ojc-input"><span class="ojc-cur-sym">₱</span><input type="number" id="ojc-goal-hourly" min="0" step="any" placeholder="300"></div>
            </div>
          </div>
          <span class="ojc-hint" id="ojc-cur-hint">Full-time jobs are judged per month, everything else per hour. Leave empty to turn one off.</span>
        </div>
        <div class="ojc-sec">
          <div class="ojc-field">
            <label for="ojc-maxAge">Too old after</label>
            <div class="ojc-input"><input type="number" id="ojc-maxAge" min="0" step="1" placeholder="60"><span>days</span></div>
            <span class="ojc-hint">0 = never too old · 7 = last week · 30 = last month</span>
          </div>
        </div>
        <details id="ojc-advanced">
          <summary>Advanced</summary>
          <label class="ojc-check"><input type="checkbox" id="ojc-noSalary"><span>Hide jobs with no pay listed</span></label>
          <label class="ojc-check ojc-sub"><input type="checkbox" id="ojc-rescueNoSalary"><span>…unless I'd like it (a word I'm into, or it meets my minimum)</span></label>
          <label class="ojc-check ojc-sub"><input type="checkbox" id="ojc-rescueNegotiable"><span>…and keep “Negotiable” jobs that mention a word I'm into</span></label>
          <label class="ojc-check"><input type="checkbox" id="ojc-showHidden"><span>Peek at hidden jobs (marked with a dashed outline)</span></label>
          <label class="ojc-check"><input type="checkbox" id="ojc-autoLoad"><span>Load more jobs when I scroll to the bottom</span></label>
          <label class="ojc-check"><input type="checkbox" id="ojc-autoScan"><span>Read full posts automatically</span></label>
          <span class="ojc-hint">Opens each job inside your window to sort it by its full description — 2 at a time, Top picks first.</span>
          <label class="ojc-check ojc-sub"><input type="checkbox" id="ojc-scanWorth"><span>…then the Maybes</span></label>
          <label class="ojc-check ojc-sub"><input type="checkbox" id="ojc-scanAll"><span>…then everything else (slowest — can find hidden gems)</span></label>
          <label class="ojc-check ojc-sub"><input type="checkbox" id="ojc-sortByPay"><span>…then sort by pay, best first</span></label>
          <div class="ojc-field" style="margin-top:14px">
            <label for="ojc-myHours">My working hours (my own time)</label>
            <input type="text" id="ojc-myHours" placeholder="08:00-18:00">
            <span class="ojc-hint">Posts that state their hours with a time zone get them in your time, with ✅ / ⚠ / ✗ against these.</span>
          </div>
          <div class="ojc-field" style="margin-top:14px">
            <label for="ojc-weeklyApplyGoal">Applications I aim for each week</label>
            <input type="number" id="ojc-weeklyApplyGoal" min="0" step="1" placeholder="0 = off">
            <span class="ojc-hint">Shows your streak in the bar. 0 turns it off.</span>
          </div>
          <div class="ojc-field" style="margin-top:14px">
            <label for="ojc-dashboardUrl">Resume-fit dashboard</label>
            <input type="text" id="ojc-dashboardUrl" placeholder="http://127.0.0.1:8371">
            <span class="ojc-hint">The onlinejobs.ph-suite dashboard on this computer. Its score for your resume goes on each card. Empty turns it off.</span>
          </div>
          <div class="ojc-field ojc-row-btns" style="margin-top:14px"><button id="ojc-rerun-setup" type="button">Run setup again</button></div>
        </details>
      </div>
      <div id="ojc-panel-foot">
        <button id="ojc-save" type="button">Save changes</button>
        <span id="ojc-saved">Saved ✓</span>
        <button id="ojc-export" type="button" class="ojc-quiet">⬇ CSV</button>
        <a href="${chrome.runtime.getURL('options.html')}" target="_blank">full page ↗</a>
      </div>`;
    panel.querySelector('#ojc-save').onclick = save;
    panel.querySelector('#ojc-export').onclick = () => self.OJCExport?.run?.();
    panel.querySelector('#ojc-close').onclick = () => open(false);
    panel.querySelector('#ojc-currency').onchange = convertGoals;
    panel.querySelector('#ojc-rerun-setup').onclick = () => { open(false); self.OJCSetup?.open(); };
    // Moving the lists between devices (F3), through the pure format in rules.js.
    panel.querySelector('#ojc-kw-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(self.OJRules.listsToText(
          fromLines($p('#ojc-neg').value), fromLines($p('#ojc-pos').value)));
        self.OJCToast?.show('Both lists copied');
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

  /** The symbol in both minimum fields follows the currency picker. */
  function paintCurrency(cur) {
    for (const s of panel.querySelectorAll('.ojc-cur-sym')) s.textContent = L.currency[cur]?.symbol || cur;
  }

  /** The form's currency, as last converted — so switching twice converts from the right base. */
  let formCur = 'PHP';
  async function convertGoals() {
    const to = $p('#ojc-currency').value, from = formCur;
    formCur = to;
    paintCurrency(to);
    if (from === to) return;
    const hint = $p('#ojc-cur-hint');
    let rate = null;
    try { rate = (await self.OJCSalaryUI?.loadRates?.(['USD']))?.USD || null; } catch { rate = null; }
    if (!rate) { hint.textContent = `Couldn't load today's rate — type your minimums in ${to}.`; return; }
    const conv = (v) => {
      if (!v) return v;
      const php = from === 'PHP' ? Number(v) : Number(v) * rate;
      return String(num(to === 'PHP' ? php : php / rate, to));
    };
    $p('#ojc-goal').value = conv($p('#ojc-goal').value);
    $p('#ojc-goal-hourly').value = conv($p('#ojc-goal-hourly').value);
    hint.textContent = `Converted at today's ECB rate (₱${rate.toFixed(2)} per $1). Check them, then Save.`;
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
    $p('#ojc-sortByPay').checked = !!s.sortByPay;
    $p('#ojc-dashboardUrl').value = s.dashboardUrl ?? '';
    $p('#ojc-weeklyApplyGoal').value = s.weeklyApplyGoal || '';
    $p('#ojc-myHours').value = s.myHours || '';
    $p('#ojc-currency').value = formCur = s.currency || 'PHP';
    paintCurrency(formCur);
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
    if (!p.hidden) {
      fillPanel();
      // The CSV of everything remembered — moved here from the bar, which had one button too many for one line.
      const ex = $p('#ojc-export');
      ex.disabled = !(self.OJCRecordsUI?.size());
      ex.title = ex.disabled ? L.btnTip.csvOff : `${L.btn.csv} — ${L.btnTip.csv}`;
      $p('#ojc-neg').focus({ preventScroll: true });
    }
  }

  /** Apply a whole settings object now, and keep it. */
  function apply(next) {
    api.setSettings(next);
    api.refreshRules();
    api.persist();
  }

  function save() {
    const before = { ...api.getSettings() };
    const cur = $p('#ojc-currency').value;
    api.setSettings({
      maxAgeDays: num($p('#ojc-maxAge').value),
      negative: fromLines($p('#ojc-neg').value),
      positive: fromLines($p('#ojc-pos').value),
      noSalary: $p('#ojc-noSalary').checked,
      rescueNoSalary: $p('#ojc-rescueNoSalary').checked,
      rescueNegotiable: $p('#ojc-rescueNegotiable').checked,
      showHidden: $p('#ojc-showHidden').checked,
      autoLoad: $p('#ojc-autoLoad').checked,
      goalSalary: num($p('#ojc-goal').value, cur),
      goalHourly: num($p('#ojc-goal-hourly').value, cur),
      autoScan: $p('#ojc-autoScan').checked,
      scanWorth: $p('#ojc-scanWorth').checked,
      scanAll: $p('#ojc-scanAll').checked,
      sortByPay: $p('#ojc-sortByPay').checked,
      dashboardUrl: $p('#ojc-dashboardUrl').value.trim(),
      currency: cur,
      weeklyApplyGoal: num($p('#ojc-weeklyApplyGoal').value),
      myHours: $p('#ojc-myHours').value.trim(),
    });
    api.refreshRules();
    api.persist();
    const el = $p('#ojc-saved');
    el.style.display = 'inline';
    clearTimeout(save.timer);
    save.timer = setTimeout(() => { el.style.display = 'none'; }, 1500);
    // D48: one step of Undo — the exact object from before this Save. D66: a currency switch says where the
    // rates come from instead of the plain "saved".
    const text = before.currency !== cur ? L.toast.currency(cur) : L.toast.saved;
    self.OJCToast?.show(text, { action: { label: L.btn.undo, run: () => { apply(before); sync(); } } });
  }

  // Esc closes the panel, like every other dialog. Only while it is open, so the site's own keys are untouched.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel && !panel.hidden) open(false);
  });

  self.OJCPanel = { open, sync, save };
})();
