import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../app';
import {
  parseWellfoundCsv,
  cleanWellfoundCompanyName,
  syncWellfoundApplicationsFromCsv,
} from '../connectors/wellfoundAutoApplyService';
import fs from 'fs';
import path from 'path';

describe('Wellfound AutoApply Backend Integration & Sync', () => {
  const sampleCsvContent = `\uFEFF"Date","Site","Role","Company","CTC/Salary","Skills","Job Link","Job Description"
"10/13/2026, 11:13:08 AM","wellfound","SDE Intern","CertaActively HiringPromotedProcurement & Compliance Platform of the future51-200 Employees","₹25,000 – ₹30,000","","https://wellfound.com/jobs/3263581-sde-intern","Leading procurement platform."
"10/13/2026, 11:16:50 AM","wellfound","Full Stack Developer Intern","The Date CrewActively Hiring51-200 Employees","₹2.4 LPA","React; Node.js","https://wellfound.com/jobs/4824501-full-stack-developer-intern","Building AI-first relationships app."
`;

  beforeEach(async () => {
    await prisma.jobApplication.deleteMany({});
    await prisma.networkingMessage.deleteMany({});
    await prisma.networkingContact.deleteMany({});
    await prisma.jobListing.deleteMany({ where: { source: 'wellfound' } });

    // Ensure candidate profile exists
    let profile = await prisma.candidateProfile.findFirst();
    if (!profile) {
      await prisma.candidateProfile.create({
        data: {
          name: 'Shourya Upadhyaya',
          email: 'shouryaupadhyaya26@gmail.com',
          targetRole: 'Software Engineer Intern',
          skills: ['JavaScript', 'TypeScript', 'Node.js', 'React.js', 'PostgreSQL'],
        },
      });
    }
  });

  describe('CSV Parser & Normalizer', () => {
    it('accurately parses CSV with quotes, BOM, and delimiters', () => {
      const rows = parseWellfoundCsv(sampleCsvContent);
      expect(rows.length).toBe(2);
      expect(rows[0].role).toBe('SDE Intern');
      expect(rows[0].company).toBe('Decentro');
      expect(rows[0].salary).toBe('₹25,000 – ₹30,000');
      expect(rows[1].role).toBe('Full Stack Developer Intern');
      expect(rows[1].skills).toBe('React; Node.js');
    });

    it('cleans noisy company text scraped from HTML headers', () => {
      const cleaned1 = cleanWellfoundCompanyName('CertaActively HiringPromotedProcurement & Compliance Platform of the future51-200 Employees');
      expect(cleaned1).toBe('Certa');

      const cleaned2 = cleanWellfoundCompanyName('The Date CrewActively Hiring51-200 Employees');
      expect(cleaned2).toBe('The Date Crew');

      const cleaned3 = cleanWellfoundCompanyName('Superfluid AI');
      expect(cleaned3).toBe('Superfluid AI');
    });
  });

  describe('Database Ingestion & Networking Contact Generation', () => {
    it('syncs CSV rows into JobListing, JobApplication, and NetworkingContacts', async () => {
      const tempCsvPath = path.join(__dirname, 'temp_test_applications.csv');
      fs.writeFileSync(tempCsvPath, sampleCsvContent, 'utf8');

      try {
        const result = await syncWellfoundApplicationsFromCsv(tempCsvPath);
        expect(result.totalRows).toBe(2);
        expect(result.newImported).toBe(2);
        expect(result.contactsCreated).toBe(4); // 2 contacts per company

        // Verify database records
        const listings = await prisma.jobListing.findMany({ where: { source: 'wellfound' } });
        expect(listings.length).toBe(2);

        const applications = await prisma.jobApplication.findMany({
          where: { stage: 'APPLIED' },
          include: { jobListing: true },
        });
        expect(applications.length).toBe(2);
        expect(applications.map((a) => a.jobListing.company)).toContain('Decentro');

        const contacts = await prisma.networkingContact.findMany({});
        expect(contacts.length).toBe(4);
        expect(contacts.some((c) => c.company === 'Decentro' && c.vitAlumni)).toBe(true);

        // Idempotency check: running sync again does not duplicate applications
        const repeatResult = await syncWellfoundApplicationsFromCsv(tempCsvPath);
        expect(repeatResult.newImported).toBe(0);
        expect(repeatResult.alreadyTracked).toBe(2);

        const listingsAfter = await prisma.jobListing.findMany({ where: { source: 'wellfound' } });
        expect(listingsAfter.length).toBe(2);
      } finally {
        if (fs.existsSync(tempCsvPath)) {
          fs.unlinkSync(tempCsvPath);
        }
      }
    });
  });

  describe('REST API Endpoints', () => {
    it('GET /api/wellfound/config returns configuration and state', async () => {
      const res = await request(app).get('/api/wellfound/config');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('env');
      expect(res.body).toHaveProperty('dailyState');
      expect(res.body).toHaveProperty('runnerState');
      expect(typeof res.body.totalCsvApplications).toBe('number');
    });

    it('GET /api/wellfound/applications reads applications', async () => {
      const res = await request(app).get('/api/wellfound/applications');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.applications)).toBe(true);
    });

    it('POST /api/wellfound/sync-database performs synchronization', async () => {
      const res = await request(app).post('/api/wellfound/sync-database');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result).toHaveProperty('totalRows');
    });

    it('GET /api/wellfound/script returns generated JS script', async () => {
      const res = await request(app).get('/api/wellfound/script');
      expect(res.status).toBe(200);
      expect(res.text).toContain('wellfound');
    });
  });
});
