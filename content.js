// content.js — OJ.ph Cleaner content script.
(() => {
  'use strict';
  const rules = self.OJRules;

  const DEFAULTS = {
    negative: [],    // keyword list → hide (exact word/phrase, case-insensitive)
    positive: [],    // keyword list → highlight only (exact word/phrase, case-insensitive)
    noSalary: true,  // hide cards whose salary text has no digit
    showHidden: false,
    autoScan: false, // W3: auto deep-scan on search page loads. Inert + disabled in the UI.
    autoLoad: true,  // W6: load the next result page when you scroll to the bottom of the list
    goalSalary: 0,   // W7: monthly PHP goal — listings at or above it brighten up (0 = off)
    goalHourly: 0,   // W7: hourly PHP goal — for listings that post a rate, which no month can judge
    maxAgeDays: 7,   // W8: hide listings posted longer ago than this (0 = off). The primary filter.
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
    cardPosted: 'p[data-temp]',               // W8: "Posted on …", on every card
    detailDescription: 'p#job-description',  // W3 (deep scan)
    detailSalaryLabel: 'h3.fs-12',           // W3, matched against SALARY_LABEL_RE
  };
  const SALARY_LABEL_RE = /WAGE\s*\/\s*SALARY/i; // W3
  const cards = () => [...document.querySelectorAll(SELECTORS.card)];
  /**
   * The site's own text inside `el`, free of anything this extension injected.
   *
   * Our note, warning and badge live in the same cells the rules read, so text we wrote can end up
   * feeding the rule that decides whether to hide the card — a card then hides or highlights because of
   * our own annotation. That happened for real twice: a second rule pass re-parsed the disclaimer's
   * "40 h/week" into the figure (₱50,186 - ₱401,485/mo), and the keyword "assumes" — which appears on no
   * listing on the board — highlighted a card because the word was in our warning.
   */
  const ownText = (el) => {
    const own = el.cloneNode(true);
    for (const injected of own.querySelectorAll('[class^="ojc-"]')) injected.remove();
    return own.textContent || '';
  };
  const cardSalary = (c) => {
    const d = c.querySelector(SELECTORS.cardSalary);
    // The site's own text only: our salary annotation (W7) lives in the same cell, and it must
    // never be able to change the no-salary verdict.
    return d ? ownText(d).trim() : '';
  };

  /**
   * When the card was posted, in epoch ms — or `null` when it does not say.
   * Read from the attribute, not from the visible text: no injected node can carry it, so there is
   * nothing of ours to strip, and a card whose date cannot be read is left visible (the recency rule
   * must not be the thing that loses a listing).
   */
  const postedAt = (c) => {
    const p = c.querySelector(SELECTORS.cardPosted);
    if (!p) return null;
    return rules.parsePosted(p.getAttribute('data-temp-2')) ??
      rules.parsePosted(p.getAttribute('data-temp'), rules.MANILA_OFFSET_MINUTES);
  };

  // Full context = card text + (after a deep scan) the fetched detail description.
  // ponytail: ctxMap is never fed until W3 lands, so fullText() is card text today —
  // the seam stays so the scan does not have to rewire the rule pass.
  const ctxMap = new WeakMap();
  const fullText = (c) => {
    const ctx = ctxMap.get(c);
    return ownText(c) + (ctx ? ' ' + (ctx.description || '') : '');
  };

  // ── Chip (bottom-right status bar) ───────────────────────────────────────
  let chip = null;
  let chipNote = '';
  const setNote = (text) => { chipNote = text; renderChip(); };
  let chipCounts = { stale: 0, noSal: 0, kw: 0, pos: 0, recon: 0 };
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
    const total = chipCounts.stale + chipCounts.noSal + chipCounts.kw;
    const b = document.createElement('b');
    b.textContent = settings.showHidden ? `${total} would be hidden` : `${total} hidden`;
    const s = document.createElement('span');
    s.textContent = ` (${chipCounts.stale} stale, ${chipCounts.noSal} no salary, ${chipCounts.kw} keywords` +
      (chipCounts.pos ? `, ${chipCounts.pos} highlighted` : '') +
      (chipCounts.recon ? `, ${chipCounts.recon} to reconsider` : '') + ')';
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
  // Order, and it is observable: stale → noSalary → negative (unless good) → positive → nothing.
  // First match wins, so a count can never be computed by adding the buckets up.

  /** The card's verdict badge, top-right: `✓ kw` in green, `✗ kw` in red. Prepended, so it is also the
   *  first thing `ownText()` strips — our own words must never reach the rules that read the card. */
  const badge = (card, cls, text) => {
    const b = document.createElement('span');
    b.className = cls;
    b.textContent = text;
    card.prepend(b);
  };

  function refreshRules() {
    if (!LIST_RE.test(location.pathname)) return;
    const now = Date.now();   // one instant for the whole pass, so two cards cannot disagree
    let stale = 0, noSal = 0, kw = 0, pos = 0, recon = 0;
    for (const c of cards()) {
      const text = fullText(c);
      const neg = rules.matchKeywords(text, settings.negative);
      const posM = rules.matchKeywords(text, settings.positive);
      const ns = settings.noSalary && !rules.hasSalary(cardSalary(c));
      const old = rules.isStale(postedAt(c), now, settings.maxAgeDays);
      // "Good" is the other half of the reconsider rule (D16): a positive keyword, or pay at or above
      // one of the goals. `.ojc-goal` is salary-cards.js's mark (W7) — read here, never written here.
      const good = posM.length > 0 || c.classList.contains('ojc-goal');

      // Ours, so it is cleared before re-deciding — and only while our own class is still on the card,
      // so an attribute the site set is never removed.
      if (c.classList.contains('ojc-recon')) c.removeAttribute('title');
      c.classList.remove('ojc-neg', 'ojc-pos', 'ojc-recon');
      for (const b of c.querySelectorAll('.ojc-pos-badge, .ojc-neg-badge')) b.remove();

      if (old) {
        c.hidden = !settings.showHidden;
        stale++;
      } else if (ns) {
        c.hidden = !settings.showHidden;
        noSal++;
      } else if (neg.length && good) {
        // A keyword you asked to hide, on a listing that also looks worth your time: shown, in yellow
        // (D15). Not hidden — a yellow marker you have to ask to see is not a reconsideration. The
        // badge says which keyword it was, so the state explains itself without a tooltip.
        c.hidden = false;
        c.classList.add('ojc-recon');
        badge(c, 'ojc-neg-badge', '✗ ' + neg.join(', '));
        c.title = 'Matches a hide keyword, but also ' +
          (posM.length ? `matches "${posM.join(', ')}"` : 'pays at or above your goal') +
          ' — shown so you can reconsider it';
        recon++;
      } else if (neg.length) {
        c.hidden = !settings.showHidden;
        c.classList.add('ojc-neg');
        badge(c, 'ojc-neg-badge', '✗ ' + neg.join(', '));
        kw++;
      } else if (posM.length) {
        c.hidden = false; // positive = highlight only, never hidden
        c.classList.add('ojc-pos');
        badge(c, 'ojc-pos-badge', '✓ ' + posM.join(', '));
        pos++;
      } else {
        c.hidden = false;
      }
    }
    chipCounts = { stale, noSal, kw, pos, recon };
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
    // The site's own text, our injected namespace removed. Exported because more than one module reads
    // card text to make a decision (the rules here, the hours basis in salary-cards.js, the pager's card
    // key) and each of them silently breaks if our own note is included: a second rule pass once read
    // the disclaimer's "40 h/week" as a second salary figure and showed "₱50,186 - ₱401,485/mo".
    ownText,
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
  const OUR_CLASSES = ['ojc-pos-badge', 'ojc-neg-badge', 'ojc-salary-note', 'ojc-salary-warn'];
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
