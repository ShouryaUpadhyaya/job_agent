import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../app';

async function reset() {
  await prisma.document.deleteMany({});
  await prisma.jobApplication.deleteMany({});
  await prisma.resume.deleteMany({});
  await prisma.candidateProfile.deleteMany();
}

describe('POST /api/profiles', () => {
  beforeAll(reset);

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it('should create a new profile', async () => {
    const res = await request(app)
      .post('/api/profiles')
      .send({
        name: 'John Doe',
        skills: ['TypeScript', 'Node.js'],
        experience: [{ company: 'Acme', role: 'Developer' }],
        education: { degree: 'BSc Computer Science' }
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('John Doe');
    expect(res.body.skills).toEqual(['TypeScript', 'Node.js']);
    expect(res.body.experience).toEqual([{ company: 'Acme', role: 'Developer' }]);
    expect(res.body.education).toEqual({ degree: 'BSc Computer Science' });
    expect(res.body.rescore.status).toBe('done');
  });

  it('should update an existing profile', async () => {
    const createRes = await request(app).post('/api/profiles').send({ name: 'Jane Doe' });
    expect(createRes.status).toBe(200);
    const profileId = createRes.body.id;

    const updateRes = await request(app)
      .post('/api/profiles')
      .send({ id: profileId, name: 'Jane Smith', skills: ['Python', ' python ', 'golang'] });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.id).toBe(profileId);
    expect(updateRes.body.name).toBe('Jane Smith');
    expect(updateRes.body.skills).toEqual(['Python', 'Go']);
  });

  it('does not wipe rawResume or unrelated fields on save', async () => {
    const profile = await prisma.candidateProfile.findFirstOrThrow({ orderBy: { id: 'asc' } });
    await prisma.candidateProfile.update({
      where: { id: profile.id },
      data: { rawResume: 'MY RESUME', phone: '+91 99999 00000', applicationAnswers: { wellfoundRules: { dailyCap: 9 }, gender: 'Male' } },
    });

    const res = await request(app).post('/api/profiles').send({
      name: 'Jane Smith',
      location: 'Vellore',
      preferredLocations: ['Bengaluru', 'Remote', 'remote'],
      remoteOk: false,
      githubUrl: 'https://github.com/jane',
      applicationAnswers: { noticePeriod: 'Immediate', gender: null },
    });
    expect(res.status).toBe(200);
    expect(res.body.rawResume).toBe('MY RESUME');
    expect(res.body.phone).toBe('+91 99999 00000');
    expect(res.body.location).toBe('Vellore');
    expect(res.body.preferredLocations).toEqual(['Bengaluru', 'Remote']);
    expect(res.body.remoteOk).toBe(false);
    expect(res.body.applicationAnswers).toEqual({ wellfoundRules: { dailyCap: 9 }, noticePeriod: 'Immediate' });
  });

  it('PATCH updates single fields without requiring a name', async () => {
    const res = await request(app).patch('/api/profiles').send({ targetGradYear: 2027, school: '' });
    expect(res.status).toBe(200);
    expect(res.body.targetGradYear).toBe(2027);
    expect(res.body.school).toBeNull();
    expect(res.body.name).toBe('Jane Smith');
  });

  it('rejects malformed fields', async () => {
    expect((await request(app).patch('/api/profiles').send({ targetGradYear: 'soon' })).status).toBe(400);
    expect((await request(app).patch('/api/profiles').send({ experience: { a: 1 } })).status).toBe(400);
    expect((await request(app).patch('/api/profiles').send({ remoteOk: 'yes' })).status).toBe(400);
  });

  it('should return 400 if name is missing', async () => {
    const res = await request(app).post('/api/profiles').send({ skills: ['JavaScript'] });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
