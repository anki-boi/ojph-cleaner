/**
 * maker.js: the maker's business card (spec.md D81), at the top of ⚙, above the keyword boxes: Jeyson builds
 * automation, for the person using the extension and for the clients they land. A small version of
 * anki-boi.github.io/work, in that page's own colours, so it reads as his card and not as part of the tool.
 *
 * It follows the Chrome Web Store's ads policy, because it shows beside a third-party site: it lives only inside the
 * extension's own settings drawer (never on the board, never near the site's own content or ads), it says who it is
 * from, it is disclosed in the store listing, nothing has to be clicked to use the extension, and it goes with the
 * extension when it is uninstalled (the policy's "adjusting the settings or uninstalling"). No Hide button: the
 * owner's call (2026-10-26), and the card only shows when someone opens ⚙. The links open only on a click; nothing
 * is loaded or sent before that (the serif is the system's own, no web font is fetched).
 */
(() => {
  'use strict';
  if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) return;
  const L = self.OJCLabels?.maker;
  if (!L) return;
  const TAG = 'utm_source=ojph-cleaner&utm_medium=extension';
  const WORK = `https://anki-boi.github.io/work/?${TAG}`;
  const CALL = `https://calendly.com/donjeysonofficial/30min?${TAG}`;

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const link = (cls, text, href) => { const a = el('a', cls, text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; };

  function paint() {
    const slot = document.getElementById('ojc-maker-slot');
    if (!slot) return;
    if (slot.firstChild) return;
    const card = el('aside', 'ojc-maker');
    card.setAttribute('aria-label', L.label);
    const mono = el('span', 'ojc-maker-mono');
    mono.append('J', el('i', null, 'D'));
    mono.setAttribute('aria-hidden', 'true');
    const head = el('div', 'ojc-maker-head');
    head.append(mono, el('div', null));
    head.children[1].append(el('small', null, L.from), el('b', null, L.name), el('span', 'ojc-maker-role', L.role));
    const row = el('div', 'ojc-maker-row');
    row.append(link('ojc-maker-call', L.call, CALL), link('ojc-maker-work', L.work, WORK));
    card.append(head, el('p', null, L.body), row);
    slot.replaceChildren(card);
  }

  // The drawer is built on its first open (panel.js); paint whenever ⚙ is pressed.
  document.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('#ojc-gear')) setTimeout(paint, 0);
  });
  self.OJCMaker = { paint };
})();
