import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import { clearGithubCache } from '../networking/github';
import { buildPeopleLinks } from '../networking/peopleLinks';
import { firstNameOf, inferPersona, normalizeLinkedinUrl, normalizeXUrl, parseHeadline } from '../networking/parse';
import { computePriority } from '../networking/priority';
import { isFabricatedContact } from '../scripts/cleanupFakeContacts';

type Route = (path: string) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;

function stubGithub(route: Route) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (!url.startsWith('https://api.github.com')) throw new Error(`unexpected fetch ${url}`);
      const r = route(url.replace('https://api.github.com', '')) || { status: 404, body: {} };
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers });
    })
  );
  return calls;
}

const user = (login: string, extra: Record<string, unknown> = {}) => ({
  login,
  name: null,
  html_url: `https://github.com/${login}`,
  avatar_url: null,
  blog: '',
  twitter_username: null,
  company: null,
  bio: null,
  email: null,
  location: null,
  ...extra,
});

describe('parsing and scoring helpers', () => {
  it('validates and normalises profile URLs', () => {
    expect(normalizeLinkedinUrl('https://in.linkedin.com/in/Some-One?trk=x')).toEqual({ ok: true, value: 'https://www.linkedin.com/in/some-one' });
    expect(normalizeLinkedinUrl('https://www.linkedin.com/company/razorpay').ok).toBe(false);
    expect(normalizeXUrl('https://twitter.com/jack')).toEqual({ ok: true, value: 'https://x.com/jack' });
    expect(normalizeXUrl('https://x.com/home').ok).toBe(false);
  });

  it('infers personas', () => {
    expect(inferPersona('Co-Founder & CTO')).toBe('FOUNDER_CXO');
    expect(inferPersona('Founding Engineer')).toBe('ENGINEER');
    expect(inferPersona('Senior Technical Recruiter')).toBe('RECRUITER');
    expect(inferPersona('Engineering Manager')).toBe('MANAGER');
    expect(inferPersona('Full Stack Developer')).toBe('FULLSTACK');
    expect(inferPersona('Marketing')).toBe('OTHER');
    expect(parseHeadline('SDE-2 @ Razorpay | VIT Vellore').company).toBe('Razorpay');
    expect(firstNameOf('Dr. ananya rao')).toBe('Ananya');
  });

  it('priority follows the playbook ordering', () => {
    const base = { vitAlumni: false, school: null, status: 'RESEARCHED', linkedinUrl: 'x', xUrl: null, email: null, lastContactAt: null, messages: [] };
    const info = { applicationStage: 'APPLIED', recentJobCount: 1 };
    const alumniEng = computePriority({ ...base, vitAlumni: true, persona: 'ENGINEER' }, info).score;
    const eng = computePriority({ ...base, persona: 'ENGINEER' }, info).score;
    const recruiter = computePriority({ ...base, persona: 'RECRUITER' }, info).score;
    const noPipeline = computePriority({ ...base, persona: 'ENGINEER' }, undefined).score;
    const notInterested = computePriority({ ...base, persona: 'ENGINEER', status: 'NOT_INTERESTED' }, info).score;
    const ghosted = computePriority(
      { ...base, persona: 'ENGINEER', status: 'MESSAGE_SENT', messages: [{ type: 'FOLLOW_UP', status: 'SENT', sentAt: new Date(Date.now() - 8 * 86400000) }] },
      info
    ).score;
    expect(alumniEng).toBeGreaterThan(eng);
    expect(eng).toBeGreaterThan(recruiter);
    expect(eng).toBeGreaterThan(noPipeline);
    expect(ghosted).toBeLessThan(eng);
    expect(notInterested).toBeLessThan(ghosted);
    expect(alumniEng).toBeLessThanOrEqual(100);
  });

  it('cleanup script recognises fabricated contacts only', () => {
    expect(isFabricatedContact({ name: 'Senior Software Engineer (Linear)', company: 'Linear', profileUrl: null })).toBe(true);
    expect(isFabricatedContact({ name: 'Engineering Team (vaiu.ai)', company: 'vaiu.ai', profileUrl: null })).toBe(true);
    expect(isFabricatedContact({ name: 'Talent Partner (MAVR)', company: 'MAVR', profileUrl: null })).toBe(true);
    expect(
      isFabricatedContact({ name: 'Real Person', company: 'X', profileUrl: 'https://www.linkedin.com/search/results/people/?keywords=x' })
    ).toBe(true);
    expect(isFabricatedContact({ name: 'Priya Sharma', company: 'Linear', profileUrl: 'https://www.linkedin.com/in/priya' })).toBe(false);
    expect(isFabricatedContact({ name: 'Ravi (Bobby) Kumar', company: 'Linear', profileUrl: null })).toBe(false);
  });
});

describe('people links', () => {
  it('builds alumni + persona searches from the profile school, LinkedIn only as search URLs', () => {
    const links = buildPeopleLinks('Razorpay', { school: 'VIT Vellore' });
    const ids = links.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['linkedin-alumni-0', 'linkedin-alumni-1', 'google-alumni', 'linkedin-swe', 'linkedin-fullstack', 'linkedin-recruiter', 'linkedin-founder', 'x-people', 'github-org']));
    for (const l of links.filter((x) => x.site === 'LinkedIn')) expect(l.url).toMatch(/^https:\/\/www\.linkedin\.com\/search\/results\/people\/\?/);
    const alumni = decodeURIComponent(links.find((l) => l.id === 'linkedin-alumni-1')!.url.replace(/\+/g, ' '));
    expect(alumni).toContain('Razorpay Vellore Institute of Technology');
    const xray = decodeURIComponent(links.find((l) => l.id === 'google-alumni')!.url.replace(/\+/g, ' '));
    expect(xray).toContain('site:linkedin.com/in "Razorpay"');
    expect(buildPeopleLinks('Razorpay', { school: null }).some((l) => l.group === 'ALUMNI')).toBe(false);
  });
});

