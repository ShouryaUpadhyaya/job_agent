import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';

const BACKEND = `Sam Lee
sam@lee.dev
SKILLS
Languages: Go, Java, SQL
Backend: Spring Boot, PostgreSQL, Kafka, Docker`;

const FRONTEND = `Sam Lee
sam@lee.dev
SKILLS
Frontend: React, TypeScript, Next.js, Tailwind CSS
Tested Google Analytics dashboards.`;

async function reset() {
  await prisma.jobApplication.deleteMany({});
  await prisma.document.deleteMany({});
  await prisma.networkingContact.updateMany({ data: { targetJobId: null } });
  await prisma.jobListing.deleteMany({});
  await prisma.resume.deleteMany({});
  await prisma.candidateProfile.deleteMany({});
}

describe('Resumes API', () => {
  let backendId = '';
  let frontendId = '';

  beforeAll(async () => {
    await reset();
    await prisma.candidateProfile.create({ data: { name: 'Sam Lee', skills: ['Java'], targetRole: 'Software Engineer Intern' } });
    await prisma.jobListing.createMany({
      data: [
        { externalId: 'r-1', source: 'test', title: 'Backend Engineer Intern', company: 'Acme', url: 'https://a', description: 'Java, Spring Boot, Kafka and PostgreSQL microservices. Internship.' },
        { externalId: 'r-2', source: 'test', title: 'Frontend Engineer Intern', company: 'Beta', url: 'https://b', description: 'React, TypeScript, Next.js and Tailwind. Internship.' },
      ],
    });
  });

  afterAll(reset);

  it('rejects an empty upload', async () => {
    const res = await request(app).post('/api/resumes').send({ content: '   ' });
    expect(res.status).toBe(400);
  });

  it('creates the first resume from pasted text as the default and extracts vocabulary skills', async () => {
    const res = await request(app).post('/api/resumes').send({ label: 'Backend', targetCategory: 'backend', content: BACKEND });
    expect(res.status).toBe(201);
    backendId = res.body.resume.id;
    expect(res.body.resume.isDefault).toBe(true);
    expect(res.body.resume.skills).toEqual(expect.arrayContaining(['Go', 'Java', 'SQL', 'Spring Boot', 'PostgreSQL', 'Kafka', 'Docker']));
    expect(res.body.rescore.status).toBe('done');
    const profile = await prisma.candidateProfile.findFirstOrThrow();
    expect(profile.rawResume).toBe(BACKEND);
    expect(profile.email).toBe('sam@lee.dev'); // filled because it was empty
  });

  it('creates a second resume from an uploaded text file without changing the default', async () => {
    const res = await request(app)
      .post('/api/resumes')
      .field('targetCategory', 'frontend')
      .attach('resume', Buffer.from(FRONTEND), { filename: 'Sam_Frontend.txt', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    frontendId = res.body.resume.id;
    expect(res.body.resume.label).toBe('Sam Frontend');
    expect(res.body.resume.fileName).toBe('Sam_Frontend.txt');
    expect(res.body.resume.isDefault).toBe(false);
    expect(res.body.resume.skills).not.toContain('Go'); // "Google" is not Go
  });

  it('lists resumes with per-resume best-for counts after rescoring', async () => {
    const res = await request(app).get('/api/resumes');
    expect(res.status).toBe(200);
    expect(res.body.resumes.map((r: any) => r.id)).toEqual([backendId, frontendId]);
    const counts = Object.fromEntries(res.body.resumes.map((r: any) => [r.label, r.bestForCount]));
    expect(counts).toEqual({ Backend: 1, 'Sam Frontend': 1 });
    const backendJob = await prisma.jobListing.findFirstOrThrow({ where: { externalId: 'r-1' } });
    expect(backendJob.bestResumeId).toBe(backendId);
  });

  it('updates label and skills (removal included) and can re-extract skills', async () => {
    let res = await request(app).patch(`/api/resumes/${frontendId}`).send({ label: 'Frontend', skills: ['React', 'reactjs', 'TypeScript'] });
    expect(res.status).toBe(200);
    expect(res.body.resume.label).toBe('Frontend');
    expect(res.body.resume.skills).toEqual(['React', 'TypeScript']);

    res = await request(app).patch(`/api/resumes/${frontendId}`).send({ reextractSkills: true });
    expect(res.body.resume.skills).toEqual(expect.arrayContaining(['Next.js', 'Tailwind']));

    res = await request(app).patch(`/api/resumes/${frontendId}`).send({ label: '  ' });
    expect(res.status).toBe(400);
  });

  it('switches the default so exactly one resume is default', async () => {
    const res = await request(app).post(`/api/resumes/${frontendId}/default`);
    expect(res.status).toBe(200);
    const defaults = await prisma.resume.findMany({ where: { isDefault: true } });
    expect(defaults.map((r) => r.id)).toEqual([frontendId]);
    const profile = await prisma.candidateProfile.findFirstOrThrow();
    expect(profile.rawResume).toBe(FRONTEND);
  });

  it('deleting the default reassigns it, and the last resume cannot be deleted', async () => {
    let res = await request(app).delete(`/api/resumes/${frontendId}`);
    expect(res.status).toBe(200);
    expect(res.body.newDefaultId).toBe(backendId);
    const jobs = await prisma.jobListing.findMany();
    expect(jobs.every((j) => j.bestResumeId === backendId)).toBe(true);

    res = await request(app).delete(`/api/resumes/${backendId}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/at least one resume/);
  });

  it('returns 404 for unknown resumes', async () => {
    expect((await request(app).patch('/api/resumes/nope').send({ label: 'x' })).status).toBe(404);
    expect((await request(app).get('/api/resumes/nope')).status).toBe(404);
  });
});
