import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import { normalizeWellfoundJob, extractWellfoundJobId } from '../connectors/wellfound';
import { normalizeLinkedInJob, extractLinkedInJobId, generatePreApplicationChecklist } from '../connectors/linkedin';

describe('Wellfound & LinkedIn Connectors and Workflows', () => {
  beforeEach(async () => {
    await prisma.emailEvent.deleteMany();
    await prisma.networkingMessage.deleteMany();
    await prisma.networkingContact.deleteMany();
    await prisma.document.deleteMany();
    await prisma.jobApplication.deleteMany();
    await prisma.candidateProfile.deleteMany();
    await prisma.jobListing.deleteMany();

    await prisma.candidateProfile.create({
      data: {
        name: 'Shourya Upadhyaya',
        skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'Go', 'Docker'],
      },
    });
  });

  afterAll(async () => {
    await prisma.emailEvent.deleteMany();
    await prisma.networkingMessage.deleteMany();
    await prisma.networkingContact.deleteMany();
    await prisma.document.deleteMany();
    await prisma.jobApplication.deleteMany();
    await prisma.candidateProfile.deleteMany();
    await prisma.jobListing.deleteMany();
    await prisma.$disconnect();
  });

  describe('Wellfound Normalizer', () => {
    it('extracts ID and normalizes startup job payload', () => {
      const url = 'https://wellfound.com/jobs/2847291-backend-systems-engineer';
      expect(extractWellfoundJobId(url)).toBe('2847291');

      const normalized = normalizeWellfoundJob({
        url,
        title: 'Backend Systems Engineer',
        company: 'Vercel',
        description: '<p>Build next-gen edge infrastructure using <b>Go</b> and <b>TypeScript</b>.</p>',
        location: 'Remote',
        salary: '$120k - $160k',
        equity: '0.1% - 0.25%',
        stage: 'Series D',
      });

      expect(normalized.source).toBe('wellfound');
      expect(normalized.externalId).toBe('2847291');
      expect(normalized.description).not.toContain('<p>');
      expect(normalized.tags).toContain('Series D');
      expect(normalized.tags).toContain('Salary: $120k - $160k');
    });
  });

  describe('LinkedIn Normalizer & Checklist Generator', () => {
    it('extracts numeric job ID and flags Easy Apply', () => {
      const url = 'https://www.linkedin.com/jobs/view/3948572019/';
      expect(extractLinkedInJobId(url)).toBe('3948572019');

      const normalized = normalizeLinkedInJob({
        url,
        title: 'Software Engineer Intern',
        company: 'Microsoft',
        description: 'Join our cloud platform team in Bangalore.',
        isEasyApply: true,
        workplaceType: 'Hybrid',
      });

      expect(normalized.source).toBe('linkedin');
      expect(normalized.externalId).toBe('3948572019');
      expect(normalized.tags).toContain('Easy Apply');
      expect(normalized.tags).toContain('Hybrid');
    });

    it('extracts job ID from various LinkedIn URL formats', () => {
      expect(extractLinkedInJobId('https://www.linkedin.com/jobs/view/4021234567/')).toBe('4021234567');
      expect(extractLinkedInJobId('https://in.linkedin.com/jobs/view/full-stack-engineer-at-selah-4475769875')).toBe('4475769875');
      expect(extractLinkedInJobId('https://www.linkedin.com/jobs/search/?currentJobId=4468619421')).toBe('4468619421');
    });

    it('generates pre-application checklist with Easy Apply recognition', () => {
      const checklist = generatePreApplicationChecklist({
        title: 'Software Engineer Intern',
        company: 'Microsoft',
        url: 'https://www.linkedin.com/jobs/view/3948572019/',
        tags: ['Easy Apply'],
      });

      expect(checklist.applicationType).toBe('EASY_APPLY');
      expect(checklist.steps.length).toBe(4);
      expect(checklist.steps[0].title).toBe('Review Tailored Resume');
      expect(checklist.steps[1].title).toBe('Find Networking Referral Contact');
    });
  });

  describe('REST API Job Import & Handoff', () => {
    it('POST /api/jobs/import/wellfound computes match score and persists', async () => {
      const res = await request(app)
        .post('/api/jobs/import/wellfound')
        .send({
          url: 'https://wellfound.com/jobs/9876543-founding-engineer',
          title: 'Founding Backend Engineer',
          company: 'Superfluid AI',
          description: 'We require strong TypeScript, Node.js, and PostgreSQL for our distributed data engine.',
          location: 'Remote',
          salary: '$140k',
        });

      expect(res.status).toBe(201);
      expect(res.body.job.source).toBe('wellfound');
      expect(res.body.job.company).toBe('Superfluid AI');
      expect(res.body.job.score).toBeGreaterThanOrEqual(60);
      expect(res.body.job.matchedSkills).toContain('TypeScript');
    });

    it('POST /api/jobs/import/linkedin supports trackInPipeline and checklist', async () => {
      const importRes = await request(app)
        .post('/api/jobs/import/linkedin')
        .send({
          url: 'https://www.linkedin.com/jobs/view/4011223344/',
          title: 'Full Stack Engineer Intern',
          company: 'Amazon',
          description: 'Build services using TypeScript and Docker.',
          isEasyApply: true,
          trackInPipeline: true,
          stage: 'BOOKMARKED',
        });

      expect(importRes.status).toBe(201);
      expect(importRes.body.application).toBeDefined();
      expect(importRes.body.application.stage).toBe('BOOKMARKED');
      const jobId = importRes.body.job.id;

      const checklistRes = await request(app).get(`/api/jobs/${jobId}/checklist`);
      expect(checklistRes.status).toBe(200);
      expect(checklistRes.body.checklist.handoffUrl).toContain('linkedin.com');
      expect(checklistRes.body.checklist.steps.length).toBe(4);
    });

    it('POST /api/jobs/scrape/linkedin validates URL parameter', async () => {
      const res = await request(app)
        .post('/api/jobs/scrape/linkedin')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('url is required');
    });
  });
});
