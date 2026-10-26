// test-dealbreakers.js: tests, nights and weekends, languages, agencies (spec.md D87). Wording from real
// OnlineJobs.ph posts, and the duties and look-alikes that must never be tagged.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const D = require('./dealbreakers.js');
const keys = (t, opts) => D.tagsOf(D.find(t), opts).map(x => x.key + (x.kind ? ':' + x.kind : '') + (x.langs ? ':' + x.langs.join('+') : '')).join(' ') || 'none';

const CASES = [
  // 🧪 a test before hiring
  ['Shortlisted candidates will be asked to complete a short skills test.', 'test'],
  ['Applicants must pass a typing test (minimum 50 WPM).', 'test'],
  ['Please take the DISC personality assessment linked below before applying.', 'test'],
  ['Qualified candidates will receive a paid test task.', 'test'],
  ['There will be an unpaid trial before the interview.', 'test'],
  ['You will be asked to complete our TestGorilla assessment.', 'test'],
  ['The next step is a sample project so we can see your work.', 'test'],
  ['There is a 3-month trial period before regularization.', 'none'],
  // live, 2026-10-26
  ['Short paid practical test', 'test'],
  ['• Train managers and verify their skills through practical assessments before assigning them roles.', 'none'],
  ['A short, paid practical assessment using fictional business and client information.', 'test'],
  ['The successful applicant will start with a paid 2-week trial.', 'test'],
  ['Send, track, and follow up on test assignments and assessments.', 'none'],
  ['Have you organised employer visits or practical trade assessments before?', 'none'],
  ['# Experienced Trades Recruiter & Practical Assessment Coordinator – Philippines', 'none'],
  ['We will travel to the Philippines to meet shortlisted candidates and observe practical assessments.', 'none'],
  ['If you do not currently have access to a centre, could you arrange a suitable venue for practical assessments?', 'none'],
  ['Test the software and report bugs to the developers.', 'none'],
  ['Write test cases and run QA testing for every release.', 'none'],
  ['Conduct patient assessments and update the charts.', 'none'],
  ['Complete tasks assigned by the manager on time.', 'none'],
  // 🌙 nights · 📅 weekends
  ['This is a graveyard shift role.', 'hours:night'],
  ['Must be willing to work night shift (US time).', 'hours:night'],
  ['Overnight shift, 10 PM to 7 AM Manila time.', 'hours:night'],
  ['Must be available during US business hours (EST).', 'none'],
  ['Day shift only, no night shift.', 'none'],
  ['Must be available to work weekends.', 'hours:weekend'],
  ['Schedule: Monday to Saturday, 9 AM to 6 PM.', 'hours:weekend'],
  ['We work 6 days a week during peak season.', 'hours:weekend'],
  ['Weekend shifts required on rotation; night shift as needed.', 'hours:both'],
  ['* Evening Shift: 5:30 PM – 10:30 PM', 'none'],
  ['Monday to Friday, weekends off!', 'none'],
  ['No weekends, no night shifts.', 'none'],
  ['Schedule: Monday-Friday, 8 hours a day.', 'none'],
  // 🗣 a language besides English
  ['Must be fluent in Spanish and English.', 'language:Spanish'],
  ['Bilingual (English/Spanish) is required.', 'language:Spanish'],
  ['Native German speaker needed for our support desk.', 'language:German'],
  ['We are looking for a Spanish-speaking virtual assistant.', 'language:Spanish'],
  ['Must have excellent written and spoken English.', 'none'],
  ['Spanish is a plus but not required.', 'none'],
  ['You MUST submit an audio recording speaking in English (Bonus for Spanish speakers).', 'none'],
  ['Fluent English required; you will handle our Spanish market clients.', 'none'],
  ['Fluent in Tagalog and English.', 'none'],
  ['Mandarin-Speaking Virtual Assistant (Remote): fluent Mandarin Chinese required.', 'language:Mandarin'],
  // live, 2026-10-26
  ['Work with local language or market specialists where Dutch or Flemish support is required.', 'none'],
  ['Market: French-speaking Canada (Québec)/ Spanish Chile', 'none'],
  ['You will work in a French speaking environment, although you are not expected to talk or understand the language.', 'none'],
  ['A short voice recording introducing yourself (if you speak Spanish, please include a brief bilingual sample).', 'none'],
  ['The Nabo Group is looking for 2 Spanish Speaking Customer Care Representative with Property Management experience.', 'language:Spanish'],
  // 🏢 a recruitment agency
  ['We are hiring on behalf of our client, a US-based law firm.', 'agency'],
  ['Our client is a fast-growing ecommerce brand in Australia.', 'agency'],
  ['We are a staffing agency that places VAs with our clients in the US.', 'agency'],
  ['We are looking for a VA for one of our clients.', 'agency'],
  ['Provide excellent support to our clients every day.', 'none'],
  ['No agencies please, direct hires only.', 'none'],
  // live, 2026-10-26
  ['We are a growing VA operations and project management agency supporting entrepreneurs in the United States.', 'agency'],
  ['We are a new US-based digital marketing agency focused on TikTok campaigns.', 'none'],
  ["We're seeking an experienced recruiter who has supported a U.S.-based staffing agency.", 'none'],
  ['Long-term stability with a growing US insurance agency', 'none'],
  ['We are not a recruitment agency; you will work directly with the owner.', 'none'],
];
for (const [t, want] of CASES) assert.strictEqual(keys(t), want, `${want}: ${t}`);
// several at once, in a fixed order
assert.strictEqual(keys('Shortlisted applicants take a skills test.\nNight shift.\nFluent French required.\nWe hire on behalf of our client, a bakery.'),
  'test hours:night language:French agency');
assert.deepStrictEqual(D.tagsOf(D.find('')), []);
assert.deepStrictEqual(D.tagsOf(null), []);

// ── never a demotion: nothing that decides, hides or ranks a card reads this file ──
for (const f of ['tiers.js', 'content.js', 'records.js', 'records-store.js', 'records-cards.js', 'scan.js', 'pay-sort.js',
  'salary-cards.js', 'lowball.js', 'lowball-cards.js', 'risk.js', 'triage.js']) {
  assert.ok(!/OJCDealbreakers|dealbreakers/.test(fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')),
    `${f} reads the dealbreaker tags: they must stay tags, never a verdict`);
}

console.log(`dealbreakers: ok (${CASES.length} sentences: tests, nights and weekends, languages, agencies, and their look-alikes; never a demotion)`);
