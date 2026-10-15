import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BRIEFING_CHECK_INTERVAL_MS,
  ConnectorScheduler,
  DailyBriefingTrigger,
  GmailSyncDeps,
  gmailAutoSyncEnabled,
  runScheduledGmailSync,
} from '../src/scheduler/cron';
import { scheduledRunDue } from '../src/briefing/summary';
import { istDateKey } from '../src/lib/time';

describe('Connector Scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should periodically invoke the connector callback', async () => {
    const callback = vi.fn();
    const scheduler = new ConnectorScheduler(1000, callback);

    scheduler.start();

    expect(callback).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledTimes(2);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledTimes(2); // Should not increase
  });
});

/** In-memory stand-in for the DailyJobSearchSummary table: IST date -> generatedAt. */
function memoryStore() {
  const rows = new Map<string, Date>();
  const generate = vi.fn(async (now: Date) => {
    rows.set(istDateKey(now), now);
  });
  const isDue = vi.fn(async (now: Date) => scheduledRunDue(now, rows.get(istDateKey(now)) ?? null));
  return { rows, generate, isDue };
}

/** IST wall-clock time on a given date, as a Date. */
const ist = (date: string, time: string) => new Date(`${date}T${time}:00.000+05:30`);

describe('Daily briefing trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not run before 20:00 IST', async () => {
    vi.setSystemTime(ist('2026-10-15', '19:50'));
    const store = memoryStore();
    const trigger = new DailyBriefingTrigger(store, () => new Date());
    trigger.start();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000); // 19:55
    expect(store.generate).not.toHaveBeenCalled();
    expect(store.isDue).toHaveBeenCalledTimes(2); // startup check + one tick
    trigger.stop();
  });

  it('runs once at/after 20:00 IST and never again that day', async () => {
    vi.setSystemTime(ist('2026-10-15', '19:58'));
    const store = memoryStore();
    const trigger = new DailyBriefingTrigger(store, () => new Date());
    trigger.start();
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000); // until 22:58
    expect(store.generate).toHaveBeenCalledTimes(1);
    const at = store.generate.mock.calls[0][0] as Date;
    expect(at.getTime()).toBeGreaterThanOrEqual(ist('2026-10-15', '20:00').getTime());
    expect(at.getTime()).toBeLessThan(ist('2026-10-15', '20:05').getTime());
    trigger.stop();
  });

  it('skips when the day was already generated after 20:00 (e.g. before a restart)', async () => {
    vi.setSystemTime(ist('2026-10-15', '21:10'));
    const store = memoryStore();
    store.rows.set('2026-10-15', ist('2026-10-15', '20:02'));
    const trigger = new DailyBriefingTrigger(store, () => new Date());
    expect(await trigger.check()).toBe('not-due');
    expect(store.generate).not.toHaveBeenCalled();
  });

  it('replaces a briefing generated earlier in the day on first view', async () => {
    vi.setSystemTime(ist('2026-10-15', '20:01'));
    const store = memoryStore();
    store.rows.set('2026-10-15', ist('2026-10-15', '09:15'));
    const trigger = new DailyBriefingTrigger(store, () => new Date());
    expect(await trigger.check()).toBe('generated');
    expect(await trigger.check()).toBe('not-due');
    expect(store.generate).toHaveBeenCalledTimes(1);
  });

  it('catches up at 21:xx when the 20:xx checks were missed (server down)', async () => {
    const store = memoryStore();
    vi.setSystemTime(ist('2026-10-15', '21:17'));
    const trigger = new DailyBriefingTrigger(store, () => new Date());
    trigger.start(); // startup check
    await vi.advanceTimersByTimeAsync(0);
    expect(store.generate).toHaveBeenCalledTimes(1);
    expect(istDateKey(store.generate.mock.calls[0][0] as Date)).toBe('2026-10-15');
    await vi.advanceTimersByTimeAsync(BRIEFING_CHECK_INTERVAL_MS * 6);
    expect(store.generate).toHaveBeenCalledTimes(1);
    trigger.stop();
  });

  it('a slow sync does not block it: checks never overlap and a busy check is skipped', async () => {
    vi.setSystemTime(ist('2026-10-15', '20:00'));
    let release!: () => void;
    const generate = vi.fn(() => new Promise<void>((r) => (release = r)));
    const trigger = new DailyBriefingTrigger({ isDue: async () => true, generate }, () => new Date());
    const first = trigger.check();
    await vi.advanceTimersByTimeAsync(0);
    expect(await trigger.check()).toBe('busy');
    release();
    expect(await first).toBe('generated');
  });

  it('maps 00:00–05:30 IST to the new IST day (not due until that evening)', async () => {
    const store = memoryStore();
    store.rows.set('2026-10-15', ist('2026-10-15', '20:01'));
    // 00:30 IST on Oct 16 is still Oct 15 in UTC.
    const early = ist('2026-10-16', '00:30');
    expect(early.toISOString().slice(0, 10)).toBe('2026-10-15');
    expect(istDateKey(early)).toBe('2026-10-16');
    vi.setSystemTime(early);
    const trigger = new DailyBriefingTrigger(store, () => new Date());
    expect(await trigger.check()).toBe('not-due');
    vi.setSystemTime(ist('2026-10-16', '05:29'));
    expect(await trigger.check()).toBe('not-due');
    vi.setSystemTime(ist('2026-10-16', '20:00'));
    expect(await trigger.check()).toBe('generated');
    expect([...store.rows.keys()]).toEqual(['2026-10-15', '2026-10-16']);
  });

  it('backs off for 30 minutes after a failure, then retries', async () => {
    vi.setSystemTime(ist('2026-10-15', '20:00'));
    const generate = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);
    const trigger = new DailyBriefingTrigger({ isDue: async () => true, generate }, () => new Date());
    expect(await trigger.check()).toBe('failed');
    vi.setSystemTime(ist('2026-10-15', '20:10'));
    expect(await trigger.check()).toBe('backoff');
    vi.setSystemTime(ist('2026-10-15', '20:31'));
    expect(await trigger.check()).toBe('generated');
  });

  it('scheduledRunDue', () => {
    expect(scheduledRunDue(ist('2026-10-15', '19:59'), null)).toBe(false);
    expect(scheduledRunDue(ist('2026-10-15', '20:00'), null)).toBe(true);
    expect(scheduledRunDue(ist('2026-10-15', '23:59'), ist('2026-10-15', '12:00'))).toBe(true);
    expect(scheduledRunDue(ist('2026-10-15', '23:59'), ist('2026-10-15', '20:00'))).toBe(false);
  });
});

