/**
 * media-ask.js: does a post ask YOU to record yourself (spec.md D86)? A video of you (a Loom intro, "a short video
 * introducing yourself") or a voice recording (a voice memo, an audio sample, a Vocaroo link). For some people that
 * ask is a dealbreaker, so it is a tag on the card, seen at a glance. A tag only: nothing is hidden for it.
 *
 * It replaces the off-platform tag, which flagged nearly every post (most ask for a form or an email). So the bar for
 * a hit is the ask, not the word: a job's DUTIES are full of videos and recordings ("edit short videos", "create Loom
 * walkthroughs of our SOPs", "clean up podcast voice recordings"), and those are never an ask. Two kinds of rule:
 *
 *   - self-evident: the words only make sense as an ask ("a video introducing yourself", "video introduction",
 *     "record yourself", "Vocaroo", "a recording of your voice");
 *   - needs an ask nearby: a Loom, an intro video, a "2-3 minute video", a voice memo or audio sample count only in a
 *     sentence (or under a heading, two lines up) that asks you to apply, send, submit, attach or record, and never
 *     right after a duty verb (edit, create, produce, transcribe…). A video CALL or video interview is never one.
 *
 * Pure and UMD: trust.js tags cards with it, figures.js puts it on the bar, test-media.js pins it on real wording.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCMediaAsk = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MIN = String.raw`(?:\d+(?:\.\d+)?\s*(?:[-–—]|to)?\s*\d*\s*(?:minutes?|mins?|seconds?|secs?)\s*(?:long\s+)?)`;
  const VIDEO_SELF = [
    /\bvideo\b[^.\n]{0,60}?\b(?:of\s+yourself|introduc(?:e|es|ing)\s+yourself|about\s+yourself|of\s+you\s+(?:talking|speaking|answering|explaining)|showing\s+your\s+face)\b/,
    /\bintroduc(?:e|ing)\s+yourself\b[^.\n]{0,60}?\bvideo\b/,
    /\bvideo\s+(?:introduction|intro|resume|cv|pitch|application|self[- ]?introduction)\b/,
    /\bselfie\s+video\b/,
    /\brecord\s+a\s+(?:short\s+)?video\s+of\s+yourself\b/,
    // "record yourself reading the script" is a voice ask (below); a bare "record yourself" is a video one.
    /\brecord\s+yourself\b(?!\s+(?:reading|speaking|talking|saying))/,
  ];
  // [pattern, and what else the sentence must say]: a Loom is only an ask when it is a video or a recording of
  // something ("upload the coaching calls to Loom" is a duty, measured live).
  const VIDEO_ASKED = [
    [/\bloom\b/, /\b(?:video|record\w*|yourself|introduc\w*|about\s+you|link)\b/],
    /\b(?:self[- ]?)?(?:introduction|intro|introductory)\s+videos?\b/,
    new RegExp(String.raw`\b${MIN}(?:loom\s+)?video\b`),
    /\bvideo\s+(?:message|recording|response|answers?|links?|clip)\b/,
    /\bvideo\s+(?:answering|responding\s+to|explaining|telling\s+us|describing|showing\s+us)\b/,
    /\byour\s+(?:intro(?:duction)?\s+|short\s+)?video\b/,
    /\b(?:send|submit|attach|upload|share|include|record)\s+(?:us\s+|me\s+)?(?:a|an|your)\s+(?:short\s+|quick\s+|brief\s+)?video\b/,
  ];
  const VOICE_SELF = [
    /\bvocaroo\b/,
    /\brecord(?:ing)?\s+(?:of\s+)?your(?:\s+own)?\s+voice\b/,
    /\b(?:voice|audio)\s+(?:recording|memo|note|message|sample|clip|introduction|intro)s?\b[^.\n]{0,50}?\b(?:yourself|of\s+you|introduc\w*|reading|your\s+voice)\b/,
    /\brecord\s+yourself\s+(?:reading|speaking|talking|saying)\b/,
  ];
  const VOICE_ASKED = [
    /\b(?:voice|audio)\s+(?:recordings?|records?|memos?|notes?|messages?|samples?|clips?|files?|introductions?|intros?|links?)\b/,
    /\b(?:mp3|m4a|wav)\b/,
  ];
  /** "a voice or video introduction", "voice or video link": either will do, so neither tag alone is true. */
  const EITHER = /\b(?:video|voice|audio)\s+or\s+(?:a\s+)?(?:video|voice|audio)\b/;
  /** A sentence that asks you to apply with something. Headings above count ("HOW TO APPLY", "submit the following:"). */
  const ASK_CTX = /\b(?:apply|applying|applications?|applicants?|candidates?|to\s+be\s+considered|submit|send|provide|attach|upload|share|include|record\s+(?:a|an|your)|following|requirements?)\b/;
  /** Words that make it a job duty, right before the match. */
  const DUTY = /\b(?:edit|editing|edits|create|creating|creates|produce|producing|transcrib\w*|clean(?:ing)?\s+up|mix(?:ing)?|cut(?:ting)?|manage|managing|repurpos\w*|post(?:ing)?|upload(?:ing)?\s+(?:client|their|our))\b[^.\n]{0,25}$/;
  const NOT_AN_ASK = /\bvideo[\s-]+(?:calls?|interviews?|conferenc\w*|meetings?|chats?|editing|editors?|edits?)\b|\bvoice[\s-]+(?:calls?|chats?|overs?)\b/;

  const segments = (text) => String(text || '').toLowerCase().split(/\n+|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);

  function scan(segs, i, self_, asked) {
    const seg = segs[i];
    for (const re of self_) { const m = re.exec(seg); if (m && !NOT_AN_ASK.test(m[0])) return true; }
    const ctx = `${segs[i - 2] || ''} ${segs[i - 1] || ''} ${seg}`;
    if (!ASK_CTX.test(ctx)) return false;
    for (const rule of asked) {
      const [re, need] = Array.isArray(rule) ? rule : [rule, null];
      const m = re.exec(seg);
      if (!m || (need && !need.test(seg)) || NOT_AN_ASK.test(seg.slice(m.index, m.index + 30))) continue;
      if (DUTY.test(seg.slice(Math.max(0, m.index - 60), m.index))) continue;
      return true;
    }
    return false;
  }

  /**
   * { video: [sentence…], voice: [sentence…], either: [sentence…] }, each sentence as the post wrote it (trimmed, at
   * most 140 chars). `either` is a sentence that accepts a video OR a voice recording; it is not counted again.
   */
  function find(text) {
    const raw = String(text || '').split(/\n+|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    const segs = segments(text);
    const out = { video: [], voice: [], either: [] };
    const quote = (i) => (raw[i].length > 140 ? raw[i].slice(0, 139).trimEnd() + '…' : raw[i]);
    for (let i = 0; i < segs.length; i++) {
      const video = scan(segs, i, VIDEO_SELF, VIDEO_ASKED), voice = scan(segs, i, VOICE_SELF, VOICE_ASKED);
      const either = EITHER.test(segs[i]) && ASK_CTX.test(`${segs[i - 2] || ''} ${segs[i - 1] || ''} ${segs[i]}`) && !NOT_AN_ASK.test(segs[i]);
      if (either) out.either.push(quote(i));
      else { if (video) out.video.push(quote(i)); if (voice) out.voice.push(quote(i)); }
    }
    return out;
  }

  /** Which tag a post gets: 'video', 'voice', 'both' (asks for each), 'either' (one of them will do), or null. */
  function kindOf(r) {
    if (!r) return null;
    if (r.video.length && r.voice.length) return 'both';
    if (r.video.length) return 'video';
    if (r.voice.length) return 'voice';
    return r.either.length ? 'either' : null;
  }

  return { find, kindOf };
});
