#!/usr/bin/env node
/**
 * Wellfound auto-apply runner (maintained here; started from the upstream
 * wellfound_autoApply/auto-apply-runner.js). Drives the patched console script with Playwright
 * in a real, headed (off-screen) Chrome using the saved login session.
 *
 *   node scripts/wellfound/runner.js wellfound login         one-time: log in, then close the window
 *   node scripts/wellfound/runner.js wellfound               DRY RUN (default): fills forms, never presses Apply
 *   node scripts/wellfound/runner.js wellfound --live        applies for real
 *   node scripts/wellfound/runner.js wellfound --preflight   prints the environment checklist as JSON
 *
 * Options: --max=N  --visible  --trace  --run-id=ID  --log-file=PATH  --diagnostics-dir=DIR
 *          --config=FILE (server-generated profile)  --daily-cap=N  --profile-dir=DIR  --max-minutes=N
 *
 * Every log line is "<ISO+05:30> <LEVEL> <message>". The last line is
 * "<ts> SUMMARY {json}" with status/submitted/skipped/errors so callers can parse the outcome.
 * Exit codes: 0 ok, 1 failure, 2 environment/config problem, 3 logged out / bot check, 130 stopped.
 */
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => {
  const a = argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : undefined;
};

const SITE = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'wellfound';
const LOGIN_MODE = argv.includes('login');
const PREFLIGHT = flag('--preflight');
const LIVE = flag('--live');
const VISIBLE = flag('--visible') || flag('--head');
const TRACE = flag('--trace');
const RUN_ID = opt('run-id') || `cli-${lib.istIso().slice(0, 19).replace(/[:T]/g, '-')}`;
const DIAG_DIR = path.resolve(opt('diagnostics-dir') || path.join(lib.DIAGNOSTICS_DIR, RUN_ID));
const LOG_FILE = opt('log-file') ? path.resolve(opt('log-file')) : null;
const PROFILE_DIR = path.resolve(opt('profile-dir') || lib.PROFILE_DIR);
const MAX = opt('max') !== undefined ? Math.max(0, parseInt(opt('max'), 10) || 0) : null;
const IDLE_ROTATE_MS = 4 * 60 * 1000;
const SEARCHES = ['https://wellfound.com/jobs'];
const LOGIN_URL = 'https://wellfound.com/login';
const SUBMITTED_RE = /application (?:sent|submitted)|DRY_RUN — would click/i;
const MAX_DIAGNOSTICS = 30;

// ---------------------------------------------------------------- logging

let logFd = null;
if (LOG_FILE) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  logFd = fs.openSync(LOG_FILE, 'a');
}
function emit(level, msg) {
  const ts = lib.istIso();
  const lines = String(msg).split(/\r?\n/).filter((l, i) => i === 0 || l.trim());
  for (const l of lines) {
    const line = `${ts} ${level.padEnd(7)} ${l}\n`;
    process.stdout.write(line);
    if (logFd !== null) {
      try { fs.writeSync(logFd, line); } catch (e) {}
    }
  }
}
const log = (m) => emit('INFO', m);
const warn = (m) => emit('WARN', m);
const error = (m) => emit('ERROR', m);

if (SITE !== 'wellfound') {
  error(`Unsupported site "${SITE}". Usage: node scripts/wellfound/runner.js wellfound [login|--live|--preflight] [--max=N]`);
  process.exit(2);
}
if (LIVE && flag('--dry-run')) {
  error('Pass either --dry-run or --live, not both.');
  process.exit(2);
}
if (!lib.isValidRunId(RUN_ID)) {
  error(`Invalid --run-id "${RUN_ID}" (letters, digits, - and _ only).`);
  process.exit(2);
}

