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
    const btn = document.createElement('button');
    btn.textContent = settings.showHidden ? 'Hide them' : 'Show all';
    btn.onclick = () => { settings.showHidden = !settings.showHidden; persist(); };
    el.append(b, s, btn);
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
  }

  // ── Live re-run on DOM changes (new cards, container swap) ──────────────
  // Ignore mutations caused by our own UI (chip rebuild, badges) to avoid loops.
  function isOurs(node) {
    let n = node;
    while (n) {
      if (n.id === 'ojc-chip' ||
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
