/**
 * resume-pdf.js: the text a PDF draws (spec.md D80), for resume-read.js. Split from it at the 300-line cap.
 *
 * The letters in a PDF are not stored as letters: each font maps its own codes to characters (a ToUnicode table
 * for the fonts Chrome, Google Docs and Word embed; a plain single-byte encoding for the standard fonts), so every
 * string is decoded through the font it is drawn in, and each letter's width is read so a space is written only
 * where the page leaves a gap. Compressed object streams (PDF 1.5+) are opened too. A scanned resume (a picture
 * of text) and an encrypted PDF have no text to give: both say so, and the person pastes instead.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { const R = require('./resume-read.js'); R.readPdf = factory(R); module.exports = R; }
  else root.OJCResumeRead.readPdf = factory(root.OJCResumeRead);
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';
  const { latin1, bytesOf, inflate, cmap, glyphChar, WIN } = R;

  const WS = /[\0\t\n\f\r ]/, DELIM = /[()<>[\]{}/%]/;
  /** Parse one PDF value starting at s[i]. Returns [value, nextIndex]. Names → {n}, refs → {r}, strings → {s} (bytes as
   *  a binary string), operators and other bare words → a plain string. */
  function parseAt(s, i) {
    const skip = () => { for (;;) { while (i < s.length && WS.test(s[i])) i++; if (s[i] === '%') { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; } else break; } };
    skip();
    const c = s[i];
    if (c === '<' && s[i + 1] === '<') {
      i += 2;
      const d = {};
      for (;;) {
        skip();
        if (s[i] === '>' && s[i + 1] === '>') return [d, i + 2];
        if (i >= s.length) return [d, i];
        const [k, j] = parseAt(s, i);
        const [v, j2] = parseAt(s, j);
        if (k && k.n !== undefined) d[k.n] = v;
        i = j2;
      }
    }
    if (c === '[') {
      i++;
      const a = [];
      for (;;) {
        skip();
        if (s[i] === ']' || i >= s.length) return [a, i + 1];
        const [v, j] = parseAt(s, i);
        // `12 0 R` arrives as three tokens: fold the last two numbers and the R into a ref.
        if (v === 'R' && typeof a[a.length - 1] === 'number' && typeof a[a.length - 2] === 'number') { a.pop(); a.push({ r: a.pop() }); }
        else a.push(v);
        i = j;
      }
    }
    if (c === '/') { let j = i + 1; while (j < s.length && !WS.test(s[j]) && !DELIM.test(s[j])) j++; return [{ n: s.slice(i + 1, j).replace(/#([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))) }, j]; }
    if (c === '(') return literal(s, i);
    if (c === '<') { let j = s.indexOf('>', i); if (j < 0) j = s.length; const hex = s.slice(i + 1, j).replace(/[^0-9a-f]/gi, ''); return [{ s: hexStr(hex) }, j + 1]; }
    let j = i;
    while (j < s.length && !WS.test(s[j]) && !DELIM.test(s[j])) j++;
    if (j === i) return [null, i + 1];
    const t = s.slice(i, j);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) {
      // a number, or the start of `num gen R`
      const m = /^\s+(\d+)\s+R(?![^\s/<[(\]>])/.exec(s.slice(j, j + 24));
      if (m && /^\d+$/.test(t)) return [{ r: Number(t) }, j + m[0].length];
      return [Number(t), j];
    }
    return [t === 'true' ? true : t === 'false' ? false : t === 'null' ? null : t, j];
  }
  const hexStr = (hex) => { if (hex.length % 2) hex += '0'; let o = ''; for (let k = 0; k < hex.length; k += 2) o += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16)); return o; };
  const ESC = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
  function literal(s, i) {
    let depth = 0, o = '';
    for (i++; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') {
        const d = s[++i];
        if (ESC[d]) o += ESC[d];
        else if (/[0-7]/.test(d)) { let oct = d; while (oct.length < 3 && /[0-7]/.test(s[i + 1])) oct += s[++i]; o += String.fromCharCode(parseInt(oct, 8) & 255); }
        else if (d === '\r') { if (s[i + 1] === '\n') i++; }
        else if (d !== '\n') o += d;
      } else if (c === '(') { depth++; o += c; }
      else if (c === ')') { if (depth-- === 0) return [{ s: o }, i + 1]; o += c; }
      else o += c;
    }
    return [{ s: o }, i];
  }

  /** ASCII85, the text wrapping some PDF makers put around compressed data: 5 characters for every 4 bytes. */
  function a85(b) {
    const t = latin1(b).replace(/^\s*<~/, '').replace(/~>[\s\S]*$/, '').replace(/\s+/g, '');
    const out = [];
    let group = [];
    const flush = (n) => {
      while (group.length < 5) group.push(84);   // pad with 'u'
      let v = 0;
      for (const c of group) v = v * 85 + c;
      for (let k = 0; k < n; k++) out.push((v >>> (24 - 8 * k)) & 255);
      group = [];
    };
    for (const ch of t) {
      if (ch === 'z' && !group.length) { out.push(0, 0, 0, 0); continue; }
      group.push(ch.charCodeAt(0) - 33);
      if (group.length === 5) flush(4);
    }
    if (group.length) flush(group.length - 1);
    return new Uint8Array(out);
  }

  /** Every object in the file, plain and inside compressed object streams: num → { v, data } (data = decoded stream). */
  async function objects(s) {
    const raw = new Map();
    const re = /(\d+)\s+\d+\s+obj\b/g;
    let m;
    while ((m = re.exec(s))) {
      const num = Number(m[1]);
      const [v, j] = parseAt(s, re.lastIndex);
      let k = j;
      while (WS.test(s[k] || '')) k++;
      let data = null;
      if (s.startsWith('stream', k)) {
        let start = k + 6;
        if (s[start] === '\r') start++;
        if (s[start] === '\n') start++;
        const len = typeof v?.Length === 'number' ? v.Length : -1;
        let end = len >= 0 && s.slice(start + len, start + len + 12).includes('endstream') ? start + len : s.indexOf('endstream', start);
        if (end < 0) end = s.length;
        data = { start, end };
        re.lastIndex = end;
      }
      raw.set(num, { v, data });
    }
    const decode = async (o) => {
      if (!o?.data) return null;
      if (o.text != null) return o.text;
      const f = o.v?.Filter, filters = Array.isArray(f) ? f.map(x => x?.n) : f ? [f.n] : [];
      let b = bytesOf(s.slice(o.data.start, o.data.end));
      for (const name of filters) {
        if (name === 'FlateDecode' || name === 'Fl') b = await inflate(b, 'deflate');
        else if (name === 'ASCII85Decode' || name === 'A85') b = a85(b);
        else if (name === 'ASCIIHexDecode' || name === 'AHx') b = bytesOf(hexStr(latin1(b).replace(/>[\s\S]*$/, '').replace(/[^0-9a-f]/gi, '')));
        else return (o.text = '');   // images and the rest: no text in them
      }
      return (o.text = latin1(b));
    };
    for (const [, o] of [...raw]) {
      if (o.v?.Type?.n !== 'ObjStm') continue;
      const t = await decode(o), first = Number(o.v.First) || 0;
      const head = t.slice(0, first).trim().split(/\s+/).map(Number);
      for (let k = 0; k + 1 < head.length; k += 2) {
        if (raw.has(head[k])) continue;   // a plain object of the same number is the newer one
        raw.set(head[k], { v: parseAt(t, first + head[k + 1])[0], data: null });
      }
    }
    return { raw, decode };
  }

  async function readPdf(b) {
    const s = latin1(b);
    if (!s.startsWith('%PDF')) throw new Error('not a PDF');
    const { raw, decode } = await objects(s);
    if (/\/Encrypt\s/.test(s.slice(-4096)) || [...raw.values()].some(o => o.v?.Type?.n === 'XRef' && o.v.Encrypt)) throw new Error('encrypted');
    const get = (v) => { for (let k = 0; v && v.r !== undefined && k < 32; k++) v = raw.get(v.r)?.v; return v; };
    const fontCache = new Map();
    async function fontOf(ref) {
      const key = ref?.r ?? ref;
      if (fontCache.has(key)) return fontCache.get(key);
      const f = get(ref) || {};
      let font = { map: null, width: 1 };
      const tu = f.ToUnicode && raw.get(f.ToUnicode.r);
      if (tu) font = cmap(await decode(tu));
      else if (f.Subtype?.n === 'Type0') font.width = 2;
      const enc = get(f.Encoding);
      if (!font.map && enc?.Differences) {
        font.diff = new Map();
        let code = 0;
        for (const x of enc.Differences) { if (typeof x === 'number') code = x; else if (x?.n) font.diff.set(code++, glyphChar(x.n)); }
      }
      // Each letter's width (thousandths of the font size), so a space is written only where the page leaves a gap:
      // Chrome draws a kerned capital on its own ("V" + "irtual"), and that must stay one word.
      font.widths = new Map();
      if (f.Subtype?.n === 'Type0') {
        const desc = get(get(f.DescendantFonts)?.[0]) || {};
        font.dw = Number(desc.DW) || 1000;
        const W = get(desc.W) || [];
        for (let k = 0; k < W.length;) {
          const c = W[k], next = get(W[k + 1]);
          if (Array.isArray(next)) { next.forEach((w, q) => font.widths.set(c + q, Number(get(w)) || 0)); k += 2; }
          else { for (let q = c; q <= next && q - c < 65536; q++) font.widths.set(q, Number(W[k + 2]) || 0); k += 3; }
        }
      } else {
        font.dw = 500;
        (get(f.Widths) || []).forEach((w, q) => font.widths.set((Number(f.FirstChar) || 0) + q, Number(get(w)) || 0));
      }
      fontCache.set(key, font);
      return font;
    }
    /** The text a string draws in a font, and how far it moves the pen (thousandths of the font size). */
    const show = (str, font) => {
      str = str?.s ?? '';
      if (!font) return [str, str.length * 500];
      if (!font.map && font.width === 2) return ['', 0];   // two-byte codes and no table to read them: no honest text
      let o = '', adv = 0;
      const w = font.map ? font.width : 1;
      for (let k = 0; k + w <= str.length; k += w) {
        let code = 0;
        for (let q = 0; q < w; q++) code = code * 256 + str.charCodeAt(k + q);
        o += font.map ? (font.map.get(code) ?? '') : font.diff?.has(code) ? font.diff.get(code) : WIN[code] ?? (code >= 32 ? String.fromCharCode(code) : '');
        adv += font.widths?.get(code) ?? font.dw ?? 500;
      }
      return [o, adv];
    };

    // Pages in reading order, each with the resources it inherits.
    const pages = [];
    const walk = (node, res, seen = new Set()) => {
      const n = get(node);
      if (!n || seen.has(n)) return;
      seen.add(n);
      const r = n.Resources ? get(n.Resources) : res;
      if (n.Type?.n === 'Page' || (!n.Kids && n.Contents)) pages.push({ n, res: r });
      else for (const k of n.Kids || []) walk(k, r, seen);
    };
    const cat = [...raw.values()].find(o => o.v?.Type?.n === 'Catalog');
    if (cat) walk(cat.v.Pages, null);
    if (!pages.length) for (const o of raw.values()) if (o.v?.Type?.n === 'Page') pages.push({ n: o.v, res: get(o.v.Resources) });

    let out = '';
    for (const { n, res } of pages) {
      const fonts = get(res?.Font) || {};
      const contents = Array.isArray(get(n.Contents)) ? get(n.Contents) : [n.Contents];
      let text = '';
      for (const c of contents) text += '\n' + ((c && raw.get(c.r) && await decode(raw.get(c.r))) || '');
      out += await runText(text, fonts) + '\n';
    }

    /**
     * Walk a page's drawing commands, writing what the text operators show. The pen is followed in page units:
     * moving down starts a new line, moving right past the end of the last word by more than a sliver writes a
     * space, and a move that lands where the last letter ended writes nothing.
     */
    async function runText(t, fonts) {
      let o = '', font = null, fs = 10, i = 0;
      let a = 1, d = 1, lineX = 0, lineY = 0, penX = null, lastY = null;
      const ops = [];
      const size = () => Math.abs(fs * a) || 10;
      const moveTo = (nx, ny) => {
        if (lastY !== null && Math.abs(ny - lastY) > size() * 0.5) o += '\n';
        else if (penX !== null && (nx - penX > size() * 0.12 || nx < penX - size())) o += ' ';
        lineX = nx; lineY = ny; penX = nx; lastY = ny;
      };
      const draw = (str) => { const [txt, adv] = show(str, font); o += txt; penX = (penX ?? lineX) + adv / 1000 * fs * Math.abs(a); };
      while (i < t.length) {
        const [v, j] = parseAt(t, i);
        if (j <= i) break;
        i = j;
        if (typeof v === 'string' && /^[A-Za-z'"*]+$/.test(v)) {
          // an operator: its operands are on the stack
          const n = (k) => Number(ops[ops.length - k]) || 0;
          const top = ops[ops.length - 1];
          if (v === 'Tf') { font = await fontOf(fonts[ops[ops.length - 2]?.n]); fs = n(1) || fs; }
          else if (v === 'Tj') draw(top);
          else if (v === "'" || v === '"') { o += '\n'; draw(top); }
          else if (v === 'TJ') {
            for (const x of Array.isArray(top) ? top : []) {
              if (typeof x !== 'number') draw(x);
              else { if (x < -250) o += ' '; penX = (penX ?? lineX) - x / 1000 * fs * Math.abs(a); }
            }
          } else if (v === 'Td' || v === 'TD') moveTo(lineX + n(2) * a, lineY + n(1) * d);
          else if (v === 'Tm') { a = n(6) || 1; d = n(3) || 1; moveTo(n(2), n(1)); }
          else if (v === 'T*') { o += '\n'; penX = null; }
          else if (v === 'BT') { a = 1; d = 1; lineX = 0; lineY = 0; }
          else if (v === 'BI') { const e = t.indexOf('EI', i); i = e < 0 ? t.length : e + 2; }   // inline image bytes
          ops.length = 0;
        } else ops.push(v);
      }
      return o;
    }

    const text = out.normalize('NFKC');
    if (!/[a-z]{3}/i.test(text)) throw new Error('no text');
    return text;
  }


  readPdf.parseAt = parseAt;
  return readPdf;
});
