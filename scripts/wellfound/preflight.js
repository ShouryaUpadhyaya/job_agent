/**
 * Environment checklist for the Wellfound runner. Used by `runner.js --preflight`, the host agent
 * and (in local mode) the server. Every failed check carries the command that fixes it.
 */
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

function check(id, label, ok, detail, fix, required = true) {
  return { id, label, ok: !!ok, required, detail: detail || '', fix: ok ? '' : fix || '' };
}

function preflight({ profileDir = lib.PROFILE_DIR } = {}) {
  const checks = [];

  const major = parseInt(process.versions.node.split('.')[0], 10);
  checks.push(check('node', 'Node.js 18+', major >= 18, `node ${process.versions.node}`, 'Install Node.js 18 or newer.'));

  const pw = lib.requireFromSub('playwright-core');
  checks.push(check('playwright', 'Playwright installed', !!pw, pw ? 'playwright-core found' : 'playwright-core not found in wellfound_autoApply/node_modules',
    'Run: npm run wellfound:install'));

  const chrome = lib.findChrome();
  checks.push(check('chrome', 'Google Chrome found', !!chrome, chrome || 'no Chrome binary in the usual locations',
    'Install Google Chrome, or set CHROME_PATH to its binary (e.g. /opt/google/chrome/chrome). In Docker there is no Chrome: run `npm run wellfound:agent` on the host.'));

  if (process.platform === 'linux') {
    const display = process.env.DISPLAY || '';
    checks.push(check('display', 'Display available', !!display,
      display ? `DISPLAY=${display}${process.env.WAYLAND_DISPLAY ? ` (Wayland: ${process.env.WAYLAND_DISPLAY})` : ''}` : 'DISPLAY is not set',
      'Start the agent/runner from a terminal inside your desktop session so DISPLAY is inherited (or export DISPLAY=:1). Chrome runs headed (off-screen) because Wellfound blocks headless browsers.'));
  } else {
    checks.push(check('display', 'Display available', true, `${process.platform}: desktop session assumed`));
  }

  let sessionOk = false;
  let sessionDetail = `${profileDir} does not exist`;
  try {
    if (fs.statSync(profileDir).isDirectory()) {
      sessionOk = fs.existsSync(path.join(profileDir, 'Default'));
      sessionDetail = sessionOk ? `${path.relative(lib.ROOT, profileDir)} present (login is verified when the run opens Wellfound)` : `${profileDir} has no Default profile yet`;
    }
  } catch (e) {}
  checks.push(check('session', 'Saved Wellfound session', sessionOk, sessionDetail,
    'Run: npm run wellfound:login — log in in the Chrome window that opens, then close it.'));

  const lock = path.join(profileDir, 'SingletonLock');
  let locked = false;
  try { fs.lstatSync(lock); locked = true; } catch (e) {}
  checks.push(check('profile-free', 'Chrome profile not in use', !locked,
    locked ? 'SingletonLock present: another Chrome (login window or a previous run) may still be open' : 'not locked',
    'Close the Wellfound Chrome window (or wait for the running job to end). If none is open, delete the stale SingletonLock file in the profile dir.', false));

  try {
    const { buildConsoleScript } = require('./build-wellfound-paste');
    const src = buildConsoleScript({ live: false, max: 1 });
    const ok = /DRY_RUN: true/.test(src);
    checks.push(check('build', 'Console script builds (dry run)', ok, ok ? 'patched upstream script OK, DRY_RUN: true' : 'built script is not dry-run',
      'Run `npm run wellfound:zen` to see the build error; the upstream submodule may have changed.'));
  } catch (e) {
    checks.push(check('build', 'Console script builds (dry run)', false, e.message.split('\n')[0],
      'Run `npm run wellfound:zen` to see the build error. Make sure the wellfound_autoApply submodule is checked out (git submodule update --init).'));
  }

  let csvDirOk = false;
  try { fs.accessSync(path.dirname(lib.CSV_FILE), fs.constants.W_OK); csvDirOk = true; } catch (e) {}
  checks.push(check('csv', 'applications.csv writable', csvDirOk, path.relative(lib.ROOT, lib.CSV_FILE),
    'Make sure wellfound_autoApply/ exists and is writable by your user.'));

  const gemini = !!lib.envValue('GEMINI_KEY');
  checks.push(check('gemini', 'Gemini key (optional)', gemini, gemini ? 'configured (used from Node, never injected into the page)' : 'not set: template cover letters/answers are used',
    'Optional: set GEMINI_KEY in the root .env for tailored answers.', false));

  const ok = checks.every((c) => c.ok || !c.required);
  return { ok, checks, host: { platform: process.platform, node: process.versions.node } };
}

module.exports = { preflight };
