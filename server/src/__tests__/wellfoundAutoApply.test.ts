import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app, prisma } from '../app';
import {
  parseWellfoundCsv,
  cleanWellfoundCompanyName,
  syncWellfoundApplicationsFromCsv,
} from '../connectors/wellfoundAutoApplyService';

const SECRET = 'AIzaTestSecretKey1234567890';

const csv = (rows: string[]) =>
  `﻿"Date","Site","Role","Company","CTC/Salary","Skills","Job Link","Job Description"\n${rows.join('\n')}\n`;

const sampleCsv = csv([
  `"10/13/2026, 11:13:08 AM","wellfound","SDE Intern","CertaActively HiringPromotedProcurement platform51-200 Employees","₹25,000 – ₹30,000","","https://wellfound.com/jobs/3263581-sde-intern","Leading procurement platform."`,
  `"10/13/2026, 11:16:50 AM","wellfound","Full Stack Developer Intern","The Date CrewActively Hiring51-200 Employees","₹2.4 LPA","React; Node.js","https://wellfound.com/jobs/4824501-full-stack-developer-intern","Building an app."`,
  // the same job applied to twice (old runner bug) and once without a company
  `"10/14/2026, 4:14:22 PM","wellfound","BACKEND DEVELOPER INTERN","Capital Compute Technologies","","","https://wellfound.com/jobs/4112529-java-developer-intern","We are hiring."`,
  `"2026-10-14T11:22:16.000Z","wellfound","BACKEND DEVELOPER INTERN","","","","https://wellfound.com/jobs/4112529-java-developer-intern | ","**READ JD CAREFULLY** About the Role: backend work"`,
]);

let tmp: string;
let csvPath: string;
let envPath: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-api-'));
  csvPath = path.join(tmp, 'applications.csv');
  envPath = path.join(tmp, '.env');
  process.env.WELLFOUND_APPLICATIONS_CSV = csvPath;
  process.env.WELLFOUND_ENV_FILE = envPath;
  process.env.WELLFOUND_RUNNER_CONFIG = path.join(tmp, 'runner-config.json');
  process.env.WELLFOUND_EXECUTOR = 'local';
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.WELLFOUND_APPLICATIONS_CSV;
  delete process.env.WELLFOUND_ENV_FILE;
  delete process.env.WELLFOUND_RUNNER_CONFIG;
});

beforeEach(async () => {
  await prisma.emailEvent.deleteMany({});
  await prisma.document.deleteMany({});
  await prisma.jobApplication.deleteMany({});
  await prisma.networkingMessage.deleteMany({});
  await prisma.networkingContact.deleteMany({});
  await prisma.jobListing.deleteMany({});
  await prisma.resume.deleteMany({});
  await prisma.candidateProfile.deleteMany({});
  await prisma.candidateProfile.create({
    data: { name: 'Shourya Upadhyaya', email: 'shourya@example.org', skills: ['Node.js', 'React'], rawResume: 'RESUME TEXT' },
  });
  fs.writeFileSync(csvPath, sampleCsv);
});

describe('CSV parsing', () => {
  it('parses quotes, BOM and cleans scraped company badges', () => {
    const rows = parseWellfoundCsv(sampleCsv);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ role: 'SDE Intern', company: 'Certa', salary: '₹25,000 – ₹30,000' });
    expect(rows[1]).toMatchObject({ company: 'The Date Crew', skills: 'React; Node.js' });
    expect(rows[3].company).toBe(''); // "About the Role" is not a company
  });

  it('cleans company text generically (no hard-coded id map)', () => {
    expect(cleanWellfoundCompanyName('The Date CrewActively Hiring51-200 Employees')).toBe('The Date Crew');
    expect(cleanWellfoundCompanyName('Superfluid AI')).toBe('Superfluid AI');
    expect(cleanWellfoundCompanyName('', 'https://wellfound.com/jobs/3263581-sde-intern')).toBe('');
    expect(cleanWellfoundCompanyName('', undefined, undefined, '*About Acme Robotics* We build robots')).toBe('Acme Robotics');
  });
});

