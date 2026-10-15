import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app, prisma } from '../app';
import { configureRunService } from '../wellfound/runService';

/** A fake runner process the test drives line by line. */
class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4242;
  killedWith: string | null = null;
  constructor(public args: string[]) {
    super();
  }
  line(text: string) {
    this.stdout.write(text + '\n');
  }
  exit(code: number | null, signal: string | null = null) {
    this.stdout.end();
    this.stderr.end();
    setTimeout(() => this.emit('close', code, signal), 10);
  }
  kill(sig: string) {
    this.killedWith = sig;
    this.exit(null, sig);
    return true;
  }
}

let children: FakeChild[] = [];
const fakeSpawn: any = (_cmd: string, args: string[]) => {
  const c = new FakeChild(args);
  children.push(c);
  return c;
};
const okPreflight = () => ({ ok: true, checks: [{ id: 'chrome', label: 'Chrome', ok: true, required: true, detail: '/opt/chrome', fix: '' }] });

const waitFor = async (fn: () => Promise<boolean> | boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out');
};
const runStatus = async (id: string) => (await prisma.wellfoundRun.findUnique({ where: { id } }))?.status;

let tmp: string;
const csvPath = () => path.join(tmp, 'applications.csv');
const writeCsv = (todayRows: number) => {
  const now = new Date().toISOString();
  const rows = Array.from({ length: todayRows }, (_, i) => `"${now}","wellfound","Intern ${i}","Co ${i}","","","https://wellfound.com/jobs/${1000 + i}-x",""`);
  fs.writeFileSync(csvPath(), `"Date","Site","Role","Company","CTC/Salary","Skills","Job Link","Job Description"\n${rows.join('\n')}\n`);
};

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-runs-'));
  process.env.WELLFOUND_LOGS_DIR = path.join(tmp, 'logs');
  process.env.WELLFOUND_DIAGNOSTICS_DIR = path.join(tmp, 'diagnostics');
  process.env.WELLFOUND_RUNNER_CONFIG = path.join(tmp, 'runner-config.json');
  process.env.WELLFOUND_APPLICATIONS_CSV = csvPath();
  process.env.WELLFOUND_STREAM_POLL_MS = '50';
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const k of ['WELLFOUND_LOGS_DIR', 'WELLFOUND_DIAGNOSTICS_DIR', 'WELLFOUND_RUNNER_CONFIG', 'WELLFOUND_APPLICATIONS_CSV', 'WELLFOUND_STREAM_POLL_MS']) delete process.env[k];
});

beforeEach(async () => {
  children = [];
  configureRunService({ executor: 'local', spawn: fakeSpawn, localPreflight: okPreflight, pollMs: 20, syncAfterLive: false });
  await prisma.wellfoundRun.deleteMany({});
  writeCsv(0);
});

afterEach(async () => {
  // never leave a fake run "active" for the next test
  for (const c of children) if (c.listenerCount('close')) c.exit(0);
  await new Promise((r) => setTimeout(r, 30));
});

