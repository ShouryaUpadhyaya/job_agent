import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import { dailyBriefingService } from '../briefing/summary';
import { shouldRunDailyBriefingNow } from '../scheduler/cron';

describe('Daily Job-Search Executive Briefing', () => {
  beforeEach(async () => {
    await prisma.dailyJobSearchSummary.deleteMany();
    await prisma.emailEvent.deleteMany();
    await prisma.networkingMessage.deleteMany();
    await prisma.networkingContact.deleteMany();
    await prisma.document.deleteMany();
    await prisma.jobApplication.deleteMany();
    await prisma.candidateProfile.deleteMany();
    await prisma.jobListing.deleteMany();

    // Create test candidate profile
    const profile = await prisma.candidateProfile.create({
      data: {
        name: 'Shourya Upadhyaya',
        skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
      },
    });

    // Create job listings
    const job1 = await prisma.jobListing.create({
      data: {
        externalId: 'briefing-job-1',
        source: 'greenhouse',
        title: 'Core Systems Intern',
        company: 'Cloudflare',
        url: 'https://cloudflare.com/jobs/1',
        description: 'Systems role',
        score: 95,
      },
    });

    const job2 = await prisma.jobListing.create({
      data: {
        externalId: 'briefing-job-2',
        source: 'ashby',
        title: 'Backend Software Intern',
        company: 'Linear',
        url: 'https://linear.app/careers/2',
        description: 'Backend role',
        score: 88,
      },
    });

    // Create test application
    await prisma.jobApplication.create({
      data: {
        jobListingId: job1.id,
        candidateProfileId: profile.id,
        stage: 'INTERVIEWING',
        status: 'SUBMITTED',
      },
    });

    // Create test email events
    await prisma.emailEvent.create({
      data: {
        messageId: 'event-interview-99',
        sender: 'talent@cloudflare.com',
        subject: 'Invitation to Interview at Cloudflare',
        snippet: 'Pick a time for your systems interview',
        receivedAt: new Date(),
        classification: 'INTERVIEW_INVITATION',
        company: 'Cloudflare',
        suggestedAction: 'Select calendar slot promptly',
      },
    });

    // Create accepted networking contact
    await prisma.networkingContact.create({
      data: {
        name: 'Rohan Sharma',
        company: 'Cloudflare',
        role: 'Staff Engineer',
        profileUrl: 'https://linkedin.com/in/rohansharma',
        vitAlumni: true,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.dailyJobSearchSummary.deleteMany();
    await prisma.emailEvent.deleteMany();
    await prisma.networkingMessage.deleteMany();
    await prisma.networkingContact.deleteMany();
    await prisma.document.deleteMany();
    await prisma.jobApplication.deleteMany();
    await prisma.candidateProfile.deleteMany();
    await prisma.jobListing.deleteMany();
    await prisma.$disconnect();
  });

  describe('8:00 PM IST Timezone Verification', () => {
    it('correctly maps 14:30 UTC to 20:00 (8:00 PM) IST', () => {
      // 14:30 UTC = 20:00 (8:00 PM) IST (+5h 30m)
      const targetUtc = new Date(Date.UTC(2026, 9, 12, 14, 30, 0));
      expect(shouldRunDailyBriefingNow(targetUtc, 20)).toBe(true);

      // 10:00 UTC = 15:30 IST (should be false for 20:00)
      const nonTargetUtc = new Date(Date.UTC(2026, 9, 12, 10, 0, 0));
      expect(shouldRunDailyBriefingNow(nonTargetUtc, 20)).toBe(false);
    });
  });

  describe('Briefing Generation & Content Structure', () => {
    it('generates structured Markdown with Needs Attention and top roles', async () => {
      const briefing = await dailyBriefingService.generateDailyBriefing();

      expect(briefing.metrics.interviewsCount).toBe(1);
      expect(briefing.metrics.needsAttentionCount).toBeGreaterThanOrEqual(1);
      expect(briefing.content).toContain('Daily Job-Search Executive Briefing');
      expect(briefing.content).toContain('Needs Attention');
      expect(briefing.content).toContain('Cloudflare');
      expect(briefing.topJobs.length).toBe(2);

      // Verify persisted in DB
      const dbSummary = await prisma.dailyJobSearchSummary.findFirst();
      expect(dbSummary).not.toBeNull();
      expect(dbSummary?.interviewsCount).toBe(1);
    });
  });

  describe('Briefing REST API Endpoints', () => {
    it('GET /api/briefing/today and POST /api/briefing/generate', async () => {
      const getRes = await request(app).get('/api/briefing/today');
      expect(getRes.status).toBe(200);
      expect(getRes.body).toHaveProperty('content');
      expect(getRes.body.interviewsCount).toBe(1);

      const forceRes = await request(app).post('/api/briefing/generate');
      expect(forceRes.status).toBe(200);
      expect(forceRes.body).toHaveProperty('metrics');

      const historyRes = await request(app).get('/api/briefing/history');
      expect(historyRes.status).toBe(200);
      expect(historyRes.body.length).toBeGreaterThanOrEqual(1);
    });
  });
});
