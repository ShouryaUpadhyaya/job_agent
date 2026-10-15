import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../db';
import { SyncService } from '../jobs/syncService';
import { JobConnector, RawJobPayload } from '../connectors/types';
import { checkListing, checkStaleListings, listingVerification, pageLooksClosed, recordFeedSync } from '../jobs/liveness';
import { upsertJobListing } from '../jobs/normalization';

class FeedConnector implements JobConnector {
  readonly name = 'Liveness Feed';
  readonly source = 'greenhouse';
  readonly feedKey = 'greenhouse:livetest';
  constructor(public ids: string[]) {}
  async fetchJobs(): Promise<RawJobPayload[]> {
    return this.ids.map((id) => ({
      externalId: `live-${id}`,
      source: 'greenhouse',
      title: `Engineer ${id}`,
      company: 'Live Co',
      url: `https://boards.greenhouse.io/livetest/jobs/${id}`,
      description: 'Build things.',
    }));
  }
}

const resp = (status: number, body: unknown = '', url = '') =>
  ({
    ok: status < 400,
    status,
    url,
    json: async () => body,
    text: async () => String(body),
  }) as unknown as Response;

describe('feed liveness', () => {
  beforeEach(async () => {
    await prisma.jobApplication.deleteMany({});
    await prisma.jobListing.deleteMany({});
    await prisma.syncRun.deleteMany({ where: { source: 'Liveness Feed' } });
  });

  it('closes listings missing from 2 successful syncs and reactivates them when seen again', async () => {
    const connector = new FeedConnector(['1', '2', '3']);
    const sync = new SyncService();
    sync.setConnectors([connector]);
    await sync.syncAll();
    const tagged = await prisma.jobListing.findFirst({ where: { externalId: 'live-1' } });
    expect(tagged?.tags).toContain('feed:greenhouse:livetest');

    connector.ids = ['1', '2'];
    await sync.syncAll();
    let gone = await prisma.jobListing.findFirst({ where: { externalId: 'live-3' } });
    expect(gone).toMatchObject({ isActive: true, missedSyncs: 1 });

    await sync.syncAll();
    gone = await prisma.jobListing.findFirst({ where: { externalId: 'live-3' } });
    expect(gone).toMatchObject({ isActive: false, closedReason: 'not_in_feed' });
    expect(gone?.closedAt).toBeInstanceOf(Date);

    connector.ids = ['1', '2', '3'];
    await sync.syncAll();
    gone = await prisma.jobListing.findFirst({ where: { externalId: 'live-3' } });
    expect(gone).toMatchObject({ isActive: true, missedSyncs: 0, closedReason: null });
  });

  it('does not penalise listings when a feed fails or returns nothing', async () => {
    const connector = new FeedConnector(['1']);
    const sync = new SyncService();
    sync.setConnectors([connector]);
    await sync.syncAll();
    connector.ids = [];
    await sync.syncAll();
    await sync.syncAll();
    const job = await prisma.jobListing.findFirst({ where: { externalId: 'live-1' } });
    expect(job).toMatchObject({ isActive: true, missedSyncs: 0 });
  });

  it('ignores email and manual feeds', async () => {
    expect(await recordFeedSync('email:linkedin', new Date(), 5)).toEqual({ missed: 0, closed: 0 });
    expect(await recordFeedSync(undefined, new Date(), 5)).toEqual({ missed: 0, closed: 0 });
  });
});

