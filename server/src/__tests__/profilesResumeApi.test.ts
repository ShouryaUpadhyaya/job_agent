import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';

describe('Profiles & Resume Ingestion API', () => {
  beforeEach(async () => {
    await prisma.jobApplication.deleteMany({});
    await prisma.document.deleteMany({});
    await prisma.candidateProfile.deleteMany({});
  });

  it('GET /api/profiles should return default profile if none exists', async () => {
    const res = await request(app).get('/api/profiles');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Shourya Upadhyaya');
    expect(res.body.skills).toBeInstanceOf(Array);
    expect(res.body.skills).toContain('TypeScript');
  });

  it('POST /api/profiles/upload-resume should parse raw text and update profile', async () => {
    const resumeText = `
Alex Mercer
alex.mercer@gmail.com | +1 555-019-2834
Bachelor of Science in Computer Science, Stanford University, Class of 2027

Skills: TypeScript, Python, React, Go, Docker, PostgreSQL, GraphQL

Experience:
- Developed distributed data processing pipelines using Python and Docker.
`;

    const res = await request(app)
      .post('/api/profiles/upload-resume')
      .send({ rawText: resumeText });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.parsedSummary.email).toBe('alex.mercer@gmail.com');
    expect(res.body.parsedSummary.skills).toContain('TypeScript');
    expect(res.body.parsedSummary.skills).toContain('Python');
    expect(res.body.parsedSummary.skills).toContain('Docker');
    expect(res.body.parsedSummary.graduationYear).toBe(2027);

    // Verify stored document
    const doc = await prisma.document.findUnique({ where: { id: res.body.documentId } });
    expect(doc).not.toBeNull();
    expect(doc?.type).toBe('RESUME');
  });
});
