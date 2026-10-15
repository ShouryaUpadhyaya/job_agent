import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseJobAlertEmail, ingestJobAlertEmail } from '../discovery/jobAlerts';
import { buildSearchLinks, LINKEDIN_INDIA_GEO_ID } from '../discovery/searchLinks';
import { getXSources } from '../discovery/xSources';
import { prisma } from '../db';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('parseJobAlertEmail', () => {
  it('parses LinkedIn job-alert HTML and strips tracking from links', () => {
    const jobs = parseJobAlertEmail({
      from: 'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>',
      subject: 'software engineer intern: 3 new jobs',
      html: fixture('linkedin-job-alert.html'),
      receivedAt: '2026-10-14T03:00:00Z',
    });
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({
      externalId: '4012345678',
      source: 'email:linkedin',
      title: 'Software Engineer Intern',
      company: 'Examplesoft Technologies',
      location: 'Bengaluru, Karnataka, India (Hybrid)',
      url: 'https://www.linkedin.com/jobs/view/4012345678/',
    });
    expect(jobs[1]).toMatchObject({ externalId: '4023456789', company: 'Sample Fintech Pvt Ltd', location: 'Pune, Maharashtra, India' });
    expect(jobs[2]).toMatchObject({ title: 'SDE Intern - 2027 Summer', company: 'Demo Cloud Inc.', location: 'India (Remote)' });
    for (const j of jobs) {
      expect(j.url).not.toMatch(/trackingId|trk=|refId/);
      expect(j.publishedAt?.toISOString()).toBe('2026-10-14T03:00:00.000Z');
    }
  });

  it('falls back to the plain-text part', () => {
    const jobs = parseJobAlertEmail({ from: 'jobalerts-noreply@linkedin.com', text: fixture('linkedin-job-alert.txt') });
    expect(jobs.map((j) => [j.externalId, j.title, j.company, j.location])).toEqual([
      ['4012345678', 'Software Engineer Intern', 'Examplesoft Technologies', 'Bengaluru, Karnataka, India'],
      ['4045678901', 'Data Engineering Intern', 'Sample Analytics', 'Mumbai, Maharashtra, India'],
    ]);
  });

  it('parses Naukri alerts', () => {
    const jobs = parseJobAlertEmail({ from: 'Naukri <naukrialerts@naukri.com>', html: fixture('naukri-job-alert.html') });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: '150926500123',
      source: 'email:naukri',
      title: 'Software Developer Trainee',
      company: 'AcmeWorks Solutions',
      location: 'Bengaluru',
      url: 'https://www.naukri.com/job-listings-software-developer-trainee-acmeworks-bengaluru-0-to-1-years-150926500123',
    });
    expect(jobs[1]).toMatchObject({ company: 'PixelForge Labs', location: 'Hyderabad, Remote' });
    expect(jobs[0].description).toContain('Skills: Java, SQL, Spring Boot');
  });

  it('parses Internshala alerts as internships', () => {
    const jobs = parseJobAlertEmail({ from: 'Internshala <student@internshala.com>', html: fixture('internshala-alert.html') });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: 'web-development-internship-in-chennai-at-brightleaf-studio1729012345',
      source: 'email:internshala',
      title: 'Web Development Internship',
      company: 'BrightLeaf Studio',
      location: 'Chennai',
      employmentType: 'INTERNSHIP',
      url: 'https://internshala.com/internship/detail/web-development-internship-in-chennai-at-brightleaf-studio1729012345/',
    });
    expect(jobs[1].location).toBe('Work From Home');
  });

  it('parses Wellfound and Instahyre alerts', () => {
    const wf = parseJobAlertEmail({ from: 'Wellfound <talent@wellfound.com>', html: fixture('wellfound-alert.html') });
    expect(wf.map((j) => [j.externalId, j.company, j.location, j.url])).toEqual([
      ['3456789', 'NimbusAI', 'Remote (India)', 'https://wellfound.com/jobs/3456789-software-engineering-intern'],
      ['3456999', 'OrbitPay', 'Bengaluru', 'https://wellfound.com/jobs/3456999-frontend-engineer-intern'],
    ]);
    const ih = parseJobAlertEmail({ from: 'Instahyre <opportunities@instahyre.com>', html: fixture('instahyre-alert.html') });
    expect(ih).toEqual([
      expect.objectContaining({ externalId: '298765', source: 'email:instahyre', company: 'VectorGrid', location: 'Bangalore' }),
    ]);
  });

  it('detects the site from links when an alert is forwarded', () => {
    const jobs = parseJobAlertEmail({ from: 'me@gmail.com', subject: 'Fwd: job alert', html: fixture('linkedin-job-alert.html') });
    expect(jobs).toHaveLength(3);
  });

  it('ignores unrelated emails', () => {
    expect(parseJobAlertEmail({ from: 'friend@example.com', html: '<p>Lunch? <a href="https://example.com">here</a></p>' })).toEqual([]);
  });

  it('never makes network requests', () => {
    const spy = vi.spyOn(global, 'fetch');
    parseJobAlertEmail({ from: 'jobalerts-noreply@linkedin.com', html: fixture('linkedin-job-alert.html') });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('ingestJobAlertEmail', () => {
  beforeEach(async () => {
    await prisma.jobApplication.deleteMany({});
    await prisma.jobListing.deleteMany({ where: { source: { startsWith: 'email:' } } });
  });

  it('upserts parsed listings idempotently', async () => {
    const email = { from: 'naukrialerts@naukri.com', html: fixture('naukri-job-alert.html') };
    const first = await ingestJobAlertEmail(email);
    expect(first).toMatchObject({ parsed: 2, created: 2, updated: 0 });
    const second = await ingestJobAlertEmail(email);
    expect(second).toMatchObject({ parsed: 2, created: 0, updated: 2 });
    const rows = await prisma.jobListing.findMany({ where: { source: 'email:naukri' } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.title.includes('Intern'))?.isInternship).toBe(true);
  });
});

describe('buildSearchLinks', () => {
  const links = buildSearchLinks(
    { targetRole: 'Software Engineer Intern', skills: ['TypeScript', 'React', 'Node.js'], preferredLocations: ['India', 'Remote'], remoteOk: true, targetGradYear: 2028 },
    ['TypeScript', 'Node.js']
  );
  const byId = (id: string) => new URL(links.find((l) => l.id === id)!.url);

  it('builds a LinkedIn internship search for India in the past week', () => {
    const u = byId('linkedin-india');
    expect(u.hostname).toBe('www.linkedin.com');
    expect(u.searchParams.get('f_E')).toBe('1');
    expect(u.searchParams.get('f_TPR')).toBe('r604800');
    expect(u.searchParams.get('geoId')).toBe(LINKEDIN_INDIA_GEO_ID);
    expect(u.searchParams.get('keywords')).toBe('Software Engineer intern');
    expect(byId('linkedin-remote').searchParams.get('f_WT')).toBe('2');
  });

  it('builds Naukri, Internshala, Wellfound, Google site: and X links', () => {
    expect(byId('naukri').searchParams.get('experience')).toBe('0');
    expect(byId('internshala').pathname).toBe('/internships/keywords-typescript/');
    expect(byId('wellfound').pathname).toBe('/role/l/software-engineer/india');
    const gh = byId('google-greenhouse').searchParams.get('q')!;
    expect(gh).toContain('site:boards.greenhouse.io');
    expect(gh).toContain('"TypeScript"');
    expect(byId('google-ashby').searchParams.get('q')).toContain('site:jobs.ashbyhq.com');
    expect(byId('x-search').searchParams.get('q')).toContain('2028');
  });

  it('omits remote links when the profile does not want remote', () => {
    const l = buildSearchLinks({ targetRole: 'Software Engineer', preferredLocations: ['Pune'], remoteOk: false });
    expect(l.some((x) => x.id === 'linkedin-remote')).toBe(false);
    expect(new URL(l.find((x) => x.id === 'linkedin-india')!.url).searchParams.get('location')).toBe('Pune');
  });
});

describe('X sources', () => {
  it('loads the researched accounts with evidence', () => {
    const data = getXSources();
    expect(data.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const a of data.accounts) {
      expect(a.handle).toBeTruthy();
      expect(a.evidence).toBeTruthy();
    }
  });
});
