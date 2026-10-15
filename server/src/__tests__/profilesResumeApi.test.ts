import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';

async function reset() {
  await prisma.jobApplication.deleteMany({});
  await prisma.document.deleteMany({});
  await prisma.resume.deleteMany({});
  await prisma.candidateProfile.deleteMany({});
}

describe('Profiles & Resume Ingestion API', () => {
  beforeEach(reset);

  it('GET /api/profiles creates a neutral placeholder profile when none exists', async () => {
    const res = await request(app).get('/api/profiles');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Your Name');
    expect(res.body.email).toBeNull();
    expect(res.body.resumes).toEqual([]);
    expect(res.body.documents).toEqual([]);
  });

  it('POST /api/profiles/upload-resume parses text, adds a default resume and fills only empty fields', async () => {
    await prisma.candidateProfile.create({ data: { name: 'Your Name', skills: [], phone: '+91 11111 11111' } });
    const resumeText = `
Alex Mercer
alex.mercer@gmail.com | +1 555-019-2834 | github.com/alexm
Bachelor of Science in Computer Science, Stanford University, Class of 2027

Skills: TypeScript, Python, React, Go, Docker, PostgreSQL, GraphQL

Experience:
- Developed distributed data processing pipelines using Python and Docker.
`;

    const res = await request(app).post('/api/profiles/upload-resume').send({ rawText: resumeText });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.parsedSummary.email).toBe('alex.mercer@gmail.com');
    expect(res.body.parsedSummary.skills).toEqual(expect.arrayContaining(['TypeScript', 'Python', 'Docker']));
    expect(res.body.parsedSummary.graduationYear).toBe(2027);
    expect(res.body.resume.isDefault).toBe(true);
    expect(res.body.resume.label).toBe('General');

    const profile = res.body.profile;
    expect(profile.name).toBe('Alex Mercer'); // placeholder replaced
    expect(profile.phone).toBe('+91 11111 11111'); // user value kept
    expect(profile.githubUrl).toBe('https://github.com/alexm');
    expect(profile.rawResume).toContain('Alex Mercer');

    const doc = await prisma.document.findUnique({ where: { id: res.body.documentId } });
    expect(doc?.type).toBe('RESUME');
    expect(doc?.version).toBe(1);

    const second = await request(app).post('/api/profiles/upload-resume').send({ rawText: resumeText + '\nKubernetes' });
    expect(second.status).toBe(200);
    expect(second.body.resume.isDefault).toBe(false);
    const doc2 = await prisma.document.findUnique({ where: { id: second.body.documentId } });
    expect(doc2?.version).toBe(2);
  });
});