describe('run lifecycle (local executor, mocked spawn)', () => {
  it('starts a dry run, streams logs over SSE, and records the summary', async () => {
    const res = await request(app).post('/api/wellfound/runs').send({ mode: 'DRY_RUN', max: 2, visible: true });
    expect(res.status).toBe(201);
    const run = res.body.run;
    expect(run).toMatchObject({ status: 'RUNNING', mode: 'DRY_RUN', maxApplications: 2, visible: true });
    expect(run.logPath).toBe(path.join(tmp, 'logs', `${run.id}.log`));

    const child = children[0];
    expect(child.args).toContain('--dry-run');
    expect(child.args).not.toContain('--live');
    expect(child.args).toContain('--max=2');
    expect(child.args).toContain(`--run-id=${run.id}`);

    child.line('2026-10-15T10:00:00.000+05:30 INFO    Session OK');
    child.stdout.write('2026-10-15T10:00:01.000+05:30 PAGE    ▶ Applying: SDE Intern @ Acme'); // split across chunks
    child.stdout.write(' | https://wellfound.com/jobs/1-x\n');
    child.stderr.write('a warning on stderr\n');
    child.line('2026-10-15T10:00:02.000+05:30 SUMMARY {"status":"SUCCEEDED","submitted":1,"skipped":2,"errors":0}');
    child.exit(0);
    await waitFor(async () => (await runStatus(run.id)) === 'SUCCEEDED');

    const done = await prisma.wellfoundRun.findUnique({ where: { id: run.id } });
    expect(done).toMatchObject({ submittedCount: 1, skippedCount: 2, errorCount: 0, exitCode: 0 });

    const sse = await request(app).get(`/api/wellfound/runs/${run.id}/stream`).buffer(true).parse((r, cb) => {
      let body = '';
      r.on('data', (c: Buffer) => (body += c.toString()));
      r.on('end', () => cb(null, body));
    });
    expect(sse.headers['content-type']).toMatch(/text\/event-stream/);
    const text = sse.body as string;
    expect(text).toContain('event: run');
    expect(text).toContain('event: log');
    expect(text).toContain('▶ Applying: SDE Intern @ Acme | https://wellfound.com/jobs/1-x'); // line reassembled
    expect(text).toContain('STDERR  a warning on stderr');
    expect(text).toContain('event: end');

    // polling fallback returns the same lines and survives after exit
    const poll = await request(app).get(`/api/wellfound/runs/${run.id}/log?offset=0`);
    expect(poll.status).toBe(200);
    expect(poll.body.lines.some((l: string) => l.includes('Session OK'))).toBe(true);
    const tail = await request(app).get(`/api/wellfound/runs/${run.id}/log?offset=${poll.body.nextOffset}`);
    expect(tail.body).toMatchObject({ lines: [], done: true });

    const list = await request(app).get('/api/wellfound/runs');
    expect(list.body.runs[0]).toMatchObject({ id: run.id, status: 'SUCCEEDED' });
  });

  it('streams live while the run is active', async () => {
    const { body } = await request(app).post('/api/wellfound/runs').send({ mode: 'DRY_RUN', max: 1 });
    const child = children[0];
    child.line('2026-10-15T10:00:00.000+05:30 INFO    first');
    setTimeout(() => {
      child.line('2026-10-15T10:00:05.000+05:30 INFO    second');
      child.exit(1);
    }, 200);
    const sse = await request(app).get(`/api/wellfound/runs/${body.run.id}/stream`).buffer(true).parse((r, cb) => {
      let b = '';
      r.on('data', (c: Buffer) => (b += c.toString()));
      r.on('end', () => cb(null, b));
    });
    const text = sse.body as string;
    expect(text.indexOf('first')).toBeLessThan(text.indexOf('second'));
    expect(text).toMatch(/event: end\ndata: .*"status":"FAILED"/);
  });

  it('refuses a second concurrent run', async () => {
    expect((await request(app).post('/api/wellfound/runs').send({ mode: 'DRY_RUN' })).status).toBe(201);
    const second = await request(app).post('/api/wellfound/runs').send({ mode: 'DRY_RUN' });
    expect(second.status).toBe(409);
    expect(second.body.activeRunId).toBeDefined();
  });

  it('stops a run', async () => {
    const { body } = await request(app).post('/api/wellfound/runs').send({ mode: 'DRY_RUN' });
    const res = await request(app).post(`/api/wellfound/runs/${body.run.id}/stop`);
    expect(res.status).toBe(200);
    expect(children[0].killedWith).toBe('SIGTERM');
    await waitFor(async () => (await runStatus(body.run.id)) === 'STOPPED');
  });

  it('records a spawn failure as FAILED with the error in the log', async () => {
    const { body } = await request(app).post('/api/wellfound/runs').send({ mode: 'DRY_RUN' });
    children[0].emit('error', new Error('spawn node ENOENT'));
    await waitFor(async () => (await runStatus(body.run.id)) === 'FAILED');
    const run = await prisma.wellfoundRun.findUnique({ where: { id: body.run.id } });
    expect(run?.error).toContain('ENOENT');
    const log = await request(app).get(`/api/wellfound/runs/${body.run.id}/log`);
    expect(log.body.lines.join('\n')).toContain('could not start the runner');
  });

  it('marks runs orphaned by a restart as failed', async () => {
    const orphan = await prisma.wellfoundRun.create({ data: { mode: 'DRY_RUN', status: 'RUNNING' } });
    const res = await request(app).post('/api/wellfound/runs').send({ mode: 'DRY_RUN' });
    expect(res.status).toBe(201);
    expect(await runStatus(orphan.id)).toBe('FAILED');
  });
});

