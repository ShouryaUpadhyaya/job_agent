import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import { gmailService } from '../email/service';
import { classifyJobEmail } from '../email/classifier';

describe('Gmail Service & Classifier Integration', () => {
  let testProfileId: string;
  let testJobId: string;
  let testAppId: string;
  let testContactId: string;

  beforeEach(async () => {
    // Clean up test data
    await prisma.emailEvent.deleteMany();
    await prisma.networkingMessage.deleteMany();
    await prisma.networkingContact.deleteMany();
    await prisma.document.deleteMany();
    await prisma.jobApplication.deleteMany();
    await prisma.candidateProfile.deleteMany();
    await prisma.jobListing.deleteMany();

    // Create candidate profile
    const profile = await prisma.candidateProfile.create({
      data: {
        name: 'Shourya Upadhyaya',
        targetGradYear: 2028,
        skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
      },
    });
    testProfileId = profile.id;

    // Create test job listing
    const job = await prisma.jobListing.create({
      data: {
        externalId: 'cloudflare-test-1',
        source: 'greenhouse',
        title: 'Systems Engineering Intern',
        company: 'Cloudflare',
        url: 'https://boards.greenhouse.io/cloudflare/jobs/1',
        description: 'Systems engineer role',
      },
    });
    testJobId = job.id;

    // Create test application
    const appRecord = await prisma.jobApplication.create({
      data: {
        jobListingId: testJobId,
        candidateProfileId: testProfileId,
        stage: 'APPLIED',
        status: 'SUBMITTED',
      },
    });
    testAppId = appRecord.id;

    // Create test networking contact
    const contact = await prisma.networkingContact.create({
      data: {
        name: 'Priya Sharma',
        company: 'Cloudflare',
        role: 'Senior Software Engineer',
        profileUrl: 'https://linkedin.com/in/priyasharma',
        vitAlumni: true,
        status: 'REQUEST_SENT',
      },
    });
    testContactId = contact.id;
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

  describe('Classifier Heuristics', () => {
    it('classifies interview invitations with high confidence', () => {
      const result = classifyJobEmail({
        subject: 'Cloudflare: Invitation to Interview for Systems Engineering Intern',
        body: 'We would love to schedule a technical screen with our engineering team.',
        sender: 'recruiting@cloudflare.com',
      });

      expect(result.classification).toBe('INTERVIEW_INVITATION');
      expect(result.confidence).toBeGreaterThan(0.85);
      expect(result.company).toBe('Cloudflare');
    });

    it('classifies coding assessments', () => {
      const result = classifyJobEmail({
        subject: 'Spotify: Next Steps - HackerRank Coding Challenge',
        body: 'Please complete the online assessment within 5 days.',
        sender: 'talent@spotify.com',
      });

      expect(result.classification).toBe('ASSESSMENT');
      expect(result.suggestedAction).toContain('assessment');
    });

    it('classifies LinkedIn connection acceptance and extracts person', () => {
      const result = classifyJobEmail({
        subject: 'Priya Sharma accepted your invitation to connect',
        body: 'Priya Sharma is now a connection on LinkedIn.',
        sender: 'invitations@linkedin.com',
      });

      expect(result.classification).toBe('LINKEDIN_CONNECTION_ACCEPTED');
      expect(result.extractedPerson).toBe('Priya Sharma');
    });

    it('classifies rejections and offers accurately', () => {
      const rejection = classifyJobEmail({
        subject: 'Update regarding your application',
        body: 'Unfortunately, we have decided to move forward with other candidates.',
      });
      expect(rejection.classification).toBe('REJECTION');

      const offer = classifyJobEmail({
        subject: 'Official Offer of Employment: Software Engineer Intern',
        body: 'We are pleased to offer you the position with our team!',
      });
      expect(offer.classification).toBe('OFFER');
    });
  });

  describe('Correlation & Database Automation', () => {
    it('updates JobApplication stage to INTERVIEWING when interview email arrives', async () => {
      const { event } = await gmailService.processEmail({
        messageId: 'msg-interview-101',
        sender: 'recruiting@cloudflare.com',
        subject: 'Invitation to Interview at Cloudflare',
        snippet: 'Please select a time on our calendar for your technical interview.',
      });

      expect(event.classification).toBe('INTERVIEW_INVITATION');
      expect(event.jobApplicationId).toBe(testAppId);

      const updatedApp = await prisma.jobApplication.findUnique({
        where: { id: testAppId },
      });
      expect(updatedApp?.stage).toBe('INTERVIEWING');
    });

    it('updates NetworkingContact to ACCEPTED and drafts referral message on LinkedIn connection email', async () => {
      const { event } = await gmailService.processEmail({
        messageId: 'msg-linkedin-102',
        sender: 'invitations@linkedin.com',
        subject: 'Priya Sharma accepted your invitation to connect',
        snippet: 'Priya Sharma is now a connection.',
      });

      expect(event.classification).toBe('LINKEDIN_CONNECTION_ACCEPTED');
      expect(event.networkingContactId).toBe(testContactId);

      // Verify contact was transitioned to ACCEPTED
      const updatedContact = await prisma.networkingContact.findUnique({
        where: { id: testContactId },
        include: { messages: true },
      });
      expect(updatedContact?.status).toBe('ACCEPTED');
      expect(updatedContact?.acceptedAt).not.toBeNull();

      // Verify draft referral message was created
      expect(updatedContact?.messages.length).toBeGreaterThan(0);
      const draftMessage = updatedContact?.messages[0];
      expect(draftMessage?.type).toBe('REFERRAL_FOLLOWUP');
      expect(draftMessage?.status).toBe('DRAFT');
      expect(draftMessage?.content).toContain('fellow VITian');
    });
  });

  describe('Gmail REST API Endpoints', () => {
    it('GET /api/gmail/status returns connection details', async () => {
      const res = await request(app).get('/api/gmail/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('connected');
      expect(res.body).toHaveProperty('totalEventsTracked');
    });

    it('GET /api/gmail/auth-url returns Google OAuth URL', async () => {
      const res = await request(app).get('/api/gmail/auth-url');
      expect(res.status).toBe(200);
      expect(res.body.url).toContain('accounts.google.com');
      expect(res.body.url).toContain('scope');
    });

    it('POST /api/gmail/simulate processes and records a new email', async () => {
      const res = await request(app)
        .post('/api/gmail/simulate')
        .send({
          sender: 'jobs@uber.com',
          subject: 'Uber: Application Received for SWE Intern',
          snippet: 'Thank you for applying to Uber. We received your application.',
        });

      expect(res.status).toBe(201);
      expect(res.body.classification.classification).toBe('APPLICATION_CONFIRMATION');

      const eventsRes = await request(app).get('/api/gmail/events');
      expect(eventsRes.status).toBe(200);
      expect(eventsRes.body.length).toBeGreaterThan(0);
    });
  });
});
