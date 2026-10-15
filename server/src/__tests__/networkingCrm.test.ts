import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import { networkingCrmService } from '../networking/crm';

async function wipe() {
  await prisma.emailEvent.deleteMany();
  await prisma.networkingMessage.deleteMany();
  await prisma.networkingContact.deleteMany();
  await prisma.document.deleteMany();
  await prisma.jobApplication.deleteMany();
  await prisma.candidateProfile.deleteMany();
  await prisma.jobListing.deleteMany();
}

const DAY = 24 * 60 * 60 * 1000;

describe('Networking CRM API', () => {
  let profileId: string;
  let jobId: string;

  beforeEach(async () => {
    await wipe();
    const profile = await prisma.candidateProfile.create({
      data: { name: 'Asha Rao', school: 'VIT Vellore', targetGradYear: 2028, skills: ['TypeScript', 'Go'] },
    });
    profileId = profile.id;
    const job = await prisma.jobListing.create({
      data: {
        externalId: 'linear-1',
        source: 'ashby',
        title: 'Backend Engineer Intern',
        company: 'Linear',
        companyKey: 'linear',
        url: 'https://jobs.ashbyhq.com/linear/1',
        description: 'Backend intern role',
      },
    });
    jobId = job.id;
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  describe('no fabricated contacts', () => {
    it('generate-targets returns search links and saves nobody', async () => {
      const res = await request(app).post('/api/networking/generate-targets').send({ company: 'Figma', saveToDb: true });
      expect(res.status).toBe(200);
      expect(res.body.createdContacts).toEqual([]);
      expect(res.body.links.length).toBeGreaterThan(0);
      expect(await prisma.networkingContact.count()).toBe(0);
    });

    it('the service no longer exposes persona generators', () => {
      expect((networkingCrmService as any).generateTargetContactsForCompany).toBeUndefined();
    });
  });

  describe('create / validate / dedupe', () => {
    it('creates a verified manual contact and infers persona + school from the headline', async () => {
      const res = await request(app).post('/api/networking/contacts').send({
        name: 'Priya Sharma',
        company: 'Linear Inc.',
        role: 'Software Engineer',
        headline: 'SDE @ Linear | VIT Vellore 2021',
        linkedinUrl: 'linkedin.com/in/Priya-Sharma/',
        xUrl: '@priya_dev',
        email: 'Priya@Example.com',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'Priya Sharma',
        companyKey: 'linear',
        persona: 'ENGINEER',
        school: 'VIT Vellore',
        vitAlumni: true,
        verified: true,
        source: 'MANUAL',
        linkedinUrl: 'https://www.linkedin.com/in/priya-sharma',
        xUrl: 'https://x.com/priya_dev',
        email: 'priya@example.com',
        emailSource: 'manual',
      });
      expect(res.body.priority.score).toBeGreaterThan(0);
      expect(res.body.priority.breakdown.some((b: any) => /VIT/.test(b.label))).toBe(true);
    });

    it('rejects LinkedIn search URLs, bad X handles and bad emails', async () => {
      const base = { name: 'A B', company: 'Linear' };
      const li = await request(app)
        .post('/api/networking/contacts')
        .send({ ...base, linkedinUrl: 'https://www.linkedin.com/search/results/people/?keywords=linear' });
      expect(li.status).toBe(400);
      expect(li.body.fieldErrors.linkedinUrl).toBeDefined();
      const x = await request(app).post('/api/networking/contacts').send({ ...base, xUrl: 'https://x.com/search?q=a' });
      expect(x.status).toBe(400);
      const email = await request(app).post('/api/networking/contacts').send({ ...base, email: 'nope' });
      expect(email.status).toBe(400);
      const missing = await request(app).post('/api/networking/contacts').send({ name: 'No Company' });
      expect(missing.status).toBe(400);
    });

    it('detects duplicates by LinkedIn URL (hard) and name+company (overridable)', async () => {
      await request(app)
        .post('/api/networking/contacts')
        .send({ name: 'Ravi K', company: 'Linear', linkedinUrl: 'https://www.linkedin.com/in/ravik' })
        .expect(201);

      const byUrl = await request(app)
        .post('/api/networking/contacts')
        .send({ name: 'Ravi Kumar', company: 'Other', linkedinUrl: 'https://linkedin.com/in/ravik' });
      expect(byUrl.status).toBe(409);
      expect(byUrl.body.reason).toBe('linkedinUrl');
      expect(byUrl.body.canForce).toBe(false);
      expect(byUrl.body.duplicate.name).toBe('Ravi K');

      const byName = await request(app).post('/api/networking/contacts').send({ name: 'ravi  k', company: 'Linear, Inc.' });
      expect(byName.status).toBe(409);
      expect(byName.body.canForce).toBe(true);

      const forced = await request(app)
        .post('/api/networking/contacts')
        .send({ name: 'ravi k', company: 'Linear', allowDuplicate: true });
      expect(forced.status).toBe(201);
    });
  });

  describe('edit and merge', () => {
    it('PATCH edits name, company, headline, alumni and validates URLs', async () => {
      const c = await prisma.networkingContact.create({ data: { name: 'Old', company: 'Linear', companyKey: 'linear', role: '' } });
      const res = await request(app).patch(`/api/networking/contacts/${c.id}`).send({
        name: 'New Name',
        company: 'Zepto',
        headline: 'Recruiter',
        vitAlumni: true,
        persona: 'RECRUITER',
        targetJobId: jobId,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'New Name', company: 'Zepto', companyKey: 'zepto', vitAlumni: true, persona: 'RECRUITER' });
      expect(res.body.targetJob.id).toBe(jobId);

      const bad = await request(app).patch(`/api/networking/contacts/${c.id}`).send({ linkedinUrl: 'https://example.com/me' });
      expect(bad.status).toBe(400);
      const missing = await request(app).patch('/api/networking/contacts/does-not-exist').send({ name: 'x' });
      expect(missing.status).toBe(404);
    });

    it('merges the other contact into the first and moves its messages and emails', async () => {
      const a = await prisma.networkingContact.create({ data: { name: 'Meera', company: 'Linear', companyKey: 'linear', role: 'SWE' } });
      const b = await prisma.networkingContact.create({
        data: { name: 'Meera S', company: 'Linear', companyKey: 'linear', role: '', email: 'meera@example.com', emailSource: 'gmail', status: 'REPLIED', notes: 'from gmail' },
      });
      await prisma.networkingMessage.create({ data: { contactId: b.id, type: 'REFERRAL_ASK', content: 'hi', status: 'SENT' } });
      const ev = await prisma.emailEvent.create({
        data: { messageId: 'm1', sender: 'meera@example.com', subject: 's', receivedAt: new Date(), classification: 'RECRUITER_OUTREACH', networkingContactId: b.id },
      });

      const res = await request(app).post(`/api/networking/contacts/${a.id}/merge`).send({ otherId: b.id });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: a.id, name: 'Meera', role: 'SWE', email: 'meera@example.com', status: 'REPLIED', notes: 'from gmail' });
      expect(res.body.messages).toHaveLength(1);
      expect(await prisma.networkingContact.findUnique({ where: { id: b.id } })).toBeNull();
      expect((await prisma.emailEvent.findUnique({ where: { id: ev.id } }))!.networkingContactId).toBe(a.id);
    });

    it('DELETE removes messages and unlinks email events', async () => {
      const c = await prisma.networkingContact.create({ data: { name: 'Del', company: 'Linear', role: '' } });
      await prisma.networkingMessage.create({ data: { contactId: c.id, type: 'CONNECTION_NOTE', content: 'x' } });
      const ev = await prisma.emailEvent.create({
        data: { messageId: 'm2', sender: 'a@b.co', subject: 's', receivedAt: new Date(), classification: 'UNKNOWN', networkingContactId: c.id },
      });
      await request(app).delete(`/api/networking/contacts/${c.id}`).expect(200);
      expect(await prisma.networkingMessage.count()).toBe(0);
      expect((await prisma.emailEvent.findUnique({ where: { id: ev.id } }))!.networkingContactId).toBeNull();
    });
  });

  describe('listing, filters and sort', () => {
    beforeEach(async () => {
      await prisma.jobApplication.create({
        data: { jobListingId: jobId, candidateProfileId: profileId, stage: 'APPLIED', companyKey: 'linear' },
      });
      await prisma.networkingContact.createMany({
        data: [
          { name: 'Alumni Engineer', company: 'Linear', companyKey: 'linear', role: 'SWE', persona: 'ENGINEER', school: 'VIT Vellore', vitAlumni: true, linkedinUrl: 'https://www.linkedin.com/in/ae' },
          { name: 'Plain Recruiter', company: 'linear', companyKey: 'linear', role: 'Recruiter', persona: 'RECRUITER' },
          { name: 'Other Co Person', company: 'Acme', companyKey: 'acme', role: 'Founder', persona: 'FOUNDER_CXO', source: 'GITHUB' },
          {
            name: 'Waiting Person',
            company: 'Acme',
            companyKey: 'acme',
            role: 'SWE',
            persona: 'ENGINEER',
            status: 'MESSAGE_SENT',
            nextFollowUpAt: new Date(Date.now() - DAY),
          },
          { name: 'Nope', company: 'Acme', companyKey: 'acme', role: 'SWE', persona: 'ENGINEER', status: 'NOT_INTERESTED' },
        ],
      });
    });

    it('sorts by priority by default (alumni engineer at an applied company first, not-interested last)', async () => {
      const res = await request(app).get('/api/networking/contacts');
      expect(res.status).toBe(200);
      expect(res.body[0].name).toBe('Alumni Engineer');
      expect(res.body[res.body.length - 1].name).toBe('Nope');
      const top = res.body[0];
      expect(top.priority.breakdown.map((b: any) => b.label).join(' ')).toMatch(/applied here/);
      expect(top.applicationStage).toBe('APPLIED');
    });

    it('company match is case-insensitive and keyed', async () => {
      const res = await request(app).get('/api/networking/contacts?company=LINEAR%20Inc');
      expect(res.body.map((c: any) => c.name).sort()).toEqual(['Alumni Engineer', 'Plain Recruiter']);
      const byKey = await request(app).get('/api/networking/contacts?companyKey=linear,acme');
      expect(byKey.body).toHaveLength(5);
    });

    it('q is server-side and case-insensitive; persona/alumni/source filters work', async () => {
      expect((await request(app).get('/api/networking/contacts?q=RECRUIT')).body.map((c: any) => c.name)).toEqual(['Plain Recruiter']);
      expect((await request(app).get('/api/networking/contacts?alumni=true')).body).toHaveLength(1);
      expect((await request(app).get('/api/networking/contacts?persona=FOUNDER_CXO')).body[0].name).toBe('Other Co Person');
      expect((await request(app).get('/api/networking/contacts?source=GITHUB')).body).toHaveLength(1);
    });

    it('derives FOLLOW_UP_DUE once nextFollowUpAt has passed', async () => {
      const due = await request(app).get('/api/networking/contacts?followUpDue=true');
      expect(due.body.map((c: any) => c.name)).toEqual(['Waiting Person']);
      expect(due.body[0].effectiveStatus).toBe('FOLLOW_UP_DUE');
      expect(due.body[0].status).toBe('MESSAGE_SENT');
      expect(due.body[0].nextActions.some((a: any) => a.value === 'FOLLOW_UP')).toBe(true);
      const byStatus = await request(app).get('/api/networking/contacts?status=FOLLOW_UP_DUE');
      expect(byStatus.body).toHaveLength(1);
      const followSort = await request(app).get('/api/networking/contacts?sort=followUp');
      expect(followSort.body[0].name).toBe('Waiting Person');
    });

    it('by-company returns counts, alumni counts and top 3 contacts', async () => {
      const res = await request(app).get('/api/networking/by-company?keys=linear,Acme,missing');
      expect(res.status).toBe(200);
      expect(res.body.linear).toMatchObject({ count: 2, alumniCount: 1 });
      expect(res.body.linear.topContacts[0].name).toBe('Alumni Engineer');
      expect(res.body.acme.count).toBe(3);
      expect(res.body.acme.topContacts).toHaveLength(3);
      expect(res.body.missing).toEqual({ count: 0, alumniCount: 0, topContacts: [] });
    });

    it('facets count derived statuses and companies', async () => {
      const res = await request(app).get('/api/networking/facets');
      expect(res.body.total).toBe(5);
      expect(res.body.followUpDue).toBe(1);
      expect(res.body.status.FOLLOW_UP_DUE).toBe(1);
      expect(res.body.companies.map((c: any) => c.companyKey).sort()).toEqual(['acme', 'linear']);
    });
  });

  describe('status workflow', () => {
    it('REQUEST_SENT sets requestSentAt and a reminder; REPLIED clears it', async () => {
      const c = await prisma.networkingContact.create({ data: { name: 'Sara', company: 'Linear', role: 'EM' } });
      const sent = await request(app).post(`/api/networking/contacts/${c.id}/transition`).send({ newStage: 'REQUEST_SENT' });
      expect(sent.status).toBe(200);
      expect(sent.body.requestSentAt).toBeTruthy();
      const days = Math.round((new Date(sent.body.nextFollowUpAt).getTime() - Date.now()) / DAY);
      expect(days).toBe(7);

      const accepted = await request(app).post(`/api/networking/contacts/${c.id}/transition`).send({ newStage: 'ACCEPTED' });
      expect(accepted.body.acceptedAt).toBeTruthy();
      expect(accepted.body.nextActions[0]).toMatchObject({ kind: 'draft', value: 'REFERRAL_ASK' });

      const replied = await request(app).post(`/api/networking/contacts/${c.id}/transition`).send({ newStage: 'REPLIED' });
      expect(replied.body.nextFollowUpAt).toBeNull();
      expect(replied.body.lastContactAt).toBeTruthy();

      const bad = await request(app).post(`/api/networking/contacts/${c.id}/transition`).send({ newStage: 'BOGUS' });
      expect(bad.status).toBe(400);
    });

    it('every status has at least one next action', async () => {
      const { CONTACT_STATUSES } = await import('../networking/constants');
      const { nextActions } = await import('../networking/crm');
      for (const status of CONTACT_STATUSES) {
        expect(nextActions({ status, nextFollowUpAt: null }).length).toBeGreaterThan(0);
      }
    });
  });

  it('parse-headline suggests role, company, persona and school', async () => {
    const res = await request(app).post('/api/networking/parse-headline').send({ text: 'Talent Acquisition at Razorpay | VIT Chennai' });
    expect(res.body).toMatchObject({ role: 'Talent Acquisition', company: 'Razorpay', persona: 'RECRUITER', school: 'VIT Chennai', vitAlumni: true });
  });
});
