import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import { upsertJobListing } from '../jobs/normalization';

const DAY = 86_400_000;

async function seedJob(over: Record<string, any>) {
  const base = {
    externalId: over.externalId,
    source: over.source || 'greenhouse',
    title: over.title || 'Software Engineer',
    company: over.company || 'Tech Corp',
    url: over.url || `https://example.com/job/${over.externalId}`,
    description: over.description || 'A great job building software.',
    location: over.location || 'Bengaluru, India',
  };
  const listing = await upsertJobListing(base);
  const { externalId, source, title, company, url, description, location, ...rest } = over;
  return Object.keys(rest).length ? prisma.jobListing.update({ where: { id: listing.id }, data: rest }) : listing;
}

describe('Jobs API', () => {
  beforeAll(async () => {
    await prisma.emailEvent.deleteMany({});
    await prisma.document.deleteMany({});
    await prisma.jobApplication.deleteMany({});
    await prisma.networkingContact.deleteMany({});
    await prisma.jobListing.deleteMany({});
  });

  afterAll(async () => {
    await prisma.jobApplication.deleteMany({});
    await prisma.jobListing.deleteMany({});
  });

  it('returns an empty page initially', async () => {
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ jobs: [], total: 0, page: 1, hasMore: false });
  });

  describe('with data', () => {
    let appliedId = '';
    let dismissedId = '';

    beforeAll(async () => {
      const now = Date.now();
      await seedJob({ externalId: 'a', title: 'Backend Engineer Intern', isInternship: true, score: 80, status: 'APPLY', publishedAt: new Date(now - 1 * DAY) });
      await seedJob({ externalId: 'b', title: 'Frontend Intern', company: 'Zeta Labs', isInternship: true, score: 60, status: 'REVIEW', location: 'Remote', source: 'lever', publishedAt: new Date(now - 20 * DAY) });
      await seedJob({ externalId: 'c', title: 'Senior Engineer', company: 'Big Co', score: 5, status: 'SKIP', publishedAt: new Date(now - 3 * DAY) });
      const closed = await seedJob({ externalId: 'd', title: 'Closed Intern Role', isInternship: true, score: 90 });
      await prisma.jobListing.update({ where: { id: closed.id }, data: { isActive: false, closedReason: 'not_in_feed' } });
      const dismissed = await seedJob({ externalId: 'e', title: 'Dismissed Intern Role', isInternship: true, score: 70, userStatus: 'DISMISSED' });
      dismissedId = dismissed.id;
      const applied = await seedJob({ externalId: 'f', title: 'Applied Intern Role', isInternship: true, score: 75, source: 'email:linkedin', url: 'https://www.linkedin.com/jobs/view/4000000001/', publishedAt: new Date(now - 10 * DAY) });
      appliedId = applied.id;
      const profile = await prisma.candidateProfile.findFirst() ?? (await prisma.candidateProfile.create({ data: { name: 'T', skills: [] } }));
      await prisma.jobApplication.create({ data: { jobListingId: applied.id, candidateProfileId: profile.id, stage: 'APPLIED', status: 'SUBMITTED' } });
      // Legacy capitalised source value
      await seedJob({ externalId: 'g', title: 'Platform Intern', source: 'Greenhouse', isInternship: true, score: 50 });
    });

    it('paginates, hides closed and dismissed by default, and sorts by best score', async () => {
      const res = await request(app).get('/api/jobs').query({ pageSize: 2 });
      expect(res.body.total).toBe(5);
      expect(res.body.jobs).toHaveLength(2);
      expect(res.body.hasMore).toBe(true);
      expect(res.body.jobs.map((j: any) => j.title)).toEqual(['Backend Engineer Intern', 'Applied Intern Role']);
      const page3 = await request(app).get('/api/jobs').query({ pageSize: 2, page: 3 });
      expect(page3.body.jobs).toHaveLength(1);
      expect(page3.body.hasMore).toBe(false);
    });

    it('caps pageSize at 100', async () => {
      const res = await request(app).get('/api/jobs').query({ pageSize: 1000 });
      expect(res.body.pageSize).toBe(100);
    });

    it('filters by internship, freshness, sources, score, remote, query and status', async () => {
      const titles = async (q: Record<string, any>) =>
        (await request(app).get('/api/jobs').query(q)).body.jobs.map((j: any) => j.title).sort();

      expect(await titles({ internshipOnly: true })).not.toContain('Senior Engineer');
      expect(await titles({ postedWithinDays: 7 })).toEqual(['Backend Engineer Intern', 'Platform Intern', 'Senior Engineer'].sort());
      expect(await titles({ sources: 'lever,email' })).toEqual(['Applied Intern Role', 'Frontend Intern']);
      expect(await titles({ sources: 'greenhouse' })).toEqual(['Backend Engineer Intern', 'Platform Intern', 'Senior Engineer'].sort());
      expect(await titles({ minScore: 70 })).toEqual(['Applied Intern Role', 'Backend Engineer Intern']);
      expect(await titles({ remote: true })).toEqual(['Frontend Intern']);
      expect(await titles({ q: 'zeta' })).toEqual(['Frontend Intern']);
      expect(await titles({ status: 'SKIP' })).toEqual(['Senior Engineer']);
      expect(await titles({ hideApplied: true })).not.toContain('Applied Intern Role');
      expect(await titles({ hideDismissed: false })).toContain('Dismissed Intern Role');
      expect(await titles({ activeOnly: false })).toContain('Closed Intern Role');
    });

    it('sorts by newest and by company', async () => {
      const newest = await request(app).get('/api/jobs').query({ sort: 'newest' });
      expect(newest.body.jobs[0].title).toBe('Backend Engineer Intern');
      const company = await request(app).get('/api/jobs').query({ sort: 'company' });
      expect(company.body.jobs[0].company).toBe('Big Co');
    });

    it('includes applied stage, freshness and verification info', async () => {
      const res = await request(app).get('/api/jobs').query({ q: 'Applied Intern' });
      const job = res.body.jobs[0];
      expect(job.appliedStage).toBe('APPLIED');
      expect(job.freshness.ageDays).toBe(10);
      expect(job.verified).toBe(false);
      expect(job.verificationLabel).toMatch(/Unverified/);
      expect(job.sourceLabel).toBe('LinkedIn alerts');
    });

    it('returns facets with merged legacy source counts', async () => {
      const res = await request(app).get('/api/jobs/facets');
      expect(res.status).toBe(200);
      const gh = res.body.sources.find((s: any) => s.value === 'greenhouse');
      expect(gh.count).toBe(3);
      expect(res.body.dismissed).toBe(1);
      expect(res.body.closed).toBe(1);
    });

    it('updates the user status', async () => {
      const bad = await request(app).patch(`/api/jobs/${appliedId}/user-status`).send({ userStatus: 'LOVED' });
      expect(bad.status).toBe(400);
      const ok = await request(app).patch(`/api/jobs/${dismissedId}/user-status`).send({ userStatus: 'SAVED' });
      expect(ok.body.userStatus).toBe('SAVED');
      const saved = await request(app).get('/api/jobs').query({ savedOnly: true });
      expect(saved.body.jobs.map((j: any) => j.id)).toEqual([dismissedId]);
      const missing = await request(app).patch('/api/jobs/00000000-0000-0000-0000-000000000000/user-status').send({ userStatus: 'SAVED' });
      expect(missing.status).toBe(404);
    });

    it('imports pasted job details without fetching the URL', async () => {
      const res = await request(app).post('/api/jobs/import').send({
        url: 'https://careers.example.org/jobs/42',
        title: 'Software Engineering Intern',
        company: 'Example Org',
        location: 'Remote',
        description: 'Internship working with TypeScript and Node.js.',
        trackInPipeline: true,
      });
      expect(res.status).toBe(201);
      expect(res.body.job.source).toBe('manual');
      expect(res.body.application.stage).toBe('BOOKMARKED');
      const missing = await request(app).post('/api/jobs/import').send({ url: 'https://x.example/1' });
      expect(missing.status).toBe(400);
    });
  });
});

describe('Discovery API', () => {
  it('GET /api/discovery/search-links returns prefilled links', async () => {
    const res = await request(app).get('/api/discovery/search-links');
    expect(res.status).toBe(200);
    const ids = res.body.links.map((l: any) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['linkedin-india', 'naukri', 'internshala', 'wellfound', 'google-greenhouse', 'x-search']));
  });

  it('GET /api/discovery/x-sources returns the researched list', async () => {
    const res = await request(app).get('/api/discovery/x-sources');
    expect(res.status).toBe(200);
    expect(res.body.searchUrl).toContain('x.com/search');
    expect(Array.isArray(res.body.accounts)).toBe(true);
    for (const a of res.body.accounts) expect(a.url).toMatch(/^https:\/\/(x|twitter)\.com\//);
  });
});