describe('CSV → pipeline sync', () => {
  it('imports each job once, tags it as wellfound, and creates no contacts', async () => {
    const result = await syncWellfoundApplicationsFromCsv(csvPath);
    expect(result).toMatchObject({ totalRows: 4, uniqueJobs: 3, newImported: 3, alreadyTracked: 0, errors: [] });

    const apps = await prisma.jobApplication.findMany({ include: { jobListing: true } });
    expect(apps).toHaveLength(3);
    for (const a of apps) {
      expect(a.stage).toBe('APPLIED');
      expect(a.source).toBe('wellfound');
      expect(a.companyKey).not.toBe('');
    }
    const backend = apps.find((a) => a.jobListing.externalId === '4112529')!;
    expect(backend.jobListing.company).toBe('Capital Compute Technologies');
    expect(backend.companyKey).toBe('capitalcompute');
    expect(backend.submittedAt?.toISOString()).toBe('2026-10-14T10:44:22.000Z'); // earliest row, parsed as IST

    expect(await prisma.networkingContact.count()).toBe(0);
  });

  it('is idempotent', async () => {
    await syncWellfoundApplicationsFromCsv(csvPath);
    const counts = async () => [await prisma.jobListing.count(), await prisma.jobApplication.count(), await prisma.networkingContact.count()];
    const before = await counts();
    const again = await syncWellfoundApplicationsFromCsv(csvPath);
    expect(again).toMatchObject({ newImported: 0, alreadyTracked: 3, advanced: 0 });
    expect(await counts()).toEqual(before);
  });

  it('never downgrades a stage, but advances a bookmarked one', async () => {
    await syncWellfoundApplicationsFromCsv(csvPath);
    const apps = await prisma.jobApplication.findMany({ include: { jobListing: true }, orderBy: { createdAt: 'asc' } });
    const [a, b, c] = apps;
    await prisma.jobApplication.update({ where: { id: a.id }, data: { stage: 'INTERVIEWING', status: 'INTERVIEWING' } });
    await prisma.jobApplication.update({ where: { id: b.id }, data: { stage: 'REJECTED', status: 'REJECTED' } });
    await prisma.jobApplication.update({ where: { id: c.id }, data: { stage: 'BOOKMARKED', status: 'DRAFT' } });

    const result = await syncWellfoundApplicationsFromCsv(csvPath);
    expect(result.advanced).toBe(1);
    const after = Object.fromEntries((await prisma.jobApplication.findMany()).map((x) => [x.id, x.stage]));
    expect(after[a.id]).toBe('INTERVIEWING');
    expect(after[b.id]).toBe('REJECTED');
    expect(after[c.id]).toBe('APPLIED');
  });

  it('matches an application tracked from another source by companyKey + title', async () => {
    const profile = (await prisma.candidateProfile.findFirst())!;
    const listing = await prisma.jobListing.create({
      data: { externalId: 'manual-1', source: 'manual', title: 'SDE Intern', company: 'Certa Inc.', url: 'https://x', description: 'd', companyKey: 'certa' },
    });
    await prisma.jobApplication.create({
      data: { jobListingId: listing.id, candidateProfileId: profile.id, stage: 'INTERVIEWING', companyKey: 'certa', source: 'manual' },
    });
    const result = await syncWellfoundApplicationsFromCsv(csvPath);
    expect(result.newImported).toBe(2);
    expect(result.alreadyTracked).toBe(1);
    expect(await prisma.jobApplication.count({ where: { companyKey: 'certa' } })).toBe(1);
  });
});

