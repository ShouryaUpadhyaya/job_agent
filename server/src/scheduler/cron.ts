import { syncService } from '../jobs/syncService';
import { checkStaleListings } from '../jobs/liveness';

export type ConnectorFn = () => Promise<void> | void;

export class ConnectorScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isExecuting = false;

  constructor(
    private intervalMs: number,
    private connectorCallback: ConnectorFn
  ) {}

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(async () => {
      // Prevent overlapping duplicate execution if prior run is still in-flight
      if (this.isExecuting) {
        console.warn('[ConnectorScheduler] Skipping scheduled run: prior run still executing.');
        return;
      }

      this.isExecuting = true;
      try {
        await this.connectorCallback();
      } catch (error) {
        console.error('[ConnectorScheduler] Scheduled execution error:', error);
      } finally {
        this.isExecuting = false;
      }
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    this.isExecuting = false;
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      isExecuting: this.isExecuting,
      intervalMs: this.intervalMs,
    };
  }
}

import { dailyBriefingService } from '../briefing/summary';
import { istDateKey } from '../lib/time';

let activeScheduler: ConnectorScheduler | null = null;
let activeBriefingTrigger: DailyBriefingTrigger | null = null;

export const BRIEFING_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const BRIEFING_RETRY_AFTER_FAILURE_MS = 30 * 60 * 1000;

export type BriefingCheckResult = 'not-due' | 'generated' | 'busy' | 'backoff' | 'failed';

export interface BriefingTriggerDeps {
  /** True when it's 20:00 IST or later and today's scheduled briefing hasn't been generated. */
  isDue(now: Date): Promise<boolean>;
  generate(now: Date): Promise<unknown>;
}

const defaultBriefingDeps: BriefingTriggerDeps = {
  isDue: (now) => dailyBriefingService.isScheduledRunDue(now),
  generate: (now) => dailyBriefingService.generate(now, 'scheduled'),
};

/**
 * Generates the daily briefing once per IST day at/after 20:00 IST. Runs on its own short
 * interval (independent of the long job sync) and checks once on start, so a missed 20:00 tick
 * (server down, long sync) is caught up later the same evening. "Already generated" lives in the
 * database (one row per IST day), so restarts never duplicate it.
 */
export class DailyBriefingTrigger {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastFailure: { day: string; at: number } | null = null;

  constructor(
    private deps: BriefingTriggerDeps = defaultBriefingDeps,
    private clock: () => Date = () => new Date(),
    private intervalMs: number = BRIEFING_CHECK_INTERVAL_MS
  ) {}

  async check(): Promise<BriefingCheckResult> {
    if (this.running) return 'busy';
    this.running = true;
    const now = this.clock();
    try {
      const day = istDateKey(now);
      if (this.lastFailure && this.lastFailure.day === day && now.getTime() - this.lastFailure.at < BRIEFING_RETRY_AFTER_FAILURE_MS) {
        return 'backoff';
      }
      if (!(await this.deps.isDue(now))) return 'not-due';
      console.log(`[Scheduler] Generating the daily briefing for ${day} (IST)...`);
      await this.deps.generate(now);
      this.lastFailure = null;
      console.log('[Scheduler] Daily briefing generated.');
      return 'generated';
    } catch (err) {
      this.lastFailure = { day: istDateKey(now), at: now.getTime() };
      console.error('[Scheduler] Daily briefing error:', err);
      return 'failed';
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  isStarted() {
    return this.timer !== null;
  }
}

export function initScheduler(intervalMinutes?: number): ConnectorScheduler {
  if (activeScheduler) {
    return activeScheduler;
  }

  const minutes = intervalMinutes ?? parseInt(process.env.SYNC_INTERVAL_MINUTES || '60', 10);
  const intervalMs = Math.max(minutes, 1) * 60 * 1000;

  activeScheduler = new ConnectorScheduler(intervalMs, async () => {
    console.log('[Scheduler] Executing scheduled background sync...');
    try {
      const result = await syncService.syncAll();
      console.log(`[Scheduler] Sync finished: ${result.status} (Fetched: ${result.totalFetched}, New: ${result.totalNew}, Updated: ${result.totalUpdated})`);
    } catch (err) {
      console.error('[Scheduler] Sync error:', err);
    }

    // Close listings older than a week that have been taken down (never fetches LinkedIn/Naukri)
    try {
      const liveness = await checkStaleListings({ limit: 40, olderThanDays: 7 });
      console.log('[Scheduler] Liveness check:', liveness);
    } catch (err) {
      console.error('[Scheduler] Liveness check error:', err);
    }

    // Import new rows from the Wellfound applications.csv (idempotent; never downgrades a stage)
    try {
      const { syncWellfoundApplicationsFromCsv } = await import('../connectors/wellfoundAutoApplyService');
      const wfResult = await syncWellfoundApplicationsFromCsv();
      if (wfResult.newImported > 0 || wfResult.advanced > 0) {
        console.log(`[Scheduler] Wellfound auto-sync: ${wfResult.newImported} new, ${wfResult.advanced} advanced.`);
      }
    } catch (err) {
      console.error('[Scheduler] Wellfound sync error:', err);
    }
  });

  activeScheduler.start();
  console.log(`[Scheduler] Initialized background scheduler (Interval: ${minutes} min)`);

  // Daily briefing: separate lightweight check so the long sync above can't delay or skip it.
  activeBriefingTrigger = new DailyBriefingTrigger();
  activeBriefingTrigger.start();
  return activeScheduler;
}

export function shutdownScheduler() {
  if (activeBriefingTrigger) {
    activeBriefingTrigger.stop();
    activeBriefingTrigger = null;
  }
  if (activeScheduler) {
    activeScheduler.stop();
    activeScheduler = null;
    console.log('[Scheduler] Background scheduler gracefully stopped.');
  }
}

