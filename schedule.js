/**
 * schedule.js — a post's working hours, in YOUR time (spec.md D59).
 *
 * "6:00 AM to 9:00 AM Philippine Time", "9-5 EST", "8am – 5pm (PST)": the range is converted with Intl — real
 * IANA zones, so daylight saving is right on the day — into the viewer's own zone, and judged against their
 * optional working hours (`myHours`, "08:00-18:00"). A tag, never a gate.
 *
 * No zone, no conversion: "9 to 5" alone could be anyone's 9 to 5, and guessing is how a day shift becomes a
 * night shift (the D10 discipline). The one shorthand read without am/pm is the office day — "9-5", "8-5" —
 * where the start is a morning hour and the end a smaller afternoon one.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCSchedule = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Longest names first, so "Philippine Standard Time" wins over "PST" (which is Pacific).
  const ZONES = [
    [/philippines?\s*(standard\s*)?time|\bmanila\s*time|\bph\s*time|\bpht\b|\bpst\s*\(?ph/i, 'Asia/Manila'],
    [/\b(us\s*)?eastern(\s*standard)?(\s*time)?\b|\be[sd]?t\b|\bnew\s*york\s*time/i, 'America/New_York'],
    [/\b(us\s*)?central(\s*standard)?\s*time\b|\bc[sd]t\b|\bcentral\b(?=\s*\)|\s*$)/i, 'America/Chicago'],
    [/\b(us\s*)?mountain(\s*standard)?\s*time\b|\bm[sd]t\b/i, 'America/Denver'],
    [/\b(us\s*)?pacific(\s*standard)?\s*time\b|\bp[sd]t\b|\bpt\b/i, 'America/Los_Angeles'],
    [/\baustralian?\s*eastern|\baest\b|\baedt\b|\bsydney\s*time|\bmelbourne\s*time/i, 'Australia/Sydney'],
    [/\bawst\b|\bperth\s*time/i, 'Australia/Perth'],
    [/\buk\s*time|\blondon\s*time|\bbst\b|\bgmt\b/i, 'Europe/London'],
    [/\butc\b/i, 'UTC'],
    [/\bcet\b|\bcest\b/i, 'Europe/Berlin'],
    [/\bsgt\b|\bsingapore\s*time/i, 'Asia/Singapore'],
    [/\bist\b|\bindia\s*time/i, 'Asia/Kolkata'],
  ];
  const T = String.raw`(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?`;
  const RANGE = new RegExp(String.raw`\b${T}\s*(?:-|–|—|to|until|till)\s*${T}`, 'ig');

  const to24 = (h, m, ap) => {
    h = Number(h); m = Number(m || 0);
    if (h > 23 || m > 59) return null;
    if (ap) { const p = /p/i.test(ap); if (h > 12 || h === 0) return null; h = (h % 12) + (p ? 12 : 0); }
    return h * 60 + m;
  };

  /** Minutes east of UTC for `zone` at instant `date`. */
  function offsetOf(zone, date) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(date).map(p => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
    return Math.round((asUtc - date.getTime()) / 60000);
  }

  /** Find the first zoned time range in `text`. → { start, end, zone } (minutes of the day, in that zone) or null. */
  function find(text) {
    const s = String(text || '');
    for (const m of s.matchAll(RANGE)) {
      const [, h1, m1, a1, h2, m2, a2] = m;
      let start, end;
      if (a1 || a2) {
        start = to24(h1, m1, a1 || a2 && (Number(h1) <= Number(h2) || /a/i.test(a2) ? a2 : (/p/i.test(a2) ? 'am' : 'pm')));
        end = to24(h2, m2, a2 || a1);
      } else if (Number(h1) >= 6 && Number(h1) <= 11 && Number(h2) >= 1 && Number(h2) < Number(h1) && !m1 && !m2) {
        start = to24(h1, 0, 'am'); end = to24(h2, 0, 'pm');   // the office day: "9-5"
      } else continue;
      if (start == null || end == null || start === end) continue;
      // The zone must be named close by — within the same sentence, a few words either side.
      const near = s.slice(Math.max(0, m.index - 30), m.index + m[0].length + 45);
      const z = ZONES.find(([re]) => re.test(near.slice(m[0].length ? near.indexOf(m[0]) : 0)) || re.test(near));
      if (!z) continue;
      return { start, end, zone: z[1], raw: m[0] };
    }
    return null;
  }

  const fmt = (min) => {
    const h = Math.floor(min / 60) % 24, mm = min % 60;
    const ap = h < 12 ? 'AM' : 'PM', h12 = h % 12 || 12;
    return mm ? `${h12}:${String(mm).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
  };
  const wrap = (x) => ((x % 1440) + 1440) % 1440;

  /** Convert a found range into `viewerZone` on the day of `now`. */
  function convert(found, viewerZone, now = new Date()) {
    const shift = offsetOf(viewerZone, now) - offsetOf(found.zone, now);
    const start = wrap(found.start + shift), end = wrap(found.end + shift);
    const mins = [];
    for (let t = start; t !== end; t = wrap(t + 30)) mins.push(t);
    const night = mins.filter(t => t >= 22 * 60 || t < 6 * 60).length >= mins.length / 2;
    return { start, end, same: shift === 0, night, text: `${fmt(start)}–${fmt(end)}` };
  }

  /** "08:00-18:00" → { start, end } minutes, or null. */
  function parseHours(s) {
    const m = /^\s*(\d{1,2}):?(\d{2})?\s*-\s*(\d{1,2}):?(\d{2})?\s*$/.exec(String(s || ''));
    if (!m) return null;
    const a = to24(m[1], m[2]), b = to24(m[3], m[4]);
    return a == null || b == null || a === b ? null : { start: a, end: b };
  }

  /** How much of the shift falls inside your hours: 'all' | 'some' | 'none'. */
  function fit(shift, mine) {
    const inside = (t) => (mine.start < mine.end ? t >= mine.start && t < mine.end : t >= mine.start || t < mine.end);
    const pts = [];
    for (let t = shift.start; t !== shift.end; t = wrap(t + 15)) pts.push(inside(t));
    const n = pts.filter(Boolean).length;
    return n === pts.length ? 'all' : n ? 'some' : 'none';
  }

  return { find, convert, parseHours, fit, offsetOf, fmt };
});
