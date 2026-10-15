#!/usr/bin/env node
/**
 * Builds a paste-ready Wellfound auto-apply script for the browser console (e.g. Zen/Firefox):
 *   node scripts/wellfound/build-wellfound-paste.js [--live]
 * Output: scripts/wellfound/out/wellfound-zen.js  (contains your personal data — git-ignored)
 *
 * It takes the upstream submodule script UNMODIFIED, patches it in memory (human behaviour layer,
 * resume-accurate answers, title filters), prepends your .env data, and writes one file.
 */
const fs = require('fs');
const path = require('path');

const SUB = path.join(__dirname, '..', '..', 'wellfound_autoApply');
const LIVE = process.argv.includes('--live');
const maxArg = process.argv.find((a) => a.startsWith('--max='));
const SESSION_MAX = maxArg ? +maxArg.split('=')[1] : 10;   // applications per console session (override: --max=3)
const DAILY_CAP = 25;     // applications per day (persisted in localStorage)

const { CV, geminiKey } = require(path.join(SUB, 'config.js'));
let src = fs.readFileSync(path.join(SUB, 'wellfound-auto-apply.js'), 'utf8');
const layer = fs.readFileSync(path.join(__dirname, 'human-layer.js'), 'utf8').replace('__HUMAN_DAILY_CAP__', String(DAILY_CAP));

function patch(from, to) {
  const hit = typeof from === 'string' ? src.includes(from) : from.test(src);
  if (!hit) throw new Error('Patch target not found (upstream changed?): ' + String(from).slice(0, 80));
  src = src.replace(from, () => to);
}

// --- config
patch(/DRY_RUN: true/, `DRY_RUN: ${!LIVE}`);
patch(/MAX_APPLICATIONS: \d+/, `MAX_APPLICATIONS: ${SESSION_MAX}`);
// resume is a 2024-2028 BTech student: allow internships, drop stacks not on the resume
patch("'intern', ", '');
patch("'react native', 'sde',", "'sde', 'intern',");
patch("'python', 'mobile',", "'python',");
patch("'ai engineer', 'ai developer', 'ml engineer',", "'ai engineer', 'ai developer',");


// --- ONLY internships + fresher/entry-level roles, internships preferred
// level gate: title must signal intern / fresher / entry-level (word-boundary: "international" must not match)
const LEVEL_RE = "/\\b(intern(ship)?s?|trainee|fresher|freshers|graduate|new grad|entry[- ]level|early career|junior|jr\\.?|apprentice|associate (software|developer|engineer)|(sde|swe)[- ]?(1|i)|(software|backend|frontend|full[- ]?stack|web) (engineer|developer) (1|i))\\b/i";
patch(/  const titleOk = \(t\) => \{[\s\S]*?\n  \};\n/, `  const LEVEL_RE = ${LEVEL_RE};
  const INTERN_RE = /\\bintern(ship)?s?\\b/i;
  const ROLE_RE = /engineer|developer|software|sde|swe|full.?stack|mern|backend|back end|frontend|front end|web|react|node|javascript|typescript|python|ai\\b|ml\\b/i;
  const BLOCK_RE = /\\b(senior|sr\\.?|principal|director|manager|lead|architect|devops|data engineer|qa\\b|tester|test engineer|designer|sales|marketing|accountant|hr\\b|recruiter|tutor|teacher|instructor)\\b/i;
  const titleOk = (t) => {
    return LEVEL_RE.test(t) && ROLE_RE.test(t) && !BLOCK_RE.test(t);
  };
`);
// prefer internships over other fresher roles when both are available
patch('const job = jobs[0];', 'const job = jobs.find((j) => INTERN_RE.test(j.title)) || jobs[0];');

// clean concatenated badges like "InternIn office" -> "Intern In office"
patch(`  function cleanTitle(raw) {
    return (raw || '')
      .replace(/\\s+/g, ' ')
      .split(/remote only|on-?site|hybrid|₹|\\$\\d|€|posted \\d|recruiter|•|\\d+\\s?(?:weeks?|days?|months?|hours?)\\s?ago/i)[0]
      .replace(/\\(?\\s*remote\\s*\\)?$/i, '')
      .replace(/[\\s\\-–—|(,/]+$/g, '')
      .trim();
  }`, `  function cleanTitle(raw) {
    return (raw || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\\s+/g, ' ')
      .split(/in[- ]?office|remote only|on[- ]?site|hybrid|india|bangalore|bengaluru|mumbai|delhi|pune|gurgaon|noida|hyderabad|chennai|jaipur|₹|\\$\\d|€|posted \\d|recruiter|•|\\d+\\s?(?:weeks?|days?|months?|hours?)\\s?ago/i)[0]
      .replace(/\\(?\\s*remote\\s*\\)?$/i, '')
      .replace(/[\\s\\-–—|(,/]+$/g, '')
      .trim();
  }`);

