// content.js — OJ.ph Cleaner content script.
(() => {
  'use strict';
  const rules = self.OJRules;

  const DEFAULTS = {
    negative: [],    // keyword list → hide (substring, case-insensitive)
    positive: [],    // keyword list → highlight only
    noSalary: true,  // hide cards whose salary text has no digit
    showHidden: false,
    autoScan: false, // W3: auto deep-scan on search page loads. Inert + disabled in the UI.
    autoLoad: true,  // W6: load the next result page when you scroll to the bottom of the list
    goalSalary: 0,   // W7: monthly PHP goal — listings at or above it brighten up (0 = off)
    goalHourly: 0,   // W7: hourly PHP goal — for listings that post a rate, which no month can judge
  };
  let settings = { ...DEFAULTS };

  const LIST_RE = /\/jobseekers\/(jobsearch|search)(\/|$)/; // keyword search (with or without /offset/) + category list pages

  // ── Page selectors ───────────────────────────────────────────────────────
  // The only place this extension knows about the site's markup, so drift is a one-line
  // fix. docs/scraping.md records the contract and tools/verify-live.mjs asserts the
  // live result — it fails loudly when a page parses to zero cards.
  const SELECTORS = {
    card: '.jobpost-cat-box.latest-job-post',
    cardSalary: 'dd.col',
    detailDescription: 'p#job-description',  // W3 (deep scan)
    detailSalaryLabel: 'h3.fs-12',           // W3, matched against SALARY_LABEL_RE
  };
  const SALARY_LABEL_RE = /WAGE\s*\/\s*SALARY/i; // W3
  const cards = () => [...document.querySelectorAll(SELECTORS.card)];
  const cardSalary = (c) => {
    const d = c.querySelector(SELECTORS.cardSalary);
    if (!d) return '';
    // The site's own text only: our salary annotation (W7) lives in the same cell, and it must
    // never be able to change the no-salary verdict.
    const own = d.cloneNode(true);
    // Everything this extension injected into the cell, by namespace — never the site's own text.
    for (const injected of own.querySelectorAll('[class^="ojc-"]')) injected.remove();
    return own.textContent.trim();
  };

  // Full context = card text + (after a deep scan) the fetched detail description.
  // ponytail: ctxMap is never fed until W3 lands, so fullText() is card text today —
  // the seam stays so the scan does not have to rewire the rule pass.
  const ctxMap = new WeakMap();
  const fullText = (c) => {
    const ctx = ctxMap.get(c);
    return (c.textContent || '') + (ctx ? ' ' + (ctx.description || '') : '');
  };

  // ── Chip (bottom-right status bar) ───────────────────────────────────────
  let chip = null;
  let chipNote = '';
  const setNote = (text) => { chipNote = text; renderChip(); };
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
      self.OJCPanel?.open(false);   // the panel belongs to panel.js; closing is the same call
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
    gear.onclick = () => self.OJCPanel?.open();   // panel.js owns the panel (W1: 300-line cap)
    const btn = document.createElement('button');
    btn.id = 'ojc-toggle';
    btn.textContent = settings.showHidden ? 'Hide them' : 'Show all';
    btn.onclick = () => {
      settings.showHidden = !settings.showHidden;
      refreshRules();
      persistField('showHidden', settings.showHidden);
    };
    el.append(gear, b, s);
    if (chipNote) {
      const note = document.createElement('i');
      note.id = 'ojc-note';
      note.textContent = chipNote;
      el.appendChild(note);
    }
    el.appendChild(btn);
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
        c.hidden = !settings.showHidden;
        noSal++;
      } else if (neg.length) {
        c.hidden = !settings.showHidden;
        c.classList.add('ojc-neg');
        kw++;
      } else if (posM.length) {
        c.hidden = false; // positive = highlight only, never hidden
        c.classList.add('ojc-pos');
        const badge = document.createElement('span');
        badge.className = 'ojc-pos-badge';
        badge.textContent = '✓ ' + posM.join(', ');
        c.prepend(badge);
        pos++;
      } else {
        c.hidden = false;
      }
    }
    chipCounts = { noSal, kw, pos };
    self.OJCLoader?.arm();        // pagination.js watches for the end of the list (W6)
    self.OJCSalaryUI?.annotate(); // salary.js adds the monthly figure per card (W7)
    renderChip();
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  // The panel's Save is a form: it writes the whole object.
  function persist() { chrome.storage.local.set({ settings }); }
  // A chip toggle changes one field, so it writes one field — by reading the stored object and merging,
  // which is the part that matters: every tab holds a copy loaded when it booted, so a full-object write
  // from here reverts settings a user changed in another tab (found by a red verify-live run, where the
  // panel's "no salary" setting came back after another tab's delayed write landed).
  //
  // NOT `chrome.storage.local.set({ 'settings.showHidden': v })`: dotted paths work for get/remove but
  // `set` silently drops them — the chip's label flipped while storage kept the old value.
  async function persistField(key, value) {
    const { settings: stored } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...DEFAULTS, ...(stored || {}), [key]: value } });
  }
  function applySettings(next) {
    settings = { ...DEFAULTS, ...(next || {}) };
    if (!settings.autoLoad) self.OJCLoader?.stop();
    refreshRules();
    self.OJCPanel?.sync();
  }

  // The API pagination.js uses (W6). Small on purpose: it must not grow into a second
  // copy of the rule pass.
  self.OJC = {
    SELECTORS, LIST_RE, cards, refreshRules, setNote, persist,
    getSettings: () => settings,
    // panel.js writes a whole form; assigning (not merging) is the point of a Save button.
    setSettings: (next) => { settings = { ...DEFAULTS, ...next }; },
  };

  // ── Live re-run on DOM changes (new cards, container swap) ──────────────
  // Recognise the UI this script injected, and nothing else. The target check is the
  // load-bearing part: a node we removed from the chip is already detached, so walking
  // parentNode from it never reaches #ojc-chip — which used to make every chip rebuild
  // schedule the next one, forever (spec.md §2.2).
  // Classes are listed explicitly rather than matched by "ojc-*": .ojc-pos/.ojc-neg/.ojc-goal sit on
  // the *site's* cards, and a mutation inside a highlighted card is a real change worth re-running for.
  const OUR_CLASSES = ['ojc-pos-badge', 'ojc-salary-note', 'ojc-salary-warn'];
  function isOurs(node) {
    let n = node;
    while (n) {
      if (typeof n.id === 'string' && n.id.startsWith('ojc-')) return true; // chip, panel, sentinel, note
      if (n.classList && OUR_CLASSES.some(c => n.classList.contains(c))) return true;
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
      if (isOurs(m.target)) continue; // our own chip/panel/badge rebuild
      if (m.type === 'characterData') return schedule();
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
