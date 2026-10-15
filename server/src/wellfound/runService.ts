import fs from 'fs';
import path from 'path';
import { spawn as nodeSpawn, ChildProcess } from 'child_process';
import { WellfoundRun } from '@prisma/client';
import { prisma } from '../db';
import {
  isValidRunId,
  logsDir,
  rootDir,
  runDiagnosticsDir,
  runLogPath,
  runnerScript,
  requireScript,
  scriptsLib,
  toRepoRelative,
  csvFile,
} from './paths';
import { currentRunnerConfig, loadWellfoundSettings, writeRunnerConfigFile } from './config';
import { countTodayApplications, readWellfoundCsv, syncWellfoundApplicationsFromCsv } from '../connectors/wellfoundAutoApplyService';
import { istDateKey } from '../lib/time';

/**
 * Wellfound run lifecycle. Each run is a WellfoundRun row plus an append-only log file at
 * logs/wellfound/<runId>.log and diagnostics under diagnostics/wellfound/<runId>/.
 *
 * Runs execute through an executor: "local" spawns scripts/wellfound/runner.js on this machine
 * (server on the host, Chrome available); "agent" proxies to the host agent (server in Docker).
 */

export type RunMode = 'DRY_RUN' | 'LIVE';
export const TERMINAL_STATUSES = ['SUCCEEDED', 'FAILED', 'STOPPED'];
export const ACTIVE_STATUSES = ['STARTING', 'RUNNING'];

export interface PreflightCheck {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string;
  fix: string;
}
export interface PreflightResult {
  ok: boolean;
  executor: 'local' | 'agent';
  checks: PreflightCheck[];
}

export interface RunSummary {
  status?: string;
  submitted?: number;
  skipped?: number;
  errors?: number;
  diagnostics?: number;
  error?: string;
  reason?: string;
  [k: string]: unknown;
}

export interface ExitInfo {
  exitCode: number | null;
  signal?: string | null;
  summary?: RunSummary | null;
  error?: string | null;
}

export interface StartSpec {
  runId: string;
  mode: RunMode;
  visible: boolean;
  max: number;
  dailyCap: number;
  trace: boolean;
  config: unknown;
}

export interface Executor {
  kind: 'local' | 'agent';
  preflight(): Promise<PreflightCheck[]>;
  start(spec: StartSpec, onExit: (info: ExitInfo) => void): Promise<void>;
  stop(runId: string): Promise<boolean>;
  /** null = the executor does not know this run (e.g. it restarted). */
  status(runId: string): Promise<{ active: boolean; exit?: ExitInfo } | null>;
  readLog(runId: string, offset: number): Promise<{ text: string; nextOffset: number }>;
}

export class RunError extends Error {
  constructor(message: string, public status = 400, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

type SpawnFn = typeof nodeSpawn;
type FetchFn = typeof fetch;

interface RunServiceOptions {
  spawn: SpawnFn;
  fetch: FetchFn;
  executor: 'auto' | 'local' | 'agent';
  agentUrl: string;
  agentToken: string;
  localPreflight: () => { ok: boolean; checks: PreflightCheck[] };
  pollMs: number;
  syncAfterLive: boolean;
}

const options: RunServiceOptions = {
  spawn: nodeSpawn,
  fetch: (...args) => fetch(...args),
  executor: (process.env.WELLFOUND_EXECUTOR as RunServiceOptions['executor']) || 'auto',
  agentUrl: process.env.WELLFOUND_AGENT_URL || '',
  agentToken: process.env.WELLFOUND_AGENT_TOKEN || '',
  localPreflight: () => requireScript<{ preflight: () => { ok: boolean; checks: PreflightCheck[] } }>('preflight.js').preflight(),
  pollMs: 2000,
  syncAfterLive: true,
};

let executorInstance: Executor | null = null;

/** Test hook / runtime reconfiguration. */
export function configureRunService(overrides: Partial<RunServiceOptions>) {
  Object.assign(options, overrides);
  executorInstance = null;
}

// ---------------------------------------------------------------- log helpers

function stamp(level: string, msg: string): string {
  const ts = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace('Z', '+05:30');
  return msg.split(/\r?\n/).filter(Boolean).map((l) => `${ts} ${level.padEnd(7)} ${l}\n`).join('');
}

function appendLocalLog(runId: string, level: string, msg: string) {
  try {
    fs.mkdirSync(logsDir(), { recursive: true });
    fs.appendFileSync(runLogPath(runId), stamp(level, msg));
  } catch (e: any) {
    console.warn(`[wellfound] log write failed: ${e.message}`);
  }
}

function lineSplitter(onLine: (line: string) => void) {
  let buf = '';
  return {
    push(chunk: Buffer | string) {
      buf += chunk.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i).replace(/\r$/, ''));
        buf = buf.slice(i + 1);
      }
    },
    flush() {
      if (buf) onLine(buf);
      buf = '';
    },
  };
}

