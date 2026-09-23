// content.js — OJ.ph Cleaner content script.
(() => {
  'use strict';
  const rules = self.OJRules, tiers = self.OJCTiers;
  // Everything this file knows about the site's list markup lives in page.js. Destructured once here so the
  // rule pass below reads as it always did, and spread into the API so every consumer (pagination,
  // salary-cards, the harness) keeps working unchanged.
  const page = self.OJCPage;
  const { LIST_RE, cards, ownText, cardSalary, postedAt, dupKeyOf } = page;

  const DEFAULTS = {
    negative: [],    // keyword list → hide (exact word/phrase, case-insensitive)
    positive: [],    // keyword list → highlight only (exact word/phrase, case-insensitive)
    noSalary: true,  // hide cards whose salary text has no digit
    rescueNoSalary: false, // W10: but show one that matches a keyword you like, or beats a goal (opt-in)
    rescueNegotiable: false, // 0.12: but show a "Negotiable"/"DOE" listing that matches a keyword you like (opt-in)
    showHidden: false,
    autoScan: false, // W13: run the scan when a list page loads. Off by default — nothing runs unprompted.
    scanWorth: true, // W13: after High yield, continue into the Worth considering cards
    scanAll: false,  // W13: and then the unclassified ones (off: they can only be promoted by this pass)
    autoLoad: true,  // W6: load the next result page when you scroll to the bottom of the list
    goalSalary: 0,   // W7: monthly PHP goal — listings at or above it brighten up (0 = off)
    goalHourly: 0,   // W7: hourly PHP goal — for listings that post a rate, which no month can judge
    maxAgeDays: 7,   // W8: hide listings posted longer ago than this (0 = off). The primary filter.
  };
  let settings = { ...DEFAULTS };

  // Which tier the board is showing (W14, D32/D38). Session-only, per tab, deliberately: a way of reading
  // the board, not a preference — a persisted view would reopen every search page filtered, with no
  // obvious way to notice why.
  let view = 'all';

  // ── Chip (bottom-right status panel) ─────────────────────────────────────
  // The DOM lives in chip.js; this file holds the counts and the callbacks the panel's buttons call.
  let chipNote = '';
  /** How many times the rule pass has run, written on the chip as `data-ojc-pass` — an attribute, so the
   *  observer never sees it, and the live harness can count PASSES instead of guessing from mutations. */
  let passNo = 0;
  const setNote = (text) => { chipNote = text; renderChip(); };  let chipCounts = { closed: 0, stale: 0, noSal: 0, kw: 0, high: 0, worth: 0, flag: 0 };
  function renderChip() {
    if (!LIST_RE.test(location.pathname)) {
      self.OJCChip?.hide();
      self.OJCPanel?.open(false);   // the panel belongs to panel.js; closing is the same call
      return;
    }
    self.OJCChip?.render({
      counts: chipCounts,
      pass: passNo,
      showHidden: settings.showHidden,
      view,
      note: chipNote,
      scanning: self.OJCScan?.isRunning?.(),
      progress: self.OJCScan?.label?.() || '',
      canScan: hasSomethingToScanFor(),
      onToggle: () => {
        settings.showHidden = !settings.showHidden;
        refreshRules();
        persistField('showHidden', settings.showHidden);
      },
      onView: (next) => setView(next),
      onScan: () => self.OJCScan?.toggle(),
      onSettings: () => self.OJCPanel?.open(),   // panel.js owns the panel (the 300-line cap)
    });
  }

  /** A scan with no keywords and no goals has nothing to decide with, so the button says so instead of
   *  spending requests to re-derive "unclassified" for every listing on the board. */
  const hasSomethingToScanFor = () => (settings.negative?.length || settings.positive?.length ||
    Number(settings.goalSalary) > 0 || Number(settings.goalHourly) > 0) ? true : false;

  // ── Rules pass ───────────────────────────────────────────────────────────
  // The verdict lives in tiers.js (one pure decision table, unit-tested); this function's job is the DOM:
  // read each card, hand the facts over, paint what comes back, and count. First match wins, so a count
  // can never be computed by adding the buckets up (closed → stale → noSalary → high/worth → keyword).

  /** The card's verdict badges: `✓ kw` green, `✗ kw` red, `⚠ off-platform`. Prepended, so they are also
   *  the first thing `ownText()` strips — our own words must never reach the rules that read the card. */
  const badge = (box, cls, text, title) => {
    const b = document.createElement('span');
    b.className = cls;
    b.textContent = text;
    if (title) b.title = title;
    box.appendChild(b);
  };
  const OFF_PLATFORM = 'this listing asks you to apply or contact outside OnlineJobs.ph';
  const FRESH_MS = 24 * 3600 * 1000;   // the fresh mark: a high-yield card posted within a day (a constant, not a setting)

  /** One flex row per card for its badges, at the top-right (individual positioning broke when two were
   *  allowed). Reused across passes — emptied, not rebuilt — and namespaced, so `ownText()` strips it. */
  const badgeBox = (card) => {
    let box = card.querySelector('.ojc-badges');
    if (!box) {
      box = document.createElement('span');
      box.className = 'ojc-badges';
      card.prepend(box);
    }
    return box;
  };

  /** The verdict per card — the scan's priority order and the live harness read the same fact in the DOM
   *  (a data attribute; `dataset.why` had four writes and no readers, so it was deleted in W2). */
  const tierMap = new WeakMap();
  const cardFactsOf = (c) => ({
    ...tiers.cardFacts(ownText(c), settings, rules.matchKeywords),
    goal: c.classList.contains('ojc-goal'),
    goalBy: c.dataset.goalBy !== undefined ? Number(c.dataset.goalBy) : null,
  });

  function refreshRules() {
    if (!LIST_RE.test(location.pathname)) return;
    const now = Date.now();   // one instant for the whole pass, so two cards cannot disagree
    const records = self.OJCRecordsUI;
    // The site's list can render late, so read the cache for new cards: one Set lookup per card, an IDB
    // read only when something is genuinely missing.
    records?.hydrateNew?.();
    const closed = self.OJCClosed;
    const counts = { closed: 0, stale: 0, noSal: 0, kw: 0, high: 0, pos: 0, worth: 0, offPlat: 0, fresh: 0, dup: 0 };
    const list = cards();
    // Duplicates are relational — no single card can know it is the older copy without the rest of the board.
    const dupSet = rules.findDuplicates(list.map(c => ({ key: dupKeyOf(c), at: postedAt(c) })));
    for (let i = 0; i < list.length; i++) { const c = list[i];
      const cardFacts = cardFactsOf(c);
      const { pos, neg } = cardFacts;
      const detail = records?.detailFor(c) || null;
      const at = postedAt(c);   // one read per card: the recency rule and the fresh mark judge the same instant
      const salText = cardSalary(c);   // one read per card: the no-salary rule and the negotiable rescue read it
      const tier = tiers.decide({
        closed: closed?.isHeld(c),
        stale: rules.isStale(at, now, settings.maxAgeDays),
        noSalary: settings.noSalary && !rules.hasSalary(salText),
        rescue: settings.rescueNoSalary,
        negotiable: rules.isNegotiable(salText),
        rescueNeg: settings.rescueNegotiable,
        card: cardFacts,
        detail,
      });
      tierMap.set(c, tier);
      c.dataset.ojcTier = tier;

      // Ours, so it is cleared before re-deciding — and only while our own class is still on the card, so
      // an attribute the site set is never removed.
      if (c.classList.contains('ojc-recon')) c.removeAttribute('title');
      c.classList.remove('ojc-neg', 'ojc-pos', 'ojc-recon', 'ojc-closed');
      for (const b of c.querySelectorAll('.ojc-pos-badge, .ojc-neg-badge, .ojc-closed-badge, .ojc-tier-badge, .ojc-flag-badge, .ojc-fresh, .ojc-dup')) b.remove();

      const flags = (detail && detail.flags) || [];
      // Everything the two texts matched, so the card lists ALL the keywords behind the verdict — one
      // vocabulary (card text and description use the same matcher), merged; where a keyword came only from
      // the description, the badge's tooltip says so rather than inventing a second badge style.
      const allPos = [...new Set([...pos, ...(detail?.pos || [])])];
      const allNeg = [...new Set([...neg, ...(detail?.neg || [])])];
      const fromDesc = [...(detail?.pos || []), ...(detail?.neg || [])];
      const why = (list) => (list.some(k => fromDesc.includes(k))
        ? 'matched in the listing\'s description: ' + list.filter(k => fromDesc.includes(k)).join(', ')
        : undefined);
      const box = badgeBox(c);
      /** The off-platform tag. A TAG, not a verdict (the user: "it should just be a tag"): it goes on every
       *  card that carries one, whatever its tier, and it never hides or demotes anything. */
      const tagOff = () => {
        if (!flags.length) return;
        badge(box, 'ojc-flag-badge', '⚠ off-platform', OFF_PLATFORM + ' (' + flags.join(', ') + ')');
        counts.offPlat++;
      };
      const tagDup = () => {
        if (!dupSet.has(i)) return;
        badge(box, 'ojc-dup', '⚠ duplicate', 'the same title and company, posted again — this is the older copy');
        counts.dup++;
      };

      if (tier === 'closed') {
        c.hidden = !settings.showHidden;
        closed.mark(c);
        counts.closed++;
      } else if (tier === 'stale') {
        c.hidden = !settings.showHidden;
        counts.stale++;
      } else if (tier === 'nosal') {
        c.hidden = !settings.showHidden;
        counts.noSal++;
      } else if (tier === 'high') {
        // HIGH YIELD = passing salary (the user's rule). A positive keyword is a bonus badge, never the reason;
        // a super-green card carries a hide keyword too, and the user sees BOTH sides to re-evaluate.
        c.hidden = false;                       // never hidden: a listing that pays enough is never taken away
        if (allPos.length) { c.classList.add('ojc-pos'); badge(box, 'ojc-pos-badge', '✓ ' + allPos.join(', '), why(allPos)); }
        if (allNeg.length) badge(box, 'ojc-neg-badge', '✗ ' + allNeg.join(', '), why(allNeg));
        tagOff();
        // Fresh: high yield posted within a day — the competition window is still open (a tag, like off-platform:
        // it annotates the verdict, it never changes it).
        if (at != null && now - at < FRESH_MS) { badge(box, 'ojc-fresh', '● fresh', 'posted in the last 24 hours — the competition window is open'); counts.fresh++; }
        counts.high++;
      } else if (tier === 'pos') {
        // A keyword you like on a listing that does NOT meet your goal: the green highlight this extension
        // has always drawn — and deliberately NOT a High yield listing, so it is neither counted as one nor
        // shown in the High yield view.
        c.hidden = false;
        c.classList.add('ojc-pos');
        badge(box, 'ojc-pos-badge', '✓ ' + allPos.join(', '), why(allPos));
        tagOff();
        counts.pos++;
      } else if (tier === 'worth') {
        c.hidden = false;
        c.classList.add('ojc-recon');
        if (allNeg.length) badge(box, 'ojc-neg-badge', '✗ ' + allNeg.join(', '), why(allNeg));
        // Both sides, both badges: a yellow card that also matched a keyword you like shows it — the user
        // re-evaluates the trade-off rather than trusting the colour alone.
        if (allPos.length) badge(box, 'ojc-pos-badge', '✓ ' + allPos.join(', '), why(allPos));
        tagOff();
        c.title = 'Shown because it ' +
          (allPos.length ? `matches "${allPos.join(', ')}"` : 'pays at or above your goal') +
          (allNeg.length ? ` but also matches "${allNeg.join(', ')}"` : '') +
          ' — reconsider it';
        counts.worth++;
      } else if (tier === 'kw') {
        c.hidden = !settings.showHidden;
        c.classList.add('ojc-neg');
        if (allNeg.length) badge(box, 'ojc-neg-badge', '✗ ' + allNeg.join(', '), why(allNeg));
        tagOff();
        counts.kw++;
      } else {
        c.hidden = false;
        tagOff();
      }
      if (!c.hidden) tagDup();   // a tag like off-platform: it annotates whatever tier the card landed in
      if (!c.hidden && settings.rescueNegotiable && rules.isNegotiable(salText) && !rules.hasSalary(salText))
        badge(box, 'ojc-flag-badge', '⚠ negotiable', 'states no figure — the pay is negotiable');
      // The remembered verdict: recomputed for a listing the scan has met, so a moved tier is recorded and
      // marked. `note` returns null for a card with no record and for an unchanged one — no storage write.
      records?.note(c, tier, cardFacts);
      records?.mark(c);
      if (view !== 'all' && tier !== view) c.hidden = true;   // the view has the last word
    }
    chipCounts = counts;
    passNo++;
    self.OJCLoader?.arm();        // pagination.js watches for the end of the list (W6)
    self.OJCSalaryUI?.annotate(); // salary-cards.js adds the monthly figure per card (W7)
    renderChip();
  }

  // Show a tier: set the view, re-run the pass, and bring the FIRST CARD OF THAT TIER into sight. Measured
  // live on a 298-card page: the filter took 237 ms, but the document shrank 92 000 px → 19 000 px and the
  // viewport (the user had scrolled to the middle) ended up 18 000 px below the first high-yield card —
  // the board was correct and showed nothing. The scroll is why the view does not look broken.
  function setView(next) {
    view = next;
    refreshRules();
    if (next === 'all') return;
    const first = cards().find(c => !c.hidden && tierMap.get(c) === next);
    if (first) first.scrollIntoView({ block: 'center', behavior: 'instant' });
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  // The panel's Save is a form: it writes the whole object.
  function persist() { chrome.storage.local.set({ settings }); }
  // A chip toggle changes one field, so it writes ONE field: every tab holds a copy loaded at boot, so a
  // full-object write here reverts settings changed in another tab (found live: the panel's "no salary"
  // came back after another tab's delayed write). Merging the stored object is the fix. NOT a dotted
  // path — `set` silently drops 'settings.showHidden' (the label flipped while storage kept the old value).
  async function persistField(key, value) {
    const { settings: stored } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...DEFAULTS, ...(stored || {}), [key]: value } });
  }
  function applySettings(next) {
    settings = { ...DEFAULTS, ...(next || {}) };
    if (!settings.autoLoad) self.OJCLoader?.stop();
    else self.OJCLoader?.rearm?.();   // a wider recency window can mean more pages are worth loading (W6)
    // Re-derive the cached descriptions BEFORE the pass reads them: this is what makes a keyword edit
    // re-tier the whole page with zero requests (D36).
    self.OJCRecordsUI?.onSettings(settings);
    refreshRules();
    self.OJCPanel?.sync();
    self.OJCScan?.onSettings?.(settings);
  }

  // The API the other modules use. Small on purpose: it must not grow into a second copy of the rule pass.
  self.OJC = {
    ...page,                     // LIST_RE, SELECTORS, cards, ownText, cardSalary, postedAt
    refreshRules, setNote, persist,
    getSettings: () => settings,
    getView: () => view,
    setView,

    /** The verdict the last pass reached for a card, and the facts behind it — the scan's ordering input
     *  (W13.3) and what the live harness recomputes against. */
    tierOf: (c) => tierMap.get(c) || null,
    cardFactsOf,
    hasSomethingToScanFor,
    // panel.js writes a whole form; assigning (not merging) is the point of a Save button.
    setSettings: (next) => { settings = { ...DEFAULTS, ...next }; },
  };

  // ── Boot ─────────────────────────────────────────────────────────────────
  chrome.storage.local.get('settings', (res) => {
    applySettings(res.settings);
    console.log('[OJ Cleaner] active', settings);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) applySettings(changes.settings.newValue);
  });
})();