if (PREFLIGHT) {
  const { preflight } = require('./preflight');
  process.stdout.write(JSON.stringify(preflight({ profileDir: PROFILE_DIR })) + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------- state

const stats = { submitted: 0, skipped: 0, errors: 0, diagnostics: 0, pageErrors: 0 };
let ctx = null;
let mainPage = null;
let finished = false;
let TARGET = 0;
let DAILY_CAP = lib.DEFAULT_DAILY_CAP;
let todayKey = lib.istDateKey();
let todayCount = 0;

function summary(status, exitCode, extra = {}) {
  return { runId: RUN_ID, mode: LIVE ? 'LIVE' : 'DRY_RUN', status, exitCode, target: TARGET, dailyCap: DAILY_CAP, todayCount, ...stats, ...extra };
}

async function finish(status, exitCode, extra = {}) {
  if (finished) return;
  finished = true;
  if (ctx && TRACE) {
    try {
      fs.mkdirSync(DIAG_DIR, { recursive: true });
      await ctx.tracing.stop({ path: path.join(DIAG_DIR, 'trace.zip') });
      log(`Playwright trace saved: ${path.join(DIAG_DIR, 'trace.zip')} (open with: npx playwright show-trace <file>)`);
    } catch (e) {}
  }
  if (ctx) await Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
  emit('SUMMARY', JSON.stringify(summary(status, exitCode, extra)));
  if (logFd !== null) {
    try { fs.closeSync(logFd); } catch (e) {}
  }
  process.exit(exitCode);
}

// ---------------------------------------------------------------- diagnostics

async function capture(page, reason, context = {}) {
  if (stats.diagnostics >= MAX_DIAGNOSTICS) return;
  stats.diagnostics++;
  const base = path.join(DIAG_DIR, `${String(stats.diagnostics).padStart(2, '0')}-${reason.replace(/[^a-z0-9-]/gi, '-')}`);
  try {
    fs.mkdirSync(DIAG_DIR, { recursive: true });
    const info = { reason, runId: RUN_ID, mode: LIVE ? 'LIVE' : 'DRY_RUN', at: new Date().toISOString(), url: null, title: null, context };
    if (page && !page.isClosed()) {
      info.url = page.url();
      info.title = await page.title().catch(() => null);
      try { await page.screenshot({ path: base + '.png', timeout: 15000 }); } catch (e) { info.screenshotError = e.message.split('\n')[0]; }
      try { fs.writeFileSync(base + '.html', await page.content()); } catch (e) { info.htmlError = e.message.split('\n')[0]; }
    } else {
      info.note = 'page unavailable (closed or crashed)';
    }
    fs.writeFileSync(base + '.json', JSON.stringify(info, null, 2));
    emit('DIAG', `saved ${path.basename(base)} (.png/.html/.json) — ${reason}`);
  } catch (e) {
    warn(`could not save diagnostics (${reason}): ${e.message}`);
  }
}

// ---------------------------------------------------------------- crash handling

const BENIGN = /Target (page, context or browser )?(has been )?closed|Session closed|Execution context was destroyed|frame was detached|Navigation failed because page was closed|Protocol error/i;
function onUnexpected(kind, e) {
  const msg = String((e && e.stack) || e);
  if (BENIGN.test(msg) && kind !== 'fatal') {
    warn(`${kind} (navigation race, continuing): ${msg.split('\n')[0]}`);
    return;
  }
  stats.errors++;
  error(`${kind}: ${msg}`);
  if (finished) return;
  capture(mainPage, 'fatal', { kind, message: msg.split('\n')[0] })
    .finally(() => finish('FAILED', 1, { error: `${kind}: ${msg.split('\n')[0]}` }));
}
process.on('unhandledRejection', (e) => onUnexpected('unhandledRejection', e));
process.on('uncaughtException', (e) => onUnexpected('uncaughtException', e));
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    warn(`Received ${sig}: stopping.`);
    finish('STOPPED', 130, { reason: 'stopped' });
  });
}

// ---------------------------------------------------------------- Gemini (from Node; the key never enters the page)

