import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import {
  parseWellfoundCsv,
  syncWellfoundApplicationsFromCsv,
} from '../connectors/wellfoundAutoApplyService';

export const wellfoundAutoApplyRouter = Router();

function findExistingFile(candidates: (string | undefined | null)[]): string {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      try {
        if (fs.statSync(c).isFile()) return c;
      } catch (e) {}
    }
  }
  return (candidates.find(Boolean) as string) || '';
}

function findExistingDir(candidates: (string | undefined | null)[]): string {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      try {
        if (fs.statSync(c).isDirectory()) return c;
      } catch (e) {}
    }
  }
  return (candidates.find(Boolean) as string) || '';
}

export function getRootDir(): string {
  return findExistingDir([
    path.resolve(__dirname, '../../../'),
    path.resolve(process.cwd()),
    '/app',
  ]);
}

export function getSubmoduleDir(): string {
  const root = getRootDir();
  return findExistingDir([
    path.join(root, 'wellfound_autoApply'),
    path.resolve(process.cwd(), 'wellfound_autoApply'),
    '/app/wellfound_autoApply',
    root,
  ]);
}

export function getEnvFile(): string {
  const sub = getSubmoduleDir();
  const root = getRootDir();
  return findExistingFile([
    path.join(sub, '.env'),
    path.join(root, '.env'),
    path.join(process.cwd(), 'wellfound_autoApply/.env'),
    path.join(process.cwd(), '.env'),
    '/app/wellfound_autoApply/.env',
  ]);
}

export function getCsvFile(): string {
  const sub = getSubmoduleDir();
  const root = getRootDir();
  return findExistingFile([
    path.join(sub, 'applications.csv'),
    path.join(root, 'applications.csv'),
    path.join(process.cwd(), 'wellfound_autoApply/applications.csv'),
    path.join(process.cwd(), 'applications.csv'),
    '/app/wellfound_autoApply/applications.csv',
    '/app/applications.csv',
  ]);
}

export function getStateFile(): string {
  const sub = getSubmoduleDir();
  const root = getRootDir();
  return findExistingFile([
    path.join(sub, 'apply-state-wellfound.json'),
    path.join(root, 'apply-state-wellfound.json'),
    path.join(process.cwd(), 'wellfound_autoApply/apply-state-wellfound.json'),
    path.join(process.cwd(), 'apply-state-wellfound.json'),
    '/app/wellfound_autoApply/apply-state-wellfound.json',
    '/app/apply-state-wellfound.json',
  ]);
}

export function getBuildScript(): string {
  const root = getRootDir();
  return findExistingFile([
    path.join(root, 'scripts/wellfound/build-wellfound-paste.js'),
    path.join(process.cwd(), 'scripts/wellfound/build-wellfound-paste.js'),
    '/app/scripts/wellfound/build-wellfound-paste.js',
  ]);
}

export function getZenScript(): string {
  const root = getRootDir();
  return findExistingFile([
    path.join(root, 'scripts/wellfound/out/wellfound-zen.js'),
    path.join(process.cwd(), 'scripts/wellfound/out/wellfound-zen.js'),
    '/app/scripts/wellfound/out/wellfound-zen.js',
  ]);
}

// Global state tracking running runner processes
interface RunnerProcessState {
  isRunning: boolean;
  pid: number | null;
  mode: 'DRY_RUN' | 'LIVE' | null;
  visible: boolean;
  max: number;
  startedAt: Date | null;
  logs: string[];
}

const runnerState: RunnerProcessState = {
  isRunning: false,
  pid: null,
  mode: null,
  visible: false,
  max: 10,
  startedAt: null,
  logs: [],
};