// check already applied across persistent list, window config, and card text
patch("      if (SELECTORS.alreadyApplied.test([...row.querySelectorAll('button, span')].map((e) => e.textContent.trim()).find((t) => /^applied$/i.test(t)) || '')) continue;", `      const _jobIdM = (a.getAttribute('href') || '').match(/\\/jobs\\/(\\d+)/);
      const _jobId = _jobIdM ? _jobIdM[1] : '';
      const _cfgUrls = (typeof window !== 'undefined' && window.__APPLY_CONFIG && window.__APPLY_CONFIG.appliedUrls) || [];
      let _locApplied = [];
      try { _locApplied = JSON.parse(localStorage.getItem('wfAppliedJobs') || '[]'); } catch (e) {}
      if (
        _cfgUrls.some((u) => u.includes(a.href) || (_jobId && u.includes(_jobId))) ||
        _locApplied.some((u) => u === a.href || (_jobId && u.includes(_jobId))) ||
        /\\bapplied\\b/i.test(row.innerText || row.textContent || '')
      ) {
        continue;
      }`);

patch("    if (!modal) {\n      log('  ⚠ no apply modal found — skipping (not counting as sent)');\n      return false;\n    }", `    if (!modal) {
      log('  ⚠ no apply modal found — skipping (not counting as sent)');
      try {
        const _s = JSON.parse(localStorage.getItem('wfAppliedJobs') || '[]');
        const _curHref = location.href;
        if (!_s.includes(_curHref)) { _s.push(_curHref); localStorage.setItem('wfAppliedJobs', JSON.stringify(_s.slice(-1000))); }
      } catch (e) {}
      return false;
    }`);

// cover letter: highlights have no trailing period, so the paragraph joined two sentences without one
patch("${CV.highlights[1] || ''}${CV.highlights[2] ? ' ' + CV.highlights[2] + '.' : ''}", "${CV.highlights[1] ? CV.highlights[1] + '. ' : ''}${CV.highlights[2] ? CV.highlights[2] + '.' : ''}");

patch('    const allRows = findJobRows();', '    await ensureFeed();\n    const allRows = findJobRows();');

patch('models/gemini-2.0-flash:generateContent', 'models/gemini-3.8-flash:generateContent'); // 2.0 is retired for this key

// accurately extract company from job card and avoid global page banner
patch("const company = (row.querySelector('img[alt*=\"logo\" i]')?.alt || '')\n        .replace(/company logo/i, '').trim();", `let company = (row.querySelector('a[href^="/company/"]')?.textContent || row.closest('div')?.querySelector('a[href^="/company/"]')?.textContent || row.querySelector('img[alt*="logo" i]')?.alt || row.querySelector('h3, h4')?.textContent || '').replace(/company logo|actively hiring|promoted|employees/gi, '').trim().split('\\n')[0];`);

patch("const el =\n      document.querySelector('a[href^=\"/company/\"] h2') ||\n      document.querySelector('[data-test=\"StartupHeader\"] h1') ||\n      document.querySelector('a[href^=\"/company/\"]');", `const _titleMatch = document.title.match(/ at (.+?) • /i) || document.title.match(/ at (.+?) \\|/i);
    const _modal = document.querySelector('[data-test="JobListingSlideIn"], [role="dialog"]') || document;
    const el = _titleMatch ? { textContent: _titleMatch[1] } : (_modal.querySelector('a[href^="/company/"] h2') || _modal.querySelector('a[href^="/company/"]') || document.querySelector('[data-test="StartupHeader"] h1'));`);

// scope the form precisely: the generic [class*=modal] selector matched the whole page shell, so
// buttons/fields from the feed and "Recent Jobs" were picked up. Use the visible textarea's own <form>
// (slide-in: div[data-test=JobListingSlideIn] form; popup: climb to the container holding the send button).
patch('    const scope = modal;\n', `    const __ta = [...document.querySelectorAll('textarea')].find(visible);
    let __sc = __ta && __ta.closest('form');
    if (!__sc && __ta) { __sc = __ta.parentElement; for (let i = 0; i < 10 && __sc && !findButtonByText(__sc, SELECTORS.sendButtonText); i++) __sc = __sc.parentElement; }
    const scope = __sc || document.querySelector('[data-test="JobListingSlideIn"]') || modal;
`);
patch('await waitFor(() => findButtonByText(scope, SELECTORS.sendButtonText), 12000)', `await waitFor(() => scope.querySelector('button[data-test="JobDescriptionSlideIn--SubmitButton"]:not([disabled])') || findButtonByText(scope, SELECTORS.sendButtonText), 12000)`);

