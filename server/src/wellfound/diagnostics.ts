import fs from 'fs';
import path from 'path';
import { isValidRunId, runDiagnosticsDir } from './paths';

/**
 * Lists and safely resolves diagnostics artifacts written by the runner:
 * <NN>-<reason>.png / .html / .json, plus trace.zip.
 */

const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export interface DiagnosticArtifact {
  id: string; // "01-logged-out"
  reason: string;
  screenshot: string | null;
  html: string | null;
  json: string | null;
  context: Record<string, unknown> | null;
}

export interface DiagnosticsListing {
  runId: string;
  artifacts: DiagnosticArtifact[];
  files: { name: string; size: number }[];
}

export function listDiagnostics(runId: string): DiagnosticsListing {
  if (!isValidRunId(runId)) throw new Error('invalid run id');
  const dir = runDiagnosticsDir(runId);
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => FILE_RE.test(n)).sort();
  } catch {
    return { runId, artifacts: [], files: [] };
  }
  const files = names.map((name) => ({ name, size: fs.statSync(path.join(dir, name)).size }));
  const groups = new Map<string, DiagnosticArtifact>();
  for (const name of names) {
    const m = name.match(/^(\d+-([a-z0-9-]+))\.(png|html|json)$/i);
    if (!m) continue;
    const [, id, reason, ext] = m;
    const g = groups.get(id) || { id, reason, screenshot: null, html: null, json: null, context: null };
    if (ext === 'png') g.screenshot = name;
    if (ext === 'html') g.html = name;
    if (ext === 'json') {
      g.json = name;
      try {
        g.context = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      } catch {
        g.context = null;
      }
    }
    groups.set(id, g);
  }
  return { runId, artifacts: [...groups.values()], files };
}

/** Absolute path of a diagnostics file, or null for anything outside the run's directory. */
export function resolveDiagnosticFile(runId: string, file: string): string | null {
  if (!isValidRunId(runId) || typeof file !== 'string' || !FILE_RE.test(file) || file.includes('..')) return null;
  const dir = path.resolve(runDiagnosticsDir(runId));
  const full = path.resolve(dir, file);
  if (path.dirname(full) !== dir) return null;
  try {
    return fs.statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

export function countDiagnostics(runId: string): number {
  try {
    return fs.readdirSync(runDiagnosticsDir(runId)).filter((n) => /\.png$/i.test(n)).length;
  } catch {
    return 0;
  }
}
