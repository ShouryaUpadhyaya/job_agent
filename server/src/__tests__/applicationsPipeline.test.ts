import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';

describe('Applications Pipeline API', () => {
  let candidateId: string;
  let jobId: string;

  beforeEach(async () => {
    await prisma.jobApplication.deleteMany({});
    await prisma.document.deleteMany({});
    await prisma.jobListing.deleteMany({ where: { source: 'test-pipeline' } });
    await prisma.candidateProfile.deleteMany({});

    const profile = await prisma.candidateProfile.create({
      data: {
        name: 'Pipeline Candidate',
        skills: ['TypeScript', 'React'],
      },
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

  it('should create an application with BOOKMARKED stage by default', async () => {
    const res = await request(app)
      .post('/api/applications')
      .send({
        jobListingId: jobId,
        candidateProfileId: candidateId,
      });

    expect(res.status).toBe(201);
    expect(res.body.stage).toBe('BOOKMARKED');
    expect(res.body.isApproved).toBe(false);
  });

  it('should transition through stages via PATCH', async () => {
    const appRecord = await prisma.jobApplication.create({
      data: {
        jobListingId: jobId,
        candidateProfileId: candidateId,
        stage: 'BOOKMARKED',
      },
    });

    const res = await request(app)
      .patch(`/api/applications/${appRecord.id}`)
      .send({
        stage: 'INTERVIEWING',
        notes: 'Passed initial technical screen with hiring manager.',
      });

    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('INTERVIEWING');
    expect(res.body.notes).toContain('Passed initial technical screen');
  });

  it('should enforce human approval before submitting', async () => {
    const appRecord = await prisma.jobApplication.create({
      data: {
        jobListingId: jobId,
        candidateProfileId: candidateId,
        isApproved: false,
      },
    });

    // Unapproved attempt should fail with 403
    const failRes = await request(app).post(`/api/applications/${appRecord.id}/submit`);
    expect(failRes.status).toBe(403);
    expect(failRes.body.error).toContain('explicit approval');

    // Approve application
    await prisma.jobApplication.update({
      where: { id: appRecord.id },
      data: { isApproved: true },
    });

    // Approved attempt should succeed
    const okRes = await request(app).post(`/api/applications/${appRecord.id}/submit`);
    expect(okRes.status).toBe(200);
    expect(okRes.body.status).toBe('SUBMITTED');
    expect(okRes.body.stage).toBe('APPLIED');
    expect(okRes.body.submittedAt).not.toBeNull();
  });
});