export function parseSummaryLine(line: string): RunSummary | null {
  const m = line.match(/ SUMMARY\s+(\{.*\})\s*$/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function readLocalLog(runId: string, offset: number): { text: string; nextOffset: number } | null {
  const file = runLogPath(runId);
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return null;
  }
  const start = Math.min(Math.max(0, offset), size);
  const len = Math.min(size - start, 512 * 1024);
  if (len <= 0) return { text: '', nextOffset: start };
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buf, 0, len, start);
  } finally {
    fs.closeSync(fd);
  }
  return { text: buf.toString('utf8'), nextOffset: start + len };
}

// ---------------------------------------------------------------- local executor

function runnerArgs(spec: StartSpec, configFile: string | null): string[] {
  const args = [runnerScript(), 'wellfound', `--run-id=${spec.runId}`, `--diagnostics-dir=${runDiagnosticsDir(spec.runId)}`, `--max=${spec.max}`, `--daily-cap=${spec.dailyCap}`];
  args.push(spec.mode === 'LIVE' ? '--live' : '--dry-run');
  if (spec.visible) args.push('--visible');
  if (spec.trace) args.push('--trace');
  if (configFile) args.push(`--config=${configFile}`);
  return args;
}

function statusFromExit(info: ExitInfo): string {
  if (info.summary?.status && TERMINAL_STATUSES.includes(info.summary.status)) return info.summary.status;
  if (info.exitCode === 0) return 'SUCCEEDED';
  if (info.exitCode === 130 || info.signal === 'SIGTERM' || info.signal === 'SIGINT') return 'STOPPED';
  return 'FAILED';
}

class LocalExecutor implements Executor {
  kind = 'local' as const;
  private children = new Map<string, ChildProcess>();

  async preflight(): Promise<PreflightCheck[]> {
    const result = options.localPreflight();
    return [
      { id: 'executor', label: 'Runs on this machine', ok: true, required: true, detail: 'Chrome is available to the server, so it starts the runner directly.', fix: '' },
      ...result.checks,
    ];
  }

