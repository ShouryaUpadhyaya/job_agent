import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

async function reset() {
  await prisma.emailEvent.deleteMany({});
  await prisma.networkingMessage.deleteMany({});
  await prisma.networkingContact.deleteMany({});
  await prisma.document.deleteMany({});
  await prisma.jobApplication.deleteMany({});
  await prisma.jobListing.deleteMany({});
  await prisma.resume.deleteMany({});
  await prisma.candidateProfile.deleteMany({});
  await prisma.syncRun.deleteMany({});
  await prisma.connectedAccount.deleteMany({});
  await prisma.wellfoundRun.deleteMany({});
}

describe('GET /api/overview', () => {
  beforeAll(reset);
  afterAll(reset);

  it('works on an empty database', async () => {
    const res = await request(app).get('/api/overview');
    expect(res.status).toBe(200);
    expect(res.body.jobs).toMatchObject({ active: 0, bySource: {}, internships: 0, apply: 0, review: 0 });
    expect(res.body.jobs.freshness).toEqual({ within3d: 0, within7d: 0, within30d: 0, older: 0 });
    expect(res.body.applications).toMatchObject({ total: 0, applied: 0, responseRate: null });
    expect(res.body.contacts).toMatchObject({ total: 0, vitAlumni: 0 });
    expect(res.body.sync.sources).toEqual([]);
    expect(res.body.gmail).toMatchObject({ connected: false, status: 'NOT_CONNECTED' });
    expect(res.body.wellfound.lastRun).toBeNull();
    expect(res.body.resumes.count).toBe(0);
  });

  it('summarises jobs, applications, contacts, syncs, Gmail and Wellfound', async () => {
    const profile = await prisma.candidateProfile.create({ data: { name: 'Pat', skills: [] } });
    await prisma.resume.create({ data: { candidateProfileId: profile.id, label: 'General', content: 'x', skills: [], isDefault: true } });
    const job = (externalId: string, source: string, extra: object = {}) =>
      prisma.jobListing.create({ data: { externalId, source, title: 'SWE Intern', company: 'Co', url: 'https://x', description: 'd', ...extra } });

    const j1 = await job('o-1', 'greenhouse', { publishedAt: ago(1), status: 'APPLY', isInternship: true });
    const j2 = await job('o-2', 'greenhouse', { publishedAt: ago(5), status: 'REVIEW' });
    const j3 = await job('o-3', 'lever', { publishedAt: ago(20), status: 'APPLY' });
    await job('o-4', 'lever', { publishedAt: ago(90), status: 'PASS' });
    await job('o-5', 'lever', { createdAt: ago(2) }); // no publishedAt → createdAt
    await job('o-6', 'lever', { isActive: false, status: 'APPLY' });

    const app1 = await prisma.jobApplication.create({ data: { jobListingId: j1.id, candidateProfileId: profile.id, stage: 'APPLIED', submittedAt: ago(2) } });
    await prisma.jobApplication.create({ data: { jobListingId: j2.id, candidateProfileId: profile.id, stage: 'INTERVIEWING', submittedAt: ago(20) } });
    await prisma.jobApplication.create({ data: { jobListingId: j3.id, candidateProfileId: profile.id, stage: 'BOOKMARKED' } });
    await prisma.emailEvent.create({
      data: { messageId: 'm1', sender: 'hr@co.com', subject: 'Interview', receivedAt: new Date(), classification: 'INTERVIEW_INVITATION', jobApplicationId: app1.id },
    });

    await prisma.networkingContact.createMany({
      data: [
        { name: 'A', company: 'Co', role: 'SWE', school: 'VIT Vellore', status: 'RESEARCHED' },
        { name: 'B', company: 'Co', role: 'SWE', school: 'Vellore Institute of Technology', status: 'REPLIED' },
        { name: 'C', company: 'Co', role: 'SWE', school: 'University of Delhi', status: 'RESEARCHED' },
      ],
    });

    await prisma.syncRun.createMany({
      data: [
        { source: 'greenhouse', status: 'FAILED', startedAt: ago(0.5), errorMessage: 'boom' },
        { source: 'greenhouse', status: 'SUCCESS', startedAt: ago(0.1), fetchedCount: 10 },
        { source: 'lever', status: 'SUCCESS', startedAt: ago(3) },
      ],
    });
    await prisma.connectedAccount.create({ data: { provider: 'gmail', email: 'pat@gmail.com', accessToken: 'secret', status: 'CONNECTED', lastSyncedAt: ago(0.2) } });
    await prisma.wellfoundRun.create({ data: { mode: 'DRY_RUN', status: 'SUCCEEDED', submittedCount: 0, startedAt: ago(1) } });

    const res = await request(app).get('/api/overview');
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.jobs.active).toBe(5);
    expect(b.jobs.bySource).toEqual({ greenhouse: 2, lever: 3 });
    expect(b.jobs.freshness).toEqual({ within3d: 2, within7d: 1, within30d: 1, older: 1 });
    expect(b.jobs).toMatchObject({ internships: 1, apply: 2, review: 1 });

    expect(b.applications.byStage).toEqual({ APPLIED: 1, INTERVIEWING: 1, BOOKMARKED: 1 });
    expect(b.applications).toMatchObject({ total: 3, newThisWeek: 1, applied: 2, responded: 1, responseRate: 0.5 });

    expect(b.contacts).toMatchObject({ total: 3, vitAlumni: 2, byStatus: { RESEARCHED: 2, REPLIED: 1 } });

    const gh = b.sync.sources.find((s: any) => s.source === 'greenhouse');
    expect(gh).toMatchObject({ status: 'SUCCESS', fetchedCount: 10, failuresLast24h: 1 });
    expect(b.sync.failuresLast24h).toBe(1);

    expect(b.gmail).toMatchObject({ connected: true, email: 'pat@gmail.com' });
    expect(JSON.stringify(b)).not.toContain('secret');
    expect(b.wellfound.lastRun).toMatchObject({ mode: 'DRY_RUN', status: 'SUCCEEDED' });
    expect(b.resumes).toEqual({ count: 1, defaultLabel: 'General' });
  });
});
