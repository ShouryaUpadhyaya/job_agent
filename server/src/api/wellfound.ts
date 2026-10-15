import fs from 'fs';
import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import {
  countTodayApplications,
  readWellfoundCsv,
  syncWellfoundApplicationsFromCsv,
  wellfoundJobIdentity,
} from '../connectors/wellfoundAutoApplyService';
import { parseRunnerTimestamp, istDateKey } from '../lib/time';
import {
  geminiConfigured,
  loadWellfoundSettings,
  saveWellfoundSettings,
  SettingsError,
  toRunnerConfig,
  writeRunnerConfigFile,
} from '../wellfound/config';
import {
  ACTIVE_STATUSES,
  RunError,
  getExecutor,
  isTerminal,
  readRunLog,
  runPreflight,
  startRun,
  stopRun,
  wellfoundStats,
} from '../wellfound/runService';
import { countDiagnostics, listDiagnostics, resolveDiagnosticFile } from '../wellfound/diagnostics';
import { envFile, isValidRunId, requireScript } from '../wellfound/paths';

export const wellfoundAutoApplyRouter = Router();

function sendError(res: Response, err: any) {
  if (err instanceof RunError) return res.status(err.status).json({ error: err.message, ...err.body });
  if (err instanceof SettingsError) return res.status(err.status).json({ error: err.message });
  console.error('[wellfound]', err);
  return res.status(500).json({ error: err?.message || 'Internal error' });
}

const withDiagnostics = <T extends { id: string }>(run: T) => ({ ...run, diagnosticsCount: countDiagnostics(run.id) });

// ---------------------------------------------------------------- overview / config

wellfoundAutoApplyRouter.get('/wellfound/overview', async (_req: Request, res: Response) => {
  try {
    const [stats, activeRun, lastRun] = await Promise.all([
      wellfoundStats(),
      prisma.wellfoundRun.findFirst({ where: { status: { in: ACTIVE_STATUSES } }, orderBy: { startedAt: 'desc' } }),
      prisma.wellfoundRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    ]);
    res.json({ stats, executor: getExecutor().kind, geminiConfigured: geminiConfigured(), activeRun, lastRun });
  } catch (err) {
    sendError(res, err);
  }
});

wellfoundAutoApplyRouter.get('/wellfound/config', async (_req: Request, res: Response) => {
  try {
    const { profile, sources, rules } = await loadWellfoundSettings();
    // The Gemini key itself is never sent to the browser.
    res.json({ profile, sources, rules, geminiConfigured: geminiConfigured(), envWritable: fs.existsSync(envFile()) });
  } catch (err) {
    sendError(res, err);
  }
});

wellfoundAutoApplyRouter.put('/wellfound/config', async (req: Request, res: Response) => {
  try {
    const { profile, rules, geminiKey } = req.body || {};
    const saved = await saveWellfoundSettings({ profile, rules, geminiKey });
    if (getExecutor().kind === 'local') writeRunnerConfigFile(saved.config);
    res.json({
      success: true,
      profile: saved.profile,
      sources: saved.sources,
      rules: saved.rules,
      geminiConfigured: geminiConfigured(),
      message: saved.geminiSaved ? 'Saved. Gemini key updated in .env.' : 'Saved.',
    });
  } catch (err) {
    sendError(res, err);
  }
});

// ---------------------------------------------------------------- applications

wellfoundAutoApplyRouter.get('/wellfound/applications', async (_req: Request, res: Response) => {
  try {
    const rows = readWellfoundCsv();
    const now = new Date();
    const today = istDateKey(now);
    const ids = [...new Set(rows.map((r) => wellfoundJobIdentity(r).externalId))];
    const listings = ids.length
      ? await prisma.jobListing.findMany({
          where: { source: 'wellfound', externalId: { in: ids } },
          select: { externalId: true, applications: { select: { stage: true }, take: 1 } },
        })
      : [];
    const stageById = new Map(listings.map((l) => [l.externalId, l.applications[0]?.stage || null]));
    const applications = rows
      .map((r) => {
        const at = parseRunnerTimestamp(r.date);
        return {
          ...r,
          submittedAt: at ? at.toISOString() : null,
          istDate: at ? istDateKey(at) : null,
          isToday: at ? istDateKey(at) === today : false,
          stage: stageById.get(wellfoundJobIdentity(r).externalId) || null,
        };
      })
      .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
    res.json({ applications, today: countTodayApplications(rows, now), todayKey: today });
  } catch (err) {
    sendError(res, err);
  }
});

wellfoundAutoApplyRouter.post('/wellfound/sync-database', async (_req: Request, res: Response) => {
  try {
    const result = await syncWellfoundApplicationsFromCsv();
    res.json({ success: true, result });
  } catch (err) {
    sendError(res, err);
  }
});

// ---------------------------------------------------------------- runs

wellfoundAutoApplyRouter.get('/wellfound/preflight', async (_req: Request, res: Response) => {
  try {
    res.json(await runPreflight());
  } catch (err) {
    sendError(res, err);
  }
});

wellfoundAutoApplyRouter.get('/wellfound/runs', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25));
    const runs = await prisma.wellfoundRun.findMany({ orderBy: { startedAt: 'desc' }, take: limit });
    res.json({ runs: runs.map(withDiagnostics) });
  } catch (err) {
    sendError(res, err);
  }
});

async function handleStart(req: Request, res: Response) {
  try {
    const run = await startRun(req.body || {});
    res.status(201).json({ run });
  } catch (err) {
    sendError(res, err);
  }
}
wellfoundAutoApplyRouter.post('/wellfound/runs', handleStart);
wellfoundAutoApplyRouter.post('/wellfound/run', handleStart); // legacy path

