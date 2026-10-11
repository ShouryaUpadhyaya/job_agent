import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectorScheduler } from '../src/scheduler/cron';

describe('Connector Scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
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