  async start(spec: StartSpec, onExit: (info: ExitInfo) => void): Promise<void> {
    fs.mkdirSync(runDiagnosticsDir(spec.runId), { recursive: true });
    const configFile = writeRunnerConfigFile(spec.config as any);
    const args = runnerArgs(spec, configFile);
    appendLocalLog(spec.runId, 'SERVER', `starting runner: node ${args.map((a) => (path.isAbsolute(a) ? path.relative(rootDir(), a) : a)).join(' ')}`);

    let summary: RunSummary | null = null;
    let spawnError: string | null = null;
    const child = options.spawn(process.execPath, args, { cwd: rootDir(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.children.set(spec.runId, child);
    const file = runLogPath(spec.runId);
    const write = (text: string) => {
      try {
        fs.appendFileSync(file, text);
      } catch {
        /* disk full etc. — keep the run going */
      }
    };
    const out = lineSplitter((line) => {
      summary = parseSummaryLine(line) || summary;
      write(line + '\n');
    });
    const err = lineSplitter((line) => {
      if (line.trim()) write(stamp('STDERR', line));
    });
    child.stdout?.on('data', (c) => out.push(c));
    child.stderr?.on('data', (c) => err.push(c));

    let exited = false;
    const done = (info: ExitInfo) => {
      if (exited) return;
      exited = true;
      out.flush();
      err.flush();
      this.children.delete(spec.runId);
      onExit({ ...info, summary, error: info.error || spawnError });
    };
    child.on('error', (e) => {
      spawnError = `could not start the runner: ${e.message}`;
      write(stamp('ERROR', spawnError));
      // 'close' may not follow a spawn failure
      setTimeout(() => done({ exitCode: null, error: spawnError }), 50);
    });
    child.on('close', (code, signal) => done({ exitCode: code, signal }));
  }

  async stop(runId: string): Promise<boolean> {
    const child = this.children.get(runId);
    if (!child) return false;
    appendLocalLog(runId, 'SERVER', 'stop requested');
    child.kill('SIGTERM');
    setTimeout(() => {
      if (this.children.get(runId) === child) child.kill('SIGKILL');
    }, 15000).unref();
    return true;
  }

  async status(runId: string) {
    return this.children.has(runId) ? { active: true } : null;
  }

  async readLog(runId: string, offset: number) {
    return readLocalLog(runId, offset) || { text: '', nextOffset: offset };
  }
}

// ---------------------------------------------------------------- agent executor

class AgentExecutor implements Executor {
  kind = 'agent' as const;
  private watchers = new Map<string, NodeJS.Timeout>();

  private async call(pathname: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}) {
    if (!options.agentUrl) throw new RunError('WELLFOUND_AGENT_URL is not set', 503);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), init.timeoutMs ?? 10000);
    try {
      const res = await options.fetch(options.agentUrl.replace(/\/$/, '') + pathname, {
        method: init.method || 'GET',
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.agentToken ? { 'x-agent-token': options.agentToken } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: ac.signal,
      });
      const data: any = await res.json().catch(() => ({}));
      return { status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  async preflight(): Promise<PreflightCheck[]> {
    const fixStart =
      'Start the agent on the host: `npm run wellfound:agent:docker` (server in Docker; needs WELLFOUND_AGENT_TOKEN in the root .env) or `npm run wellfound:agent` (server on the host).';
    let health;
    try {
      health = await this.call('/health', { timeoutMs: 3000 });
    } catch (e: any) {
      return [{ id: 'agent', label: 'Host agent reachable', ok: false, required: true, detail: `${options.agentUrl || '(WELLFOUND_AGENT_URL unset)'}: ${e.name === 'AbortError' ? 'timeout' : e.message}`, fix: fixStart }];
    }
    if (health.status !== 200) {
      return [{ id: 'agent', label: 'Host agent reachable', ok: false, required: true, detail: `HTTP ${health.status}`, fix: fixStart }];
    }
    const checks: PreflightCheck[] = [
      { id: 'agent', label: 'Host agent reachable', ok: true, required: true, detail: `${options.agentUrl} (DISPLAY=${health.data.display || 'unset'})`, fix: '' },
    ];
    const pf = await this.call('/preflight', { timeoutMs: 15000 });
    if (pf.status === 401) {
      checks.push({ id: 'agent-token', label: 'Agent token matches', ok: false, required: true, detail: 'agent rejected the token',
        fix: 'Set the same WELLFOUND_AGENT_TOKEN in the root .env for both the agent and the server (docker compose reads it), then restart both.' });
      return checks;
    }
    checks.push(...((pf.data?.checks as PreflightCheck[]) || []));
    const logsVisible = fs.existsSync(path.dirname(logsDir()));
    checks.push({ id: 'log-mount', label: 'Run logs visible to the server', ok: logsVisible, required: false,
      detail: logsVisible ? `${toRepoRelative(logsDir())}` : 'logs/ is not mounted; logs are fetched through the agent instead',
      fix: 'Mount ./logs and ./diagnostics into the server container (see docker-compose.yml) to see screenshots in the UI.' });
    return checks;
  }

  async start(spec: StartSpec, onExit: (info: ExitInfo) => void): Promise<void> {
    const res = await this.call('/runs', {
      method: 'POST',
      body: { runId: spec.runId, mode: spec.mode, visible: spec.visible, max: spec.max, dailyCap: spec.dailyCap, trace: spec.trace, config: spec.config, confirmLive: spec.mode === 'LIVE' },
      timeoutMs: 30000,
    });
    if (res.status !== 202) {
      throw new RunError(res.data?.error || `agent refused the run (HTTP ${res.status})`, res.status === 412 ? 412 : 502, res.data?.preflight ? { preflight: res.data.preflight } : {});
    }
    this.watch(spec.runId, onExit);
  }

  watch(runId: string, onExit: (info: ExitInfo) => void) {
    if (this.watchers.has(runId)) return;
    let failures = 0;
    const tick = async () => {
      try {
        const res = await this.call(`/runs/${runId}`, { timeoutMs: 5000 });
        failures = 0;
        if (res.status === 404) {
          this.unwatch(runId);
          onExit({ exitCode: null, error: 'the host agent no longer knows this run (agent restarted?)' });
          return;
        }
        const run = res.data?.run;
        if (run && run.status !== 'RUNNING') {
          this.unwatch(runId);
          onExit({ exitCode: run.exitCode ?? null, signal: run.signal, summary: run.summary, error: run.error });
        }
      } catch {
        // agent briefly unreachable: keep polling; give up after ~10 minutes
        if (++failures > (10 * 60 * 1000) / options.pollMs) {
          this.unwatch(runId);
          onExit({ exitCode: null, error: 'lost contact with the host agent' });
        }
      }
    };
    this.watchers.set(runId, setInterval(tick, options.pollMs));
  }

  private unwatch(runId: string) {
    const t = this.watchers.get(runId);
    if (t) clearInterval(t);
    this.watchers.delete(runId);
  }

  async stop(runId: string): Promise<boolean> {
    const res = await this.call(`/runs/${runId}/stop`, { method: 'POST' });
    return res.status === 202;
  }

  async status(runId: string) {
    try {
      const res = await this.call(`/runs/${runId}`, { timeoutMs: 5000 });
      if (res.status === 404) return null;
      const run = res.data?.run;
      if (!run) return null;
      return run.status === 'RUNNING'
        ? { active: true }
        : { active: false, exit: { exitCode: run.exitCode ?? null, signal: run.signal, summary: run.summary, error: run.error } };
    } catch {
      return { active: true }; // unreachable: don't declare it dead
    }
  }

  async readLog(runId: string, offset: number) {
    const local = readLocalLog(runId, offset); // logs/ is bind-mounted into the container
    if (local) return local;
    try {
      const res = await this.call(`/runs/${runId}/log?offset=${offset}`, { timeoutMs: 5000 });
      if (res.status === 200) return { text: String(res.data.text || ''), nextOffset: Number(res.data.nextOffset) || offset };
    } catch {
      /* fall through */
    }
    return { text: '', nextOffset: offset };
  }
}

// ---------------------------------------------------------------- service

export function resolveExecutorKind(): 'local' | 'agent' {
  if (options.executor === 'local' || options.executor === 'agent') return options.executor;
  let chrome: string | null = null;
  try {
    chrome = scriptsLib().findChrome();
  } catch {
    chrome = null;
  }
  if (chrome) return 'local';
  return options.agentUrl ? 'agent' : 'local';
}

export function getExecutor(): Executor {
  const kind = resolveExecutorKind();
  if (!executorInstance || executorInstance.kind !== kind) {
    executorInstance = kind === 'agent' ? new AgentExecutor() : new LocalExecutor();
  }
  return executorInstance;
}

export async function runPreflight(): Promise<PreflightResult> {
  const executor = getExecutor();
  let checks: PreflightCheck[];
  try {
    checks = await executor.preflight();
  } catch (e: any) {
    checks = [{ id: 'preflight', label: 'Preflight', ok: false, required: true, detail: e.message, fix: 'See the server log.' }];
  }
  return { ok: checks.every((c) => c.ok || !c.required), executor: executor.kind, checks };
}

export async function wellfoundStats(now: Date = new Date()) {
  const { rules } = await loadWellfoundSettings();
  const rows = readWellfoundCsv();
  const today = countTodayApplications(rows, now);
  return {
    todayKey: istDateKey(now),
    today,
    dailyCap: rules.dailyCap,
    remainingToday: Math.max(0, rules.dailyCap - today),
    totalApplications: rows.length,
    csvPath: toRepoRelative(csvFile()),
  };
}

async function finalizeRun(runId: string, info: ExitInfo) {
  const run = await prisma.wellfoundRun.findUnique({ where: { id: runId } });
  if (!run || TERMINAL_STATUSES.includes(run.status)) return;
  const status = statusFromExit(info);
  const s = info.summary || {};
  const error =
    info.error || (typeof s.error === 'string' ? s.error : null) ||
    (status === 'FAILED' ? `runner exited with code ${info.exitCode ?? 'unknown'}${info.signal ? ` (${info.signal})` : ''}` : null);
  await prisma.wellfoundRun.update({
    where: { id: runId },
    data: {
      status,
      endedAt: new Date(),
      exitCode: info.exitCode ?? null,
      submittedCount: Number(s.submitted) || 0,
      skippedCount: Number(s.skipped) || 0,
      errorCount: Number(s.errors) || 0,
      error,
    },
  });
  if (getExecutor().kind === 'local') appendLocalLog(runId, 'SERVER', `run finished: ${status}${error ? ` — ${error}` : ''}`);
  if (run.mode === 'LIVE' && options.syncAfterLive && (Number(s.submitted) || 0) > 0) {
    try {
      const r = await syncWellfoundApplicationsFromCsv();
      if (getExecutor().kind === 'local') appendLocalLog(runId, 'SERVER', `synced CSV to the pipeline: ${r.newImported} new, ${r.alreadyTracked} already tracked`);
    } catch (e: any) {
      console.warn(`[wellfound] post-run sync failed: ${e.message}`);
    }
  }
}

/** Marks runs the executor no longer knows about as failed; resumes watching ones still running on the agent. */
export async function reconcileRuns(): Promise<void> {
  const active = await prisma.wellfoundRun.findMany({ where: { status: { in: ACTIVE_STATUSES } } });
  const executor = getExecutor();
  for (const run of active) {
    const st = await executor.status(run.id);
    if (!st) {
      await finalizeRun(run.id, { exitCode: null, error: 'interrupted: the server or agent restarted while the run was active' });
    } else if (!st.active && st.exit) {
      await finalizeRun(run.id, st.exit);
    } else if (st.active && executor instanceof AgentExecutor) {
      executor.watch(run.id, (info) => void finalizeRun(run.id, info));
    }
  }
}

export interface StartRunInput {
  mode?: unknown;
  visible?: unknown;
  max?: unknown;
  trace?: unknown;
  confirmLive?: unknown;
}

export async function startRun(input: StartRunInput): Promise<WellfoundRun> {
  const mode: RunMode = input.mode === 'LIVE' ? 'LIVE' : 'DRY_RUN';
  if (input.mode !== undefined && input.mode !== 'LIVE' && input.mode !== 'DRY_RUN') throw new RunError('mode must be DRY_RUN or LIVE');
  if (mode === 'LIVE' && input.confirmLive !== true) {
    throw new RunError('Live runs submit real applications. Confirm explicitly (confirmLive: true).', 400);
  }

  await reconcileRuns();
  const active = await prisma.wellfoundRun.findFirst({ where: { status: { in: ACTIVE_STATUSES } } });
  if (active) throw new RunError('A Wellfound run is already in progress.', 409, { activeRunId: active.id });

  const preflight = await runPreflight();
  if (!preflight.ok) throw new RunError('Preflight failed — fix the items below and retry.', 412, { preflight });

  const stats = await wellfoundStats();
  const requested = Math.max(1, Math.min(50, parseInt(String(input.max ?? 3), 10) || 3));
  const batch = mode === 'LIVE' ? Math.min(requested, stats.remainingToday) : requested;
  if (batch <= 0) {
    throw new RunError(`Daily cap reached: ${stats.today}/${stats.dailyCap} applications today (IST).`, 409, { stats });
  }

  const config = await currentRunnerConfig();
  const run = await prisma.wellfoundRun.create({
    data: { mode, visible: Boolean(input.visible), maxApplications: batch, status: 'STARTING' },
  });
  if (!isValidRunId(run.id)) throw new RunError('bad run id', 500);
  const logRel = toRepoRelative(runLogPath(run.id));
  const diagRel = toRepoRelative(runDiagnosticsDir(run.id));
  await prisma.wellfoundRun.update({ where: { id: run.id }, data: { logPath: logRel, diagnosticsDir: diagRel } });

  const executor = getExecutor();
  if (executor.kind === 'local') {
    appendLocalLog(run.id, 'SERVER', `run ${run.id}: ${mode} batch=${batch} (requested ${requested}; today ${stats.today}/${stats.dailyCap} IST) visible=${Boolean(input.visible)}`);
  }
  try {
    await executor.start(
      { runId: run.id, mode, visible: Boolean(input.visible), max: batch, dailyCap: stats.dailyCap, trace: Boolean(input.trace), config },
      (info) => void finalizeRun(run.id, info).catch((e) => console.error('[wellfound] finalize failed:', e))
    );
  } catch (e: any) {
    if (executor.kind === 'local') appendLocalLog(run.id, 'ERROR', e.message);
    await prisma.wellfoundRun.update({ where: { id: run.id }, data: { status: 'FAILED', endedAt: new Date(), error: e.message } });
    if (e instanceof RunError) throw new RunError(e.message, e.status, { ...e.body, runId: run.id });
    throw new RunError(`Could not start the run: ${e.message}`, 502, { runId: run.id });
  }
  return prisma.wellfoundRun.update({ where: { id: run.id }, data: { status: 'RUNNING' } });
}

export async function stopRun(runId: string): Promise<WellfoundRun> {
  const run = await prisma.wellfoundRun.findUnique({ where: { id: runId } });
  if (!run) throw new RunError('Run not found', 404);
  if (!ACTIVE_STATUSES.includes(run.status)) throw new RunError('Run is not active', 409);
  const stopped = await getExecutor().stop(runId);
  if (!stopped) {
    await finalizeRun(runId, { exitCode: null, signal: 'SIGTERM', error: 'stopped (process was no longer running)' });
  }
  return (await prisma.wellfoundRun.findUnique({ where: { id: runId } }))!;
}

/** Complete lines from `offset` (a trailing partial line is held back until the run is over). */
export async function readRunLog(runId: string, offset: number, final: boolean): Promise<{ lines: string[]; nextOffset: number }> {
  const chunk = await getExecutor().readLog(runId, offset);
  if (!chunk.text) return { lines: [], nextOffset: chunk.nextOffset };
  let text = chunk.text;
  let next = chunk.nextOffset;
  if (!final && !text.endsWith('\n')) {
    const cut = text.lastIndexOf('\n');
    const keep = cut >= 0 ? text.slice(0, cut + 1) : '';
    next = offset + Buffer.byteLength(keep, 'utf8');
    text = keep;
  }
  return { lines: text.split('\n').filter((l, i, a) => l !== '' || i < a.length - 1).filter(Boolean), nextOffset: next };
}

export const isTerminal = (status: string) => TERMINAL_STATUSES.includes(status);
