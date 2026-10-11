import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma } from './app';

describe('Health Endpoint', () => {
  beforeAll(async () => {
    // Ensure DB is connected
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should return 200 OK and database connected', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      database: 'connected',
    });
  });
});