describe('Scheduled Gmail sync', () => {
  const deps = (over: Partial<GmailSyncDeps> = {}): GmailSyncDeps => ({
    isConfigured: () => true,
    isConnected: vi.fn(async () => true),
    isSyncing: vi.fn(async () => false),
    sync: vi.fn(async () => ({ fetched: 3, new: 2, errors: 0, stageChanges: 1 })),
    ...over,
  });

  afterEach(() => {
    delete process.env.GMAIL_AUTO_SYNC;
    vi.restoreAllMocks();
  });

  it('syncs when configured and connected', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const d = deps();
    expect(await runScheduledGmailSync(d)).toBe('synced');
    expect(d.sync).toHaveBeenCalledTimes(1);
  });

  it('skips silently when not configured or not connected', async () => {
    const notConfigured = deps({ isConfigured: () => false });
    expect(await runScheduledGmailSync(notConfigured)).toBe('not-configured');
    expect(notConfigured.sync).not.toHaveBeenCalled();
    const notConnected = deps({ isConnected: vi.fn(async () => false) });
    expect(await runScheduledGmailSync(notConnected)).toBe('not-connected');
    expect(notConnected.sync).not.toHaveBeenCalled();
  });

  it('skips while a manual sync is running, including a 409 race', async () => {
    const running = deps({ isSyncing: vi.fn(async () => true) });
    expect(await runScheduledGmailSync(running)).toBe('busy');
    expect(running.sync).not.toHaveBeenCalled();
    const race = deps({ sync: vi.fn(async () => Promise.reject(Object.assign(new Error('busy'), { code: 'sync_in_progress' }))) });
    expect(await runScheduledGmailSync(race)).toBe('busy');
  });

  it('never throws on sync errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = deps({ sync: vi.fn(async () => Promise.reject(new Error('boom'))) });
    expect(await runScheduledGmailSync(failing)).toBe('failed');
  });

  it('can be turned off with GMAIL_AUTO_SYNC=false', async () => {
    process.env.GMAIL_AUTO_SYNC = 'false';
    const d = deps();
    expect(await runScheduledGmailSync(d)).toBe('disabled');
    expect(d.isConnected).not.toHaveBeenCalled();
    expect(gmailAutoSyncEnabled({})).toBe(true);
  });
});