describe('stale listing checks', () => {
  beforeEach(async () => {
    await prisma.jobApplication.deleteMany({});
    await prisma.jobListing.deleteMany({});
  });

  it('recognises closed job pages', () => {
    expect(pageLooksClosed('<h1>This job is no longer accepting applications</h1>')).toBe(true);
    expect(pageLooksClosed('<p>The position has been filled.</p>')).toBe(true);
    expect(pageLooksClosed('<p>Apply now for this role</p>')).toBe(false);
  });

  it('uses ATS per-job APIs and never fetches LinkedIn/Naukri', async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.includes('/jobs/404') ? resp(404) : resp(200, {})));
    const deps = { fetchImpl: fetchImpl as unknown as typeof fetch };
    expect((await checkListing({ externalId: '404', source: 'greenhouse', url: 'https://x.com/a', tags: ['feed:greenhouse:acme'] }, deps)).verdict).toBe('closed');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://boards-api.greenhouse.io/v1/boards/acme/jobs/404');
    expect((await checkListing({ externalId: '5', source: 'greenhouse', url: 'https://x.com/a', tags: ['feed:greenhouse:acme'] }, deps)).verdict).toBe('alive');
    fetchImpl.mockClear();
    const li = await checkListing({ externalId: '1', source: 'email:linkedin', url: 'https://www.linkedin.com/jobs/view/1/', tags: [] }, deps);
    const nk = await checkListing({ externalId: '2', source: 'email:naukri', url: 'https://www.naukri.com/job-listings-x-123456789', tags: [] }, deps);
    expect([li.verdict, nk.verdict]).toEqual(['skipped', 'skipped']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('checks Ashby boards once per run', async () => {
    const fetchImpl = vi.fn(async () => resp(200, { jobs: [{ id: 'keep' }] }));
    const cache = new Map();
    const deps = { fetchImpl: fetchImpl as unknown as typeof fetch };
    const tags = ['feed:ashby:acme'];
    expect((await checkListing({ externalId: 'keep', source: 'ashby', url: 'https://jobs.ashbyhq.com/acme/keep', tags }, deps, cache)).verdict).toBe('alive');
    expect((await checkListing({ externalId: 'gone', source: 'ashby', url: 'https://jobs.ashbyhq.com/acme/gone', tags }, deps, cache)).verdict).toBe('closed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('closes old listings whose page is gone and records lastCheckedAt', async () => {
    const old = new Date(Date.now() - 10 * 86_400_000);
    const mk = async (id: string, url: string, publishedAt = old) => {
      const j = await upsertJobListing({ externalId: id, source: 'manual', title: 'Intern', company: 'Co', url, description: 'x' });
      return prisma.jobListing.update({ where: { id: j.id }, data: { publishedAt } });
    };
    const gone = await mk('gone', 'https://careers.example.com/gone');
    const filled = await mk('filled', 'https://careers.example.com/filled');
    const live = await mk('live', 'https://careers.example.com/live');
    const fresh = await mk('fresh', 'https://careers.example.com/fresh', new Date());
    const linkedin = await mk('li', 'https://www.linkedin.com/jobs/view/123456789/');

    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/gone')) return resp(404);
      if (url.endsWith('/filled')) return resp(200, '<p>Sorry, this position has been filled.</p>');
      return resp(200, '<p>Apply</p>');
    });
    const summary = await checkStaleListings({ fetchImpl: fetchImpl as unknown as typeof fetch, delayMs: 0 });
    expect(summary).toMatchObject({ checked: 3, closed: 2, alive: 1 });
    expect(fetchImpl.mock.calls.map((c) => c[0]).sort()).toEqual([
      'https://careers.example.com/filled',
      'https://careers.example.com/gone',
      'https://careers.example.com/live',
    ]);

    const rows = await prisma.jobListing.findMany({ where: { id: { in: [gone.id, filled.id, live.id, fresh.id, linkedin.id] } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(gone.id)).toMatchObject({ isActive: false, closedReason: 'http_404' });
    expect(byId.get(filled.id)).toMatchObject({ isActive: false, closedReason: 'closed_page' });
    expect(byId.get(live.id)?.isActive).toBe(true);
    expect(byId.get(live.id)?.lastCheckedAt).toBeInstanceOf(Date);
    expect(byId.get(fresh.id)?.lastCheckedAt).toBeNull();
    expect(byId.get(linkedin.id)?.lastCheckedAt).toBeNull();

    // Checked within 24h → not re-checked.
    const again = await checkStaleListings({ fetchImpl: fetchImpl as unknown as typeof fetch, delayMs: 0 });
    expect(again.checked).toBe(0);
  });

  it('labels restricted-host listings as unverified', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    const v = listingVerification(
      {
        url: 'https://www.linkedin.com/jobs/view/1/',
        source: 'email:linkedin',
        isActive: true,
        lastSeenAt: now,
        lastCheckedAt: null,
        publishedAt: new Date('2026-10-01T00:00:00Z'),
        createdAt: now,
        tags: [],
      },
      now
    );
    expect(v).toEqual({ verified: false, ageDays: 14, label: 'Unverified, older than 14 days' });
  });
});
