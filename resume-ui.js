/**
 * resume-ui.js: the "Words from your resume" picker (spec.md D80), opened from setup's "What are you hunting?"
 * screen and from ⚙'s "📄 From my resume".
 *
 * Paste the resume or pick the file (resume-read.js turns .pdf, .docx and .txt into text, on this computer), then
 * the job words found in it come back as ticked boxes, each with how many posts seen here use it (resume-words.js,
 * fed by skill-tags.js). Add hands the ticked words to whoever opened it; nothing is saved by this file, and the
 * resume itself is never stored.
 *
 * ⚙'s button is caught here by its id, so panel.js stays a form; setup.js calls `open` itself.
 */
(() => {
  'use strict';
  if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) return;
  const RR = self.OJCResumeRead, RW = self.OJCResumeWords, PR = self.OJCPresets, L = self.OJCLabels?.resume;
  if (!RR || !RW || !L) return;

  let node = null;
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v; else if (k.startsWith('on')) n[k] = v; else n.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k);
    return n;
  };
  const close = () => { node?.remove(); node = null; };

  /** `existing`: the words already on either list (never offered again). `onAdd(words)`: what Add does. */
  function open({ existing = [], onAdd }) {
    close();
    const text = h('textarea', { id: 'ojc-resume-text', rows: '7', placeholder: L.pastePh, spellcheck: 'false', 'aria-label': L.pastePh });
    const input = h('input', { type: 'file', accept: '.pdf,.docx,.txt,.md,application/pdf,text/plain', hidden: '' });
    const status = h('span', { class: 'ojc-rw-status', role: 'status' });
    const results = h('div', { class: 'ojc-rw-results' });
    const add = h('button', { type: 'button', class: 'is-primary', disabled: '' }, L.add(0));
    let rows = [];

    const count = () => results.querySelectorAll('input:checked').length;
    const paintAdd = () => { const n = count(); add.textContent = L.add(n); add.disabled = !n; };

    async function find() {
      if (!text.value.trim()) { text.focus(); return; }
      const said = status.textContent;   // "Read 312 words from cv.pdf" stays once the words are found
      status.textContent = L.looking;
      results.innerHTML = '';
      const seen = (await self.OJCSkillTags?.gather?.()) || { tags: [], corpus: [] };
      rows = RW.suggest({ resume: text.value, vocab: RW.vocabulary(PR?.ARCHETYPES, seen.tags), corpus: seen.corpus, existing });
      status.textContent = said === L.looking ? '' : said;
      if (!rows.length) { results.append(h('p', { class: 'ojc-rw-none' }, L.none(seen.corpus.length))); paintAdd(); return; }
      results.append(h('p', {}, L.found(rows.length, seen.corpus.length)),
        h('div', { class: 'ojc-rw-chips' }, rows.map((r) => {
          const cb = h('input', { type: 'checkbox', value: r.word });
          cb.checked = r.ticked;
          cb.onchange = paintAdd;
          const chip = h('label', { class: 'ojc-rw-chip' + (r.general ? ' is-general' : '') }, cb, h('span', {}, r.label), h('small', {}, L.posts(r.posts)));
          if (r.general) chip.title = L.generalTip;
          return chip;
        })));
      paintAdd();
    }

    input.onchange = async () => {
      const f = input.files && input.files[0];
      input.value = '';
      if (!f) return;
      status.textContent = L.reading(f.name);
      try {
        const t = await RR.read(f.name, await f.arrayBuffer());
        text.value = t;
        status.textContent = L.read(f.name, (t.match(/\S+/g) || []).length);
        await find();
      } catch (e) {
        status.textContent = L.err[e?.message] || L.err.other;
      }
    };

    add.onclick = () => {
      const words = [...results.querySelectorAll('input:checked')].map(cb => cb.value);
      close();
      if (words.length) onAdd?.(words);
    };

    node = h('div', { id: 'ojc-resume', role: 'dialog', 'aria-modal': 'true', 'aria-label': L.title },
      h('div', { class: 'ojc-rw-card' },
        h('div', { class: 'ojc-rw-top' }, h('b', {}, L.title),
          h('button', { type: 'button', class: 'ojc-rw-x', 'aria-label': L.close, title: L.close, onclick: close }, '✕')),
        h('p', {}, L.intro),
        text,
        h('div', { class: 'ojc-rw-row' },
          h('button', { type: 'button', onclick: () => input.click() }, L.file), input,
          h('button', { type: 'button', class: 'ojc-rw-find', onclick: find }, L.find), status),
        results,
        h('p', { class: 'ojc-rw-privacy' }, L.privacy),
        h('div', { class: 'ojc-rw-foot' }, h('button', { type: 'button', onclick: close }, L.cancel), add)));
    node.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    node.addEventListener('click', (e) => { if (e.target === node) close(); });
    document.body.appendChild(node);
    text.focus({ preventScroll: true });
  }

  // ⚙ → "📄 From my resume": the words go into the "I'm into" box, and Save keeps them, as with "Add words for…".
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t?.closest('#ojc-kw-resume')) return;
    const box = (id) => document.getElementById(id);
    const lines = (el) => (el?.value || '').split('\n').map(x => x.trim()).filter(Boolean);
    open({
      existing: [...lines(box('ojc-pos')), ...lines(box('ojc-neg'))],
      onAdd: (words) => {
        const pos = box('ojc-pos'), neg = box('ojc-neg');
        if (!pos || !neg) return;
        // The presets' rule (presets.js): a block on a word you want goes, or that word's jobs would stay hidden.
        const next = PR.addWords({ positive: lines(pos), negative: lines(neg) }, words);
        pos.value = next.positive.join('\n');
        neg.value = next.negative.join('\n');
        self.OJCToast?.show(L.addedPanel(words.length, next.unblocked));
      },
    });
  });

  self.OJCResumeUI = { open, close };
})();
