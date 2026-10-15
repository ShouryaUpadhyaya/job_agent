import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../app';

describe('Applications API', () => {
  beforeAll(async () => {
    await prisma.document.deleteMany();
    await prisma.emailEvent.deleteMany();
    await prisma.jobApplication.deleteMany();
    await prisma.networkingMessage.deleteMany();
    await prisma.networkingContact.deleteMany();
    await prisma.jobListing.deleteMany();
    await prisma.resume.deleteMany();
    await prisma.candidateProfile.deleteMany();
  });

  it('should create and fetch an application without profile or document contents', async () => {
    const job = await prisma.jobListing.create({
      data: {
        externalId: 'ext-123',
        source: 'test',
        title: 'Software Engineer',
        company: 'Test Co',
        location: 'Bengaluru',
        url: 'http://example.com',
        description: 'Great job',
        score: 77,
      },
    });

    const profile = await prisma.candidateProfile.create({
      data: { name: 'Test Candidate', skills: ['TypeScript'], rawResume: 'SECRET RESUME TEXT' },
    });

    const res = await request(app)
      .post('/api/applications')
      .send({ jobListingId: job.id, candidateProfileId: profile.id, stage: 'APPLIED', notes: 'looks good' });

    expect(res.status).toBe(201);
    expect(res.body.duplicate).toBe(false);
    expect(res.body.stage).toBe('APPLIED');
    expect(res.body.status).toBe('SUBMITTED');
    expect(res.body.submittedAt).not.toBeNull();
    expect(res.body.notes).toBe('looks good');
    expect(res.body.jobListingId).toBe(job.id);
    expect(res.body.source).toBe('manual');
    expect(res.body.companyKey).toBe('test');

    await prisma.document.create({
      data: { type: 'COVER_LETTER', content: 'DOC BODY', candidateProfileId: profile.id, jobApplicationId: res.body.id },
    });

    const getRes = await request(app).get('/api/applications');
    expect(getRes.status).toBe(200);
    expect(getRes.body).toHaveLength(1);
    const item = getRes.body[0];
    expect(item.job).toMatchObject({ title: 'Software Engineer', company: 'Test Co', location: 'Bengaluru', score: 77 });
    expect(item.documentCount).toBe(1);
    expect(item.people).toMatchObject({ count: 0, alumniCount: 0 });
    expect(typeof item.fit.score).toBe('number');
    expect(item.fit.breakdown).toHaveLength(6);
    expect(item.candidateProfile).toBeUndefined();
    const raw = JSON.stringify(getRes.body);
    expect(raw).not.toContain('SECRET RESUME TEXT');
    expect(raw).not.toContain('DOC BODY');

    const one = await request(app).get(`/api/applications/${res.body.id}`);
    expect(one.status).toBe(200);
    expect(one.body.documents).toEqual([expect.objectContaining({ type: 'COVER_LETTER' })]);
    expect(JSON.stringify(one.body)).not.toContain('DOC BODY');

    // Delete works even with a document attached.
    const del = await request(app).delete(`/api/applications/${res.body.id}`);
    expect(del.status).toBe(200);
  });
});
