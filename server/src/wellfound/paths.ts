import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

/**
 * Filesystem layout for the Wellfound integration. The repo root is the directory that holds
 * scripts/wellfound (host: the checkout; Docker: /app, where scripts/, logs/, diagnostics/ and
 * wellfound_autoApply/ are bind-mounted). Every path can be overridden by env for tests.
 */

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

let cachedRoot: string | null = null;

export function rootDir(): string {
  if (process.env.WELLFOUND_ROOT) return path.resolve(process.env.WELLFOUND_ROOT);
  if (cachedRoot) return cachedRoot;
  const candidates = [path.resolve(__dirname, '../../..'), path.resolve(process.cwd()), path.resolve(process.cwd(), '..'), '/app'];
  cachedRoot = candidates.find((c) => isDir(path.join(c, 'scripts', 'wellfound'))) || candidates[0];
  return cachedRoot;
}

export const scriptsDir = () => path.join(rootDir(), 'scripts', 'wellfound');
export const submoduleDir = () => path.join(rootDir(), 'wellfound_autoApply');
export const logsDir = () => process.env.WELLFOUND_LOGS_DIR || path.join(rootDir(), 'logs', 'wellfound');
export const diagnosticsRoot = () => process.env.WELLFOUND_DIAGNOSTICS_DIR || path.join(rootDir(), 'diagnostics', 'wellfound');
export const runnerScript = () => path.join(scriptsDir(), 'runner.js');
export const runnerConfigFile = () => process.env.WELLFOUND_RUNNER_CONFIG || path.join(scriptsDir(), 'out', 'runner-config.json');
export const envFile = () => process.env.WELLFOUND_ENV_FILE || path.join(rootDir(), '.env');

export function csvFile(): string {
  if (process.env.WELLFOUND_APPLICATIONS_CSV) return process.env.WELLFOUND_APPLICATIONS_CSV;
  const candidates = [path.join(submoduleDir(), 'applications.csv'), path.join(rootDir(), 'applications.csv')];
  return candidates.find((c) => fs.existsSync(c)) || candidates[0];
}

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
export const isValidRunId = (id: unknown): id is string => typeof id === 'string' && RUN_ID_RE.test(id);

export const runLogPath = (runId: string) => path.join(logsDir(), `${runId}.log`);
export const runDiagnosticsDir = (runId: string) => path.join(diagnosticsRoot(), runId);

/** Paths stored on WellfoundRun rows are repo-relative so host and container agree on them. */
export const toRepoRelative = (p: string) => {
  const rel = path.relative(rootDir(), p);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p;
};

/** Loads a CommonJS module from scripts/wellfound (shared with the host runner and agent). */
export function requireScript<T = any>(name: string): T {
  const req = createRequire(path.join(scriptsDir(), 'package-anchor.js'));
  return req(path.join(scriptsDir(), name)) as T;
}

/** Subset of scripts/wellfound/lib.js used by the server. */
export interface ScriptsLib {
  DEFAULT_DAILY_CAP: number;
  buildCv(profile: Record<string, unknown>): Record<string, unknown>;
  injectDryRun(src: string, dryRun: boolean): string;
  loadProfileDefaults(): Record<string, any>;
  legacyEnvProfile(): Record<string, any>;
  findChrome(): string | null;
}

export const scriptsLib = () => requireScript<ScriptsLib>('lib.js');
