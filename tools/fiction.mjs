// tools/fiction.mjs — a made-up job board for the README, store and demo media.
//
// The media must never show a real employer, so the capture tools load a real search page (for the site's own
// layout and CSS) and then replace every listing with an invented one: title, type, pay, hours, description and
// tags. No company names, no logos, and the site's own logo hidden. The extension then sorts the invented board
// exactly as it would a real one — nothing about its behaviour is faked.
//
//   import { FICTION_SETTINGS, applyFiction } from './fiction.mjs';
//   await store.set({ settings: FICTION_SETTINGS });   // before the page loads
//   await applyFiction(tab);                           // after it has
//
// The listings are chosen so every tier and tag appears at least once with the settings below: Top picks, a
// Maybe (pays well, blocked word), Liked, two Lowballs, a gig with no hours (hidden), a listing with no pay
// (hidden), and a month whose hours are not known yet ("? /hr"). Pay is written the ways real posts write it.

/** Settings the media are recorded with — shown in dollars, judged per hour (D71). */
export const FICTION_SETTINGS = {
  currency: 'USD', goalHourly: 6, goalSalary: 1000, lowballHourly: 2, topPickMultiplier: 1.5,
  positive: ['virtual assistant', 'quickbooks', 'ai', 'automation', 'remote'],
  negative: ['cold calling', 'crypto', 'video editor'],
  noSalary: true, rescueNoSalary: true, rescueNegotiable: true, hideGigsNoHours: true,
  maxAgeDays: 7, autoScan: false, autoLoad: false, sortByPay: true, showHidden: false,
};

const H = 3600 * 1000;
/** [title, type, pay, description, tags, hours ago] */
export const LISTINGS = [
  ['Senior AI Automation Specialist (Zapier, Make)', 'Full Time', '$12/hour',
    'Build and maintain automations across our sales and support tools. 30 hours per week, fully remote, flexible hours within US Eastern time.',
    ['Automation', 'Zapier', 'AI Tools'], 3],
  ['Executive Virtual Assistant — Real Estate Team', 'Full Time', '$1,400/month',
    'Inbox, calendar and transaction paperwork for a small, friendly team. 40 hours per week, remote, Monday to Friday.',
    ['Executive Support', 'Calendar Management', 'Real Estate'], 6],
  ['Remote Bookkeeper — QuickBooks Online', 'Part Time', '$9/hour',
    'Monthly close, reconciliations and payroll for three small clients in QuickBooks Online. 20 hours per week.',
    ['Bookkeeping', 'QuickBooks', 'Payroll'], 9],
  ['Appointment Setter — Cold Calling', 'Full Time', '$1,200/month',
    'Outbound calls to warm leads and booking consultations. 40 hours per week, US hours, scripts and training provided.',
    ['Appointment Setting', 'Sales', 'CRM'], 12],
  ['Community Moderator for a Crypto Learning App', 'Part Time', '$8/hour',
    'Moderate our Discord and answer beginner questions. 25 hours per week, evenings Philippine time.',
    ['Community Management', 'Discord', 'Customer Support'], 20],
  ['Customer Support Specialist (Email & Chat)', 'Full Time', 'PHP 45,000 per month',
    'Answer customer emails and live chat for an online store. 45 hours per week, remote, night shift.',
    ['Customer Service', 'Live Chat', 'Zendesk'], 26],
  ['Executive Assistant to a Startup Founder', 'Full Time', '$1,000/month',
    'Keep a busy founder organised: email, travel, meeting notes and follow-ups. Remote. Start next week.',
    ['Executive Support', 'Travel Planning', 'Google Workspace'], 30],
  ['Lead Generation Researcher', 'Part Time', '$5/hour',
    'Find and verify contact details for B2B leads in spreadsheets. 20 hours per week.',
    ['Lead Generation', 'Research', 'Google Sheets'], 34],
  ['Social Media Assistant', 'Full Time', '$300/month',
    'Post daily on four platforms, reply to comments and make simple graphics. 40 hours per week.',
    ['Social Media', 'Canva', 'Content Scheduling'], 40],
  ['Data Entry Assistant', 'Full Time', '$250 per month',
    'Copy product details from supplier sheets into our store. 48 hours per week, six days.',
    ['Data Entry', 'Excel', 'Attention to Detail'], 44],
  ['Video Editor for a YouTube Channel', 'Gig', '$150',
    'Edit two ten-minute videos from raw footage: cuts, captions and music.',
    ['Video Editing', 'Premiere Pro', 'YouTube'], 50],
  ['General Virtual Assistant', 'Full Time', 'TBD',
    'Admin tasks for a growing agency. Details on the call.',
    ['Administrative Support', 'Communication', 'Organization'], 60],
];

