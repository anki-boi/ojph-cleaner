// test-pager.js — node tests for pagination.js's pure helpers (run: node test-pager.js).
// The loader itself needs a DOM and the live site; these are the parts that decide *which URL*
// gets fetched and *when to stop*, which is where a runaway request loop would come from.
const assert = require('assert');
const { nextPageUrl, parseShown, pageOffset, pastHorizon } = require('./pagination.js');

const BASE = 'https://www.onlinejobs.ph';

// ── nextPageUrl: the site addresses pages by how many jobs are already displayed ──
assert.strictEqual(
  nextPageUrl(`${BASE}/jobseekers/jobsearch?jobkeyword=bookkeeper`, 30),
  `${BASE}/jobseekers/jobsearch/30?jobkeyword=bookkeeper`,
  'bare list → insert the offset segment');
assert.strictEqual(
  nextPageUrl(`${BASE}/jobseekers/jobsearch/30?jobkeyword=bookkeeper`, 60),
  `${BASE}/jobseekers/jobsearch/60?jobkeyword=bookkeeper`,
  'offset list → replace the offset');
assert.strictEqual(
  nextPageUrl(`${BASE}/jobseekers/search/c/virtual-assistant/0`, 30),
  `${BASE}/jobseekers/search/c/virtual-assistant/30`,
  'category page with an offset segment');
assert.strictEqual(
  nextPageUrl(`${BASE}/jobseekers/search/c/virtual-assistant`, 30),
  `${BASE}/jobseekers/search/c/virtual-assistant/30`,
  'category page without an offset segment');
assert.strictEqual(
  nextPageUrl(`${BASE}/jobseekers/jobsearch`, 30),
  `${BASE}/jobseekers/jobsearch/30`,
  'bare list with no query');
// a multi-parameter query must survive intact, including one that looks numeric
assert.strictEqual(
  nextPageUrl(`${BASE}/jobseekers/jobsearch?jobkeyword=data%20entry&sortby=1`, 30),
  `${BASE}/jobseekers/jobsearch/30?jobkeyword=data%20entry&sortby=1`,
  'the whole query string is preserved');
assert.strictEqual(
  nextPageUrl(`${BASE}/jobseekers/jobsearch?jobkeyword=bookkeeper`, 0),
  `${BASE}/jobseekers/jobsearch/0?jobkeyword=bookkeeper`,
  'offset 0 is a valid page');
// never produce a URL that drops the last path segment for a non-numeric tail
assert.strictEqual(
  nextPageUrl(`${BASE}/jobseekers/jobsearch/`, 30),
  `${BASE}/jobseekers/jobsearch/30`,
  'trailing slash does not double up');

// ── parseShown: the total is what stops the loader, so a wrong parse means endless fetches ──
assert.deepStrictEqual(parseShown('Displaying 30 out of 297 jobs'), { from: 30, total: 297 });
assert.deepStrictEqual(parseShown('Displaying 1 out of 1 jobs'), { from: 1, total: 1 });
assert.deepStrictEqual(parseShown('  displaying 60 OUT OF 297 JOBS  '), { from: 60, total: 297 });
assert.deepStrictEqual(parseShown('No jobs found'), null);
assert.deepStrictEqual(parseShown(''), null);
assert.deepStrictEqual(parseShown(null), null);
assert.deepStrictEqual(parseShown('Displaying 30 jobs'), null, 'a line without "out of" is not a count');

// ── pageOffset: how far into the result set this page already is ──
assert.strictEqual(pageOffset('/jobseekers/jobsearch'), 0, 'bare list is offset 0');
assert.strictEqual(pageOffset('/jobseekers/jobsearch/30'), 30);
assert.strictEqual(pageOffset('/jobseekers/search/c/virtual-assistant/0'), 0);
assert.strictEqual(pageOffset('/jobseekers/search/c/virtual-assistant/60'), 60);
assert.strictEqual(pageOffset('/jobseekers/job/some-title-1662908'), 0,
  'a job detail URL ends in -<id>, not /<offset> — it must not look like a page position');
assert.strictEqual(pageOffset(''), 0);
assert.strictEqual(pageOffset(null), 0);

// the next offset is pageOffset + cards on screen, which is what the loader passes in
assert.strictEqual(nextPageUrl('/jobseekers/jobsearch/290?jobkeyword=x', 290 + 7),
  '/jobseekers/jobsearch/297?jobkeyword=x',
  'a final partial page asks for the position after it, not for page 1 again');


// ── pastHorizon: stop paging once the tail is older than the recency window ──
// The user's report, verbatim: "your pagination is kinda overkill since you still paginate even though you
// have reached the history threshold". The board is newest-first, so the OLDEST card loaded is the tail: once
// it is outside the window, every later page is stale and would be hidden on arrival.
const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
const ago = (d) => NOW - d * DAY;
assert.strictEqual(pastHorizon([ago(0.1), ago(1.2)], NOW, 7), false, 'all fresh → keep paging');
assert.strictEqual(pastHorizon([ago(0.1), ago(7.1)], NOW, 7), true, 'the tail is past 7 days → stop');
assert.strictEqual(pastHorizon([ago(6.9)], NOW, 7), false, 'inside the window → keep paging');
assert.strictEqual(pastHorizon([ago(6.9)], NOW, 7), false);
// Boundary: exactly 7 days old is still inside a "posted within the last 7 days" window (rules.isStale is strict).
assert.strictEqual(pastHorizon([ago(7)], NOW, 7), false);
// 0 = the window is off, so there is no horizon to reach.
assert.strictEqual(pastHorizon([ago(900)], NOW, 0), false);
assert.strictEqual(pastHorizon([ago(900)], NOW, null), false);
// An unreadable date is never a reason to end the list (the recency rule must not be the rule that loses one).
assert.strictEqual(pastHorizon([null, undefined, ago(900)], NOW, 7), true, 'the readable one still decides');
assert.strictEqual(pastHorizon([null, undefined], NOW, 7), false, 'nothing readable → never stop');
assert.strictEqual(pastHorizon([], NOW, 7), false);
assert.strictEqual(pastHorizon(undefined, NOW, 7), false);
assert.strictEqual(pastHorizon([NaN, Infinity], NOW, 7), false, 'a non-finite timestamp is not a date');

console.log('pager: all assertions passed');
