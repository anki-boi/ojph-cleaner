// test-media.js: does a post ask you to record yourself (spec.md D86)? Wording taken from real OnlineJobs.ph posts.
const assert = require('assert');
const M = require('./media-ask.js');
const kinds = (t) => M.kindOf(M.find(t)) || 'none';

const YES = [
  ['HOW TO APPLY (PLEASE READ CAREFULLY!!!) Please submit the following: - A 2–3 minute Loom video introducing yourself and explaining why you would be a strong fit for the role.', 'video'],
  ['Please submit the following:\n- A 2-3 minute Loom video introducing yourself\n- Your resume', 'video'],
  ['Send us a short video introducing yourself.', 'video'],
  ['To apply, record a 1-minute Loom telling us about yourself.', 'video'],
  ['Applicants must include a video introduction.', 'video'],
  ['Please record a short video of yourself answering these 3 questions.', 'video'],
  ['HOW TO APPLY\nSend a 60 second video and your CV to the email below.', 'video'],
  ['Applications without an intro video will not be considered.', 'video'],
  ['Please include a voice recording of you reading the paragraph below.', 'voice'],
  ['To apply, attach an audio sample (mp3) of your English.', 'voice'],
  ['Send a Vocaroo link with your answers.', 'voice'],
  ['Requirements to apply:\n- Voice memo introducing yourself\n- Resume', 'voice'],
  ['Submit a 1 minute video introducing yourself and a voice recording of your sales pitch.', 'both'],
  // found in live posts (2026-10-26) and missed by the first rules
  ['Please send your resume and a short video answering the following:', 'video'],
  ['Please note: If your video contains poor English, your application will not be considered.', 'video'],
  ['*MUST SEND VOICE OR VIDEO LINK TO APPLY*', 'either'],
  ['Please also include a **short voice or video introduction**.', 'either'],
  ['Please provide a video or voice recording link with an introduction.', 'either'],
  ['To apply, please send:\n- Your resume\n- A Google Drive link to a 2-3 minute video in English.', 'video'],
  ['Record yourself reading the script below and send it with your application.', 'voice'],
];
const NO = [
  'We are looking for a video editor to edit short videos for YouTube.',
  'You will create Loom walkthroughs of our SOPs for the team.',
  'Edit voice recordings for our weekly podcast.',
  'Shortlisted applicants will be invited to a video call interview.',
  'Must be comfortable on video calls with clients.',
  'You will create intro videos for our clients\' channels.',
  'Familiarity with Loom, Slack and ClickUp is a plus.',
  'Transcribe audio files and voice notes from the sales team.',
  'Send your resume and portfolio to the email below.',
  'Apply via the Google Form: ----------',
  'Experience producing 2-3 minute videos for TikTok.',
  'Upload client videos to YouTube and write the descriptions.',
  // live, 2026-10-26: a duty that mentions Loom in a list of tasks
  '-Upload Weekly Coaching Calls — Download calls from Zoom, upload to Loom, and add them to MemberVault with Fathom notes.',
  'Shortlisted applicants will be sent a short online skills test, then a video interview.',
  'Please include: A brief introduction about your video-editing experience.',
];
for (const [t, want] of YES) assert.strictEqual(kinds(t), want, `should be ${want}: ${t}`);
for (const t of NO) assert.strictEqual(kinds(t), 'none', `should not be an ask: ${t}`);

// the sentence is quoted as the post wrote it, for the tag's tooltip
const r = M.find('About us.\nPlease submit the following:\n- A 2-3 minute Loom video introducing yourself\n- Your CV');
assert.deepStrictEqual(r.video, ['- A 2-3 minute Loom video introducing yourself']);
assert.deepStrictEqual(M.find(''), { video: [], voice: [], either: [] });
assert.strictEqual(M.kindOf(M.find(null)), null);

console.log(`media: ok (${YES.length} asks found, ${NO.length} duties and look-alikes left alone)`);