const pad = (n) => String(n).padStart(2, '0');
/** "2026-10-14 06:49:44" in UTC (data-temp-2) and in Manila time (data-temp), like the site writes them. */
const stamps = (ms) => {
  const f = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return { utc: f(new Date(ms)), manila: f(new Date(ms + 8 * H)) };
};

/** Replace the board in `tab` with the invented listings. The page must already be a search page. */
export async function applyFiction(tab, { keyword = 'virtual assistant' } = {}) {
  const now = Date.now();
  const cards = LISTINGS.map(([title, type, pay, desc, tags, ago], i) => ({
    title, type, pay, desc, tags, id: 9000001 + i, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    ...stamps(now - ago * H),
  }));
  return tab.evaluate(`(() => {
    const cards = ${JSON.stringify(cards)};
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const first = document.querySelector('.jobpost-cat-box.latest-job-post');
    if (!first) return 'no board on this page';
    const host = first.parentElement;
    for (const c of [...document.querySelectorAll('.jobpost-cat-box.latest-job-post')]) c.remove();
    const typeClass = (t) => t.toLowerCase().replace(/[^a-z]+/g, '-');
    const html = cards.map(c => {
      const href = '/jobseekers/job/' + c.slug + '-' + c.id;
      return '<div style="position: relative;" class="jobpost-cat-box latest-job-post card-hover-default">' +
        '<a href="' + href + '" style="text-decoration: none;color:inherit;">' +
        '<dl class="row fs-14 d-flex justify-content-between"><dt class="col"><h4 class="fs-16 fw-700">' + esc(c.title) +
        ' <span class="badge ' + typeClass(c.type) + ' mt-md-0">' + esc(c.type) + '</span></h4></dt></dl>' +
        '<p class="fs-13 mb-0" data-temp="' + c.manila + '" data-temp-2="' + c.utc + '"><em>Posted on ' + c.manila + '</em></p>' +
        '<dl class="row fs-14 no-gutters align-items-top mt-2 mb-2 mt-sm-0 mb-sm-0"><dt class="col-auto text-center"></dt>' +
        '<dd class="col">' + esc(c.pay) + '</dd></dl></a>' +
        '<div class="desc fs-14 d-none d-sm-block"><a href="' + href + '" style="text-decoration: none;color:inherit;">' + esc(c.desc) +
        '</a> <a href="' + href + '" target="_blank">See More</a></div>' +
        '<div class="job-tag">' + c.tags.map(t => '<a href="#" class="badge">' + esc(t) + '</a>').join(' ') + '</div></div>';
    }).join('');
    // Our bar lives inside the results column, above the first card: insert the cards after it, not before.
    const bar = document.getElementById('ojc-chip');
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const frag = document.createDocumentFragment();
    while (tmp.firstChild) frag.appendChild(tmp.firstChild);
    if (bar && bar.parentElement === host) bar.after(frag); else host.appendChild(frag);
    // No real employer, and no OnlineJobs.ph branding, anywhere in frame.
    for (const img of document.querySelectorAll('img.jobpost-cat-box-logo, .navbar-brand img')) img.style.visibility = 'hidden';
    const kw = document.querySelector('input[name="jobkeyword"]');
    if (kw) kw.value = ${JSON.stringify(keyword)};
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length === 0 && /^Displaying \\d+ out of \\d+ jobs$/.test((el.textContent || '').trim())) {
        el.textContent = 'Displaying ' + cards.length + ' out of ' + cards.length + ' jobs';
      }
    }
    return 'fiction: ' + cards.length + ' listings';
  })()`);
}
