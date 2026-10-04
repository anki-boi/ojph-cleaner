/**
 * toast.js — one short message at the bottom of the page, optionally with an action (spec.md D48, D66).
 *
 *   OJCToast.show('Settings saved', { action: { label: 'Undo', run: () => … }, ms: 8000 })
 *
 * One at a time: a new toast replaces the old one (and the old one's action is gone with it — an Undo
 * offered for a change that has since been overwritten would undo the wrong thing). The node carries an
 * `ojc-` id, so observer.js never mistakes it for the site changing.
 */
(() => {
  'use strict';
  if (typeof document === 'undefined') return;
  let node = null, timer = 0;

  function ensure() {
    if (node?.isConnected) return node;
    node = document.createElement('div');
    node.id = 'ojc-toast';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.hidden = true;
    document.body.appendChild(node);
    return node;
  }

  function hide() {
    clearTimeout(timer);
    if (node) { node.hidden = true; node.innerHTML = ''; }
  }

  function show(text, { action = null, ms = action ? 8000 : 5000 } = {}) {
    const n = ensure();
    clearTimeout(timer);
    n.innerHTML = '';
    const msg = document.createElement('span');
    msg.textContent = text;
    n.appendChild(msg);
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'ojc-toast-action';
      b.textContent = action.label;
      b.onclick = () => { hide(); action.run(); };
      n.appendChild(b);
    }
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '✕';
    x.setAttribute('aria-label', 'Dismiss');
    x.onclick = hide;
    n.appendChild(x);
    n.hidden = false;
    timer = setTimeout(hide, ms);
  }

  self.OJCToast = { show, hide };
})();
