/**
 * resume-read.js: the text of a resume file (spec.md D80), from .txt, .docx or .pdf, with no library.
 *
 * Pure and UMD: resume-ui.js hands it the file's bytes in the page, test-resume.js hands it real files in node.
 * The browser's own DecompressionStream does the unpacking, so the extension keeps its zero dependencies.
 *
 *   .docx  a zip archive; the words are the <w:t> runs of word/document.xml, a paragraph per line.
 *   .pdf   the text a PDF draws, page by page: resume-pdf.js (loaded after this file), which reads the font
 *          tables kept here.
 *
 * Only the words matter here (resume-words.js matches them against job words), so layout is approximate: a
 * new line where the text moves down, a space where it moves along.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCResumeRead = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MAX_BYTES = 15 * 1024 * 1024;

  const latin1 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return s;
  };
  const bytesOf = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };

  /** Inflate, keeping whatever came out before an error: PDF streams often carry a stray byte after the data. */
  async function inflate(u8, format) {
    const ds = new DecompressionStream(format);
    const w = ds.writable.getWriter();
    w.write(u8).catch(() => {});
    w.close().catch(() => {});
    const r = ds.readable.getReader();
    const parts = [];
    let n = 0;
    try { for (;;) { const { value, done } = await r.read(); if (done) break; parts.push(value); n += value.length; } } catch { /* keep what we have */ }
    const out = new Uint8Array(n);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  // ── .docx ───────────────────────────────────────────────────────────────
  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

  /** The files of a zip whose names pass `want`, as bytes. Reads the central directory, as every unzip does. */
  async function unzip(b, want) {
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip');
    const out = new Map();
    let p = u32(b, eocd + 16);
    for (let k = u16(b, eocd + 10); k > 0 && u32(b, p) === 0x02014b50; k--) {
      const method = u16(b, p + 10), size = u32(b, p + 20), nameLen = u16(b, p + 28);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
      const local = u32(b, p + 42);
      p += 46 + nameLen + u16(b, p + 30) + u16(b, p + 32);
      if (!want(name) || u32(b, local) !== 0x04034b50) continue;
      const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
      const data = b.subarray(start, start + size);
      out.set(name, method === 0 ? data : method === 8 ? await inflate(data, 'deflate-raw') : new Uint8Array(0));
    }
    return out;
  }

  const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e.toLowerCase()] ?? m);

  async function readDocx(b) {
    const files = await unzip(b, (n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
    const doc = files.get('word/document.xml');
    if (!doc) throw new Error('not a Word document');
    const xml = [doc, ...[...files].filter(([n]) => n !== 'word/document.xml').map(([, v]) => v)]
      .map(v => new TextDecoder().decode(v)).join('\n');
    return unescapeXml(xml
      .replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n')
      .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, '')      // field codes (HYPERLINK "…"), not text
      .replace(/<[^>]+>/g, ''));
  }

  // ── PDF font tables (resume-pdf.js reads them) ─────────────────────────
  /** A ToUnicode CMap: code → string, and how many bytes a code takes. */
  function cmap(t) {
    const map = new Map();
    let width = 0;
    const hx = (h) => parseInt(h, 16);
    const utf16 = (h) => {
      if (!h) return '';
      if (h.length < 4) return String.fromCharCode(hx(h));
      let o = '';
      for (let k = 0; k + 3 < h.length; k += 4) o += String.fromCharCode(hx(h.slice(k, k + 4)));
      return o;
    };
    for (const blk of t.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
      const m = /<([0-9a-f]+)>/i.exec(blk[1]);
      if (m) width = Math.max(width, m[1].length / 2);
    }
    for (const blk of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const m of blk[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) {
        map.set(hx(m[1]), utf16(m[2]));
        if (!width) width = m[1].length / 2;
      }
    }
    for (const blk of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const m of blk[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<[0-9a-f]*>|\[[^\]]*\])/gi)) {
        const lo = hx(m[1]), hi = hx(m[2]);
        if (!width) width = m[1].length / 2;
        if (m[3][0] === '[') {
          const list = [...m[3].matchAll(/<([0-9a-f]*)>/gi)].map(x => utf16(x[1]));
          for (let c = lo; c <= hi && c - lo < list.length; c++) map.set(c, list[c - lo]);
        } else {
          const base = m[3].slice(1, -1), last = hx(base.slice(-4) || '0'), pre = utf16(base.slice(0, -4));
          for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, pre + String.fromCharCode(last + (c - lo)));
        }
      }
    }
    return { map, width: width || 1 };
  }

  /** Glyph names a /Differences array uses for the characters a resume has. Anything else: a one-letter name, or uniXXXX. */
  const GLYPH = { space: ' ', hyphen: '-', period: '.', comma: ',', colon: ':', semicolon: ';', slash: '/', at: '@', ampersand: '&',
    parenleft: '(', parenright: ')', quoteright: '’', quoteleft: '‘', quotedblleft: '“', quotedblright: '”', quotesingle: "'",
    bullet: '•', endash: '–', emdash: '—', fi: 'fi', fl: 'fl', plus: '+', numbersign: '#', percent: '%', dollar: '$',
    zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
  const glyphChar = (n) => GLYPH[n] ?? (n.length === 1 ? n : /^uni[0-9A-F]{4}$/.test(n) ? String.fromCharCode(parseInt(n.slice(3), 16)) : '');
  /** WinAnsi's printable differences from Latin-1 (the 0x80 to 0x9F row): quotes, dashes and the bullet. */
  const WIN = { 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x85: '…', 0x80: '€' };

  /** The resume's text, from a file name and its bytes. Throws Error('…') with a reason a person can act on. */
  async function read(name, buffer) {
    const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (b.length > MAX_BYTES) throw new Error('too big');
    const ext = (/\.([a-z0-9]+)$/i.exec(name || '') || [])[1]?.toLowerCase();
    let text;
    if (ext === 'pdf' || latin1(b.subarray(0, 5)) === '%PDF-') text = await api.readPdf(b);   // resume-pdf.js
    else if (ext === 'docx') text = await readDocx(b);
    else if (ext === 'doc') throw new Error('old Word file');
    // Notepad's "Unicode" is UTF-16 with a byte-order mark.
    else text = new TextDecoder(b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : 'utf-8').decode(b);
    return text.replace(/[ \t\f\r]+/g, ' ').replace(/ *\n[\n ]*/g, '\n').trim();
  }

  const api = { read, readDocx, unzip, latin1, bytesOf, inflate, cmap, glyphChar, WIN, MAX_BYTES, readPdf: null };
  return api;
});
