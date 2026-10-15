/**
 * Shared helpers for the Wellfound runner, build script and host agent.
 * Plain CommonJS with no dependencies, so the server (in Docker) and the host can both load it.
 */
const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = __dirname;
const ROOT = path.resolve(__dirname, '..', '..');
const SUB = path.join(ROOT, 'wellfound_autoApply');
const OUT_DIR = path.join(__dirname, 'out');
const LOGS_DIR = path.join(ROOT, 'logs', 'wellfound');
const DIAGNOSTICS_DIR = path.join(ROOT, 'diagnostics', 'wellfound');
const CSV_FILE = process.env.WELLFOUND_APPLICATIONS_CSV || path.join(SUB, 'applications.csv');
const PROFILE_DIR = process.env.WELLFOUND_PROFILE_DIR || path.join(SUB, '.wellfound-chrome-profile');
const RUNNER_CONFIG_FILE = path.join(OUT_DIR, 'runner-config.json');
const DEFAULT_DAILY_CAP = 25;

// ---------------------------------------------------------------- env files

function parseEnv(text) {
  const out = {};
  for (const line of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
      v = v.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function readEnvFile(file) {
  try {
    return parseEnv(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return {};
  }
}

/** process.env wins, then the root .env, then the legacy submodule .env. */
function envValue(key, fallback = '') {
  if (process.env[key]) return process.env[key];
  const rootEnv = readEnvFile(path.join(ROOT, '.env'));
  if (rootEnv[key]) return rootEnv[key];
  const subEnv = readEnvFile(path.join(SUB, '.env'));
  if (subEnv[key]) return subEnv[key];
  return fallback;
}

// ---------------------------------------------------------------- time (IST)

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDateKey(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO strings (new rows) or legacy host-local "M/D/YYYY, h:mm:ss AM" strings written in IST. */
function parseRunnerTimestamp(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (m) {
    const [, mo, da, yr, hRaw, mi, se, ampm] = m;
    let h = parseInt(hRaw, 10);
    if (ampm) {
      const pm = ampm.toUpperCase() === 'PM';
      if (h === 12) h = pm ? 12 : 0;
      else if (pm) h += 12;
    }
    return new Date(Date.UTC(+yr, +mo - 1, +da, h, +mi, se ? +se : 0) - IST_OFFSET_MS);
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Local ISO-8601 timestamp with the IST offset, e.g. 2026-10-15T14:02:11.120+05:30 */
function istIso(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().replace('Z', '+05:30');
}

// ---------------------------------------------------------------- CSV

/** Minimal RFC-4180 reader (quotes, escaped quotes, embedded newlines). */
function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

function readCsvRows(file = CSV_FILE) {
  if (!fs.existsSync(file)) return [];
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  return rows.slice(1).map((c) => ({ date: c[0] || '', site: c[1] || '', role: c[2] || '', company: c[3] || '', link: c[6] || '' }));
}

function countToday(rows, now = new Date()) {
  const today = istDateKey(now);
  return rows.filter((r) => {
    const d = parseRunnerTimestamp(r.date);
    return d && istDateKey(d) === today;
  }).length;
}

function appliedUrls(file = CSV_FILE) {
  const urls = new Set();
  for (const r of readCsvRows(file)) {
    const m = r.link.match(/https?:\/\/[^\s",|]+/);
    if (m) urls.add(m[0].trim());
  }
  return [...urls];
}

const csvRow = (vals) => vals.map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\s+/g, ' ').trim() + '"').join(',') + '\n';
const CSV_HEADER = ['Date', 'Site', 'Role', 'Company', 'CTC/Salary', 'Skills', 'Job Link', 'Job Description'];

function appendCsvRow(job, file = CSV_FILE) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, '\uFEFF' + csvRow(CSV_HEADER));
  fs.appendFileSync(file, csvRow([new Date().toISOString(), 'wellfound', job.title, job.company, job.salary, job.skills, job.link, job.jd]));
}

// ---------------------------------------------------------------- DRY_RUN injection

/**
 * Forces the console script's DRY_RUN flag to the requested value, whatever the source says.
 * Throws if the flag cannot be found, so a build can never silently fall back to live.
 */
function injectDryRun(src, dryRun) {
  const re = /DRY_RUN:\s*(true|false)/;
  if (!re.test(src)) throw new Error('DRY_RUN flag not found in the Wellfound console script');
  const out = src.replace(re, `DRY_RUN: ${dryRun ? 'true' : 'false'}`);
  const m = out.match(re);
  if (!m || m[1] !== String(!!dryRun)) throw new Error('DRY_RUN injection failed');
  return out;
}

function injectMax(src, max) {
  const re = /MAX_APPLICATIONS:\s*\d+/;
  if (!re.test(src)) throw new Error('MAX_APPLICATIONS not found in the Wellfound console script');
  return src.replace(re, `MAX_APPLICATIONS: ${Math.max(0, Math.floor(max))}`);
}

// ---------------------------------------------------------------- runner config (CV + rules)

function loadProfileDefaults() {
  try {
    return JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, 'profile-defaults.json'), 'utf8'));
  } catch (e) {
    return {};
  }
}

/** CV from the legacy wellfound_autoApply/.env (only used when the server has not generated a config). */
function legacyEnvProfile() {
  const E = readEnvFile(path.join(SUB, '.env'));
  const highlights = (E.HIGHLIGHTS || '').split('||').map((s) => s.trim()).filter(Boolean);
  return {
    name: E.NAME, email: E.EMAIL, phone: E.PHONE, location: E.LOCATION,
    currentRole: E.CURRENT_ROLE, company: E.COMPANY, education: E.EDUCATION,
    yearsOfExperience: E.YEARS_EXPERIENCE, skills: E.SKILLS, highlights: highlights.length ? highlights : undefined,
    noticePeriod: E.NOTICE_PERIOD, currentCTC: E.CURRENT_CTC, expectedCTC: E.EXPECTED_CTC, dob: E.DOB,
    gender: E.GENDER, workAuth: E.WORK_AUTH, github: E.GITHUB_URL, linkedin: E.LINKEDIN_URL, portfolio: E.PORTFOLIO_URL,
  };
}

function pick(...vals) {
  for (const v of vals) {
    if (Array.isArray(v) ? v.length : v != null && String(v).trim() !== '') return v;
  }
  return '';
}

/** Turns flat profile answers into the CV object the console script expects (same shape as upstream config.js). */
function buildCv(p) {
  const highlights = Array.isArray(p.highlights) ? p.highlights : String(p.highlights || '').split('||').map((s) => s.trim()).filter(Boolean);
  const skills = Array.isArray(p.skills) ? p.skills.join(', ') : String(p.skills || '');
  const links = [p.github && `GitHub: ${p.github}`, p.linkedin && `LinkedIn: ${p.linkedin}`, p.portfolio && `Portfolio: ${p.portfolio}`, p.x && `X: ${p.x}`]
    .filter(Boolean).join(' | ');
  return {
    name: p.name || '', email: p.email || '', phone: p.phone || '', location: p.location || '',
    currentRole: p.currentRole || '', company: p.company || '', education: p.education || '',
    yearsOfExperience: p.yearsOfExperience || '', skills, highlights,
    noticePeriod: p.noticePeriod || '', currentCTC: p.currentCTC || '', expectedCTC: p.expectedCTC || '',
    currentSalary: p.currentCTC ? `${p.currentCTC} LPA` : '', expectedSalary: p.expectedCTC ? `${p.expectedCTC} LPA` : '',
    dob: p.dob || '', gender: p.gender || '', workAuth: p.workAuth || '',
    github: p.github || '', linkedin: p.linkedin || '', portfolio: p.portfolio || '', x: p.x || '', links,
    remoteOk: p.remoteOk || 'Yes, I am set up for remote work and also open to hybrid or on-site roles.',
    relocate: p.relocate || (p.location ? `Yes, I am open to relocation. I am currently based in ${p.location}.` : 'Yes, I am open to relocation.'),
    startDate: p.noticePeriod ? `I can start within ${p.noticePeriod}.` : 'I can start soon; happy to discuss timing.',
  };
}

const DEFAULT_RULES = { dailyCap: DEFAULT_DAILY_CAP, autoTickTerms: true, maxRuntimeMinutes: 100 };

/**
 * The runner config: server-generated file (DB profile is the source of truth) when present,
 * otherwise legacy .env + resume defaults so the CLI still works standalone.
 */
function loadRunnerConfig(file) {
  const target = file || RUNNER_CONFIG_FILE;
  if (fs.existsSync(target)) {
    const cfg = JSON.parse(fs.readFileSync(target, 'utf8'));
    return { CV: cfg.CV || buildCv({}), rules: { ...DEFAULT_RULES, ...(cfg.rules || {}) }, source: target };
  }
  const defaults = loadProfileDefaults();
  const legacy = legacyEnvProfile();
  const merged = {};
  for (const k of new Set([...Object.keys(defaults), ...Object.keys(legacy)])) merged[k] = pick(legacy[k], defaults[k]);
  return { CV: buildCv(merged), rules: { ...DEFAULT_RULES }, source: 'legacy .env + profile-defaults.json' };
}

// ---------------------------------------------------------------- environment checks

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

function findChrome() {
  return CHROME_CANDIDATES.find((p) => {
    try { return fs.statSync(p).isFile(); } catch (e) { return false; }
  }) || null;
}

/** Playwright lives in wellfound_autoApply/node_modules (npm run wellfound:install). */
function requireFromSub(mod) {
  try {
    return require(require.resolve(mod, { paths: [SUB, SCRIPTS_DIR, ROOT] }));
  } catch (e) {
    return null;
  }
}

function isValidRunId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(id);
}

module.exports = {
  ROOT, SUB, SCRIPTS_DIR, OUT_DIR, LOGS_DIR, DIAGNOSTICS_DIR, CSV_FILE, PROFILE_DIR, RUNNER_CONFIG_FILE, DEFAULT_DAILY_CAP, DEFAULT_RULES,
  parseEnv, readEnvFile, envValue,
  istDateKey, istIso, parseRunnerTimestamp,
  parseCsv, readCsvRows, countToday, appliedUrls, appendCsvRow, csvRow,
  injectDryRun, injectMax,
  loadProfileDefaults, legacyEnvProfile, buildCv, loadRunnerConfig,
  findChrome, requireFromSub, isValidRunId,
};
