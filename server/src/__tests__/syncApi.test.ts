import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { syncService } from '../jobs/syncService';

describe('Sync API Endpoints (Deterministic Integration Tests)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/sync/status should return observability info', async () => {
    vi.spyOn(syncService, 'getSyncStatus').mockResolvedValue({
      isSyncing: false,
      totalJobs: 42,
      lastSyncAt: new Date(),
      activeConnectors: [
        { name: 'Greenhouse (Cloudflare)', source: 'Greenhouse' },
        { name: 'Ashby (Linear)', source: 'Ashby' },
        { name: 'Arbeitnow Jobs API', source: 'Arbeitnow' },
      ],
      recentRuns: [],
    });

    const res = await request(app).get('/api/sync/status');
    expect(res.status).toBe(200);
    expect(res.body.isSyncing).toBe(false);
    expect(res.body.totalJobs).toBe(42);
    expect(res.body.activeConnectors).toHaveLength(3);
  });

  it('POST /api/sync should trigger synchronization and return summary', async () => {
    vi.spyOn(syncService, 'syncAll').mockResolvedValue({
      status: 'SUCCESS',
      totalFetched: 15,
      totalNew: 10,
      totalUpdated: 5,
      connectorResults: [
        { source: 'Greenhouse', status: 'SUCCESS', fetched: 10, new: 8, updated: 2 },
        { source: 'Ashby', status: 'SUCCESS', fetched: 5, new: 2, updated: 3 },
      ],
      durationMs: 320,
    });

    const res = await request(app).post('/api/sync').send({ force: true });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Synchronization completed.');
    expect(res.body.summary.status).toBe('SUCCESS');
    expect(res.body.summary.totalFetched).toBe(15);
    expect(res.body.summary.totalNew).toBe(10);
  });

  it('POST /api/sync should return 409 when sync is already in flight', async () => {
    vi.spyOn(syncService, 'syncAll').mockResolvedValue({
      status: 'ALREADY_RUNNING',
      totalFetched: 0,
      totalNew: 0,
      totalUpdated: 0,
      connectorResults: [],
      durationMs: 0,
    });

    const res = await request(app).post('/api/sync').send();
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('already running');
  });

  it('POST /api/sync should return 502 when all connectors fail', async () => {
    vi.spyOn(syncService, 'syncAll').mockResolvedValue({
      status: 'FAILED',
      totalFetched: 0,
      totalNew: 0,
      totalUpdated: 0,
      connectorResults: [
        { source: 'Greenhouse', status: 'FAILED', fetched: 0, new: 0, updated: 0, error: 'Network failure' },
      ],
      durationMs: 50,
    });

    const res = await request(app).post('/api/sync').send();
    expect(res.status).toBe(502);
    expect(res.body.message).toContain('failed');
  });
});