async function geminiNode(prompt) {
  const key = lib.envValue('GEMINI_KEY');
  if (!key || typeof prompt !== 'string') return '';
  const models = (lib.envValue('GEMINI_MODELS') || 'gemini-flash-lite-latest,gemini-flash-latest').split(',').map((m) => m.trim()).filter(Boolean);
  for (const model of models) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25000);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt.slice(0, 20000) }] }] }),
        signal: ac.signal,
      });
      if (!res.ok) { warn(`Gemini ${model}: HTTP ${res.status}`); continue; }
      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      if (text) return text;
    } catch (e) {
      warn(`Gemini ${model}: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return '';
}

// ---------------------------------------------------------------- main

function loadPlaywright() {
  const core = lib.requireFromSub('playwright-core');
  if (!core) return null;
  const extra = lib.requireFromSub('playwright-extra');
  const stealth = lib.requireFromSub('puppeteer-extra-plugin-stealth');
  if (extra && stealth) {
    try {
      const chromium = extra.addExtra(core.chromium);
      chromium.use(stealth()); // patches the fingerprint leaks reCAPTCHA/DataDome use to flag automation
      return chromium;
    } catch (e) {
      warn(`stealth plugin unavailable (${e.message}); using plain Playwright`);
    }
  }
  return core.chromium;
}

function refreshToday() {
  const key = lib.istDateKey();
  if (key !== todayKey) {
    log(`IST date rolled over (${todayKey} → ${key}); daily count resets.`);
    todayKey = key;
  }
  todayCount = lib.countToday(lib.readCsvRows());
  return todayCount;
}

(async () => {
  const cfgFile = opt('config');
  let cfg;
  try {
    cfg = lib.loadRunnerConfig(cfgFile ? path.resolve(cfgFile) : undefined);
  } catch (e) {
    error(`Could not read runner config: ${e.message}`);
    return finish('FAILED', 2, { error: 'bad config' });
  }
  DAILY_CAP = Math.max(1, parseInt(opt('daily-cap'), 10) || Number(cfg.rules.dailyCap) || lib.DEFAULT_DAILY_CAP);
  const MAX_RUNTIME_MS = (parseInt(opt('max-minutes'), 10) || Number(cfg.rules.maxRuntimeMinutes) || 100) * 60 * 1000;

  const chromium = loadPlaywright();
  if (!chromium) {
    error('Playwright is not installed. Fix: npm run wellfound:install');
    return finish('FAILED', 2, { error: 'playwright missing' });
  }
  const executablePath = lib.findChrome();
  if (!executablePath) {
    error('Google Chrome not found. Fix: install Chrome or set CHROME_PATH. (In Docker there is no Chrome — run `npm run wellfound:agent` on the host.)');
    return finish('FAILED', 2, { error: 'chrome missing' });
  }
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    error('DISPLAY is not set, so headed Chrome cannot open. Fix: start this from a terminal in your desktop session (or export DISPLAY=:1).');
    return finish('FAILED', 2, { error: 'no display' });
  }

  if (!LOGIN_MODE) {
    refreshToday();
    const remaining = DAILY_CAP - todayCount;
    TARGET = LIVE ? Math.min(MAX ?? remaining, remaining) : (MAX ?? 3);
    if (TARGET <= 0) {
      log(LIVE ? `Daily cap reached: ${todayCount}/${DAILY_CAP} applications today (IST). Nothing to do.` : 'Batch size is 0. Nothing to do.');
      return finish('SUCCEEDED', 0, { reason: 'daily cap reached' });
    }
  }

  log(`Run ${RUN_ID}: mode=${LOGIN_MODE ? 'LOGIN' : LIVE ? 'LIVE' : 'DRY RUN'} target=${TARGET} today=${todayCount}/${DAILY_CAP} visible=${VISIBLE} trace=${TRACE}`);
  log(`Chrome: ${executablePath}  DISPLAY=${process.env.DISPLAY || '(n/a)'}  profile=${path.relative(lib.ROOT, PROFILE_DIR) || PROFILE_DIR}  config=${cfg.source}`);

  try {
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      executablePath,
      headless: false, // Wellfound blocks headless; headed + off-screen instead
      viewport: { width: 1280, height: 900 },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-backgrounding-occluded-windows', // keep timers full-speed while off-screen
        '--disable-renderer-backgrounding',
        ...(LOGIN_MODE || VISIBLE ? [] : ['--window-position=-32000,-32000']),
      ],
    });
  } catch (e) {
    const first = e.message.split('\n')[0];
    const hint = /ProcessSingleton|SingletonLock|profile.*in use/i.test(e.message)
      ? ' The Chrome profile is in use: close the Wellfound Chrome window (login window or previous run) and retry.'
      : '';
    error(`Chrome failed to launch: ${first}.${hint}`);
    return finish('FAILED', 2, { error: `launch failed: ${first}` });
  }
  ctx.on('close', () => {
    if (!finished) {
      warn('Browser closed.');
      if (LOGIN_MODE) {
        log('Login window closed. Session saved. Next: run a dry run (npm run wellfound:dry-run).');
        finish('SUCCEEDED', 0, { reason: 'login' });
      } else {
        finish('FAILED', 1, { error: 'browser window was closed during the run' });
      }
    }
  });
  mainPage = ctx.pages()[0] || (await ctx.newPage());

  if (LOGIN_MODE) {
    await mainPage.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    log('Chrome is open — log in to Wellfound, then CLOSE the browser window. The session is saved automatically.');
    return; // ctx 'close' handler finishes
  }

  if (TRACE) await ctx.tracing.start({ screenshots: true, snapshots: true }).catch((e) => warn(`tracing unavailable: ${e.message}`));
  await ctx.exposeBinding('__aaGemini', async (_source, prompt) => geminiNode(prompt));

  const deadline = Date.now() + MAX_RUNTIME_MS;
  let lastActivity = Date.now();
  let searchIdx = 0;
  let pendingJob = null;
  let exhausted = 0; // times the page script ran out of matching jobs since the last application
  let reloadedFeed = false;
  let sessionVerified = false; // nothing is injected until the logged-in check passes
  const skillVocab = String(cfg.CV.skills || '').split(',').map((s) => s.trim()).filter(Boolean);
  const matchSkills = (t) => { const l = ` ${String(t).toLowerCase()} `; return skillVocab.filter((s) => l.includes(s.toLowerCase())).join('; '); };

  function buildInjection() {
    const { buildConsoleScript } = require('./build-wellfound-paste');
    const src = buildConsoleScript({ live: LIVE, max: Math.max(1, TARGET - stats.submitted), dailyCap: DAILY_CAP });
    const payload = { CV: cfg.CV, rules: cfg.rules, appliedUrls: lib.appliedUrls() }; // re-read from the CSV on every injection
    return `(async () => {
      if (window.__aaBusy) return; window.__aaBusy = true;
      window.__APPLY_CONFIG = ${JSON.stringify(payload)};
      try { await ${src}
      } catch (e) { console.log('[auto-apply] ✖ SCRIPT_ERROR ' + String((e && e.stack) || e).slice(0, 600)); }
      finally { window.__aaBusy = false; }
    })()`;
  }
  const inject = (p) => p.evaluate(buildInjection()).catch((e) => { if (!BENIGN.test(e.message)) warn(`injection failed: ${e.message.split('\n')[0]}`); });
  const pushAppliedUrls = (p) => p.evaluate((urls) => { if (window.__APPLY_CONFIG) window.__APPLY_CONFIG.appliedUrls = urls; }, lib.appliedUrls()).catch(() => {});
  const isBusy = (p) => p.evaluate('!!window.__aaBusy').catch(() => false);

  function wire(page) {
    page.on('pageerror', (err) => {
      stats.pageErrors++;
      if (stats.pageErrors <= 20) emit('PAGEERR', String(err.message || err).split('\n')[0].slice(0, 300));
      else if (stats.pageErrors === 21) emit('PAGEERR', '(further page errors suppressed)');
    });
    page.on('crash', () => {
      stats.errors++;
      error(`Page crashed: ${page.url()}`);
      capture(page, 'page-crash', { url: page.url() });
    });
    page.on('console', (msg) => {
      const text = msg.text();
      if (!/auto-apply/.test(text)) return;
      lastActivity = Date.now();
      const clean = text.replace(/^%c\[auto-apply\]\s*\S*\s*/, '').replace(/^\[auto-apply\]\s*/, '').trim();
      emit('PAGE', clean.slice(0, 400));

      if (/SCRIPT_ERROR/.test(clean)) {
        stats.errors++;
        capture(page, 'script-error', { message: clean.slice(0, 600), job: pendingJob });
      } else if (/no apply modal found/.test(clean)) {
        stats.skipped++;
        capture(page, 'no-apply-modal', { job: pendingJob });
      } else if (/no Send button found/.test(clean)) {
        stats.skipped++;
        capture(page, 'no-submit-button', { job: pendingJob });
      } else if (/Send button is disabled|location-blocked/.test(clean)) {
        stats.skipped++;
        if (/disabled/.test(clean)) capture(page, 'submit-disabled', { job: pendingJob });
      }

      const m = clean.match(/▶ (?:Applying|Opening): (.+)/);
      if (m) {
        const [main, link, cardSalary] = m[1].split(' | ');
        const atParts = main.split(' @ ');
        const company = atParts.length > 1 ? atParts.pop() : ''; // company is after the LAST ' @ '
        pendingJob = { title: atParts.join(' @ ').trim(), company: (company || '').replace(/^\?$/, '').trim(), link: (link || '').trim(), salary: (cardSalary || '').trim(), skills: '', jd: '' };
        setTimeout(() => {
          page.evaluate(() => {
            const q = (s) => document.querySelector(s)?.textContent?.trim() || '';
            const modal = document.querySelector('[data-test="JobListingSlideIn"], [role="dialog"]') || document;
            const mq = (s) => modal.querySelector(s)?.textContent?.trim() || '';
            const titleMatch = document.title.match(/ at (.+?) • /i) || document.title.match(/ at (.+?) \|/i);
            const rawComp = (modal.innerText || '').match(/Apply to (.{2,60})/)?.[1]?.trim() || (titleMatch ? titleMatch[1].trim() : '') ||
              mq('a[href^="/company/"] h2') || mq('a[href^="/company/"]');
            return {
              company: (rawComp || '').split('\n')[0].replace(/\s+/g, ' ').replace(/(?:Actively\s*Hiring|Promoted|\d+-\d+\s*Employees).*/i, '').trim(),
              salary: mq('[data-testid*="salary" i]') || ((modal.innerText || '').match(/(?:₹|\$)\s?[\d,.]+(?:\s?[–-]\s?(?:₹|\$)?[\d,.]+)?[^\n]{0,30}/) || [''])[0],
              jd: (mq('[class*="description" i]') || q('[class*="jobDescription" i]')).slice(0, 1200),
            };
          }).then((d) => {
            if (!d || !pendingJob) return;
            pendingJob.company = pendingJob.company || d.company;
            pendingJob.salary = pendingJob.salary || d.salary;
            pendingJob.jd = d.jd;
            pendingJob.skills = matchSkills(pendingJob.title + ' ' + d.jd);
          }).catch(() => {});
        }, 2000);
      }

      if (/All search pages exhausted/.test(clean)) exhausted++;

      if (SUBMITTED_RE.test(clean)) {
        exhausted = 0;
        reloadedFeed = false;
        stats.submitted++;
        if (LIVE) {
          refreshToday();
          try { lib.appendCsvRow(pendingJob || { title: 'unknown' }); } catch (e) { stats.errors++; error('CSV write failed: ' + e.message); }
          todayCount++;
          pushAppliedUrls(page);
        }
        log(`==> ${stats.submitted}/${TARGET} this run${LIVE ? ` (${todayCount}/${DAILY_CAP} today IST)` : ' (dry run: simulated, nothing sent)'}`);
        pendingJob = null;
      }
    });
    page.on('load', async () => {
      if (!sessionVerified || !/wellfound\.com/.test(page.url())) return;
      lastActivity = Date.now();
      await inject(page); // navigation mid-run is normal
    });
  }
  ctx.pages().forEach(wire);
  ctx.on('page', wire);

  try {
    await mainPage.goto(SEARCHES[0], { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    error(`Could not open ${SEARCHES[0]}: ${e.message.split('\n')[0]}`);
    await capture(mainPage, 'navigation-failed', { url: SEARCHES[0] });
    return finish('FAILED', 1, { error: 'navigation failed' });
  }
  await mainPage.waitForTimeout(8000);

  // Fail fast when the session is gone or a bot check is shown: nothing below can work.
  const state = await mainPage.evaluate(() => {
    const body = (document.body && document.body.innerText) || '';
    const jobLinks = [...document.querySelectorAll('a[href*="/jobs/"]')].filter((a) => /\/jobs\/\d/.test(a.getAttribute('href') || '')).length;
    const password = !!document.querySelector('input[type="password"]');
    // Logged-in nav links to your applications/profile; the public (logged-out) /jobs feed shows Log in / Sign up instead.
    const loggedIn = !!document.querySelector('a[href^="/jobs/applications"], a[href^="/profile/edit"], a[href^="/jobs/messages"]');
    const loginLinks = !!document.querySelector('a[href="/login"], a[href^="/login?"], a[href*="/jobs/signup"], a[href*="/join"]');
    return { path: location.pathname, body: body.slice(0, 4000), jobLinks, password, loggedIn, loginLinks };
  }).catch(() => ({ path: '', body: '', jobLinks: 0, password: false, loggedIn: false, loginLinks: false }));
  const botCheck = !state.loggedIn && /verify you are human|are you a robot|captcha|access (is )?denied|unusual activity/i.test(state.body);
  const loggedOut = /^\/(login|join|signup|users\/sign_in)/.test(state.path) || state.password ||
    (!state.loggedIn && (state.loginLinks || state.jobLinks === 0));
  if (botCheck || loggedOut) {
    const reason = botCheck ? 'bot-check' : 'logged-out';
    await capture(mainPage, reason, { path: state.path, jobLinks: state.jobLinks });
    error(botCheck
      ? 'Wellfound is showing a bot check. Open it with `npm run wellfound:login`, solve the check by hand, close the window, then retry later.'
      : 'Wellfound session is logged out. Fix: npm run wellfound:login (log in in the window that opens, then close it), then start a dry run again.');
    return finish('FAILED', 3, { reason, error: botCheck ? 'bot check shown' : 'logged out' });
  }
  log(`Session OK (logged in): ${state.jobLinks} job links on ${state.path}.`);
  sessionVerified = true;
  await inject(mainPage);

  // Supervisor: re-inject when idle, close stray tabs, stop on target/time/idle.
  let lastHousekeeping = Date.now();
  while (stats.submitted < TARGET && Date.now() < deadline && !finished) {
    await new Promise((r) => setTimeout(r, 3000));
    if (LIVE && refreshToday() >= DAILY_CAP) { log(`Daily cap ${DAILY_CAP} reached.`); break; }
    if (Date.now() - lastHousekeeping < 45000) continue;
    lastHousekeeping = Date.now();

    let anyBusy = false;
    for (const p of ctx.pages()) {
      if (await isBusy(p)) anyBusy = true;
      else if (p !== mainPage) await p.close().catch(() => {});
    }
    if (anyBusy) continue;
    if (exhausted > 0) {
      if (reloadedFeed) { log('No more matching jobs in the feed right now (checked again after a reload).'); break; }
      log('Feed exhausted; reloading it once for fresh jobs.');
      reloadedFeed = true;
      exhausted = 0;
      await mainPage.goto(SEARCHES[searchIdx], { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      continue;
    }
    if (Date.now() - lastActivity > IDLE_ROTATE_MS) {
      searchIdx++;
      if (searchIdx >= SEARCHES.length) { log('No more matching jobs right now (all searches exhausted).'); break; }
      log(`Rotating to next search: ${SEARCHES[searchIdx]}`);
      await mainPage.goto(SEARCHES[searchIdx], { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    } else {
      await inject(mainPage); // continue with the next jobs on this page
    }
  }

  log(`Finished: ${stats.submitted}/${TARGET} ${LIVE ? 'submitted' : 'simulated (dry run, nothing sent)'}, ${stats.skipped} skipped, ${stats.errors} errors.`);
  await finish(stats.errors > 0 && stats.submitted === 0 ? 'FAILED' : 'SUCCEEDED', stats.errors > 0 && stats.submitted === 0 ? 1 : 0);
})().catch((e) => onUnexpected('fatal', e));
