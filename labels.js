/**
 * labels.js — every word the extension shows, in one table (spec.md D43, W16).
 *
 * The internal names never change (D44): tier keys `high` / `worth` / `pos`, setting keys, record fields,
 * classes and ids stay exactly as stored and as the harness reads them. Only what a person reads lives here,
 * so a rename is one edit and `test-labels.js` can prove the old vocabulary is gone from the source.
 *
 * Pure and UMD: content scripts read `self.OJCLabels`, node tests and tools/verify-live.mjs `require` it.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OJCLabels = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const L = {
    /** The tiers as filter pills and bar counts (plural), and as a single card's verdict (singular). */
    tier: { all: 'Everything', high: 'Top picks', worth: 'Maybe', pos: 'Liked', low: 'Lowball', applied: 'Applied' },
    tierOne: {
      high: 'Top pick', worth: 'Maybe', pos: 'Liked', kw: 'blocked word', nosal: 'no pay listed',
      stale: 'too old', closed: 'closed', none: 'not sorted yet', passed: 'you passed', low: 'lowball', gig: 'gig, no hours',
    },
    icon: { high: '⭐', worth: '🤔', pos: '💚', low: '⚫', applied: '📨', hidden: '🙈' },
    /** Why a listing is hidden — the bar's breakdown. */
    hidden: {
      closed: 'Closed', stale: 'Too old', noSal: 'No pay listed', gig: 'Gigs with no hours', kw: 'Blocked words', passed: 'You passed',
    },
    hiddenTip: {
      closed: 'you saw these listings close — hidden from now on',
      stale: 'posted longer ago than your "too old after" setting',
      noSal: 'the listing states no figure',
      gig: 'a gig that states no hours per week — its pay cannot be turned into an hourly rate. Read posts opens these first, and one whose page states hours comes back',
      kw: 'mentions a word you never want to see, and does not meet your minimum pay',
      passed: 'you marked these "not for me"',
    },
    tierTip: {
      all: 'show the whole board with only your hiding rules applied',
      high: 'meets your minimum pay — including the few that mention a blocked word but pay well over it (⚙: Top pick at × my minimum)',
      worth: 'mentions a word you block, but meets your minimum pay — your call',
      pos: 'mentions a word you are into, but pays below your minimum',
      low: 'pays at or below your lowball line (Settings → Advanced) — report them to OnlineJobs.ph as "Salary too low"',
      applied: 'jobs on this board you applied to (or got further with), and new posts of a role you already applied to',
    },
    btn: {
      peek: 'Peek at hidden', unpeek: 'Hide them again', scan: 'Read posts', stop: 'Stop',
      csv: 'Download CSV', settings: 'Settings', undo: 'Undo',
    },
    btnTip: {
      scan: 'open every listing inside your window and re-sort it by its full description (2 at a time)',
      scanOff: 'add a word or a minimum pay first — there is nothing to sort by',
      stop: 'stop reading — everything read so far is kept, and the next run skips it',
      csv: 'download the listings you choose — Top picks, Maybe, Liked — as a spreadsheet, sorted by hourly rate',
      csvOff: 'nothing remembered yet — read some posts first',
    },
    /** `N hidden` / `N would be hidden` (the second while peeking — the harness asserts on it). */
    hiddenTotal: (n, peeking) => (peeking ? `${n} would be hidden` : `${n} hidden`),
    /** Marks painted on a card. */
    mark: {
      fresh: '● posted today', freshTip: 'posted in the last 24 hours — apply while the list is short',
      dup: '⚠ reposted', dupTip: 'the same title and company was posted again — this is the older copy',
      up: '↑ better than it looked', down: '↓ worse than it looked',
      offPlatform: '⚠ wants you off OLJ',
      offPlatformTip: 'asks you to apply or talk somewhere other than OnlineJobs.ph',
      negotiable: '⚠ negotiable', negotiableTip: 'states no figure — the pay is negotiable',
      closed: '⊘ closed', closedTip: 'you saw this listing closed — remembered so it stops appearing',
      assumes: (h) => `if full-time (${h} h/wk) — confirm the hours`,
      fit: (n, max) => `fits your resume ${n}/${max}`,
      overHours: (h) => `⚠ ${h} h/week — longer than a 40 h week`,
      partHours: (h) => `⏱ part-time month at ${h} h/week`,
      hours: (h) => `⏱ ${h} h/week`,
    },
    /** The verdict mark on a saved-jobs row. */
    row: { high: '★ top pick', worth: 'maybe', pos: '✓ liked' },
    /** Scan and loader progress. */
    note: {
      loadingPages: 'Reading posts: loading result pages…',
      loadedJobs: (n) => `Reading posts: loaded ${n} jobs…`,
      progress: (done, total, up, down) => `Reading posts ${done} of ${total} · ${up} better · ${down} worse`,
      nothingToScan: 'Nothing to sort by: add a word or a minimum pay first',
      notAList: 'Reading posts works on a job list page',
      loadingMore: 'Loading more…',
    },
    /** Lowball listings and reporting them (D67). */
    low: {
      badge: (rate) => `⚫ lowball · ${rate}/hr · Report`,
      badgeTip: (rate, floor, hours) => `about ${rate}/hour at best — at or below your ${floor}/hour line` +
        (hours ? ` (the monthly pay over the post's own ${hours} h/week)` : '') +
        '. Click to report it to OnlineJobs.ph as "Salary too low" — you confirm first',
      sending: '⚫ reporting…',
      confirmOne: (rate, hours, floor) => `Report this job to OnlineJobs.ph for low salary ("Salary too low")?\n\n` +
        `It pays about ${rate}/hour` + (hours ? ` (the monthly pay over the post's own ${hours} hours a week)` : '') +
        `, at or below your ${floor}/hour line. The report is filed under your own account.`,
      reported: '⚫ reported', reportedTip: 'you reported this listing to OnlineJobs.ph as "Salary too low"',
      check: '⚫? checking hours',
      checkTip: (floor) => `a monthly figure that could be under ${floor}/hour — the extension reads the post's own ` +
        'HOURS PER WEEK before calling it a lowball (Read posts opens these first)',
      // No count: the prompt fires as the first lowball is marked, before the rest of the board's pay is worked out,
      // and a number there was wrong ("1 lowball offer" on a board with 2). The bar's ⚫ pill holds the live count.
      nudge: () => '⚫ This board has lowball offers. Let\'s report them!',
      nudgeBtn: 'Review them',
      bulk: (n) => `⚫ Review ${n} lowball`,
      bulkTip: 'go through the lowball listings on this board one at a time — you see each one and decide: Report, Skip or Stop',
      reviewStep: (i, n, title, pay, floor) => `Lowball ${i} of ${n} · "${title}" · ${pay} — at or below your ${floor}/hr line. Report it as "Salary too low"?`,
      reviewReport: 'Report this one', reviewSkip: 'Skip', reviewStop: 'Stop',
      reviewDone: (sent, skipped) => `Reported ${sent}, skipped ${skipped}` + (sent ? ' — thank you' : ''),
      done: (n) => `Reported ${n} lowball listing${n === 1 ? '' : 's'} — thank you`,
      capped: (cap) => `Daily limit reached (${cap} reports in 24 hours) — change it in Settings → Advanced`,
      off: 'Reporting is off — set a daily limit above 0 in Settings → Advanced',
      failed: (why) => `Report not sent: ${why}`,
      signedOut: 'sign in to OnlineJobs.ph first',
    },
    /** How a keyword matches (D69) — taught in setup, repeated in ⚙ and on the options page. */
    match: {
      title: 'How words match',
      rows: [
        ['video editor', 'whole words, plus plurals and hyphens: video editors, video-editor'],
        ['design*', 'ends in * → any word starting with it: designer, designing, designs'],
        ['=lead', 'starts with = → exactly this word: lead, never leads'],
      ],
      never: 'A word never matches inside another: ai never matches email.',
      noBroad: 'Careful with * here: intern* would also hide internal and international jobs.',
    },
    /** Applied jobs (D76 to D78): the card stamp, the card button, the "Did you apply?" question, the note. */
    mine: {
      apply: '📨 Applied', applyTip: 'mark this job as applied (it moves to Applied in My jobs; you can undo)',
      undoApplyTip: 'you marked this applied; click to take it out of My jobs (you can undo)',
      laterTip: 'further along than applied: move it in My jobs',
      stamp: (state, when, via) => (state === 'applied' ? `📨 Applied ${when}` : `📨 ${state === 'interview' ? 'Interview' : 'Offer'} · applied ${when}`) + (via ? ` via ${via}` : ''),
      stampTip: 'your own record, kept on this computer. Open 📋 My jobs to move it along or edit the note',
      savedNote: '💾 Saved',
      repost: (when, sameCompany) => `📨 You applied to this ${sameCompany ? 'role' : 'title'} ${when}`,
      repostTip: (title, sameCompany) => `You applied to "${title}" earlier, ` + (sameCompany
        ? 'from the same company, under a different listing. This looks like a repost.'
        : 'under a different listing with this exact title. The card names no company, so check it is the same employer.'),
      ask: (title, via) => `Did you apply${title ? ` for "${title}"` : ''}` + (via ? ` via ${via}` : '') + '?',
      askWhy: { link: (host) => `You opened ${host} from this post.`, email: (addr) => `You copied ${addr} from this post.`,
        copy: 'You copied something from this post.', site: 'You pressed Apply for this job.' },
      yes: '✓ Yes, I applied', notYet: 'Not yet', never: 'Stop asking',
      neverDone: 'Okay, no more "Did you apply?" questions. Turn them back on in ⚙ Settings, Advanced.',
      done: (title) => `Applied: ${title || 'this job'}`,
      notePh: 'Add a note: what you sent, who to follow up with…',
      noteSave: 'Save note', noteSaved: 'Note saved', close: 'Close',
    },
    /** Backup and restore (D79): everything the extension keeps, in one file, for another computer. */
    backup: {
      save: '⬇ Back up everything', load: '⬆ Restore from a file',
      hint: 'One file with your settings, My jobs, notes and everything the extension remembers. Restore it on another computer (or after a reinstall) to carry on where you left off.',
      made: (name) => `Backup saved as ${name}`,
      bad: 'That file is not an OJ.ph Cleaner backup. Nothing was changed.',
      confirm: (when, s) => `Replace everything here with the backup from ${when}? It holds ${s.jobs} job${s.jobs === 1 ? '' : 's'} in My jobs, ` +
        `${s.records} remembered listing${s.records === 1 ? '' : 's'} and ${s.posts} saved post${s.posts === 1 ? '' : 's'}. What is on this computer now is replaced.`,
      replace: 'Replace', cancel: 'Cancel',
      restored: 'Restored. Reloading the page…',
      failed: (why) => `Restore failed: ${why}.`,
    },
    /** Words from your resume (D80): the picker in setup and in ⚙. */
    resume: {
      btn: '📄 From my resume', setupBtn: '📄 Fill these from my resume',
      title: 'Words from your resume',
      intro: 'Paste your resume, or pick the file. Only job words that are in your resume and in real posts are offered, and nothing is added until you press Add.',
      pastePh: 'Paste your resume here…',
      file: '📄 Choose a file (.pdf, .docx, .txt)',
      find: 'Find my words',
      reading: (name) => `Reading ${name}…`,
      read: (name, n) => `Read ${n} words from ${name}.`,
      looking: 'Looking for job words…',
      found: (n, posts) => `${n} job word${n === 1 ? '' : 's'} from your resume, and how many of the ${posts} posts seen on this computer use each. Untick any you don't want.`,
      none: (posts) => posts
        ? `None of the job words in the ${posts} posts seen on this computer are in this resume. Browse a few searches or press Read posts, then try again.`
        : 'No posts seen on this computer yet. Open a search, then try again.',
      posts: (n) => `${n} post${n === 1 ? '' : 's'}`,
      generalTip: 'A general skill most posts ask for: it would mark most jobs green, so it is not ticked',
      add: (n) => (n ? `Add ${n} word${n === 1 ? '' : 's'}` : 'Add'),
      cancel: 'Cancel', close: 'Close',
      addedPanel: (n, unblocked = []) => `Added ${n} word${n === 1 ? '' : 's'} from your resume` +
        (unblocked.length ? `, and took ${unblocked.map(w => `"${w}"`).join(', ')} off Never show me` : '') + '. Check them, then Save',
      addedSetup: (n, unblocked = []) => `Added ${n} word${n === 1 ? '' : 's'} from your resume` +
        (unblocked.length ? `, and took ${unblocked.map(w => `"${w}"`).join(', ')} off the hide list` : '') + '.',
      privacy: 'Your resume stays on this computer and is not saved. Only the words you add are kept.',
      err: {
        encrypted: 'This PDF is locked with a password.',
        'no text': 'No text came out of this file (a scanned picture, perhaps).',
        'old Word file': 'This is an old .doc file.',
        'too big': 'That file is over 15 MB.',
        few: (n) => `Only ${n} word${n === 1 ? '' : 's'} came out of this file.`,
        other: "This file couldn't be read.",
      },
      pasteBelow: 'Paste the text in the box above instead.',
      pasteNow: 'Open your resume, select all (Ctrl+A), copy (Ctrl+C), then paste it here (Ctrl+V). The words are found as soon as you paste.',
      wrongText: 'Words look wrong? Paste the text instead',
    },
    /** A note from the maker, at the top of ⚙ (D81). Who it is from, said first: the store's ads policy asks for it. */
    maker: {
      label: 'A note from the maker of OJ.ph Cleaner',
      from: 'From the maker of OJ.ph Cleaner',
      name: 'Jeyson Dagondon',
      role: 'AI-Native Workflow Automation · RPh',
      body: 'I build browser extensions like this one, CRM pipelines, AI agents and small internal tools. ' +
        'If you, or a client you land, have busywork that should run itself, let’s talk.',
      call: 'Book a call', work: 'See my work ↗',
    },
    /** The CSV chooser (D75). */
    exportPick: {
      title: 'Export which listings?',
      hint: 'Sorted by category, then by hourly rate — the same figure each card leads with.',
      none: 'Tick at least one.',
      go: '⬇ Download CSV', cancel: 'Cancel',
    },
    /** The display currencies (D66). PHP first: it is the default and the board's own currency. */
    currency: { PHP: { symbol: '₱', name: 'Philippine peso' }, USD: { symbol: '$', name: 'US dollar' } },
    toast: {
      saved: 'Settings saved',
      currency: (code) => `Showing pay in ${code}. Exchange rates are the ECB's reference rates, refreshed daily.`,
    },
  };
  return L;
});
