import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../app';

describe('POST /api/profiles', () => {
  beforeAll(async () => {
    await prisma.document.deleteMany({});
    await prisma.jobApplication.deleteMany({});
    await prisma.candidateProfile.deleteMany();
  });

  afterAll(async () => {
    await prisma.document.deleteMany({});
    await prisma.jobApplication.deleteMany({});
    await prisma.candidateProfile.deleteMany();
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
  });

  it('should update an existing profile', async () => {
    const createRes = await request(app)
      .post('/api/profiles')
      .send({
        name: 'Jane Doe',
      });
    
    expect(createRes.status).toBe(200);
    const profileId = createRes.body.id;

    const updateRes = await request(app)
      .post('/api/profiles')
      .send({
        id: profileId,
        name: 'Jane Smith',
        skills: ['Python']
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.id).toBe(profileId);
    expect(updateRes.body.name).toBe('Jane Smith');
    expect(updateRes.body.skills).toEqual(['Python']);
  });

  it('should return 400 if name is missing', async () => {
    const res = await request(app)
      .post('/api/profiles')
      .send({
        skills: ['JavaScript']
      });
    
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
