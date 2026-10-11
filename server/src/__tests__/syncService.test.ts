import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncService } from '../jobs/syncService';
import { JobConnector, RawJobPayload } from '../connectors/types';
import { prisma } from '../db';

class MockSuccessConnector implements JobConnector {
  readonly name = 'Mock Source A';
  readonly source = 'MockA';

  async fetchJobs(): Promise<RawJobPayload[]> {
    return [
      {
        externalId: 'mock-job-001',
        source: 'MockA',
        title: 'Backend Software Engineering Intern',
        company: 'Apex Technologies',
        url: 'https://apex.test/jobs/001',
        description: 'Internship role working with TypeScript, Node.js, and PostgreSQL for 2027/2028 students.',
        location: 'Remote',
      },
      {
        externalId: 'mock-job-002',
        source: 'MockA',
        title: 'Principal Architect',
        company: 'Legacy Corp',
        url: 'https://apex.test/jobs/002',
        description: 'Requires 15+ years experience and leadership.',
        location: 'On-site',
      },
    ];
  }
}

class MockFailingConnector implements JobConnector {
  readonly name = 'Mock Failing Source';
  readonly source = 'MockFail';

  async fetchJobs(): Promise<RawJobPayload[]> {
    throw new Error('Network timeout connecting to upstream ATS');
  }
}

describe('SyncService Integration & Deduplication', () => {
  let syncService: SyncService;

  beforeEach(async () => {
    syncService = new SyncService();
    // Clean up test data
    await prisma.jobApplication.deleteMany({});
    await prisma.document.deleteMany({});
    await prisma.jobListing.deleteMany({
      where: { source: { in: ['MockA', 'MockFail'] } },
    });
    await prisma.syncRun.deleteMany({
      where: { source: { in: ['Mock Source A', 'Mock Failing Source'] } },
    });
    await prisma.candidateProfile.deleteMany({});
    await prisma.candidateProfile.create({
      data: {
        name: 'Test Candidate',
        skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'Docker'],
        experience: { target: '2027 software engineering internships' },
      },
    });
  });

  it('should ingest and score jobs accurately into database', async () => {
    syncService.setConnectors([new MockSuccessConnector()]);

    const result = await syncService.syncAll();
    expect(result.status).toBe('SUCCESS');
    expect(result.totalFetched).toBe(2);
    expect(result.totalNew).toBe(2);
    expect(result.totalUpdated).toBe(0);

    // Verify jobs exist in PostgreSQL
    const savedJobs = await prisma.jobListing.findMany({
      where: { source: 'MockA' },
      orderBy: { externalId: 'asc' },
    });

    expect(savedJobs).toHaveLength(2);
    expect(savedJobs[0].title).toBe('Backend Software Engineering Intern');
    expect(savedJobs[0].status).toBe('APPLY');
    expect(savedJobs[0].score).toBeGreaterThan(50);
    expect(savedJobs[0].matchedSkills).toContain('TypeScript');

    // The principal architect job should be disqualified as SKIP
    expect(savedJobs[1].title).toBe('Principal Architect');
    expect(savedJobs[1].status).toBe('SKIP');
  });

  it('should prevent duplicate records on repeated syncs (idempotency)', async () => {
    syncService.setConnectors([new MockSuccessConnector()]);

    // First sync
    const firstSync = await syncService.syncAll();
    expect(firstSync.totalNew).toBe(2);
    expect(firstSync.totalUpdated).toBe(0);

    const initialCount = await prisma.jobListing.count({
      where: { source: 'MockA' },
    });
    expect(initialCount).toBe(2);

    // Second sync with identical data
    const secondSync = await syncService.syncAll();
    expect(secondSync.totalNew).toBe(0);
    expect(secondSync.totalUpdated).toBe(2);

    // Count must remain exactly 2, not 4
    const finalCount = await prisma.jobListing.count({
      where: { source: 'MockA' },
    });
    expect(finalCount).toBe(2);
  });

  it('should handle partial connector failure without crashing other connectors', async () => {
    syncService.setConnectors([
      new MockSuccessConnector(),
      new MockFailingConnector(),
    ]);

    const result = await syncService.syncAll();
    expect(result.status).toBe('PARTIAL');
    expect(result.totalFetched).toBe(2);
    expect(result.connectorResults).toHaveLength(2);

    const failResult = result.connectorResults.find(r => r.source === 'Mock Failing Source');
    expect(failResult?.status).toBe('FAILED');
    expect(failResult?.error).toContain('Network timeout');

    // Verify failure was recorded in SyncRun table
    const failedRun = await prisma.syncRun.findFirst({
      where: { source: 'Mock Failing Source', status: 'FAILED' },
    });
    expect(failedRun).toBeDefined();
    expect(failedRun?.errorMessage).toContain('Network timeout');
  });

  it('should reject overlapping sync executions when already in progress', async () => {
    syncService.setConnectors([
      {
        name: 'Slow Connector',
        fetchJobs: async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return [];
        },
      },
    ]);

    const p1 = syncService.syncAll();
    const p2 = syncService.syncAll();

    const [res1, res2] = await Promise.all([p1, p2]);
    expect([res1.status, res2.status]).toContain('ALREADY_RUNNING');
  });
});
