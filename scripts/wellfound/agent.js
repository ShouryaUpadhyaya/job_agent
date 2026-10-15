#!/usr/bin/env node
/**
 * Wellfound host agent: a tiny dependency-free HTTP service that starts the Playwright runner on
 * the host (where Chrome, the display and the saved login live). The API server proxies to it when
 * it runs in Docker (WELLFOUND_AGENT_URL=http://host.docker.internal:3002).
 *
 *   npm run wellfound:agent                      # 127.0.0.1:3002 — for a server running on the host
 *   npm run wellfound:agent:docker               # 0.0.0.0:3002 — reachable from the Docker server;
 *                                                #   requires WELLFOUND_AGENT_TOKEN (root .env), shared with the server
 *
 * Env (process env or root .env): WELLFOUND_AGENT_HOST, WELLFOUND_AGENT_PORT, WELLFOUND_AGENT_TOKEN.
 *
 * Routes: GET /health, GET /preflight, GET /runs, POST /runs, GET /runs/:id, POST /runs/:id/stop,
 *         GET /runs/:id/log?offset=N
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const lib = require('./lib');
const { preflight } = require('./preflight');

const HOST = process.argv.includes('--docker') ? '0.0.0.0' : process.env.WELLFOUND_AGENT_HOST || lib.envValue('WELLFOUND_AGENT_HOST') || '127.0.0.1';
const PORT = parseInt(process.env.WELLFOUND_AGENT_PORT || lib.envValue('WELLFOUND_AGENT_PORT') || '3002', 10);
const TOKEN = process.env.WELLFOUND_AGENT_TOKEN || lib.envValue('WELLFOUND_AGENT_TOKEN') || '';
const RUNNER = path.join(__dirname, 'runner.js');
const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];

const say = (m) => console.log(`${lib.istIso()} AGENT   ${m}`);

if (!LOOPBACK.includes(HOST) && !TOKEN) {
  console.error(`Refusing to listen on ${HOST} without WELLFOUND_AGENT_TOKEN: anyone on your network could start applications.\n` +
    'Add WELLFOUND_AGENT_TOKEN=<random string> to the root .env (the Docker server reads the same value), or bind to 127.0.0.1.');
  process.exit(1);
}

/** runId -> run record (in memory; the server keeps the durable WellfoundRun row) */
const runs = new Map();
let activeRunId = null;

function publicRun(r) {
  if (!r) return null;
  const { child, ...rest } = r;
  return rest;
}

function appendLog(file, level, msg) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, String(msg).split(/\r?\n/).filter(Boolean).map((l) => `${lib.istIso()} ${level.padEnd(7)} ${l}\n`).join(''));
  } catch (e) {}
}

function lineSplitter(onLine) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i).replace(/\r$/, ''));
        buf = buf.slice(i + 1);
      }
    },
    flush() { if (buf) onLine(buf); buf = ''; },
  };
}

function statusFromExit(code, signal, summary) {
  if (summary && summary.status) return summary.status;
  if (code === 0) return 'SUCCEEDED';
  if (code === 130 || signal === 'SIGTERM' || signal === 'SIGINT') return 'STOPPED';
  return 'FAILED';
}

