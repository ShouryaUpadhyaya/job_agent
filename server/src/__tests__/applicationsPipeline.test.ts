import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';

const DAY = 24 * 60 * 60 * 1000;

describe('Applications Pipeline API', () => {
  let candidateId: string;
  let jobId: string;

  beforeEach(async () => {
    await prisma.document.deleteMany({});
    await prisma.emailEvent.deleteMany({});
    await prisma.jobApplication.deleteMany({});
    await prisma.networkingMessage.deleteMany({});
    await prisma.networkingContact.deleteMany({});
    await prisma.jobListing.deleteMany({ where: { source: 'test-pipeline' } });
    await prisma.resume.deleteMany({});
    await prisma.candidateProfile.deleteMany({});

    const profile = await prisma.candidateProfile.create({
      data: { name: 'Pipeline Candidate', skills: ['TypeScript', 'React'] },
    });
    candidateId = profile.id;

    const job = await prisma.jobListing.create({
      data: {
        externalId: 'pipe-001',
        source: 'test-pipeline',
        title: 'Full Stack Engineer',
        company: 'Scale AI',
        url: 'https://scale.com/careers/pipe-001',
        description: 'TypeScript and React roles.',
      },
    });
    jobId = job.id;
  });

  const makeJob = (externalId: string, company: string, score: number, extra: Record<string, unknown> = {}) =>
    prisma.jobListing.create({
      data: {
        externalId,
        source: 'test-pipeline',
        title: `${company} Intern`,
        company,
        companyKey: company.toLowerCase(),
        url: `https://example.com/${externalId}`,
        description: 'x',
        score,
        ...extra,
      },
    });

  const makeApp = (jobListingId: string, data: Record<string, unknown> = {}) =>
    prisma.jobApplication.create({
      data: { jobListingId, candidateProfileId: candidateId, ...data },
    });

  it('creates an application with BOOKMARKED stage by default', async () => {
    const res = await request(app).post('/api/applications').send({ jobListingId: jobId, candidateProfileId: candidateId });
    expect(res.status).toBe(201);
    expect(res.body.stage).toBe('BOOKMARKED');
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.isApproved).toBe(false);
    expect(res.body.companyKey).toBe('scaleai');
  });

  it('does not create a duplicate when the same job is saved twice', async () => {
    const first = await request(app).post('/api/applications').send({ jobListingId: jobId });
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/applications').send({ jobListingId: jobId, stage: 'APPLIED' });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.stage).toBe('BOOKMARKED');
    expect(await prisma.jobApplication.count({ where: { jobListingId: jobId } })).toBe(1);
  });

  it('creates a profile when none exists and rejects unknown jobs and stages', async () => {
    await prisma.candidateProfile.deleteMany({});
    const ok = await request(app).post('/api/applications').send({ jobListingId: jobId });
    expect(ok.status).toBe(201);

    expect((await request(app).post('/api/applications').send({ jobListingId: 'nope' })).status).toBe(404);
    expect((await request(app).post('/api/applications').send({ jobListingId: jobId, stage: 'WAT' })).status).toBe(400);
    expect((await request(app).post('/api/applications').send({})).status).toBe(400);
  });

  it('transitions stages via PATCH, syncing status and submittedAt', async () => {
    const appRecord = await makeApp(jobId, { stage: 'BOOKMARKED' });

    const res = await request(app)
      .patch(`/api/applications/${appRecord.id}`)
      .send({ stage: 'INTERVIEWING', notes: 'Passed initial technical screen with hiring manager.' });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('INTERVIEWING');
    expect(res.body.status).toBe('INTERVIEWING');
    expect(res.body.notes).toContain('Passed initial technical screen');

    const applied = await request(app).patch(`/api/applications/${appRecord.id}`).send({ stage: 'APPLIED' });
    expect(applied.body.status).toBe('SUBMITTED');
    const stamped = applied.body.submittedAt;
    expect(stamped).not.toBeNull();

    const again = await request(app).patch(`/api/applications/${appRecord.id}`).send({ stage: 'APPLIED' });
    expect(again.body.submittedAt).toBe(stamped);

    const archived = await request(app).patch(`/api/applications/${appRecord.id}`).send({ stage: 'ARCHIVED' });
    expect(archived.status).toBe(200);
    expect(archived.body.stage).toBe('ARCHIVED');
    expect(archived.body.fit.score).toBe(0);

    const back = await request(app).patch(`/api/applications/${appRecord.id}`).send({ stage: 'BOOKMARKED' });
    expect(back.body.status).toBe('DRAFT');
  });

  it('rejects invalid PATCH input', async () => {
    const appRecord = await makeApp(jobId);
    expect((await request(app).patch(`/api/applications/${appRecord.id}`).send({ stage: 'DONE' })).status).toBe(400);
    expect((await request(app).patch(`/api/applications/${appRecord.id}`).send({ status: 'SUBMITTED' })).status).toBe(400);
    expect((await request(app).patch(`/api/applications/missing`).send({ notes: 'x' })).status).toBe(404);
  });

  it('enforces human approval before submitting', async () => {
    const appRecord = await makeApp(jobId, { isApproved: false });

    const failRes = await request(app).post(`/api/applications/${appRecord.id}/submit`);
    expect(failRes.status).toBe(403);
    expect(failRes.body.error).toContain('explicit approval');

    await prisma.jobApplication.update({ where: { id: appRecord.id }, data: { isApproved: true } });

    const okRes = await request(app).post(`/api/applications/${appRecord.id}/submit`);
    expect(okRes.status).toBe(200);
    expect(okRes.body.status).toBe('SUBMITTED');
    expect(okRes.body.stage).toBe('APPLIED');
    expect(okRes.body.submittedAt).not.toBeNull();
  });

  describe('listing, filters and sorts', () => {
    let ids: Record<string, string>;

    beforeEach(async () => {
      const now = Date.now();
      const alpha = await makeJob('a', 'Alpha', 90);
      const beta = await makeJob('b', 'Beta', 60);
      const gamma = await makeJob('c', 'Gamma', 75, { isActive: false, closedReason: 'gone' });
      const delta = await makeJob('d', 'Delta', 95);

      const a = await makeApp(alpha.id, { stage: 'BOOKMARKED', companyKey: 'alpha', source: 'manual', notes: 'dream company' });
      const b = await makeApp(beta.id, {
        stage: 'INTERVIEWING',
        status: 'INTERVIEWING',
        companyKey: 'beta',
        source: 'wellfound',
        submittedAt: new Date(now - 5 * DAY),
        lastEmailAt: new Date(now - DAY),
      });
      const c = await makeApp(gamma.id, { stage: 'APPLIED', status: 'SUBMITTED', companyKey: 'gamma', source: 'email', submittedAt: new Date(now - DAY) });
      const d = await makeApp(delta.id, { stage: 'REJECTED', status: 'REJECTED', companyKey: 'delta', source: 'manual' });
      ids = { alpha: a.id, beta: b.id, gamma: c.id, delta: d.id };

      // Beta: 2 VIT alumni (one engaged) + 1 other; Gamma: 1 alumnus.
      await prisma.networkingContact.createMany({
        data: [
          { name: 'B One', company: 'Beta', companyKey: 'beta', role: 'SWE', vitAlumni: true, status: 'REPLIED' },
          { name: 'B Two', company: 'Beta', companyKey: 'beta', role: 'SWE', school: 'VIT Vellore' },
          { name: 'B Three', company: 'Beta', companyKey: 'beta', role: 'Recruiter' },
          { name: 'G One', company: 'Gamma', companyKey: 'gamma', role: 'SWE', vitAlumni: true },
        ],
      });
    });

    const list = async (query: Record<string, string> = {}) => {
      const res = await request(app).get('/api/applications').query(query);
      expect(res.status).toBe(200);
      return res.body as Array<{ id: string; [k: string]: any }>;
    };
    const order = (rows: Array<{ id: string }>) =>
      rows.map((r) => Object.keys(ids).find((k) => ids[k] === r.id));

    it('returns people per company from one batched lookup', async () => {
      const rows = await list({ sort: 'company' });
      const beta = rows.find((r) => r.id === ids.beta)!;
      expect(beta.people.count).toBe(3);
      expect(beta.people.alumniCount).toBe(2);
      expect(beta.people.engagedCount).toBe(1);
      expect(beta.people.topContacts.length).toBeLessThanOrEqual(3);
      expect(beta.job).toMatchObject({ company: 'Beta', score: 60, isActive: true });
      const gamma = rows.find((r) => r.id === ids.gamma)!;
      expect(gamma.job.isActive).toBe(false);
      expect(gamma.job.closedReason).toBe('gone');
    });

    it('sorts by match score with rejected applications last', async () => {
      expect(order(await list({ sort: 'match' }))).toEqual(['alpha', 'gamma', 'beta', 'delta']);
    });

    it('sorts by VIT alumni then match', async () => {
      expect(order(await list({ sort: 'alumni' }))).toEqual(['beta', 'gamma', 'alpha', 'delta']);
    });

    it('sorts by fit, rejected scoring 0 at the bottom', async () => {
      const rows = await list({ sort: 'fit' });
      const scores = rows.map((r) => r.fit.score);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
      expect(order(rows)[3]).toBe('delta');
      expect(rows[3].fit.score).toBe(0);
      // Beta's alumni, engaged contact, interview and recent email outweigh its lower match.
      expect(order(rows)[0]).toBe('beta');
    });

    it('sorts by applied date (unapplied last) and company', async () => {
      expect(order(await list({ sort: 'applied' })).slice(0, 2)).toEqual(['gamma', 'beta']);
      expect(order(await list({ sort: 'company' }))).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    });

    it('filters by stage list, source, search and alumni', async () => {
      expect(order(await list({ stage: 'APPLIED,INTERVIEWING', sort: 'company' }))).toEqual(['beta', 'gamma']);
      expect(order(await list({ source: 'wellfound' }))).toEqual(['beta']);
      expect(order(await list({ q: 'dream' }))).toEqual(['alpha']);
      expect(order(await list({ q: 'gamma' }))).toEqual(['gamma']);
      expect(order(await list({ hasAlumni: 'true', sort: 'company' }))).toEqual(['beta', 'gamma']);
    });

    it('returns stage counts', async () => {
      const res = await request(app).get('/api/applications/stats');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(4);
      expect(res.body.stages).toMatchObject({ BOOKMARKED: 1, INTERVIEWING: 1, APPLIED: 1, REJECTED: 1, ARCHIVED: 0 });
      expect(res.body.sources).toMatchObject({ manual: 2, wellfound: 1, email: 1 });
    });
  });
});
