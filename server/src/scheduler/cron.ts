import { syncService } from '../jobs/syncService';

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

let activeScheduler: ConnectorScheduler | null = null;

export function initScheduler(intervalMinutes?: number): ConnectorScheduler {
  if (activeScheduler) {
    return activeScheduler;
  }

  const minutes = intervalMinutes ?? parseInt(process.env.SYNC_INTERVAL_MINUTES || '60', 10);
  const intervalMs = Math.max(minutes, 1) * 60 * 1000;

  activeScheduler = new ConnectorScheduler(intervalMs, async () => {
    console.log('[Scheduler] Executing scheduled background sync...');
    const result = await syncService.syncAll();
    console.log(`[Scheduler] Sync finished: ${result.status} (Fetched: ${result.totalFetched}, New: ${result.totalNew}, Updated: ${result.totalUpdated})`);
  });

  activeScheduler.start();
  console.log(`[Scheduler] Initialized background scheduler (Interval: ${minutes} min)`);
  return activeScheduler;
}

export function shutdownScheduler() {
  if (activeScheduler) {
    activeScheduler.stop();
    activeScheduler = null;
    console.log('[Scheduler] Background scheduler gracefully stopped.');
  }
}