describe('live mode guards and batch sizing', () => {
  it('requires explicit confirmation for live runs', async () => {
    const res = await request(app).post('/api/wellfound/runs').send({ mode: 'LIVE', max: 1 });
    expect(res.status).toBe(400);
    expect(children).toHaveLength(0);
  });

  it('uses min(batch, cap - today) for live runs', async () => {
    writeCsv(23);
    const res = await request(app).post('/api/wellfound/runs').send({ mode: 'LIVE', max: 5, confirmLive: true });
    expect(res.status).toBe(201);
    expect(res.body.run.maxApplications).toBe(2);
    expect(children[0].args).toContain('--live');
    expect(children[0].args).toContain('--max=2');
    expect(children[0].args).toContain('--daily-cap=25');
  });

  it('refuses live runs once the daily cap is reached', async () => {
    writeCsv(25);
    const res = await request(app).post('/api/wellfound/runs').send({ mode: 'LIVE', max: 5, confirmLive: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Daily cap reached: 25\/25/);
    expect(children).toHaveLength(0);
  });

  it('rejects an unknown mode', async () => {
    expect((await request(app).post('/api/wellfound/runs').send({ mode: 'YOLO' })).status).toBe(400);
  });
});

describe('preflight', () => {
  it('returns actionable failures and blocks the run', async () => {
    configureRunService({
      executor: 'local',
      spawn: fakeSpawn,
      localPreflight: () => ({
        ok: false,
        checks: [{ id: 'session', label: 'Saved Wellfound session', ok: false, required: true, detail: 'missing', fix: 'Run: npm run wellfound:login' }],
      }),
    });
    const pf = await request(app).get('/api/wellfound/preflight');
    expect(pf.body.ok).toBe(false);
    expect(pf.body.checks.find((c: any) => c.id === 'session').fix).toContain('wellfound:login');

    const res = await request(app).post('/api/wellfound/runs').send({ mode: 'DRY_RUN' });
    expect(res.status).toBe(412);
    expect(res.body.preflight.ok).toBe(false);
    expect(children).toHaveLength(0);
    expect(await prisma.wellfoundRun.count()).toBe(0);
  });

  it('explains how to start the agent when it is unreachable', async () => {
    configureRunService({
      executor: 'agent',
      agentUrl: 'http://host.docker.internal:3002',
      fetch: (async () => {
        throw new Error('connect ECONNREFUSED');
      }) as any,
    });
    const pf = await request(app).get('/api/wellfound/preflight');
    expect(pf.body).toMatchObject({ ok: false, executor: 'agent' });
    expect(pf.body.checks[0]).toMatchObject({ id: 'agent', ok: false });
    expect(pf.body.checks[0].fix).toContain('npm run wellfound:agent');
  });
});

describe('agent executor (mocked HTTP)', () => {
  it('proxies the run to the agent and finalizes from its status', async () => {
    const calls: { url: string; method: string; body?: any; token?: string }[] = [];
    let polls = 0;
    const json = (status: number, data: unknown) => ({ status, json: async () => data }) as any;
    configureRunService({
      executor: 'agent',
      agentUrl: 'http://agent:3002',
      agentToken: 'tok',
      pollMs: 20,
      fetch: (async (url: string, init: any) => {
        const u = new URL(url);
        calls.push({ url: u.pathname, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined, token: init?.headers?.['x-agent-token'] });
        if (u.pathname === '/health') return json(200, { ok: true, display: ':1' });
        if (u.pathname === '/preflight') return json(200, { ok: true, checks: [{ id: 'chrome', label: 'Chrome', ok: true, required: true, detail: '', fix: '' }] });
        if (u.pathname === '/runs' && init?.method === 'POST') return json(202, { run: { status: 'RUNNING' } });
        if (u.pathname.startsWith('/runs/')) {
          polls++;
          return json(200, { run: polls < 2 ? { status: 'RUNNING' } : { status: 'SUCCEEDED', exitCode: 0, summary: { status: 'SUCCEEDED', submitted: 1, skipped: 0, errors: 0 } } });
        }
        return json(404, {});
      }) as any,
    });

    const res = await request(app).post('/api/wellfound/runs').send({ mode: 'DRY_RUN', max: 1 });
    expect(res.status).toBe(201);
    const start = calls.find((c) => c.url === '/runs' && c.method === 'POST')!;
    expect(start.body).toMatchObject({ runId: res.body.run.id, mode: 'DRY_RUN', max: 1, confirmLive: false });
    expect(start.body.config.CV).toBeDefined();
    expect(start.token).toBe('tok');
    await waitFor(async () => (await runStatus(res.body.run.id)) === 'SUCCEEDED');
    expect((await prisma.wellfoundRun.findUnique({ where: { id: res.body.run.id } }))?.submittedCount).toBe(1);
  });
});

describe('diagnostics endpoints', () => {
  it('lists artifacts and serves files without path traversal', async () => {
    const run = await prisma.wellfoundRun.create({ data: { mode: 'DRY_RUN', status: 'FAILED' } });
    const dir = path.join(tmp, 'diagnostics', run.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '01-logged-out.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(dir, '01-logged-out.html'), '<html><script>alert(1)</script></html>');
    fs.writeFileSync(path.join(dir, '01-logged-out.json'), JSON.stringify({ reason: 'logged-out', url: 'https://wellfound.com/login' }));
    fs.writeFileSync(path.join(tmp, 'diagnostics', 'outside.txt'), 'secret');

    const list = await request(app).get(`/api/wellfound/runs/${run.id}/diagnostics`);
    expect(list.status).toBe(200);
    expect(list.body.artifacts[0]).toMatchObject({ reason: 'logged-out', screenshot: '01-logged-out.png', html: '01-logged-out.html' });

    const png = await request(app).get(`/api/wellfound/runs/${run.id}/diagnostics/01-logged-out.png`);
    expect(png.status).toBe(200);
    expect(png.headers['content-type']).toMatch(/image\/png/);

    const html = await request(app).get(`/api/wellfound/runs/${run.id}/diagnostics/01-logged-out.html`);
    expect(html.headers['content-disposition']).toMatch(/attachment/);
    expect(html.headers['content-security-policy']).toBe('sandbox');

    for (const bad of ['..%2Foutside.txt', '..%2F..%2F.env', '%2Fetc%2Fpasswd', '..']) {
      const r = await request(app).get(`/api/wellfound/runs/${run.id}/diagnostics/${bad}`);
      expect([400, 404]).toContain(r.status);
      expect(r.text).not.toContain('secret');
    }
    expect((await request(app).get('/api/wellfound/runs/..%2F..%2Fetc/diagnostics')).status).toBe(400);
  });
});