function startRun(body) {
  const runId = body.runId;
  if (!lib.isValidRunId(runId)) return [400, { error: 'invalid runId' }];
  if (runs.has(runId)) return [409, { error: `run ${runId} already exists` }];
  if (activeRunId) return [409, { error: `run ${activeRunId} is still running`, activeRunId }];
  const mode = body.mode === 'LIVE' ? 'LIVE' : 'DRY_RUN';
  if (body.mode !== 'LIVE' && body.mode !== 'DRY_RUN') return [400, { error: 'mode must be DRY_RUN or LIVE' }];
  if (mode === 'LIVE' && body.confirmLive !== true) return [400, { error: 'LIVE runs need confirmLive: true' }];

  const pf = preflight();
  if (!pf.ok) return [412, { error: 'Preflight failed on the host', preflight: pf }];

  const logFile = path.join(lib.LOGS_DIR, `${runId}.log`);
  const diagnosticsDir = path.join(lib.DIAGNOSTICS_DIR, runId);
  fs.mkdirSync(lib.LOGS_DIR, { recursive: true });
  fs.mkdirSync(diagnosticsDir, { recursive: true });

  const args = [RUNNER, 'wellfound', `--run-id=${runId}`, `--log-file=${logFile}`, `--diagnostics-dir=${diagnosticsDir}`];
  if (mode === 'LIVE') args.push('--live');
  else args.push('--dry-run');
  const max = parseInt(body.max, 10);
  if (Number.isFinite(max) && max >= 0) args.push(`--max=${max}`);
  const cap = parseInt(body.dailyCap, 10);
  if (Number.isFinite(cap) && cap > 0) args.push(`--daily-cap=${cap}`);
  if (body.visible) args.push('--visible');
  if (body.trace) args.push('--trace');
  if (body.config && typeof body.config === 'object' && body.config.CV) {
    fs.mkdirSync(lib.OUT_DIR, { recursive: true });
    fs.writeFileSync(lib.RUNNER_CONFIG_FILE, JSON.stringify({ ...body.config, generatedAt: new Date().toISOString() }, null, 2));
    args.push(`--config=${lib.RUNNER_CONFIG_FILE}`);
  }

  appendLog(logFile, 'AGENT', `starting runner on host ${require('os').hostname()}: node ${args.slice(1).map((a) => path.isAbsolute(a) ? path.relative(lib.ROOT, a) : a).join(' ')}`);
  const run = { runId, mode, status: 'RUNNING', pid: null, exitCode: null, signal: null, startedAt: new Date().toISOString(), endedAt: null,
    logFile: path.relative(lib.ROOT, logFile), diagnosticsDir: path.relative(lib.ROOT, diagnosticsDir), summary: null, error: null, child: null };

  let child;
  try {
    child = spawn(process.execPath, args, { cwd: lib.ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    appendLog(logFile, 'ERROR', `spawn failed: ${e.message}`);
    return [500, { error: `spawn failed: ${e.message}` }];
  }
  run.child = child;
  run.pid = child.pid || null;
  runs.set(runId, run);
  activeRunId = runId;

  const out = lineSplitter((line) => {
    const m = line.match(/ SUMMARY\s+(\{.*\})\s*$/);
    if (m) { try { run.summary = JSON.parse(m[1]); } catch (e) {} }
  });
  const err = lineSplitter((line) => { if (line.trim()) appendLog(logFile, 'STDERR', line); });
  child.stdout.on('data', (c) => out.push(c));
  child.stderr.on('data', (c) => err.push(c));
  child.on('error', (e) => {
    run.error = `runner process error: ${e.message}`;
    appendLog(logFile, 'ERROR', run.error);
  });
  child.on('close', (code, signal) => {
    out.flush();
    err.flush();
    run.exitCode = code;
    run.signal = signal;
    run.status = statusFromExit(code, signal, run.summary);
    run.error = run.error || (run.summary && run.summary.error) || (run.status === 'FAILED' ? `runner exited with code ${code}${signal ? ` (${signal})` : ''}` : null);
    run.endedAt = new Date().toISOString();
    run.child = null;
    if (activeRunId === runId) activeRunId = null;
    appendLog(logFile, 'AGENT', `runner exited: code=${code}${signal ? ` signal=${signal}` : ''} status=${run.status}`);
    say(`run ${runId} ended: ${run.status}`);
  });
  say(`run ${runId} started (${mode}, pid ${run.pid})`);
  return [202, { run: publicRun(run) }];
}

function stopRun(runId) {
  const run = runs.get(runId);
  if (!run) return [404, { error: 'unknown run' }];
  if (!run.child) return [409, { error: 'run is not active', run: publicRun(run) }];
  appendLog(path.join(lib.ROOT, run.logFile), 'AGENT', 'stop requested');
  run.child.kill('SIGTERM');
  const child = run.child;
  setTimeout(() => { if (run.child === child) child.kill('SIGKILL'); }, 15000).unref();
  return [202, { run: publicRun(run) }];
}

function readLog(runId, offset) {
  if (!lib.isValidRunId(runId)) return [400, { error: 'invalid runId' }];
  const file = path.join(lib.LOGS_DIR, `${runId}.log`);
  const run = runs.get(runId);
  let size = 0;
  try { size = fs.statSync(file).size; } catch (e) {
    return [200, { text: '', nextOffset: 0, size: 0, done: run ? !run.child : true, run: publicRun(run) }];
  }
  const start = Math.min(Math.max(0, offset || 0), size);
  const len = Math.min(size - start, 256 * 1024);
  const buf = Buffer.alloc(len);
  if (len > 0) {
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
  }
  return [200, { text: buf.toString('utf8'), nextOffset: start + len, size, done: (run ? !run.child : true) && start + len >= size, run: publicRun(run) }];
}

function authorized(req) {
  if (!TOKEN) return true;
  const got = String(req.headers['x-agent-token'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const a = Buffer.from(got);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  try {
    const url = new URL(req.url, 'http://agent');
    const parts = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(200, { ok: true, service: 'wellfound-agent', activeRunId, platform: process.platform, display: process.env.DISPLAY || null, auth: !!TOKEN });
    }
    if (!authorized(req)) return send(401, { error: 'missing or wrong agent token (WELLFOUND_AGENT_TOKEN)' });

    if (req.method === 'GET' && url.pathname === '/preflight') return send(200, preflight());
    if (req.method === 'GET' && url.pathname === '/runs') return send(200, { runs: [...runs.values()].map(publicRun), activeRunId });
    if (req.method === 'POST' && url.pathname === '/runs') {
      const [status, body] = startRun(await readBody(req));
      return send(status, body);
    }
    if (parts[0] === 'runs' && parts[1]) {
      const runId = parts[1];
      if (req.method === 'GET' && parts.length === 2) {
        const run = runs.get(runId);
        return run ? send(200, { run: publicRun(run) }) : send(404, { error: 'unknown run' });
      }
      if (req.method === 'POST' && parts[2] === 'stop') return send(...stopRun(runId));
      if (req.method === 'GET' && parts[2] === 'log') return send(...readLog(runId, parseInt(url.searchParams.get('offset') || '0', 10)));
    }
    send(404, { error: 'not found' });
  } catch (e) {
    send(500, { error: e.message });
  }
});

function shutdown(sig) {
  say(`${sig}: stopping${activeRunId ? ` (stopping run ${activeRunId})` : ''}`);
  const run = activeRunId && runs.get(activeRunId);
  if (run && run.child) run.child.kill('SIGTERM');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(PORT, HOST, () => {
  fs.mkdirSync(lib.LOGS_DIR, { recursive: true });
  fs.mkdirSync(lib.DIAGNOSTICS_DIR, { recursive: true });
  say(`listening on http://${HOST}:${PORT} (token ${TOKEN ? 'required' : 'not set: loopback only'})`);
  const pf = preflight();
  for (const c of pf.checks) say(`${c.ok ? 'ok  ' : c.required ? 'FAIL' : 'warn'} ${c.label}: ${c.detail}${c.ok ? '' : ` — ${c.fix}`}`);
});
