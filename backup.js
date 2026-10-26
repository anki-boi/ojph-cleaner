/**
 * backup.js: ⚙ → Advanced → "Back up everything" and "Restore from a file" (spec.md D79).
 *
 * Runs in the OnlineJobs.ph page on purpose: the saved posts live in that site's IndexedDB (detail-cache.js), which
 * the extension's own pages (options.html, jobs.html) cannot open. `chrome.storage.local` is reachable from here
 * too, so one place holds both halves.
 *
 * Restore replaces, it never merges: two computers' My jobs would disagree about the same listing and a merge would
 * have to guess which one is right. It asks first, saying what the file holds, and the file is checked
 * (backup-file.js) before anything is written. Then the page reloads, so every part of the extension starts from
 * the restored data instead of what it held in memory.
 *
 * The panel only carries the two buttons; the clicks are caught here, so panel.js stays a form.
 *
 * Two writers keep a copy in memory and write it back whole: the visit marks (triage.js, every minute and on
 * leaving) and the re-post sightings (trust.js). While a restore runs, `restoring` stops them, in this tab and, through
 * the `restoreStamp` key, in every other OnlineJobs.ph tab, which then reloads onto the restored data too.
 */
(() => {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage || typeof document === 'undefined') return;
  const F = self.OJCBackupFile, cache = self.OJCDetailCache, L = self.OJCLabels;
  if (!F) return;
  let restoring = false;

  async function save() {
    const storage = await chrome.storage.local.get(null);
    let posts = [];
    try { posts = (await cache?.all?.()) || []; } catch { /* no saved posts readable: the rest still backs up */ }
    const now = Date.now();
    const file = F.pack({ storage, posts, version: chrome.runtime.getManifest().version, now });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
    a.download = F.fileName(now);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    self.OJCToast?.show(L.backup.made(a.download));
  }

  function pick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const b = F.unpack(await f.text());
      if (b instanceof Error) { self.OJCToast?.show(b.message === 'not a backup file' ? L.backup.bad : L.backup.failed(b.message)); return; }
      ask(b);
    };
    input.click();
  }

  /** The question, inside the panel under the buttons: what the file holds, and that it replaces what is here. */
  function ask(b) {
    document.getElementById('ojc-restore-ask')?.remove();
    const host = document.getElementById('ojc-backup-row');
    const box = document.createElement('div');
    box.id = 'ojc-restore-ask';
    const when = b.at ? new Date(b.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'an unknown date';
    const p = document.createElement('p');
    p.textContent = L.backup.confirm(when, F.summary(b));
    const go = Object.assign(document.createElement('button'), { type: 'button', className: 'ojc-restore-go', textContent: L.backup.replace });
    const no = Object.assign(document.createElement('button'), { type: 'button', textContent: L.backup.cancel });
    go.onclick = () => restore(b, box);
    no.onclick = () => box.remove();
    box.append(p, go, no);
    (host || document.body).after(box);
    go.focus();
  }

  async function restore(b, box) {
    box.querySelectorAll('button').forEach(x => { x.disabled = true; });
    restoring = true;
    try {
      if (cache?.replaceAll) await cache.replaceAll(b.posts);
      const now = await chrome.storage.local.get(null);
      await chrome.storage.local.set(b.storage);
      const extra = Object.keys(now).filter(k => !(k in b.storage));
      if (extra.length) await chrome.storage.local.remove(extra);
      await chrome.storage.local.set({ restoreStamp: Date.now() });   // the other tabs reload on this
    } catch (e) {
      restoring = false;
      self.OJCToast?.show(L.backup.failed(e?.message || 'the browser refused the write'));
      box.remove();
      return;
    }
    self.OJCToast?.show(L.backup.restored);
    setTimeout(() => location.reload(), 900);
  }

  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest('#ojc-backup-save')) save();
    else if (t?.closest('#ojc-backup-load')) pick();
  });

  // Another tab restored: stop writing from memory, and start again from what is stored now.
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local' || !ch.restoreStamp?.newValue || restoring) return;
    restoring = true;
    setTimeout(() => location.reload(), 300);
  });

  self.OJCBackup = { save, pick, get restoring() { return restoring; } };
})();
