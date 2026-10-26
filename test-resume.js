// test-resume.js: words from a resume (spec.md D80). Real files in tests/fixtures/resume, all of one made-up person:
// a PDF printed by Chrome (the engine behind Google Docs' PDF download), two by another PDF maker (a standard font
// and an embedded Windows font), one repacked into a compressed object stream (as Word writes them), a scan with no
// text, a locked PDF, and a .docx whose words are split across runs the way Word splits them.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('./resume-pdf.js');   // resume-read.js with the PDF reader attached
const RW = require('./resume-words.js');
const PR = require('./presets.js');
const FIX = path.join(__dirname, 'tests', 'fixtures', 'resume');
const file = (name) => fs.readFileSync(path.join(FIX, name));

const MUST = ['Maria Dela Cruz', 'Virtual Assistant', 'QuickBooks Online', 'Microsoft Excel', 'Google Sheets', 'GoHighLevel',
  'customer service', 'accounts payable', 'Email management'];

(async () => {
  // ── reading ──
  for (const f of ['resume-chrome.pdf', 'resume-standard-font.pdf', 'resume-embedded-font.pdf', 'resume-object-stream.pdf', 'resume.docx']) {
    const t = await R.read(f, file(f));
    for (const w of MUST) {
      if (f === 'resume.docx' && w === 'accounts payable') continue;   // the .docx is the shorter version
      assert.ok(t.includes(w), `${f}: "${w}" not read as one phrase\n${t}`);
    }
    assert.ok(!/ {2}/.test(t) && !/\u0000/.test(t), `${f}: stray spaces or NULs`);
  }
  const chrome = await R.read('resume-chrome.pdf', file('resume-chrome.pdf'));
  assert.ok(/Remote Bookkeeper & Virtual Assistant/.test(chrome), 'a capital drawn on its own ("V" + "irtual") stays one word');
  assert.ok(/QuickBooks Online, Xero/.test(chrome), 'a bold run beside plain text: no space before the comma');
  const docx = await R.read('resume.docx', file('resume.docx'));
  assert.ok(docx.includes('Comfortable with QuickBooks Online'), 'a word Word split across two runs is one word');
  assert.ok(!docx.includes('HYPERLINK'), 'field codes are not text');
  assert.ok(docx.includes('Curriculum Vitae'), 'headers are read too');
  assert.strictEqual(await R.read('notes.txt', Buffer.from('QuickBooks and Xero\r\n\r\n\r\nCanva')), 'QuickBooks and Xero\nCanva');
  assert.ok((await R.read('u.txt', Buffer.from('﻿Xero', 'utf16le'))).endsWith('Xero'), 'Notepad\'s "Unicode" (UTF-16) reads');
  // refusals a person can act on
  const why = async (name, bytes) => { try { await R.read(name, bytes); return 'read'; } catch (e) { return e.message; } };
  assert.strictEqual(await why('scan.pdf', file('resume-scanned.pdf')), 'no text');
  assert.strictEqual(await why('locked.pdf', file('resume-encrypted.pdf')), 'encrypted');
  assert.strictEqual(await why('old.doc', Buffer.from('anything')), 'old Word file');
  assert.strictEqual(await why('big.pdf', new Uint8Array(R.MAX_BYTES + 1)), 'too big');
  assert.notStrictEqual(await why('broken.docx', Buffer.from('not a zip')), 'read');

  // ── which words to offer ──
  const tags = ['QuickBooks', 'Xero', 'Canva', 'Data Entry', 'English', 'Shopify', 'Video Editing', 'GoHighLevel',
    'Microsoft Excel', 'a sentence, with a comma', 'One Two Three Four Five'];
  const vocab = RW.vocabulary(PR.ARCHETYPES, tags);
  assert.ok(vocab.some(v => v.word === 'quickbooks'), 'tags join the presets');
  assert.ok(!vocab.some(v => /comma|five/i.test(v.label)), 'tags with commas or more than 4 words are left out');
  assert.strictEqual(vocab.filter(v => RW.norm(v.word) === 'quickbooks').length, 1, 'a preset word and a tag of the same word: once');

  // 40 posts: English in all of them (a general skill), QuickBooks in 30 (a bookkeeper's own searches), Canva in 3,
  // video editing in 5 (not in the resume)
  const corpus = Array.from({ length: 40 }, (_, i) => [
    'english required',
    i < 30 ? 'quickbooks bookkeeper' : '',
    i >= 10 && i < 13 ? 'canva graphics' : '',
    i >= 20 && i < 25 ? 'video editing' : '',
    i === 30 ? 'data entries and data entry clerk' : '',
  ].join(' '));
  const rows = RW.suggest({ resume: chrome, vocab, corpus, existing: ['xero'] });
  const by = Object.fromEntries(rows.map(r => [RW.norm(r.word), r]));
  assert.strictEqual(by.quickbooks.posts, 30);
  assert.strictEqual(by.quickbooks.ticked, true, 'in most posts seen because the person searches for it: the best word, ticked');
  assert.strictEqual(by.canva.posts, 3);
  assert.strictEqual(by.english.general, true, 'a general skill');
  assert.strictEqual(by.english.ticked, false, 'shown, but not ticked');
  assert.ok(!by['video editing'], 'not in the resume: never offered');
  assert.ok(!by.xero, 'already on a list: not offered again');
  assert.ok(!by.shopify, 'in the resume but in no post seen: not offered');
  assert.strictEqual(rows[0].word, 'english', 'most-used first');
  assert.ok(rows.findIndex(r => r.word === 'quickbooks') < rows.findIndex(r => r.word === 'canva'));
  // the general list is about the word, not how often it is seen
  assert.strictEqual(RW.suggest({ resume: 'Attention to detail, Xero', vocab: RW.vocabulary([], ['Attention to Detail', 'Xero']),
    corpus: ['xero and attention to detail'] }).map(r => `${r.label}:${r.ticked}`).join(' '), 'Attention to Detail:false Xero:true');
  assert.deepStrictEqual(RW.suggest({ resume: '   ', vocab, corpus }), []);
  // adding them: the presets' rule, a block on a wanted word goes (and is named); other blocks stay
  const added = PR.addWords({ positive: ['remote'], negative: ['bookkeeper', 'cold calling', 'graphic designer'] }, ['bookkeep*', 'xero', 'remote']);
  assert.deepStrictEqual(added.positive, ['remote', 'bookkeep*', 'xero']);
  assert.deepStrictEqual(added.negative, ['cold calling', 'graphic designer']);
  assert.deepStrictEqual(added.unblocked, ['bookkeeper']);
  assert.deepStrictEqual(PR.addWords({ positive: [], negative: ['lead generation'] }, ['=lead']).unblocked, [], '"=lead" does not reach into a longer block');
  // the matcher's own rules: "ai" is never found inside "email"
  assert.ok(!RW.suggest({ resume: 'email management', vocab: [{ word: 'ai', label: 'AI' }], corpus: ['ai tools'] }).length);

  console.log('resume: ok (Chrome, standard-font, embedded-font and object-stream PDFs, .docx, .txt, refusals, word picking)');
})().catch((e) => { console.error(e); process.exit(1); });
