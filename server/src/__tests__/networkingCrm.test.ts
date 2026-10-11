import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import { networkingCrmService } from '../networking/crm';

describe('Networking CRM Integration', () => {
  let testProfileId: string;
  let testJobId: string;

  beforeEach(async () => {
    // Clean up
    await prisma.emailEvent.deleteMany();
    await prisma.networkingMessage.deleteMany();
    await prisma.networkingContact.deleteMany();
    await prisma.document.deleteMany();
    await prisma.jobApplication.deleteMany();
    await prisma.candidateProfile.deleteMany();
    await prisma.jobListing.deleteMany();

    const profile = await prisma.candidateProfile.create({
      data: {
        name: 'Shourya Upadhyaya',
        targetGradYear: 2028,
        skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'Go'],
      },
    });
    testProfileId = profile.id;

    const job = await prisma.jobListing.create({
      data: {
        externalId: 'linear-test-1',
        source: 'ashby',
        title: 'Backend Engineer Intern',
        company: 'Linear',
        url: 'https://jobs.ashbyhq.com/linear/1',
        description: 'Backend intern role',
      },
    });
    testJobId = job.id;
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

  describe('Persona Research & Priority Ranking', () => {
    it('generates ranked target personas with VIT Alumni at the top', async () => {
      const targets = await networkingCrmService.generateTargetContactsForCompany('Linear', testJobId);
      expect(targets.length).toBeGreaterThanOrEqual(4);

      // Verify top target is VIT Alumni with highest score
      const topTarget = targets[0];
      expect(topTarget.vitAlumni).toBe(true);
      expect(topTarget.relevanceScore).toBeGreaterThanOrEqual(95);
      expect(topTarget.searchUrl).toContain('linkedin.com/search');
    });
  });

  describe('Strict 300-Character Connection Request Note Generation', () => {
    it('generates connection notes strictly under 300 chars for all personas', () => {
      const alumniNote = networkingCrmService.generateConnectionNote({
        name: 'Ananya Rao',
        company: 'Linear',
        role: 'Senior Software Engineer',
        vitAlumni: true,
      });

      expect(alumniNote.charCount).toBeLessThanOrEqual(300);
      expect(alumniNote.isWithinLimit).toBe(true);
      expect(alumniNote.content).toContain('VIT');

      const recruiterNote = networkingCrmService.generateConnectionNote({
        name: 'David Miller',
        company: 'Linear',
        role: 'University Recruiter',
        vitAlumni: false,
      });

      expect(recruiterNote.charCount).toBeLessThanOrEqual(300);
      expect(recruiterNote.isWithinLimit).toBe(true);
      expect(recruiterNote.content).toContain('SWE Intern');
    });
  });

  describe('Referral Follow-up Generation', () => {
    it('generates personalized referral follow-up with candidate profile context', async () => {
      const contact = await prisma.networkingContact.create({
        data: {
          name: 'Ananya Rao',
          company: 'Linear',
          role: 'Senior Software Engineer',
          profileUrl: 'https://linkedin.com/in/ananyarao',
          vitAlumni: true,
          targetJobId: testJobId,
          status: 'ACCEPTED',
        },
      });

      const referralMsg = await networkingCrmService.generateReferralFollowUp(contact.id);
      expect(referralMsg.type).toBe('REFERRAL_FOLLOWUP');
      expect(referralMsg.content).toContain('VITian');
      expect(referralMsg.content).toContain('Backend Engineer Intern');
      expect(referralMsg.content).toContain('Linear');
    });
  });

  describe('Lifecycle Stage Transitions', () => {
    it('transitions stage to REQUEST_SENT and sets 5-day follow-up reminder', async () => {
      const contact = await prisma.networkingContact.create({
        data: {
          name: 'Sarah Connor',
          company: 'Linear',
          role: 'Engineering Manager',
          profileUrl: 'https://linkedin.com/in/sarahconnor',
          status: 'RESEARCHED',
        },
      });

      const updated = await networkingCrmService.transitionStage(contact.id, 'REQUEST_SENT', 'Sent via LinkedIn web');
      expect(updated.status).toBe('REQUEST_SENT');
      expect(updated.requestSentAt).not.toBeNull();
      expect(updated.nextFollowUpAt).not.toBeNull();
      // Should be ~5 days in future
      const diffDays = Math.round((updated.nextFollowUpAt!.getTime() - Date.now()) / (1000 * 3600 * 24));
      expect(diffDays).toBe(5);
    });
  });

  describe('Networking REST API Endpoints', () => {
    it('POST /api/networking/contacts creates contact and lists via GET', async () => {
      const createRes = await request(app)
        .post('/api/networking/contacts')
        .send({
          name: 'Alex Rivera',
          company: 'Spotify',
          role: 'Backend Engineer',
          profileUrl: 'https://linkedin.com/in/alexrivera',
          vitAlumni: false,
          relevanceScore: 88,
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.name).toBe('Alex Rivera');

      const listRes = await request(app).get('/api/networking/contacts?company=Spotify');
      expect(listRes.status).toBe(200);
      expect(listRes.body.length).toBe(1);
    });

    it('POST /api/networking/contacts/:id/generate-note generates note and creates draft message', async () => {
      const contact = await prisma.networkingContact.create({
        data: {
          name: 'Karan Patel',
          company: 'Spotify',
          role: 'Staff Engineer',
          profileUrl: 'https://linkedin.com/in/karanpatel',
          vitAlumni: true,
        },
      });

      const res = await request(app).post(`/api/networking/contacts/${contact.id}/generate-note`);
      expect(res.status).toBe(200);
      expect(res.body.note.charCount).toBeLessThanOrEqual(300);
      expect(res.body.message.status).toBe('DRAFT');
    });

    it('POST /api/networking/generate-targets with saveToDb persists personas', async () => {
      const res = await request(app)
        .post('/api/networking/generate-targets')
        .send({ company: 'Figma', saveToDb: true });

      expect(res.status).toBe(201);
      expect(res.body.createdContacts.length).toBeGreaterThanOrEqual(4);

      const dbCount = await prisma.networkingContact.count({ where: { company: 'Figma' } });
      expect(dbCount).toBe(res.body.createdContacts.length);
    });
  });
});