// --- human layer replaces sleep/humanDelay
patch("const sleep = (ms) => new Promise((r) => setTimeout(r, ms));", layer);
patch(/const humanDelay = .*\n/, 'const humanDelay = humanBetweenApps;\n');

// --- human interactions
patch('setValue(textareas[0], coverLetter(company, title));', 'await humanFill(textareas[0], await aiCoverLetter(company, title));');
patch('const answer = await answerQuestion(label);', 'const answer = (await aiAnswerQuestion(label, company, title)) || (await answerQuestion(label));');
patch('      setValue(field, answer);', '      await humanFill(field, answer);');
patch('if (!pick.checked) pick.click();', 'if (!pick.checked) await humanClick(pick);');
patch('        cb.click();', '        await humanClick(cb);');
patch("    job.linkEl.scrollIntoView({ block: 'center' });\n    await sleep(500);\n    job.linkEl.click();", '    await humanClick(job.linkEl);');
patch('    await sleep(3000);\n\n    const ok = await fillAndSubmit', '    await sleep(3000);\n    await readingPause();\n\n    const ok = await fillAndSubmit');
patch("    if (CONFIG.DRY_RUN) {\n      log('  🔍 DRY_RUN", "    await reviewPause();\n    if (CONFIG.DRY_RUN) {\n      log('  🔍 DRY_RUN");
patch('    sendBtn.click();\n    log(\'  ✅ application sent\');', '    await humanClick(sendBtn);\n    log(\'  ✅ application sent\');\n    await dismissPostSubmit();');
patch('        window.scrollTo(0, document.body.scrollHeight);\n        await sleep(3000);', '        await humanScrollFeed();\n        await sleep(3000);');
patch('while (applied < CONFIG.MAX_APPLICATIONS) {', 'while (applied < CONFIG.MAX_APPLICATIONS && dailyOk()) {');
patch('      applied++;\n', '      applied++; bumpDaily();\n');

// --- answers that matched the upstream author's CV, rewritten to match this resume
patch(/\[\/react\|frontend\|front-end\/i,\n\s*`[^`]*`\]/, "[/react|frontend|front-end/i,\n      `I build frontends with React.js, Next.js, TypeScript, Tailwind CSS and Zustand. At Nepbyte I shipped production React apps and raised Lighthouse scores by 40% with lazy loading and code splitting, and I built the Cook Off 10.0 code editor platform on Next.js for 1,000+ users.`]");
patch(/\[\/node\|backend\|back-end\|api\/i,\n\s*`[^`]*`\]/, "[/node|backend|back-end|api/i,\n      `I build backends with Node.js and Express, using Prisma with PostgreSQL, MongoDB and Redis. I designed an e-commerce backend at Moss X (JWT auth, Razorpay webhooks with idempotency, Redis caching under 50 ms) and OpenPumTa with 30+ REST APIs, WebSockets, Docker and Nginx on a self-hosted VPS.`]");
patch(/\[\/\\b\(ai\|llm\|ml\|machine learning\|genai\|langchain\)\\b\/i,\n\s*`[^`]*`\]/, "[/\\b(ai|llm|ml|machine learning|genai|langchain)\\b/i,\n      `I have built AI-powered features into products, such as the productivity reports and daily reviews in OpenPumTa that analyse habits, tasks and study sessions. I am still growing in this area and keen to learn more on the job.`]");
// "about yourself" / "worked on" answers reference highlights[3] and [2]; keep them but drop the "Previously:" framing
patch("Previously: ${CV.highlights[2] || ''}. ${CV.highlights[3] || ''}.", "Also: ${CV.highlights[2] || ''}.");
patch("I owned it end to end, from architecture through deployment and CI/CD.", "I owned it end to end, from architecture through Docker-based deployment.");

const header = `// Generated ${new Date().toISOString()} — ${LIVE ? 'LIVE' : 'DRY RUN'} — session max ${SESSION_MAX}, daily cap ${DAILY_CAP}\nwindow.__APPLY_CONFIG = ${JSON.stringify({ CV, geminiKey })};\n`;
const out = path.join(__dirname, 'out', 'wellfound-zen.js');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, header + src);
fs.writeFileSync(path.join(SUB, 'wellfound-auto-apply-enhanced.js'), src);
new Function('return async () => {' + src + '}'); // syntax check (does not execute)
console.log(`Wrote ${out} and ${path.join(SUB, 'wellfound-auto-apply-enhanced.js')}\nMode: ${LIVE ? 'LIVE (will press Apply)' : 'DRY RUN (never presses Apply)'}`);