// 1. GET /api/wellfound/config - Get current configuration from .env and stats
wellfoundAutoApplyRouter.get('/wellfound/config', async (req: Request, res: Response) => {
  try {
    const envFile = getEnvFile();
    let envContent = '';
    if (envFile && fs.existsSync(envFile)) {
      envContent = fs.readFileSync(envFile, 'utf8');
    }

    const envMap: Record<string, string> = {};
    for (const line of envContent.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match) {
        let val = match[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        envMap[match[1]] = val;
      }
    }

    // Daily state from apply-state-wellfound.json
    let dailyState = { date: new Date().toDateString(), count: 0 };
    const stateFile = getStateFile();
    if (stateFile && fs.existsSync(stateFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8').replace(/^\uFEFF/, ''));
        dailyState = parsed;
      } catch (e) {}
    }

    // CSV application count
    let totalCsvApplications = 0;
    const csvFile = getCsvFile();
    if (csvFile && fs.existsSync(csvFile)) {
      try {
        const csvData = fs.readFileSync(csvFile, 'utf8');
        const rows = parseWellfoundCsv(csvData);
        totalCsvApplications = rows.length;
      } catch (e) {}
    }

    res.json({
      env: envMap,
      dailyState,
      totalCsvApplications,
      runnerState: {
        isRunning: runnerState.isRunning,
        mode: runnerState.mode,
        visible: runnerState.visible,
        max: runnerState.max,
        startedAt: runnerState.startedAt,
        logTail: runnerState.logs.slice(-50),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. PUT /api/wellfound/config - Update configuration in .env and rebuild scripts
wellfoundAutoApplyRouter.put('/wellfound/config', async (req: Request, res: Response) => {
  try {
    const {
      NAME,
      EMAIL,
      PHONE,
      LOCATION,
      CURRENT_ROLE,
      COMPANY,
      EDUCATION,
      YEARS_EXPERIENCE,
      SKILLS,
      HIGHLIGHTS,
      NOTICE_PERIOD,
      CURRENT_CTC,
      EXPECTED_CTC,
      DOB,
      GENDER,
      WORK_AUTH,
      GITHUB_URL,
      LINKEDIN_URL,
      PORTFOLIO_URL,
      GEMINI_KEY,
    } = req.body;

    const lines: string[] = [
      `NAME=${NAME ?? ''}`,
      `EMAIL=${EMAIL ?? ''}`,
      `PHONE=${PHONE ?? ''}`,
      `LOCATION=${LOCATION ?? ''}`,
      '',
      `CURRENT_ROLE=${CURRENT_ROLE ?? ''}`,
      `COMPANY=${COMPANY ?? ''}`,
      `EDUCATION=${EDUCATION ?? ''}`,
      `YEARS_EXPERIENCE=${YEARS_EXPERIENCE ?? ''}`,
      `SKILLS=${SKILLS ?? ''}`,
      '',
      '# Up to 5 highlights separated by || (no trailing periods)',
      `HIGHLIGHTS=${HIGHLIGHTS ?? ''}`,
      '',
      `NOTICE_PERIOD=${NOTICE_PERIOD ?? '1 week'}`,
      `CURRENT_CTC=${CURRENT_CTC ?? '0'}`,
      `EXPECTED_CTC=${EXPECTED_CTC ?? '6-10'}`,
      `DOB=${DOB ?? ''}`,
      `GENDER=${GENDER ?? 'Male'}`,
      `WORK_AUTH=${WORK_AUTH ?? 'Yes, I am an Indian citizen based in India and authorized to work here. I would need visa sponsorship to work onsite outside India.'}`,
      '',
      `GITHUB_URL=${GITHUB_URL ?? ''}`,
      `LINKEDIN_URL=${LINKEDIN_URL ?? ''}`,
      `PORTFOLIO_URL=${PORTFOLIO_URL ?? ''}`,
      '',
      `GEMINI_KEY=${GEMINI_KEY ?? ''}`,
      '',
    ];

    const envFile = getEnvFile();
    if (envFile) {
      fs.writeFileSync(envFile, lines.join('\n'), 'utf8');
    }

    // Trigger rebuild of both wellfound-zen.js and wellfound-auto-apply-enhanced.js
    const buildScript = getBuildScript();
    if (buildScript && fs.existsSync(buildScript)) {
      const rebuildProc = spawn('node', [buildScript, '--live'], { cwd: getRootDir() });
      rebuildProc.on('error', (err) => {
        console.warn('Rebuild process error:', err.message);
      });
      await new Promise((resolve) => {
        rebuildProc.on('close', resolve);
        rebuildProc.on('error', () => resolve(null));
      });
    }

    res.json({ success: true, message: 'Configuration saved and build regenerated successfully.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. GET /api/wellfound/applications - Read parsed applications from applications.csv
wellfoundAutoApplyRouter.get('/wellfound/applications', async (req: Request, res: Response) => {
  try {
    const csvFile = getCsvFile();
    if (!csvFile || !fs.existsSync(csvFile)) {
      return res.json({ applications: [] });
    }
    const csvContent = fs.readFileSync(csvFile, 'utf8');
    const rows = parseWellfoundCsv(csvContent);
    res.json({ applications: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. POST /api/wellfound/sync-database - Sync applications.csv to PostgreSQL database
wellfoundAutoApplyRouter.post('/wellfound/sync-database', async (req: Request, res: Response) => {
  try {
    const csvFile = getCsvFile();
    const result = await syncWellfoundApplicationsFromCsv(csvFile);
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. POST /api/wellfound/run - Launch runner in Playwright (Dry-run or Live, visible or background)
wellfoundAutoApplyRouter.post('/wellfound/run', async (req: Request, res: Response) => {
  try {
    if (runnerState.isRunning) {
      return res.status(409).json({
        error: 'A Wellfound automation run is already in progress.',
        pid: runnerState.pid,
      });
    }

    const { mode = 'DRY_RUN', visible = false, max = 5 } = req.body;
    const isLive = mode === 'LIVE';

    // 1. Ensure scripts are rebuilt with target settings
    const buildScript = getBuildScript();
    if (buildScript && fs.existsSync(buildScript)) {
      const buildArgs = [buildScript];
      if (isLive) buildArgs.push('--live');
      if (max) buildArgs.push(`--max=${max}`);

      const buildChild = spawn('node', buildArgs, { cwd: getRootDir() });
      buildChild.on('error', (err) => {
        runnerState.logs.push(`Build error: ${err.message}`);
      });
      await new Promise((resolve) => {
        buildChild.on('close', resolve);
        buildChild.on('error', () => resolve(null));
      });
    }

    // 2. Launch Playwright runner
    const subDir = getSubmoduleDir();
    const runnerScript = path.join(subDir, 'auto-apply-runner.js');
    if (!fs.existsSync(runnerScript)) {
      return res.status(400).json({
        error: `Runner script not found at ${runnerScript}. To run automation directly on your machine with browser UI, run in your terminal: node wellfound_autoApply/auto-apply-runner.js wellfound ${isLive ? '--live' : ''} ${visible ? '--visible' : ''}`.trim(),
      });
    }

    const runnerArgs = [runnerScript, 'wellfound'];
    if (isLive) runnerArgs.push('--live');
    if (visible) runnerArgs.push('--visible');

    const runnerProc = spawn('node', runnerArgs, {
      cwd: subDir,
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
    });

    runnerProc.on('error', (err) => {
      runnerState.isRunning = false;
      runnerState.pid = null;
      runnerState.logs.push(`[${new Date().toLocaleTimeString()}] Runner error: ${err.message}`);
    });

    runnerState.isRunning = true;
    runnerState.pid = runnerProc.pid || null;
    runnerState.mode = isLive ? 'LIVE' : 'DRY_RUN';
    runnerState.visible = !!visible;
    runnerState.max = Number(max) || 5;
    runnerState.startedAt = new Date();
    runnerState.logs = [`[${new Date().toLocaleTimeString()}] Started runner in ${runnerState.mode} mode (visible=${visible})`];

    runnerProc.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      const lines = text.split('\n').filter(Boolean);
      runnerState.logs.push(...lines);
      if (runnerState.logs.length > 500) {
        runnerState.logs = runnerState.logs.slice(-300);
      }
    });

    runnerProc.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      const lines = text.split('\n').filter(Boolean);
      runnerState.logs.push(...lines);
    });

    runnerProc.on('close', async (code) => {
      runnerState.isRunning = false;
      runnerState.pid = null;
      runnerState.logs.push(`[${new Date().toLocaleTimeString()}] Process exited with code ${code}`);

      // Auto-sync CSV to database whenever a live run finishes
      if (isLive) {
        try {
          await syncWellfoundApplicationsFromCsv(getCsvFile());
          runnerState.logs.push(`[${new Date().toLocaleTimeString()}] Auto-synced applications to database.`);
        } catch (syncErr: any) {
          runnerState.logs.push(`[${new Date().toLocaleTimeString()}] Sync error: ${syncErr.message}`);
        }
      }
    });

    res.json({
      success: true,
      message: `Launched runner in ${runnerState.mode} mode (visible=${visible})`,
      pid: runnerState.pid,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 6. POST /api/wellfound/stop - Cancel running process
wellfoundAutoApplyRouter.post('/wellfound/stop', async (req: Request, res: Response) => {
  try {
    if (!runnerState.isRunning || !runnerState.pid) {
      return res.status(400).json({ message: 'No runner is currently active.' });
    }

    try {
      process.kill(runnerState.pid, 'SIGTERM');
    } catch (e) {}

    runnerState.isRunning = false;
    runnerState.pid = null;
    runnerState.logs.push(`[${new Date().toLocaleTimeString()}] Stopped by user request.`);

    res.json({ success: true, message: 'Automation process stopped.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 7. GET /api/wellfound/script - Get the generated Zen script content to easily copy to clipboard
wellfoundAutoApplyRouter.get('/wellfound/script', async (req: Request, res: Response) => {
  try {
    const zenScript = getZenScript();
    const buildScript = getBuildScript();
    if (!fs.existsSync(zenScript) && fs.existsSync(buildScript)) {
      // Rebuild if missing
      const rebuildProc = spawn('node', [buildScript, '--live'], { cwd: getRootDir() });
      rebuildProc.on('error', (err) => {
        console.warn('Rebuild process error:', err.message);
      });
      await new Promise((resolve) => {
        rebuildProc.on('close', resolve);
        rebuildProc.on('error', () => resolve(null));
      });
    }
    if (!fs.existsSync(zenScript)) {
      return res.status(404).send('// Zen script not yet generated. Please configure and save your profile first.');
    }
    const scriptContent = fs.readFileSync(zenScript, 'utf8');
    res.setHeader('Content-Type', 'text/javascript');
    res.send(scriptContent);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