describe('config API', () => {
  beforeEach(() => {
    process.env.GEMINI_KEY = SECRET;
    fs.writeFileSync(envPath, '# my settings\nGOOGLE_EMAIL=me@example.com\nGEMINI_KEY=old-key\nDATABASE_URL="postgres://x"\n');
  });
  afterAll(() => {
    process.env.GEMINI_KEY = '';
  });

  it('GET /config returns the profile and never the Gemini key', async () => {
    const res = await request(app).get('/api/wellfound/config');
    expect(res.status).toBe(200);
    expect(res.body.geminiConfigured).toBe(true);
    expect(res.body.profile.name).toBe('Shourya Upadhyaya');
    expect(res.body.rules).toMatchObject({ dailyCap: 25, autoTickTerms: true });
    expect(res.body.profile.gender).toBe('');
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain('GEMINI_KEY');
  });

  it('PUT /config saves to the profile, keeps rawResume, preserves unknown .env keys', async () => {
    const res = await request(app)
      .put('/api/wellfound/config')
      .send({
        profile: { phone: '+91 90000 00000', gender: 'Male', highlights: ['One', 'Two'], skills: 'Node.js, Redis', noticePeriod: '2 weeks' },
        rules: { dailyCap: 12, autoTickTerms: false },
        geminiKey: 'AIzaNewKey_abcdefghijkl',
      });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('AIzaNewKey');
    expect(res.body.rules).toMatchObject({ dailyCap: 12, autoTickTerms: false });

    const env = fs.readFileSync(envPath, 'utf8');
    expect(env).toContain('# my settings');
    expect(env).toContain('GOOGLE_EMAIL=me@example.com');
    expect(env).toContain('DATABASE_URL="postgres://x"');
    expect(env).toContain('GEMINI_KEY=AIzaNewKey_abcdefghijkl');
    expect(env).not.toContain('old-key');

    const profile = (await prisma.candidateProfile.findFirst())!;
    expect(profile.phone).toBe('+91 90000 00000');
    expect(profile.skills).toEqual(['Node.js', 'Redis']);
    expect(profile.rawResume).toBe('RESUME TEXT');
    expect(profile.applicationAnswers).toMatchObject({ gender: 'Male', highlights: ['One', 'Two'], noticePeriod: '2 weeks', wellfoundRules: { dailyCap: 12 } });

    const cfg = await request(app).get('/api/wellfound/config');
    expect(cfg.body.profile.highlights).toEqual(['One', 'Two']);
    expect(cfg.body.sources.phone).toBe('profile');
  });

  it('PUT /config validates the daily cap and the key format', async () => {
    expect((await request(app).put('/api/wellfound/config').send({ rules: { dailyCap: 0 } })).status).toBe(400);
    expect((await request(app).put('/api/wellfound/config').send({ geminiKey: 'bad key\nINJECT=1' })).status).toBe(400);
    expect(fs.readFileSync(envPath, 'utf8')).not.toContain('INJECT');
  });
});

describe('applications + overview', () => {
  it('computes today from CSV dates in IST, not from the state file', async () => {
    const now = new Date();
    fs.writeFileSync(csvPath, csv([
      `"${now.toISOString()}","wellfound","Intern A","Acme","","","https://wellfound.com/jobs/111-a",""`,
      `"10/13/2026, 11:13:08 AM","wellfound","Intern B","Beta","","","https://wellfound.com/jobs/222-b",""`,
    ]));
    const res = await request(app).get('/api/wellfound/applications');
    expect(res.status).toBe(200);
    expect(res.body.today).toBe(1);
    expect(res.body.applications[0]).toMatchObject({ role: 'Intern A', isToday: true });

    const ov = await request(app).get('/api/wellfound/overview');
    expect(ov.status).toBe(200);
    expect(ov.body.stats).toMatchObject({ today: 1, dailyCap: 25, remainingToday: 24, totalApplications: 2 });
  });

  it('POST /sync-database syncs the configured CSV', async () => {
    const res = await request(app).post('/api/wellfound/sync-database');
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ uniqueJobs: 3 });
  });
});

describe('Zen script endpoint', () => {
  beforeEach(() => {
    process.env.GEMINI_KEY = SECRET;
  });

  it('builds a dry run without the key by default', async () => {
    const res = await request(app).get('/api/wellfound/script');
    expect(res.status).toBe(200);
    expect(res.headers['x-wellfound-mode']).toBe('DRY_RUN');
    expect(res.text).toContain('DRY_RUN: true');
    expect(res.text).not.toContain('DRY_RUN: false');
    expect(res.text).not.toContain(SECRET);
  });

  it('includes the key only when asked, and live only when asked', async () => {
    const withKey = await request(app).get('/api/wellfound/script?includeKey=1');
    expect(withKey.text).toContain(SECRET);
    expect(withKey.headers['x-gemini-key']).toBe('included');
    const live = await request(app).get('/api/wellfound/script?mode=live');
    expect(live.text).toContain('DRY_RUN: false');
  });
});
