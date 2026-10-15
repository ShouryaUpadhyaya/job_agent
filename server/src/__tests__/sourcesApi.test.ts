import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';

describe('Job Sources API (/api/sources)', () => {
  beforeEach(async () => {
    await prisma.jobSourceConfig.deleteMany({});
  });

  it('GET /api/sources should initialize and return default sources if empty', async () => {
    const res = await request(app).get('/api/sources');
    expect(res.status).toBe(200);
    expect(res.body.sources).toBeInstanceOf(Array);
    expect(res.body.sources.length).toBeGreaterThanOrEqual(4);

    const sourceTypes = res.body.sources.map((s: any) => s.sourceType);
    expect(sourceTypes).toContain('greenhouse');
    expect(sourceTypes).toContain('ashby');
    expect(sourceTypes).toContain('lever');
    expect(sourceTypes).toContain('smartrecruiters');
    expect(sourceTypes).toContain('workable');
    expect(sourceTypes).toContain('remotive');
    expect(sourceTypes).not.toContain('linkedin');
    expect(sourceTypes).not.toContain('wellfound');
  });

  it('POST /api/sources should create a valid new source', async () => {
    const res = await request(app)
      .post('/api/sources')
      .send({
        sourceType: 'lever',
        boardToken: 'netflix',
        name: 'Netflix',
      });

    expect(res.status).toBe(201);
    expect(res.body.source.name).toBe('Netflix');
    expect(res.body.source.boardToken).toBe('netflix');
    expect(res.body.source.enabled).toBe(true);

    const dbRecord = await prisma.jobSourceConfig.findUnique({
      where: {
        sourceType_boardToken: {
          sourceType: 'lever',
          boardToken: 'netflix',
        },
      },
    });
    expect(dbRecord).not.toBeNull();
  });

  it('POST /api/sources should reject invalid sourceType', async () => {
    const res = await request(app)
      .post('/api/sources')
      .send({
        sourceType: 'unsupported-source',
        boardToken: 'foo',
        name: 'Foo',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid sourceType');
  });

  it('PATCH /api/sources/:id should toggle enabled flag', async () => {
    const created = await prisma.jobSourceConfig.create({
      data: {
        sourceType: 'greenhouse',
        boardToken: 'stripe',
        name: 'Stripe',
        enabled: true,
      },
    });

    const res = await request(app)
      .patch(`/api/sources/${created.id}`)
      .send({ enabled: false, name: 'Stripe Inc' });

    expect(res.status).toBe(200);
    expect(res.body.source.enabled).toBe(false);
    expect(res.body.source.name).toBe('Stripe Inc');
  });

  it('DELETE /api/sources/:id should remove the source', async () => {
    const created = await prisma.jobSourceConfig.create({
      data: {
        sourceType: 'ashby',
        boardToken: 'retool',
        name: 'Retool',
      },
    });

    const res = await request(app).delete(`/api/sources/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const found = await prisma.jobSourceConfig.findUnique({ where: { id: created.id } });
    expect(found).toBeNull();
  });
});
