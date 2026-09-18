// content.js — OJ.ph Cleaner content script.
(() => {
  'use strict';
  const rules = self.OJRules;

  const DEFAULTS = {
    negative: [],    // keyword list → hide (substring, case-insensitive)
    positive: [],    // keyword list → highlight only
    noSalary: true,  // hide cards whose salary text has no digit
    showHidden: false,
    autoScan: false, // (Task 4) auto deep-scan on search page loads
  };
  let settings = { ...DEFAULTS };

  // ── DOM helpers ──────────────────────────────────────────────────────────
  const LIST_RE = /\/jobseekers\/(jobsearch|search)(\/|$)/; // keyword search (with or without /offset/) + category list pages
  const cards = () => [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')];
  const cardSalary = (c) => {
    const d = c.querySelector('dd.col'); // confirmed list-card salary element
    return d ? d.textContent.trim() : '';
  };

  // Full context = card text + (after a deep scan) the fetched detail description
  const ctxMap = new WeakMap();
  const fullText = (c) => {
    const ctx = ctxMap.get(c);
    return (c.textContent || '') + (ctx ? ' ' + (ctx.description || '') : '');
  };

  // ── In-page options panel ────────────────────────────────────────────────
  // A sibling of the chip, NOT a child: renderChip() wipes the chip's contents
  // on every rule pass, so a child panel would be destroyed while you type.
  const toLines = (arr) => (arr || []).join('\n');
  const fromLines = (s) => [...new Set(s.split('\n').map(x => x.trim()).filter(Boolean))];
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
      <label class="ojc-check"><input type="checkbox" id="ojc-autoScan"> Auto deep-scan this page</label>
      <div class="ojc-row">
        <button id="ojc-save">Save</button>
        <span id="ojc-saved">Saved ✓</span>
        <a href="${chrome.runtime.getURL('options.html')}" target="_blank">full options ↗</a>
      </div>`;
    panel.querySelector('#ojc-save').onclick = savePanel;
    document.body.appendChild(panel);
    return panel;
  }

  function fillPanel() {
    $p('#ojc-neg').value = toLines(settings.negative);
    $p('#ojc-pos').value = toLines(settings.positive);
    $p('#ojc-noSalary').checked = settings.noSalary;
    $p('#ojc-showHidden').checked = settings.showHidden;
    $p('#ojc-autoScan').checked = settings.autoScan;
  }

  // Mirror settings into an open panel without clobbering a field being typed in.
  function syncPanel() {
    if (!panel || panel.hidden) return;
    if (panel.contains(document.activeElement)) $p('#ojc-showHidden').checked = settings.showHidden;
    else fillPanel();
  }

  function openPanel(open) {
    const p = ensurePanel();
    p.hidden = !(open ?? p.hidden);
    if (!p.hidden) fillPanel();
  }

  // Save applies the rules immediately — the storage write is only durability,
  // so the listing reacts on click instead of waiting for a round trip.
  function savePanel() {
    settings = {
      negative: fromLines($p('#ojc-neg').value),
      positive: fromLines($p('#ojc-pos').value),
      noSalary: $p('#ojc-noSalary').checked,
      showHidden: $p('#ojc-showHidden').checked,
      autoScan: $p('#ojc-autoScan').checked,
    };
    refreshRules();
    persist();
    const el = $p('#ojc-saved');
    el.style.display = 'inline';
    clearTimeout(savePanel.timer);
    savePanel.timer = setTimeout(() => { el.style.display = 'none'; }, 1500);
  }

  // ── Chip (bottom-right status bar) ───────────────────────────────────────
  let chip = null;
  let chipCounts = { noSal: 0, kw: 0, pos: 0 };
  function ensureChip() {
    if (!chip || !chip.isConnected) {
      chip = document.createElement('div');
      chip.id = 'ojc-chip';
      document.body.appendChild(chip);
    }
    return chip;
  }
  function renderChip() {
    if (!LIST_RE.test(location.pathname)) {
      if (chip?.isConnected) chip.style.display = 'none';
      if (panel?.isConnected) panel.hidden = true;
      return;
    }
    const el = ensureChip();
    el.style.display = '';
    el.innerHTML = '';
    const total = chipCounts.noSal + chipCounts.kw;
    const b = document.createElement('b');
    b.textContent = settings.showHidden ? `${total} would be hidden` : `${total} hidden`;
    const s = document.createElement('span');
    s.textContent = ` (${chipCounts.noSal} no salary, ${chipCounts.kw} keywords` +
      (chipCounts.pos ? `, ${chipCounts.pos} highlighted` : '') + ')';
    const gear = document.createElement('button');
    gear.id = 'ojc-gear';
    gear.title = 'Options';
    gear.textContent = '⚙';
    gear.onclick = () => openPanel();
    const btn = document.createElement('button');
    btn.id = 'ojc-toggle';
    btn.textContent = settings.showHidden ? 'Hide them' : 'Show all';
    btn.onclick = () => {
      settings.showHidden = !settings.showHidden;
      refreshRules();
      persist();
    };
    el.append(gear, b, s, btn);
  }

  // ── Rules pass ───────────────────────────────────────────────────────────
  function refreshRules() {
    if (!LIST_RE.test(location.pathname)) return;
    let noSal = 0, kw = 0, pos = 0;
    for (const c of cards()) {
      const text = fullText(c);
      const neg = rules.matchKeywords(text, settings.negative);
      const posM = rules.matchKeywords(text, settings.positive);
      const ns = settings.noSalary && !rules.hasSalary(cardSalary(c));

      c.classList.remove('ojc-neg', 'ojc-pos');
      c.querySelector('.ojc-pos-badge')?.remove();

      if (ns) {
        c.dataset.why = 'no-salary';
        c.hidden = !settings.showHidden;
        noSal++;
      } else if (neg.length) {
        c.dataset.why = 'keywords:' + neg.join(',');
        c.hidden = !settings.showHidden;
        c.classList.add('ojc-neg');
        kw++;
      } else if (posM.length) {
        c.dataset.why = '';
        c.hidden = false; // positive = highlight only, never hidden
        c.classList.add('ojc-pos');
        const badge = document.createElement('span');
        badge.className = 'ojc-pos-badge';
        badge.textContent = '✓ ' + posM.join(', ');
        c.prepend(badge);
        pos++;
      } else {
        c.dataset.why = '';
        c.hidden = false;
      }
    }
    chipCounts = { noSal, kw, pos };
    renderChip();
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  function persist() { chrome.storage.local.set({ settings }); }
  function applySettings(next) {
    settings = { ...DEFAULTS, ...(next || {}) };
    refreshRules();
    syncPanel();
  }

  // ── Live re-run on DOM changes (new cards, container swap) ──────────────
  // Ignore mutations caused by our own UI (chip rebuild, badges) to avoid loops.
  function isOurs(node) {
    let n = node;
    while (n) {
      if (n.id === 'ojc-chip' || n.id === 'ojc-panel' ||
          (n.classList && (n.classList.contains('ojc-pos-badge') ||
                          n.classList.contains('ojc-neg') ||
                          n.classList.contains('ojc-pos')))) return true;
      n = n.parentNode;
    }
    return false;
  }
  let mo = null, ticking = false;
  function schedule() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; refreshRules(); });
  }
  function onMutate(muts) {
    for (const m of muts) {
      if (m.type === 'characterData') { if (!isOurs(m.target)) return schedule(); continue; }
      const nodes = [...m.addedNodes, ...m.removedNodes].filter(n => n.nodeType === 1);
      if (nodes.some(n => !isOurs(n))) return schedule();
    }
  }
  function watch() {
    if (mo) return;
    mo = new MutationObserver(onMutate);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  chrome.storage.local.get('settings', (res) => {
    applySettings(res.settings);
    console.log('[OJ Cleaner] active', settings);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) applySettings(changes.settings.newValue);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