wellfoundAutoApplyRouter.post('/wellfound/stop', async (_req: Request, res: Response) => {
  try {
    const active = await prisma.wellfoundRun.findFirst({ where: { status: { in: ACTIVE_STATUSES } } });
    if (!active) return res.status(409).json({ error: 'No run is active.' });
    res.json({ run: await stopRun(active.id) });
  } catch (err) {
    sendError(res, err);
  }
});

async function findRun(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!isValidRunId(id)) {
    res.status(400).json({ error: 'Invalid run id' });
    return null;
  }
  const run = await prisma.wellfoundRun.findUnique({ where: { id } });
  if (!run) res.status(404).json({ error: 'Run not found' });
  return run;
}

wellfoundAutoApplyRouter.get('/wellfound/runs/:id', async (req: Request, res: Response) => {
  try {
    const run = await findRun(req, res);
    if (run) res.json({ run: withDiagnostics(run) });
  } catch (err) {
    sendError(res, err);
  }
});

wellfoundAutoApplyRouter.post('/wellfound/runs/:id/stop', async (req: Request, res: Response) => {
  try {
    const run = await findRun(req, res);
    if (run) res.json({ run: await stopRun(run.id) });
  } catch (err) {
    sendError(res, err);
  }
});

/** Polling fallback for the SSE stream: complete log lines from a byte offset. */
wellfoundAutoApplyRouter.get('/wellfound/runs/:id/log', async (req: Request, res: Response) => {
  try {
    const run = await findRun(req, res);
    if (!run) return;
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
    const done = isTerminal(run.status);
    const { lines, nextOffset } = await readRunLog(run.id, offset, done);
    res.json({ lines, nextOffset, done: done && lines.length === 0, run });
  } catch (err) {
    sendError(res, err);
  }
});

/** SSE: replays the log file from the start, then tails it until the run ends. */
wellfoundAutoApplyRouter.get('/wellfound/runs/:id/stream', async (req: Request, res: Response) => {
  let run;
  try {
    run = await findRun(req, res);
  } catch (err) {
    return sendError(res, err);
  }
  if (!run) return;
  const runId = run.id;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let closed = false;
  req.on('close', () => {
    closed = true;
  });
  const send = (event: string, data: unknown) => {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send('run', run);

  const pollMs = Math.max(50, parseInt(process.env.WELLFOUND_STREAM_POLL_MS || '500', 10));
  let offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
  let lastBeat = Date.now();
  let lastStatus = run.status;
  try {
    while (!closed) {
      // Status first, then read: if the run was already over before this read, the read saw every byte.
      const fresh = await prisma.wellfoundRun.findUnique({ where: { id: runId } });
      const over = !fresh || isTerminal(fresh.status);
      const { lines, nextOffset } = await readRunLog(runId, offset, over);
      offset = nextOffset;
      if (lines.length) send('log', { lines, offset });
      if (fresh && fresh.status !== lastStatus) {
        lastStatus = fresh.status;
        send('run', fresh);
      }
      if (over && lines.length === 0) {
        send('end', fresh ? withDiagnostics(fresh) : null);
        break;
      }
      if (Date.now() - lastBeat > 15000) {
        res.write(': keep-alive\n\n');
        lastBeat = Date.now();
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  } catch (err: any) {
    send('error', { error: err.message });
  }
  res.end();
});

wellfoundAutoApplyRouter.get('/wellfound/runs/:id/diagnostics', async (req: Request, res: Response) => {
  try {
    const run = await findRun(req, res);
    if (run) res.json(listDiagnostics(run.id));
  } catch (err) {
    sendError(res, err);
  }
});

wellfoundAutoApplyRouter.get('/wellfound/runs/:id/diagnostics/:file', (req: Request, res: Response) => {
  const full = resolveDiagnosticFile(String(req.params.id), String(req.params.file));
  if (!full) return res.status(404).json({ error: 'Not found' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (/\.html$/i.test(full)) {
    // Captured third-party HTML: never render it on our origin.
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Content-Disposition', `attachment; filename="${String(req.params.file)}"`);
    res.type('text/html');
  } else if (/\.zip$/i.test(full)) {
    res.setHeader('Content-Disposition', `attachment; filename="${String(req.params.file)}"`);
  }
  res.sendFile(full);
});

// ---------------------------------------------------------------- Zen console bundle

/**
 * Builds the paste-in-console bundle on demand (no files written). Dry run unless ?mode=live;
 * the Gemini key is embedded only with ?includeKey=1.
 */
wellfoundAutoApplyRouter.get('/wellfound/script', async (req: Request, res: Response) => {
  try {
    const live = req.query.mode === 'live';
    const wantKey = req.query.includeKey === '1' || req.query.includeKey === 'true';
    const max = Math.max(1, Math.min(50, parseInt(String(req.query.max || '10'), 10) || 10));
    const { profile, rules } = await loadWellfoundSettings();
    const config = toRunnerConfig(profile, rules);
    const key = wantKey ? process.env.GEMINI_KEY || null : null;
    const build = requireScript<{ buildZenBundle: (o: any) => string }>('build-wellfound-paste.js');
    const text = build.buildZenBundle({ live, max, dailyCap: rules.dailyCap, config, geminiKey: key });
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Wellfound-Mode', live ? 'LIVE' : 'DRY_RUN');
    res.setHeader('X-Gemini-Key', key ? 'included' : wantKey ? 'missing' : 'excluded');
    res.send(text);
  } catch (err) {
    sendError(res, err);
  }
});
