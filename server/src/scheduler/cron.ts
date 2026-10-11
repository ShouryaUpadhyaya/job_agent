export type ConnectorFn = () => Promise<void> | void;

export class ConnectorScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private intervalMs: number,
    private connectorCallback: ConnectorFn
  ) {}

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(async () => {
      try {
        await this.connectorCallback();
      } catch (error) {
        console.error("Connector invocation failed:", error);
      }
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }
}
