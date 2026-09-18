/**
 * test-closed.js — the closed-listing memory's pure half (W9.1).
 *
 * The memory is a map of job id → when we saw it close. What is under test is that it never grows
 * without bound, never forgets by accident, and never confuses a search page for a job.
 */
const assert = require('node:assert');
const { jobIdFrom, isClosedText, prune, record, HISTORY_DAYS } = require('./closed.js');

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);

// ── job ids: two slug spellings, absolute and relative, query and fragment ───────────────────────
assert.strictEqual(jobIdFrom('/jobseekers/job/video-ads-for-e-commerce-full-time-1733463'), '1733463');
assert.strictEqual(jobIdFrom('https://www.onlinejobs.ph/jobseekers/job/Medical-Assistant-1570005'), '1570005');
assert.strictEqual(jobIdFrom('/jobseekers/job/AI-Automation-Specialist-n8n-1558310'), '1558310');
assert.strictEqual(jobIdFrom('/jobseekers/job/some-slug-123?x=1'), '123');
assert.strictEqual(jobIdFrom('/jobseekers/job/some-slug-123/'), '123');
assert.strictEqual(jobIdFrom('/jobseekers/job/some-slug-123#apply'), '123');
// Not jobs: a search page, a bare slug, and nothing at all.
assert.strictEqual(jobIdFrom('/jobseekers/jobsearch/240?jobkeyword='), null);
assert.strictEqual(jobIdFrom('/jobseekers/bookmarked_jobs'), null);
assert.strictEqual(jobIdFrom('/jobseekers/job/no-id-here'), null);
assert.strictEqual(jobIdFrom(''), null);
assert.strictEqual(jobIdFrom(null), null);
assert.strictEqual(jobIdFrom(undefined), null);

// ── the closure marker, exactly as the live page prints it ───────────────────────────────────────
assert.strictEqual(isClosedText('This job has been closed'), true);
assert.strictEqual(isClosedText('REPORT THIS JOB POST This job has been closed'), true);
assert.strictEqual(isClosedText('this job has been closed.'), true);
assert.strictEqual(isClosedText('This job is no longer accepting applications'), true);
// Not closure: a phrase that merely mentions closing, and an empty page.
assert.strictEqual(isClosedText('We closed 12 deals last quarter'), false);
assert.strictEqual(isClosedText('Subtitles and closed captioning'), false);
assert.strictEqual(isClosedText(''), false);
assert.strictEqual(isClosedText(null), false);

// ── the 6-month cap ─────────────────────────────────────────────────────────────────────────────
assert.strictEqual(HISTORY_DAYS, 180);
const old = { at: NOW - 181 * DAY }, fresh = { at: NOW - 179 * DAY };
const map = { 111: old, 222: fresh };
const kept = prune(map, NOW, HISTORY_DAYS * DAY);
assert.deepStrictEqual(Object.keys(kept).sort(), ['222'], 'a 179-day entry survives, a 181-day one does not');
assert.deepStrictEqual(Object.keys(map).sort(), ['111', '222'], 'prune returns a new map and leaves the input alone');
// Garbage in storage must not survive, and must not throw.
assert.deepStrictEqual(prune({ a: { at: NOW }, b: {}, c: null, d: 'x', e: { at: 'nope' } }, NOW, HISTORY_DAYS * DAY), { a: { at: NOW } });
assert.deepStrictEqual(prune(null, NOW, HISTORY_DAYS * DAY), {}, 'no memory yet is not an error');
assert.deepStrictEqual(prune(undefined, NOW, HISTORY_DAYS * DAY), {});

// ── recording ───────────────────────────────────────────────────────────────────────────────────
const rec = record({ 111: old }, '333', NOW, HISTORY_DAYS * DAY);
assert.deepStrictEqual(Object.keys(rec).sort(), ['333'], 'recording also prunes');
assert.strictEqual(rec['333'].at, NOW);
assert.deepStrictEqual(record({}, '444', NOW, HISTORY_DAYS * DAY), { 444: { at: NOW } });
assert.deepStrictEqual(record({}, null, NOW, HISTORY_DAYS * DAY), {}, 'a page with no id records nothing');
assert.deepStrictEqual(record({}, '', NOW, HISTORY_DAYS * DAY), {});
// Re-recording the same job refreshes its timestamp instead of duplicating it.
const twice = record(record({}, '555', NOW - 100 * DAY, HISTORY_DAYS * DAY), '555', NOW, HISTORY_DAYS * DAY);
assert.deepStrictEqual(Object.keys(twice), ['555']);
assert.strictEqual(twice['555'].at, NOW);

console.log('closed: all assertions passed');
