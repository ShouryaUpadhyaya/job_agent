#!/usr/bin/env node
/**
 * Builds the Wellfound console auto-apply script from the UNMODIFIED upstream submodule file
 * (wellfound_autoApply/wellfound-auto-apply.js), patched in memory: human behaviour layer,
 * resume-accurate answers, intern/fresher title filters, scoped selectors, configurable rules.
 *
 *   node scripts/wellfound/build-wellfound-paste.js                 # dry run (default)
 *   node scripts/wellfound/build-wellfound-paste.js --dry-run       # same, explicit
 *   node scripts/wellfound/build-wellfound-paste.js --live          # presses Apply for real
 *   options: --max=N (applications per console session), --with-key (embed GEMINI_KEY in the Zen bundle)
 *
 * Outputs (git-ignored, contain personal data):
 *   scripts/wellfound/out/wellfound-zen.js       paste into the browser console (Zen/Firefox/Chrome)
 *   scripts/wellfound/out/wellfound-enhanced.js  the patched script without personal data (debugging aid)
 *
 * The Playwright runner (runner.js) calls buildConsoleScript() in-process, so it never depends on a stale file.
 */
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const UPSTREAM = path.join(lib.SUB, 'wellfound-auto-apply.js');

function buildConsoleScript({ live = false, max = 10, dailyCap = lib.DEFAULT_DAILY_CAP } = {}) {
  if (typeof live !== 'boolean') throw new Error('buildConsoleScript: `live` must be an explicit boolean');
  let src = fs.readFileSync(UPSTREAM, 'utf8');
  const layer = fs.readFileSync(path.join(__dirname, 'human-layer.js'), 'utf8').replace('__HUMAN_DAILY_CAP__', String(Number(dailyCap) || lib.DEFAULT_DAILY_CAP));

  function patch(from, to) {
    const hit = typeof from === 'string' ? src.includes(from) : from.test(src);
    if (!hit) throw new Error('Patch target not found (upstream changed?): ' + String(from).slice(0, 80));
    src = src.replace(from, () => to);
  }

  // --- config: rules from the runner/Zen header; drop the dead keyword lists (titleOk is replaced below)
  patch("  const __CFG = (typeof window !== 'undefined' && window.__APPLY_CONFIG) || {};\n",
    "  const __CFG = (typeof window !== 'undefined' && window.__APPLY_CONFIG) || {};\n  const RULES = __CFG.rules || {};\n");
  patch(/\n\s*\/\/ Job titles to apply to[\s\S]*?TITLE_BLOCKLIST: \[[\s\S]*?\],\n/, '\n');

  // --- ONLY internships + fresher/entry-level roles, internships preferred
  // level gate: title must signal intern / fresher / entry-level (word-boundary: "international" must not match)
  const LEVEL_RE = "/\\b(intern(ship)?s?|trainee|fresher|freshers|graduate|new grad|entry[- ]level|early career|junior|jr\\.?|apprentice|associate (software|developer|engineer)|(sde|swe)[- ]?(1|i)|(software|backend|frontend|full[- ]?stack|web) (engineer|developer) (1|i))\\b/i";
  patch(/  const titleOk = \(t\) => \{[\s\S]*?\n  \};\n/, `  const LEVEL_RE = ${LEVEL_RE};
  const INTERN_RE = /\\bintern(ship)?s?\\b/i;
  const ROLE_RE = /engineer|developer|software|sde|swe|full.?stack|mern|backend|back end|frontend|front end|web|react|node|javascript|typescript|python|ai\\b|ml\\b/i;
  const BLOCK_RE = /\\b(senior|sr\\.?|principal|director|manager|lead|architect|devops|data engineer|qa\\b|tester|test engineer|testing|designer|sales|marketing|accountant|hr\\b|recruiter|tutor|teacher|instructor|flutter|ios|android|embedded|\\.net|c#|php|ruby|golang)\\b/i;
  const titleOk = (t) => LEVEL_RE.test(t) && ROLE_RE.test(t) && !BLOCK_RE.test(t);
`);
  // prefer internships over other fresher roles when both are available
  patch('const job = jobs[0];', 'const job = jobs.find((j) => INTERN_RE.test(j.title)) || jobs[0];');

  // clean concatenated badges like "InternIn office" -> "Intern In office"
  patch(`  function cleanTitle(raw) {
    return (raw || '')
      .replace(/\\s+/g, ' ')
      .split(/remote only|on-?site|hybrid|₹|\\$\\d|€|posted \\d|recruiter|•|\\d+\\s?(?:weeks?|days?|months?|hours?)\\s?ago/i)[0]`, `  function cleanTitle(raw) {
    return (raw || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\\s+/g, ' ')
      .split(/in[- ]?office|remote only|on[- ]?site|hybrid|india|bangalore|bengaluru|mumbai|delhi|pune|gurgaon|noida|hyderabad|chennai|jaipur|₹|\\$\\d|€|posted \\d|recruiter|•|\\d+\\s?(?:weeks?|days?|months?|hours?)\\s?ago/i)[0]`);

  // --- job card scoping: the row is the largest ancestor that holds ONLY this job's link, so the
  // "Applied" stamp / company of a neighbouring card can never leak in.
  patch(`      let row = a.closest('div');
      for (let i = 0; i < 5 && row && row.textContent.trim().length < 60; i++) row = row.parentElement;
      row = row || a.parentElement;`, `      const _jobIdsIn = (el) => new Set([...el.querySelectorAll('a[href*="/jobs/"]')].map((x) => ((x.getAttribute('href') || '').match(/\\/jobs\\/(\\d+)/) || [])[1]).filter(Boolean)).size;
      let row = a.parentElement || a;
      while (row.parentElement && row.parentElement !== document.body && _jobIdsIn(row.parentElement) <= 1) row = row.parentElement;`);

  // already applied: runner/CSV list (refreshed before every job), the local skip list, or an "Applied" stamp on THIS card
  patch("      if (SELECTORS.alreadyApplied.test([...row.querySelectorAll('button, span')].map((e) => e.textContent.trim()).find((t) => /^applied$/i.test(t)) || '')) continue;", `      const _jobIdM = (a.getAttribute('href') || '').match(/\\/jobs\\/(\\d+)/);
      const _jobId = _jobIdM ? _jobIdM[1] : '';
      const _cfgUrls = (typeof window !== 'undefined' && window.__APPLY_CONFIG && window.__APPLY_CONFIG.appliedUrls) || [];
      let _locApplied = [];
      try { _locApplied = JSON.parse(localStorage.getItem('wfAppliedJobs') || '[]'); } catch (e) {}
      const _sameJob = (u) => u === a.href || (_jobId && new RegExp('/jobs/' + _jobId + '(?:\\\\D|$)').test(u));
      if (
        _cfgUrls.some(_sameJob) || _locApplied.some(_sameJob) ||
        [...row.querySelectorAll('button, span, div')].some((e) => e.children.length === 0 && /^applied$/i.test(e.textContent.trim()))
      ) {
        continue;
      }`);

  // company from the job's own startup card (never the global page banner)
  patch("const company = (row.querySelector('img[alt*=\"logo\" i]')?.alt || '')\n        .replace(/company logo/i, '').trim();", `let company = ((a.closest('[data-test="StartupResult"]') || row).querySelector('a[href^="/company/"] h2, a[href^="/company/"]')?.textContent || row.querySelector('img[alt*="logo" i]')?.alt || '').replace(/company logo|actively hiring|promoted|\\d+-\\d+ employees|employees/gi, ' ').replace(/\\s+/g, ' ').trim();`);

  patch("const el =\n      document.querySelector('a[href^=\"/company/\"] h2') ||\n      document.querySelector('[data-test=\"StartupHeader\"] h1') ||\n      document.querySelector('a[href^=\"/company/\"]');", `const _titleMatch = document.title.match(/ at (.+?) • /i) || document.title.match(/ at (.+?) \\|/i);
    const _modal = document.querySelector('[data-test="JobListingSlideIn"], [role="dialog"]') || document;
    const el = _titleMatch ? { textContent: _titleMatch[1] } : (_modal.querySelector('a[href^="/company/"] h2') || _modal.querySelector('a[href^="/company/"]') || document.querySelector('[data-test="StartupHeader"] h1'));`);

  // --- apply panel: prefer the data-test slide-in, never a page-sized "[class*=modal]" shell
  patch(`    const modal = await waitFor(() => {
      const dialogs = [...document.querySelectorAll(SELECTORS.modal)];`, `    const modal = await waitFor(() => {
      const slide = [...document.querySelectorAll('[data-test="JobListingSlideIn"]')].find(visible);
      if (slide && (slide.querySelector('textarea') || /apply to /i.test(slide.textContent))) return slide;
      const dialogs = [...document.querySelectorAll(SELECTORS.modal)].filter((d) => visible(d) && d.textContent.length < 20000);`);

  patch("    if (!modal) {\n      log('  ⚠ no apply modal found — skipping (not counting as sent)');\n      return false;\n    }", `    if (!modal) {
      log('  ⚠ no apply modal found — skipping (not counting as sent)');
      try {
        const _s = JSON.parse(localStorage.getItem('wfAppliedJobs') || '[]');
        const _curHref = location.href;
        if (!_s.includes(_curHref)) { _s.push(_curHref); localStorage.setItem('wfAppliedJobs', JSON.stringify(_s.slice(-1000))); }
      } catch (e) {}
      return false;
    }`);

  // form scope: the cover-letter textarea's own <form>, else climb from it but never past the panel
  patch('    const scope = modal;\n', `    const __ta = [...modal.querySelectorAll('textarea')].find(visible);
    let __sc = __ta && __ta.closest('form');
    if (!__sc && __ta) { __sc = __ta.parentElement; while (__sc && __sc !== modal && !findButtonByText(__sc, SELECTORS.sendButtonText)) __sc = __sc.parentElement; }
    const scope = (__sc && modal.contains(__sc)) ? __sc : modal;
`);
  patch('await waitFor(() => findButtonByText(scope, SELECTORS.sendButtonText), 12000)', `await waitFor(() => scope.querySelector('button[data-test="JobDescriptionSlideIn--SubmitButton"]:not([disabled])') || modal.querySelector('button[data-test="JobDescriptionSlideIn--SubmitButton"]:not([disabled])') || findButtonByText(scope, SELECTORS.sendButtonText), 12000)`);

  // --- gender: from the profile (blank = "prefer not to say" when offered, otherwise leave unanswered)
  patch(`        pick = group.find((r) => { const l = labelTextOf(r); return /male/i.test(l) && !/female/i.test(l); });`, `        const _g = String(CV.gender || '').trim().toLowerCase();
        const _esc = (s) => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
        pick = _g ? (group.find((r) => labelTextOf(r).trim().toLowerCase() === _g) ||
                     group.find((r) => new RegExp('^' + _esc(_g) + '\\\\b', 'i').test(labelTextOf(r).trim()))) : null;
        pick = pick || group.find((r) => /prefer not|decline|rather not|not to say/i.test(labelTextOf(r)));
        if (!pick) { log('  ⏭ gender question left unanswered (set it in Profile & Rules if required)'); continue; }`);

  // --- consent/terms checkboxes are ticked only when the rule allows it
  patch(`      if (!cb.checked &&
          (isLocationQuestion || /relocat|agree|confirm|authoriz|terms|acknowledge|remote/i.test(own))) {`, `      const _isTerms = /agree|confirm|authoriz|terms|acknowledge|consent|privacy/i.test(own);
      if (!cb.checked && _isTerms && RULES.autoTickTerms === false) { log(\`  ⏭ left consent box unticked (rule): "\${own.slice(0, 50)}"\`); continue; }
      if (!cb.checked &&
          (isLocationQuestion || /relocat|remote/i.test(own) || _isTerms)) {`);

  // cover letter: highlights have no trailing period, so the paragraph joined two sentences without one
  patch("${CV.highlights[1] || ''}${CV.highlights[2] ? ' ' + CV.highlights[2] + '.' : ''}", "${CV.highlights[1] ? CV.highlights[1] + '. ' : ''}${CV.highlights[2] ? CV.highlights[2] + '.' : ''}");

  patch('    const allRows = findJobRows();', '    await ensureFeed();\n    const allRows = findJobRows();');

  // upstream fallback Gemini call: 2.0 is retired, and the key belongs in a header, not the URL
  patch("`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.geminiKey}`,\n          {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json' },",
    "`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`,\n          {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': CONFIG.geminiKey },");

  // --- human layer replaces sleep/humanDelay
  patch('const sleep = (ms) => new Promise((r) => setTimeout(r, ms));', layer);
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

  // --- answer bank rewritten from the resume (no claims beyond it)
  patch(/\[\/react\|frontend\|front-end\/i,\n\s*`[^`]*`\]/, "[/react|frontend|front-end/i,\n      `I build frontends with React, Next.js, TypeScript, Tailwind CSS and Zustand. At Nepbyte Technology I built production React apps with Axios and Zustand and improved Lighthouse scores by 40%, and I built Cook Off 10.0, a Next.js coding-contest platform with a CodeMirror 6 editor used by 1,000+ users.`]");
  patch(/\[\/node\|backend\|back-end\|api\/i,\n\s*`[^`]*`\]/, "[/node|backend|back-end|api/i,\n      `I build backends with Node.js and Express, using Prisma with PostgreSQL, MongoDB and Redis. At Moss X I led 3 developers on an e-commerce backend with JWT auth, Redis caching under 50 ms and idempotent Razorpay webhooks, and I built OpenPumTa with 30+ REST APIs, WebSockets, Docker Compose and Nginx on a VPS, monitored with Prometheus and Grafana.`]");
  patch(/\[\/\\b\(ai\|llm\|ml\|machine learning\|genai\|langchain\)\\b\/i,\n\s*`[^`]*`\]/, "[/\\b(ai|llm|ml|machine learning|genai|langchain)\\b/i,\n      `My production experience so far is full-stack web development (Node.js, Express, React, PostgreSQL, Redis, Docker). I have not shipped ML models in production yet; I can contribute to the APIs, data flow and infrastructure around AI features and I am keen to learn the modelling side on the job.`]");
  patch('    [/education|degree|university|college/i, CV.education],', "    [/graduat|passing year|year of study|batch|current year/i, CV.education],\n    [/education|degree|university|college/i, CV.education],\n    [/twitter|\\bx\\.com\\b|\\bx (profile|handle)\\b/i, CV.x || CV.links],");
  patch("Previously: ${CV.highlights[2] || ''}. ${CV.highlights[3] || ''}.", "Also: ${CV.highlights[1] || ''}.");
  patch("I owned it end to end, from architecture through deployment and CI/CD.", "I owned it end to end, from the API design to the Docker and Nginx deployment.");

  src = lib.injectDryRun(src, !live);
  src = lib.injectMax(src, max);
  new Function('return async () => {' + src + '}'); // syntax check (does not execute)
  return src;
}

/** Console bundle with the personal-data header. The Gemini key is embedded only when passed explicitly. */
function buildZenBundle({ live = false, max = 10, dailyCap, config, geminiKey = null } = {}) {
  const cfg = config || lib.loadRunnerConfig();
  const cap = Number(dailyCap || (cfg.rules && cfg.rules.dailyCap) || lib.DEFAULT_DAILY_CAP);
  const src = buildConsoleScript({ live, max, dailyCap: cap });
  const payload = { CV: cfg.CV, rules: cfg.rules || {}, appliedUrls: [] };
  if (geminiKey) payload.geminiKey = geminiKey;
  const header = `// Generated ${new Date().toISOString()} — ${live ? 'LIVE (presses Apply)' : 'DRY RUN (never presses Apply)'} — session max ${max}, daily cap ${cap}${geminiKey ? ' — contains your Gemini key, do not share' : ''}\nwindow.__APPLY_CONFIG = ${JSON.stringify(payload)};\n`;
  return header + src;
}

function cli(argv) {
  const live = argv.includes('--live');
  if (live && argv.includes('--dry-run')) throw new Error('Pass either --dry-run or --live, not both.');
  const maxArg = argv.find((a) => a.startsWith('--max='));
  const max = maxArg ? Math.max(1, parseInt(maxArg.split('=')[1], 10) || 10) : 10;
  const cfg = lib.loadRunnerConfig();
  const key = argv.includes('--with-key') ? lib.envValue('GEMINI_KEY') : null;
  fs.mkdirSync(lib.OUT_DIR, { recursive: true });
  const zen = path.join(lib.OUT_DIR, 'wellfound-zen.js');
  const enhanced = path.join(lib.OUT_DIR, 'wellfound-enhanced.js');
  fs.writeFileSync(zen, buildZenBundle({ live, max, config: cfg, geminiKey: key }));
  fs.writeFileSync(enhanced, buildConsoleScript({ live, max, dailyCap: cfg.rules.dailyCap }));
  console.log(`Wrote ${zen}\nWrote ${enhanced}\nProfile source: ${cfg.source}\nMode: ${live ? 'LIVE (will press Apply)' : 'DRY RUN (never presses Apply)'}${key ? '\nGemini key embedded (--with-key).' : ''}`);
}

if (require.main === module) {
  try {
    cli(process.argv.slice(2));
  } catch (e) {
    console.error('Build failed: ' + e.message);
    process.exit(1);
  }
}

module.exports = { buildConsoleScript, buildZenBundle };
