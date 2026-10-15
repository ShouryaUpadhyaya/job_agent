import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { requireScript, scriptsLib } from '../wellfound/paths';
import { parseEnv, updateEnvText } from '../wellfound/envFile';
import { resolveDiagnosticFile, listDiagnostics } from '../wellfound/diagnostics';
import { countTodayApplications } from '../connectors/wellfoundAutoApplyService';

const build = requireScript<{
  buildConsoleScript: (o: { live: boolean; max?: number; dailyCap?: number }) => string;
  buildZenBundle: (o: any) => string;
}>('build-wellfound-paste.js');
const lib = requireScript<any>('lib.js');

describe('DRY_RUN safety', () => {
  it('injects DRY_RUN in both directions and refuses sources without the flag', () => {
    expect(scriptsLib().injectDryRun('const CONFIG = { DRY_RUN: false, x: 1 }', true)).toContain('DRY_RUN: true');
    expect(scriptsLib().injectDryRun('const CONFIG = { DRY_RUN: true, x: 1 }', false)).toContain('DRY_RUN: false');
    expect(scriptsLib().injectDryRun('const CONFIG = { DRY_RUN:false }', true)).toContain('DRY_RUN: true');
    expect(() => scriptsLib().injectDryRun('const CONFIG = {}', true)).toThrow(/DRY_RUN flag not found/);
  });

  it('a dry-run build contains DRY_RUN: true and never DRY_RUN: false', () => {
    const src = build.buildConsoleScript({ live: false, max: 2 });
    expect(src).toContain('DRY_RUN: true');
    expect(src).not.toContain('DRY_RUN: false');
    expect(src).toContain('MAX_APPLICATIONS: 2');
  });

  it('only an explicit live=true builds a live script', () => {
    expect(build.buildConsoleScript({ live: true, max: 1 })).toContain('DRY_RUN: false');
    expect(() => build.buildConsoleScript({ live: 'yes' as any })).toThrow(/explicit boolean/);
  });

  it('the Zen bundle excludes the Gemini key unless passed explicitly', () => {
    const config = { CV: lib.buildCv({ name: 'A' }), rules: { dailyCap: 25 } };
    const header = (s: string) => s.split('\n').slice(0, 2).join('\n');
    expect(header(build.buildZenBundle({ live: false, max: 1, config }))).not.toContain('geminiKey');
    expect(header(build.buildZenBundle({ live: false, max: 1, config, geminiKey: 'k-123' }))).toContain('"geminiKey":"k-123"');
  });

  it('build removes the hard-coded gender pick and dead keyword lists, and honours the consent rule', () => {
    const src = build.buildConsoleScript({ live: false });
    expect(src).not.toMatch(/\/male\/i\.test\(l\) && !\/female\/i/);
    expect(src).not.toContain('TITLE_KEYWORDS');
    expect(src).toContain('RULES.autoTickTerms === false');
    expect(src).toContain("CV.gender");
  });
});

describe('IST "today" counting', () => {
  const rows = [
    { date: '10/14/2026, 11:50:00 PM' }, // legacy host-local (IST) format: 14 Oct 23:50 IST
    { date: '2026-10-14T18:20:00.000Z' }, // ISO: 14 Oct 23:50 IST
    { date: '2026-10-14T18:40:00.000Z' }, // ISO: 15 Oct 00:10 IST
    { date: '10/13/2026, 2:40:23 PM' },
    { date: 'garbage' },
  ];

  it('counts rows on the IST calendar day, including legacy CSV dates', () => {
    expect(countTodayApplications(rows, new Date('2026-10-14T18:25:00.000Z'))).toBe(2); // 23:55 IST on the 14th
    expect(lib.countToday(rows, new Date('2026-10-14T18:25:00.000Z'))).toBe(2);
  });

  it('rolls over at IST midnight, not UTC midnight', () => {
    // 00:05 IST on the 15th (still the 14th in UTC)
    expect(countTodayApplications(rows, new Date('2026-10-14T18:35:00.000Z'))).toBe(1);
    expect(lib.countToday(rows, new Date('2026-10-14T18:35:00.000Z'))).toBe(1);
    // a new day with no applications yet
    expect(countTodayApplications(rows, new Date('2026-10-16T04:00:00.000Z'))).toBe(0);
  });

  it('parses the legacy format as IST', () => {
    expect(lib.parseRunnerTimestamp('10/14/2026, 2:40:23 PM').toISOString()).toBe('2026-10-14T09:10:23.000Z');
  });
});

describe('.env editing', () => {
  it('keeps unknown keys and comments and escapes values', () => {
    const before = '# keep me\nGOOGLE_EMAIL=me@example.com\nGEMINI_KEY=old\nOTHER="a b"\nGEMINI_KEY=dupe\n';
    const after = updateEnvText(before, { GEMINI_KEY: 'new"val\nINJECTED=1', NEW_KEY: 'x' });
    expect(after).toContain('# keep me');
    expect(after).toContain('GOOGLE_EMAIL=me@example.com');
    expect(after).toContain('OTHER="a b"');
    expect(after.match(/^GEMINI_KEY=/gm)).toHaveLength(1);
    expect(after).not.toMatch(/^INJECTED=/m);
    const parsed = parseEnv(after);
    expect(parsed.GEMINI_KEY).toBe('new"val\nINJECTED=1');
    expect(parsed.NEW_KEY).toBe('x');
    expect(parsed.GOOGLE_EMAIL).toBe('me@example.com');
  });

  it('rejects invalid keys', () => {
    expect(() => updateEnvText('', { 'BAD KEY': 'x' })).toThrow();
  });
});

describe('diagnostics paths', () => {
  it('rejects path traversal and serves only files inside the run directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-diag-'));
    const prev = process.env.WELLFOUND_DIAGNOSTICS_DIR;
    process.env.WELLFOUND_DIAGNOSTICS_DIR = tmp;
    try {
      fs.mkdirSync(path.join(tmp, 'run-1'));
      fs.writeFileSync(path.join(tmp, 'run-1', '01-logged-out.png'), 'png');
      fs.writeFileSync(path.join(tmp, 'run-1', '01-logged-out.json'), '{"reason":"logged-out"}');
      fs.writeFileSync(path.join(tmp, 'secret.txt'), 'nope');

      expect(resolveDiagnosticFile('run-1', '01-logged-out.png')).toBe(path.join(tmp, 'run-1', '01-logged-out.png'));
      expect(resolveDiagnosticFile('run-1', '../secret.txt')).toBeNull();
      expect(resolveDiagnosticFile('run-1', '..')).toBeNull();
      expect(resolveDiagnosticFile('..', 'secret.txt')).toBeNull();
      expect(resolveDiagnosticFile('run-1', '/etc/passwd')).toBeNull();
      expect(resolveDiagnosticFile('run-1', 'missing.png')).toBeNull();

      const listing = listDiagnostics('run-1');
      expect(listing.artifacts).toHaveLength(1);
      expect(listing.artifacts[0]).toMatchObject({ id: '01-logged-out', reason: 'logged-out', screenshot: '01-logged-out.png', context: { reason: 'logged-out' } });
    } finally {
      if (prev === undefined) delete process.env.WELLFOUND_DIAGNOSTICS_DIR;
      else process.env.WELLFOUND_DIAGNOSTICS_DIR = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
