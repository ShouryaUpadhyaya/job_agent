import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../app';

describe('Applications API', () => {
  beforeAll(async () => {
    await prisma.jobApplication.deleteMany();
    await prisma.jobListing.deleteMany();
    await prisma.candidateProfile.deleteMany();
  });

  it('should create and fetch an application', async () => {
    const job = await prisma.jobListing.create({
      data: {
        externalId: 'ext-123',
        source: 'test',
        title: 'Software Engineer',
        company: 'Test Co',
        url: 'http://example.com',
        description: 'Great job',
      }
    });

    const profile = await prisma.candidateProfile.create({
      data: {
        name: 'Test Candidate',
        skills: ['TypeScript']
      }
    });

    const res = await request(app)
      .post('/api/applications')
      .send({
        jobListingId: job.id,
        candidateProfileId: profile.id,
        status: 'APPLIED',
        notes: 'looks good'
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('APPLIED');
    expect(res.body.notes).toBe('looks good');
    expect(res.body.jobListingId).toBe(job.id);

    const getRes = await request(app).get('/api/applications');
    expect(getRes.status).toBe(200);
    expect(getRes.body).toHaveLength(1);
    expect(getRes.body[0].jobListing.title).toBe('Software Engineer');
    expect(getRes.body[0].candidateProfile.name).toBe('Test Candidate');
  });
});