describe('networking discovery API', () => {
  beforeEach(async () => {
    clearGithubCache();
    await prisma.emailEvent.deleteMany();
    await prisma.networkingMessage.deleteMany();
    await prisma.networkingContact.deleteMany();
    await prisma.candidateProfile.deleteMany();
    await prisma.candidateProfile.create({ data: { name: 'Asha', school: 'VIT Vellore', skills: [] } });
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await prisma.networkingContact.deleteMany();
    await prisma.candidateProfile.deleteMany();
    await prisma.$disconnect();
  });

  it('GET people-links never fetches anything', async () => {
    const calls = stubGithub(() => undefined);
    const res = await request(app).get('/api/networking/companies/Razorpay/people-links?githubOrg=razorpay');
    expect(res.status).toBe(200);
    expect(res.body.links.find((l: any) => l.id === 'github-org').url).toBe('https://github.com/razorpay');
    expect(calls).toHaveLength(0);
  });

  it('lists public org members with only published fields, and caches for an hour', async () => {
    const calls = stubGithub((p) => {
      if (p.startsWith('/search/users')) return { body: { items: [{ login: 'razorpay', html_url: 'https://github.com/razorpay' }] } };
      if (p === '/orgs/razorpay') return { body: { login: 'razorpay', name: 'Razorpay', html_url: 'https://github.com/razorpay' } };
      if (p.startsWith('/orgs/razorpay/public_members')) return { body: [{ login: 'dev1', type: 'User' }, { login: 'dev2', type: 'User' }] };
      if (p === '/users/dev1') return { body: user('dev1', { name: 'Dev One', company: '@razorpay', twitter_username: 'devone', email: 'dev1@example.com' }) };
      if (p === '/users/dev2') return { body: user('dev2') };
    });
    const res = await request(app).get('/api/networking/companies/Razorpay/github-people');
    expect(res.status).toBe(200);
    expect(res.body.org.login).toBe('razorpay');
    expect(res.body.source).toBe('members');
    expect(res.body.people).toHaveLength(2);
    expect(res.body.people[0]).toMatchObject({ login: 'dev1', name: 'Dev One', email: 'dev1@example.com', twitterUsername: 'devone', companyMatches: true, existingContactId: null });
    expect(res.body.people[1]).toMatchObject({ login: 'dev2', name: null, email: null, blog: null });
    const n = calls.length;
    await request(app).get('/api/networking/companies/Razorpay/github-people');
    expect(calls.length).toBe(n);
  });

  it('falls back to top contributors when members are hidden, and honours an org override', async () => {
    stubGithub((p) => {
      if (p === '/orgs/acme-oss') return { body: { login: 'acme-oss', html_url: 'https://github.com/acme-oss' } };
      if (p.startsWith('/orgs/acme-oss/public_members')) return { body: [] };
      if (p.startsWith('/search/repositories')) return { body: { items: [{ full_name: 'acme-oss/core' }] } };
      if (p.startsWith('/repos/acme-oss/core/contributors'))
        return { body: [{ login: 'renovate[bot]', type: 'Bot' }, { login: 'c1', type: 'User', contributions: 50 }] };
      if (p === '/users/c1') return { body: user('c1', { company: 'Freelance' }) };
    });
    const res = await request(app).get('/api/networking/companies/Acme/github-people?org=acme-oss');
    expect(res.body.source).toBe('contributors');
    expect(res.body.people.map((p: any) => p.login)).toEqual(['c1']);
    expect(res.body.people[0]).toMatchObject({ via: 'contributor', companyMatches: false, contributions: 50 });
    expect(res.body.message).toMatch(/contributors/);
  });

  it('reports rate limits instead of failing', async () => {
    stubGithub(() => ({ status: 403, body: { message: 'rate limit' }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1900000000' } }));
    const res = await request(app).get('/api/networking/companies/Zepto/github-people');
    expect(res.status).toBe(200);
    expect(res.body.rateLimited).toBe(true);
    expect(res.body.people).toEqual([]);
  });

  it('adds a GitHub person as a contact using only their public profile', async () => {
    stubGithub((p) => {
      if (p === '/users/dev1') return { body: user('dev1', { name: 'Dev One', email: 'dev1@example.com', twitter_username: 'devone', bio: 'Backend engineer' }) };
      if (p === '/users/dev2') return { body: user('dev2') };
    });
    const a = await request(app).post('/api/networking/companies/Razorpay/github-people/add').send({ login: 'dev1' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ name: 'Dev One', source: 'GITHUB', verified: false, email: 'dev1@example.com', emailSource: 'github', xUrl: 'https://x.com/devone', githubUrl: 'https://github.com/dev1', persona: 'ENGINEER' });
    const b = await request(app).post('/api/networking/companies/Razorpay/github-people/add').send({ login: 'dev2' });
    expect(b.body).toMatchObject({ name: 'dev2', email: null, emailSource: null, xUrl: null });
    const again = await request(app).post('/api/networking/companies/Razorpay/github-people/add').send({ login: 'dev1' });
    expect(again.status).toBe(409);
  });
});
