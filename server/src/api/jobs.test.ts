import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import { upsertJobListing } from '../jobs/normalization';

describe('GET /api/jobs', () => {
  beforeAll(async () => {
    // Clear jobs before testing
    await prisma.jobApplication.deleteMany({}); await prisma.jobListing.deleteMany({});
  });

  afterAll(async () => {
    await prisma.jobApplication.deleteMany({}); await prisma.jobListing.deleteMany({});
    await prisma.$disconnect();
  });

  it('should return empty list initially', async () => {
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('should return inserted jobs', async () => {
    await upsertJobListing({
      externalId: '123',
      source: 'test',
      title: 'Software Engineer',
      company: 'Tech Corp',
      url: 'https://example.com/job/123',
      description: 'A great job.',
      status: 'NEW',
      score: 10,
    });

    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Software Engineer');
  });
});
