import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../app';

describe('Copilot API & Submission Enforcement', () => {
  beforeAll(async () => {
    // Clear DB
    await prisma.document.deleteMany();
    await prisma.jobApplication.deleteMany();
    await prisma.jobListing.deleteMany();
    await prisma.candidateProfile.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('generates a mock cover letter', async () => {
    const res = await request(app)
      .post('/api/copilot/generate')
      .send({
        type: 'COVER_LETTER',
        candidateProfileId: 'test-profile',
        jobListingId: 'test-job',
      });
    expect(res.status).toBe(200);
    expect(res.body.content).toContain('Dear Hiring Manager');
  });

  it('prevents submission without explicit approval', async () => {
    const job = await prisma.jobListing.create({
      data: { externalId: 'job-1', source: 'test', title: 'SWE', company: 'Tech', url: 'https://test', description: 'desc' }
    });
    const profile = await prisma.candidateProfile.create({
      data: { name: 'Alice', skills: ['JS'] }
    });
    const application = await prisma.jobApplication.create({
      data: { jobListingId: job.id, candidateProfileId: profile.id, isApproved: false }
    });

    const res = await request(app)
      .post(`/api/applications/${application.id}/submit`)
      .send({});
      
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Application cannot be submitted without explicit approval');
  });

  it('allows submission when approved', async () => {
    const job = await prisma.jobListing.create({
      data: { externalId: 'job-2', source: 'test', title: 'SWE', company: 'Tech', url: 'https://test', description: 'desc' }
    });
    const profile = await prisma.candidateProfile.create({
      data: { name: 'Bob', skills: ['TS'] }
    });
    const application = await prisma.jobApplication.create({
      data: { jobListingId: job.id, candidateProfileId: profile.id, isApproved: true }
    });

    const res = await request(app)
      .post(`/api/applications/${application.id}/submit`)
      .send({});
      
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUBMITTED');
  });

  it('generates an answer for screening questions via copilot API', async () => {
    const res = await request(app)
      .post('/api/copilot/generate-answer')
      .send({
        question: 'What experience do you have with backend microservices?',
      });

    expect(res.status).toBe(200);
    expect(res.body.question).toBe('What experience do you have with backend microservices?');
    expect(typeof res.body.answer).toBe('string');
    expect(res.body.answer.length).toBeGreaterThan(10);
  }, 20000);
});
